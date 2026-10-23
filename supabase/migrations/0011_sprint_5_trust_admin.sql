ALTER TABLE users ADD COLUMN suspended_at timestamptz, ADD COLUMN suspension_reason text,
  ADD COLUMN strike_reviewed_at timestamptz, ADD COLUMN push_chat boolean NOT NULL DEFAULT true;
ALTER TABLE identity_verifications ADD COLUMN purged_at timestamptz;
ALTER TABLE users DROP CONSTRAINT users_phone_check;
ALTER TABLE users ADD CONSTRAINT users_phone_check CHECK
  (phone ~ '^\+[1-9][0-9]{7,14}$' OR (account_status='dihapus' AND phone='deleted:'||id::text));
ALTER TABLE messages ADD COLUMN hidden_at timestamptz;
ALTER TABLE reports ADD COLUMN note text, ADD COLUMN action_taken text,
  ADD COLUMN handled_by uuid REFERENCES users(id), ADD COLUMN handled_at timestamptz,
  ADD COLUMN decision_note text;
CREATE INDEX reports_queue ON reports(status, created_at);
ALTER TABLE payout_tasks ADD COLUMN adjustment_of uuid REFERENCES payout_tasks(id),
  ADD COLUMN adjustment_reason text, ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE payout_tasks ADD CONSTRAINT adjustment_reference CHECK
  (kind <> 'penyesuaian' OR (adjustment_of IS NOT NULL AND length(btrim(adjustment_reason)) >= 10 AND created_by IS NOT NULL));
ALTER TABLE strikes ADD COLUMN report_id uuid UNIQUE REFERENCES reports(id);
CREATE INDEX strikes_current_window ON strikes(user_id, expires_at);
CREATE TABLE dispute_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id uuid NOT NULL REFERENCES disputes(id),
  user_id uuid NOT NULL REFERENCES users(id), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 20 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(dispute_id,user_id)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES rentals(id),
  reviewer_id uuid NOT NULL REFERENCES users(id), reviewee_id uuid NOT NULL REFERENCES users(id),
  score integer NOT NULL CHECK(score BETWEEN 1 AND 5), tags text[] NOT NULL DEFAULT '{}',
  comment text NOT NULL DEFAULT '' CHECK(length(comment)<=500), visible_at timestamptz, hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rental_id,reviewer_id), CHECK(reviewer_id<>reviewee_id)
);
CREATE TRIGGER dispute_response_immutable BEFORE UPDATE OR DELETE ON dispute_responses FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE FUNCTION protect_visible_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.visible_at IS NOT NULL AND
    (NEW.rental_id,NEW.reviewer_id,NEW.reviewee_id,NEW.score,NEW.tags,NEW.comment,NEW.visible_at)
    IS DISTINCT FROM (OLD.rental_id,OLD.reviewer_id,OLD.reviewee_id,OLD.score,OLD.tags,OLD.comment,OLD.visible_at)) THEN
    RAISE EXCEPTION 'Ulasan yang sudah terlihat tidak dapat diubah' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_protected BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION protect_visible_review();
CREATE INDEX reviews_public ON reviews(reviewee_id,visible_at);
CREATE TRIGGER reviews_updated BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TABLE reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), date text NOT NULL CHECK(date ~ '^\d{4}-\d{2}-\d{2}$'),
  platform_account_id uuid NOT NULL REFERENCES platform_accounts(id), actual_balance bigint NOT NULL CHECK(actual_balance>=0),
  ledger_balance bigint NOT NULL, note text NOT NULL DEFAULT '', entered_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(date,platform_account_id),
  CHECK(actual_balance=ledger_balance OR length(btrim(note))>=5)
);
CREATE TRIGGER reconciliations_immutable BEFORE UPDATE OR DELETE ON reconciliations FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_user ON push_subscriptions(user_id);
CREATE TABLE push_receipts (
  delivery_id uuid NOT NULL REFERENCES notification_deliveries(id),
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(delivery_id,subscription_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dispute_responses','reviews','reconciliations','push_subscriptions','push_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
  END LOOP;
END $$;

-- Reuse the after-commit callback for both channels. No notification cron and no replay.
CREATE OR REPLACE FUNCTION public.dispatch_telegram_delivery(delivery_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_url text; target_secret text; request_id bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries WHERE id=delivery_id AND channel IN ('telegram','push') AND status='antre') THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO target_url FROM vault.decrypted_secrets WHERE name='sewamates_notification_url';
  SELECT decrypted_secret INTO target_secret FROM vault.decrypted_secrets WHERE name='sewamates_notification_secret';
  IF target_url IS NULL OR target_secret IS NULL OR target_url !~ '^https://[^[:space:]]+$' THEN
    UPDATE public.notification_deliveries SET last_error='WEBHOOK_NOT_CONFIGURED' WHERE id=delivery_id; RETURN NULL;
  END IF;
  SELECT net.http_post(url:=target_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||target_secret),
    body:=jsonb_build_object('deliveryId',delivery_id),timeout_milliseconds:=10000) INTO request_id;
  UPDATE public.notification_deliveries SET dispatch_request_id=request_id,last_error=NULL WHERE id=delivery_id;
  RETURN request_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.notification_deliveries SET last_error='WEBHOOK_DISPATCH_FAILED' WHERE id=delivery_id; RETURN NULL;
END $$;
CREATE FUNCTION enqueue_sprint5_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN ('dispute_responded','dispute_decided','account_suspended','account_reactivated','account_counterparty_suspended') THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.type IN (
    'verification_decided','listing_decided','rental_requested','rental_approved','rental_rejected','rental_expired','rental_cancelled',
    'payment_decided','rental_reminder','reschedule_requested','reschedule_decided','no_show_reported','no_show_resolved','rental_late',
    'payout_completed','dispute_opened','handover_arrived','handover_completed','return_completed','return_check_confirmed',
    'review_ending','payout_scheduled','dispute_evidence','dispute_responded','dispute_decided','account_counterparty_suspended','chat_message'
  ) AND EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id=NEW.user_id)
    AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND account_status<>'dihapus' AND (NEW.type<>'chat_message' OR push_chat)) THEN
    INSERT INTO notification_deliveries(notification_id,channel) VALUES(NEW.id,'push') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_sprint5_outbox AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_sprint5_notifications();
