-- Keep photos as evidence, but only count photos from the current rental schedule.
ALTER TABLE handover_photos
  ADD COLUMN reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0);

-- Backfill only the new metadata. The migration runner wraps this in a transaction;
-- ALTER TABLE holds the lock until the immutable-evidence trigger is enabled again.
ALTER TABLE handover_photos DISABLE TRIGGER handover_photos_immutable;
UPDATE handover_photos p
SET reschedule_count = (
  SELECT count(*)::integer
  FROM reschedule_requests r
  JOIN handover_records h ON h.rental_id = r.rental_id
  -- Ambiguous timestamps in the same millisecond stay in the earlier schedule.
  WHERE h.id = p.handover_id AND r.status = 'disetujui'
    AND r.responded_at < date_trunc('milliseconds', p.received_at)
);
ALTER TABLE handover_photos ENABLE TRIGGER handover_photos_immutable;
