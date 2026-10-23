-- Sprint 4: handover, return, check window, cancellation split, reschedule, no-show, disputes, payouts.
ALTER TABLE rentals
  ADD COLUMN status_before_dispute rental_status,
  ADD COLUMN returned_at timestamptz,
  ADD COLUMN review_ends_at timestamptz,
  ADD COLUMN late_fee bigint NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  ADD COLUMN late_until timestamptz,
  ADD COLUMN owner_ok_at timestamptz,
  ADD COLUMN renter_ok_at timestamptz,
  ADD COLUMN reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  ADD COLUMN settled_at timestamptz,
  ADD COLUMN settlement jsonb;
ALTER TABLE rentals ADD CONSTRAINT rentals_late_fee_cap CHECK (late_fee <= deposit);
ALTER TABLE rentals ADD CONSTRAINT rentals_check_window
  CHECK (status <> 'DIKEMBALIKAN' OR (returned_at IS NOT NULL AND review_ends_at IS NOT NULL));
ALTER TABLE rentals ADD CONSTRAINT rentals_dispute_origin
  CHECK (status <> 'SENGKETA' OR status_before_dispute IS NOT NULL);
CREATE INDEX rentals_start_jobs ON rentals (status, start_at);
CREATE INDEX rentals_due_jobs ON rentals (status, due_at);
CREATE INDEX rentals_review_jobs ON rentals (status, review_ends_at);

-- A payment is settled once: inside the rental settlement, or as its own late refund.
ALTER TABLE payments ADD COLUMN settled_at timestamptz;
-- Sprint 3 only created full refunds, so existing tasks become a refund settlement.
UPDATE payments p SET settled_at = t.created_at FROM payout_tasks t WHERE t.source_payment_id = p.id;
UPDATE rentals r SET settled_at = t.first_task, settlement = jsonb_build_object(
    'reason', 'refund_penuh', 'received', t.total, 'owner', 0, 'renter', t.total, 'commission', 0,
    'lateFee', 0, 'cancellationFee', 0)
  FROM (SELECT rental_id, min(created_at) AS first_task, sum(amount) AS total FROM payout_tasks GROUP BY rental_id) t
  WHERE t.rental_id = r.id;

CREATE TABLE handover_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  type text NOT NULL CHECK (type IN ('start', 'end')),
  owner_arrived_at timestamptz, renter_arrived_at timestamptz, owner_location jsonb, renter_location jsonb,
  photos_confirmed_at timestamptz, code_hash text, code_issued_at timestamptz,
  code_failed_attempts integer NOT NULL DEFAULT 0 CHECK (code_failed_attempts >= 0), code_locked_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, type)
);
CREATE TABLE handover_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), handover_id uuid NOT NULL REFERENCES handover_records(id),
  uploaded_by uuid NOT NULL REFERENCES users(id), path text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('camera', 'gallery')),
  -- Server receive time is the photo time (02 F10); the client clock is not trusted.
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handover_photos_record ON handover_photos (handover_id, received_at);
CREATE TABLE reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  proposed_by uuid NOT NULL REFERENCES users(id), new_start_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'disetujui', 'ditolak', 'kedaluwarsa')),
  responded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_reschedule ON reschedule_requests (rental_id) WHERE status = 'menunggu';
CREATE TABLE no_show_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  phase text NOT NULL CHECK (phase IN ('start', 'end')),
  reported_by uuid NOT NULL REFERENCES users(id), reported_party uuid NOT NULL REFERENCES users(id),
  -- gugur: the parties met and completed the handover before the report was resolved.
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'diterima', 'dibantah', 'gugur')),
  respond_by timestamptz NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reported_by <> reported_party)
);
CREATE UNIQUE INDEX one_open_no_show ON no_show_reports (rental_id, phase) WHERE status = 'menunggu';
CREATE INDEX no_show_due ON no_show_reports (status, respond_by);
CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  opened_by uuid REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('rusak', 'hilang', 'telat', 'tidak_sesuai', 'tidak_hadir', 'lainnya')),
  description text NOT NULL CHECK (opened_by IS NULL OR length(btrim(description)) >= 20),
  opened_from_status rental_status NOT NULL,
  status text NOT NULL DEFAULT 'dibuka' CHECK (status IN ('dibuka', 'diputuskan')),
  respond_by timestamptz NOT NULL, decide_by timestamptz NOT NULL,
  outcome text CHECK (outcome IN ('lanjutkan', 'batal', 'bagi_dana')),
  owner_amount bigint, renter_amount bigint, commission_amount bigint, new_start_at timestamptz,
  decision_note text, decided_by uuid REFERENCES users(id), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_open_dispute ON disputes (rental_id) WHERE status = 'dibuka';
CREATE INDEX disputes_queue ON disputes (status, decide_by);
CREATE TABLE dispute_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id uuid NOT NULL REFERENCES disputes(id),
  uploaded_by uuid NOT NULL REFERENCES users(id), path text NOT NULL UNIQUE,
  note text CHECK (note IS NULL OR length(note) <= 500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_evidence_party ON dispute_evidence (dispute_id, uploaded_by);
CREATE TABLE strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('batal_setelah_dibayar', 'tidak_hadir', 'terlambat', 'sengketa', 'laporan')),
  rental_id uuid REFERENCES rentals(id), given_by uuid REFERENCES users(id), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rental_id, reason)
);
CREATE INDEX strikes_active ON strikes (user_id, expires_at);

ALTER TABLE payout_tasks
  ADD COLUMN claimed_by uuid REFERENCES users(id), ADD COLUMN claimed_until timestamptz,
  ADD COLUMN source_account_id uuid REFERENCES platform_accounts(id),
  ADD COLUMN transferred_amount bigint, ADD COLUMN transfer_fee bigint, ADD COLUMN proof_path text UNIQUE,
  ADD COLUMN transferred_at timestamptz, ADD COLUMN completed_by uuid REFERENCES users(id),
  ADD COLUMN completed_at timestamptz;
ALTER TABLE payout_tasks ADD CONSTRAINT payout_tasks_status
  CHECK (status IN ('menunggu', 'diklaim', 'selesai'));
ALTER TABLE payout_tasks ADD CONSTRAINT payout_tasks_claim
  CHECK (status <> 'diklaim' OR (claimed_by IS NOT NULL AND claimed_until IS NOT NULL));
ALTER TABLE payout_tasks ADD CONSTRAINT payout_tasks_completion CHECK (
  status <> 'selesai' OR (source_account_id IS NOT NULL AND transferred_amount = amount AND transfer_fee >= 0
    AND proof_path IS NOT NULL AND transferred_at IS NOT NULL AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
);
CREATE INDEX payout_queue ON payout_tasks (status, target_at);
CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('antar_rekening', 'penarikan_komisi')),
  from_account_id uuid NOT NULL REFERENCES platform_accounts(id), to_account_id uuid REFERENCES platform_accounts(id),
  amount bigint NOT NULL CHECK (amount > 0), fee bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  proof_path text NOT NULL UNIQUE, note text CHECK (note IS NULL OR length(note) <= 500),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'antar_rekening' OR (to_account_id IS NOT NULL AND to_account_id <> from_account_id))
);
-- Payout and cash journals point back to the record that caused them.
ALTER TABLE ledger_entries
  ADD COLUMN payout_task_id uuid REFERENCES payout_tasks(id),
  ADD COLUMN cash_movement_id uuid REFERENCES cash_movements(id);
-- Reminders and SLA alerts are sent once per kind and target.
CREATE TABLE sent_alerts (
  kind text NOT NULL, target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, target_id)
);

-- Evidence of money movement and condition stays as recorded (04 §6.2).
CREATE FUNCTION protect_payout_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'selesai' THEN
    RAISE EXCEPTION 'Tugas pencairan yang selesai tidak dapat diubah' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_task_protected BEFORE UPDATE OR DELETE ON payout_tasks
  FOR EACH ROW EXECUTE FUNCTION protect_payout_task();
CREATE FUNCTION immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bukti tidak dapat diubah atau dihapus' USING ERRCODE = '23514'; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['handover_photos', 'dispute_evidence', 'cash_movements'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_evidence()', t || '_immutable', t);
  END LOOP;
  CREATE TRIGGER touch_updated BEFORE UPDATE ON handover_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  FOREACH t IN ARRAY ARRAY['handover_records', 'handover_photos', 'reschedule_requests', 'no_show_reports',
    'disputes', 'dispute_evidence', 'strikes', 'cash_movements', 'sent_alerts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', t); END IF;
  END LOOP;
END $$;

ALTER TABLE upload_tickets DROP CONSTRAINT upload_tickets_purpose_check;
ALTER TABLE upload_tickets ADD CONSTRAINT upload_tickets_purpose_check CHECK (purpose IN (
  'identity_card', 'identity_selfie', 'avatar', 'item_photo', 'payment_proof', 'chat_image',
  'handover_photo', 'dispute_evidence', 'payout_proof', 'cash_proof'
));

-- Sprint 4 events in the Telegram column of 02 F15; check-window and in-app-only events are excluded.
CREATE OR REPLACE FUNCTION enqueue_telegram_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN (
    'verification_decided', 'listing_decided', 'rental_requested', 'rental_approved',
    'rental_rejected', 'rental_expired', 'rental_cancelled', 'payment_decided',
    'rental_reminder', 'reschedule_requested', 'reschedule_decided', 'no_show_reported',
    'no_show_resolved', 'rental_late', 'payout_completed', 'dispute_opened', 'strike_given'
  ) THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
