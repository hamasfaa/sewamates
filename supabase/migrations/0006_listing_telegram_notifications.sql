-- Important listing decisions use the same durable Telegram outbox as rental decisions.
CREATE OR REPLACE FUNCTION enqueue_telegram_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN (
    'verification_decided', 'listing_decided', 'rental_requested', 'rental_approved',
    'rental_rejected', 'rental_expired', 'rental_cancelled', 'payment_decided'
  ) THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
