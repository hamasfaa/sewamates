ALTER TABLE public.notification_deliveries ADD COLUMN dispatch_request_id bigint;
ALTER TABLE public.notification_deliveries ADD COLUMN telegram_message_id bigint;

-- pg_net runs the request only after COMMIT, including when the writer is a script.
CREATE FUNCTION public.dispatch_telegram_delivery(delivery_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_url text; target_secret text; request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries
    WHERE id=delivery_id AND channel='telegram' AND status='antre') THEN
    RETURN NULL;
  END IF;
  -- Plain PostgreSQL/PGlite test environments do not have Supabase extensions.
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
  -- The business event stays committed; preserve the failure without leaking Vault contents.
  UPDATE public.notification_deliveries SET last_error='WEBHOOK_DISPATCH_FAILED' WHERE id=delivery_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_telegram_delivery(uuid) FROM PUBLIC;

CREATE FUNCTION public.dispatch_telegram_delivery_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.dispatch_telegram_delivery(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_telegram_delivery_event() FROM PUBLIC;
CREATE TRIGGER telegram_delivery_event AFTER INSERT ON public.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.dispatch_telegram_delivery_event();

-- Only the Telegram polling job is retired; the expiration jobs remain intact.
DO $$ DECLARE retired_job bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR retired_job IN SELECT jobid FROM cron.job WHERE jobname='sewamates-deliver-notifications' LOOP
      PERFORM cron.unschedule(retired_job);
    END LOOP;
  END IF;
END $$;
