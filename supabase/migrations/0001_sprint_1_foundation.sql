CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
CREATE TYPE account_status AS ENUM ('aktif', 'ditangguhkan', 'dihapus');
CREATE TYPE verification_status AS ENUM ('belum', 'menunggu', 'terverifikasi', 'ditolak');
CREATE TYPE identity_status AS ENUM ('menunggu', 'diterima', 'ditolak');
CREATE TYPE login_status AS ENUM ('menunggu', 'disetujui', 'dipakai', 'kedaluwarsa');
CREATE TYPE confirmation_status AS ENUM ('menunggu', 'dikonfirmasi', 'ditolak', 'kedaluwarsa');

CREATE TABLE campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name text NOT NULL DEFAULT '', avatar_url text, role user_role NOT NULL DEFAULT 'user',
  telegram_user_id bigint UNIQUE, telegram_chat_id bigint, telegram_linked_at timestamptz, telegram_blocked_at timestamptz,
  account_status account_status NOT NULL DEFAULT 'aktif', verification_status verification_status NOT NULL DEFAULT 'belum',
  campus_id uuid REFERENCES campuses(id), rating_avg integer NOT NULL DEFAULT 0, rating_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0, terms_accepted_at timestamptz, terms_version text, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  card_type text NOT NULL CHECK (card_type IN ('ktm', 'ktp')), card_photo_path text NOT NULL, selfie_path text NOT NULL,
  status identity_status NOT NULL DEFAULT 'menunggu', reject_reason text, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ditolak' OR length(trim(reject_reason)) >= 5 AND reject_reason IS NOT NULL),
  CHECK (status = 'menunggu' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_pending_identity ON identity_verifications(user_id) WHERE status = 'menunggu';
CREATE INDEX identity_queue ON identity_verifications(status, created_at);
CREATE TABLE payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('bank', 'ewallet')), provider text NOT NULL, account_no_enc text NOT NULL, account_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE,
  user_agent text, ip text, last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE, browser_nonce_hash text NOT NULL,
  ip_hash text NOT NULL, match_code text NOT NULL CHECK (match_code ~ '^[0-9]{2}$'), telegram_user_id bigint,
  user_id uuid REFERENCES users(id), status login_status NOT NULL DEFAULT 'menunggu', expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_browser_rate ON login_requests(browser_nonce_hash, created_at);
CREATE INDEX login_ip_rate ON login_requests(ip_hash, created_at);
CREATE INDEX login_telegram_pending ON login_requests(telegram_user_id) WHERE status = 'menunggu';
CREATE TABLE action_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('ubah_rekening', 'hapus_akun')), payload jsonb NOT NULL,
  status confirmation_status NOT NULL DEFAULT 'menunggu', expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_action ON action_confirmations(user_id, action) WHERE status = 'menunggu';
CREATE TABLE telegram_updates (update_id bigint PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE settings (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  target_type text NOT NULL, target_id text NOT NULL, meta jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_action ON admin_audit_logs(admin_id, action, created_at);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), type text NOT NULL,
  title text NOT NULL, body text NOT NULL, link text NOT NULL CHECK (link ~ '^/[^/]'), read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE TABLE upload_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), path text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('identity_card', 'identity_selfie', 'avatar')), content_type text NOT NULL,
  used boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency_keys (
  id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), request_hash text NOT NULL,
  response jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['campuses','users','identity_verifications','payout_accounts','login_requests','action_confirmations','settings'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', table_name);
  END LOOP;
END $$;
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit log bersifat permanen'; END;
$$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- The runtime connects using a trusted server role. Browser roles receive no private access.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['campuses','users','identity_verifications','payout_accounts','sessions','login_requests','action_confirmations','telegram_updates','settings','admin_audit_logs','notifications','upload_tickets','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', table_name); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', table_name); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON notifications TO authenticated;
    CREATE POLICY own_notifications ON notifications FOR SELECT TO authenticated
      USING (user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid);
  END IF;
END $$;
