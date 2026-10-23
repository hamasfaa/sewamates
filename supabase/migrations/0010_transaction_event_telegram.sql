-- Transaction milestones go through the existing event-driven Telegram outbox.
-- Admin tasks still enqueue one explicit group delivery; ordinary chat stays in-app.
-- Historical notifications are not replayed by this migration.
CREATE OR REPLACE FUNCTION enqueue_telegram_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN (
    'verification_decided', 'listing_decided', 'rental_requested', 'rental_approved',
    'rental_rejected', 'rental_expired', 'rental_cancelled', 'payment_decided',
    'rental_reminder', 'reschedule_requested', 'reschedule_decided', 'no_show_reported',
    'no_show_resolved', 'rental_late', 'payout_completed', 'dispute_opened', 'strike_given',
    'handover_arrived', 'handover_completed', 'return_completed', 'return_check_confirmed',
    'review_ending', 'payout_scheduled', 'dispute_evidence'
  ) THEN
    INSERT INTO notification_deliveries(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
