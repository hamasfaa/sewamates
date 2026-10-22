CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE rental_status AS ENUM ('DIAJUKAN','DISETUJUI','MENUNGGU_VERIFIKASI','DIBAYAR','BERJALAN','DIKEMBALIKAN','SENGKETA','PENCAIRAN_DIPROSES','SELESAI','DITOLAK','KADALUARSA','DIBATALKAN');
CREATE TABLE platform_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL CHECK(type IN ('bank','ewallet')),
  provider text NOT NULL, account_no text NOT NULL, account_name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, account_no)
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES items(id),
  renter_id uuid NOT NULL REFERENCES users(id), owner_id uuid NOT NULL REFERENCES users(id),
  last_message_at timestamptz NOT NULL DEFAULT now(), renter_last_read_at timestamptz, owner_last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,renter_id), CHECK(renter_id<>owner_id)
);
CREATE TABLE rentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_code text NOT NULL UNIQUE,
  item_id uuid NOT NULL REFERENCES items(id), owner_id uuid NOT NULL REFERENCES users(id), renter_id uuid NOT NULL REFERENCES users(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id), pickup_point_id uuid NOT NULL REFERENCES pickup_points(id),
  start_at timestamptz NOT NULL, due_at timestamptz NOT NULL, days integer NOT NULL CHECK(days BETWEEN 1 AND 90),
  block_period tstzrange NOT NULL, price_per_day bigint NOT NULL CHECK(price_per_day>0), rent_total bigint NOT NULL CHECK(rent_total>0),
  deposit bigint NOT NULL CHECK(deposit>0), commission_rate_bp integer NOT NULL CHECK(commission_rate_bp BETWEEN 0 AND 10000),
  commission_amount bigint NOT NULL CHECK(commission_amount>=0), unique_code integer CHECK(unique_code BETWEEN 1 AND 999),
  amount_due bigint NOT NULL CHECK(amount_due>0), amount_received bigint NOT NULL DEFAULT 0 CHECK(amount_received>=0),
  rules_snapshot jsonb NOT NULL, listing_snapshot jsonb NOT NULL,
  status rental_status NOT NULL DEFAULT 'DIAJUKAN', respond_by timestamptz NOT NULL, pay_by timestamptz,
  cancelled_by uuid REFERENCES users(id), cancel_reason text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(owner_id<>renter_id), CHECK(due_at=start_at+days*interval '24 hours'),
  CHECK(rent_total=price_per_day*days), CHECK(amount_due=rent_total+deposit+coalesce(unique_code,0)),
  CHECK(lower(block_period)=start_at AND upper(block_period)>=due_at),
  CHECK(status NOT IN ('DISETUJUI','MENUNGGU_VERIFIKASI') OR (unique_code IS NOT NULL AND pay_by IS NOT NULL)),
  CHECK(NOT isempty(block_period) AND NOT lower_inf(block_period) AND NOT upper_inf(block_period) AND lower_inc(block_period) AND NOT upper_inc(block_period)),
  EXCLUDE USING gist(item_id WITH =, block_period WITH &&) WHERE(status IN ('DISETUJUI','MENUNGGU_VERIFIKASI','DIBAYAR','BERJALAN'))
);
CREATE UNIQUE INDEX rentals_waiting_unique_code ON rentals(unique_code) WHERE(status IN ('DISETUJUI','MENUNGGU_VERIFIKASI'));
CREATE INDEX rentals_owner ON rentals(owner_id,created_at DESC);
CREATE INDEX rentals_renter ON rentals(renter_id,created_at DESC);
CREATE INDEX rentals_deadlines ON rentals(status,respond_by,pay_by);
CREATE SEQUENCE rental_public_sequence;
CREATE TABLE rental_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  from_status rental_status, to_status rental_status NOT NULL, actor_id uuid REFERENCES users(id),
  actor_type text NOT NULL CHECK(actor_type IN ('user','admin','system')), meta jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_events_timeline ON rental_events(rental_id,created_at,id);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender_id uuid REFERENCES users(id), rental_id uuid REFERENCES rentals(id), type text NOT NULL CHECK(type IN ('text','image','system')),
  body text NOT NULL DEFAULT '', image_path text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(length(body)<=2000), CHECK((type='image' AND image_path IS NOT NULL) OR (type<>'image' AND length(btrim(body))>0)),
  CHECK((type='system')=(sender_id IS NULL))
);
CREATE INDEX messages_cursor ON messages(conversation_id,created_at DESC,id DESC);
CREATE INDEX messages_rate ON messages(sender_id,created_at);
CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id), blocked_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id)
);
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK(target_type IN ('message','user','item','review')), target_id uuid NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000), status text NOT NULL DEFAULT 'menunggu', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  platform_account_id uuid NOT NULL REFERENCES platform_accounts(id), platform_snapshot jsonb NOT NULL,
  proof_path text NOT NULL UNIQUE, proof_sha256 text NOT NULL, sender_name text NOT NULL, transferred_at timestamptz NOT NULL,
  claimed_amount bigint NOT NULL CHECK(claimed_amount>0), status text NOT NULL DEFAULT 'menunggu' CHECK(status IN ('menunggu','diterima','ditolak')),
  verified_amount bigint, reject_reason text, verified_by uuid REFERENCES users(id), verified_at timestamptz,
  target_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(rental_id,proof_sha256),
  CHECK(status<>'diterima' OR (verified_amount IS NOT NULL AND verified_amount>0 AND verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK(status<>'ditolak' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason))>=5 AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX payments_pending ON payments(status,created_at);
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), journal_id uuid NOT NULL, rental_id uuid REFERENCES rentals(id),
  payment_id uuid REFERENCES payments(id), account text NOT NULL, debit bigint NOT NULL DEFAULT 0, credit bigint NOT NULL DEFAULT 0,
  memo text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(debit>=0 AND credit>=0 AND (debit>0)<>(credit>0)), UNIQUE(journal_id,account)
);
CREATE INDEX ledger_rental ON ledger_entries(rental_id,account);
CREATE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT coalesce(sum(debit-credit),0) FROM ledger_entries WHERE journal_id=NEW.journal_id)<>0 THEN
    RAISE EXCEPTION 'Jurnal harus seimbang' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Entri ledger tidak dapat diubah atau dihapus' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
-- Refund obligations must survive expiry/late verification in Sprint 3. Execution UI follows Sprint 4.
CREATE TABLE payout_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id), recipient_id uuid NOT NULL REFERENCES users(id),
  source_payment_id uuid UNIQUE REFERENCES payments(id), kind text NOT NULL CHECK(kind IN ('pencairan_pemilik','refund_penyewa','penyesuaian')),
  amount bigint NOT NULL CHECK(amount>0), account_snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'menunggu',
  target_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES notifications(id),
  channel text NOT NULL DEFAULT 'telegram', chat_id bigint, status text NOT NULL DEFAULT 'antre' CHECK(status IN ('antre','terkirim','gagal')),
  attempts integer NOT NULL DEFAULT 0, last_error text, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(notification_id,channel)
);
CREATE INDEX deliveries_due ON notification_deliveries(status,next_attempt_at);
CREATE TABLE delivery_throttles (key text PRIMARY KEY, next_at timestamptz NOT NULL);
CREATE FUNCTION enqueue_telegram_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN ('verification_decided','rental_requested','rental_approved','rental_rejected','rental_expired','rental_cancelled','payment_decided') THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_telegram_outbox AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_notification();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['platform_accounts','conversations','rentals','rental_events','messages','user_blocks','reports','payments','ledger_entries','payout_tasks','notification_deliveries','delivery_throttles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['platform_accounts','rentals'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',t);
  END LOOP;
END $$;
ALTER TABLE upload_tickets DROP CONSTRAINT upload_tickets_purpose_check;
ALTER TABLE upload_tickets ADD CONSTRAINT upload_tickets_purpose_check CHECK(purpose IN ('identity_card','identity_selfie','avatar','item_photo','payment_proof','chat_image'));
DO $$ BEGIN IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('evidence-private','evidence-private',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;
END IF; END $$;
