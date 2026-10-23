-- Keep migration 0011 unchanged: it may already be applied to a shared database.
-- Retain the Sprint 5 Telegram events and retire browser delivery data only.
CREATE OR REPLACE FUNCTION enqueue_sprint5_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN ('dispute_responded','dispute_decided','account_suspended','account_reactivated','account_counterparty_suspended') THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_telegram_delivery(delivery_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_url text; target_secret text; request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries
    WHERE id=delivery_id AND channel='telegram' AND status='antre') THEN
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR
     to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO target_url FROM vault.decrypted_secrets
    WHERE name='sewamates_notification_url';
  SELECT decrypted_secret INTO target_secret FROM vault.decrypted_secrets
    WHERE name='sewamates_notification_secret';
  IF target_url IS NULL OR target_secret IS NULL OR target_url !~ '^https://[^[:space:]]+$' THEN
    UPDATE public.notification_deliveries SET last_error='WEBHOOK_NOT_CONFIGURED' WHERE id=delivery_id;
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := target_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||target_secret),
    body := jsonb_build_object('deliveryId',delivery_id),
    timeout_milliseconds := 10000
  ) INTO request_id;
  UPDATE public.notification_deliveries SET dispatch_request_id=request_id,last_error=NULL WHERE id=delivery_id;
  RETURN request_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.notification_deliveries SET last_error='WEBHOOK_DISPATCH_FAILED' WHERE id=delivery_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_telegram_delivery(uuid) FROM PUBLIC;

DROP TABLE IF EXISTS public.push_receipts;
DROP TABLE IF EXISTS public.push_subscriptions;
ALTER TABLE public.users DROP COLUMN IF EXISTS push_chat;
DELETE FROM public.notification_deliveries WHERE channel='push';
ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_telegram_only;
ALTER TABLE public.notification_deliveries ADD CONSTRAINT notification_deliveries_telegram_only
  CHECK (channel='telegram');
