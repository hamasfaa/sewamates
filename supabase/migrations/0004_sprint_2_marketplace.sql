-- Sprint 2 marketplace (A-3.2). Periods are [start, end); WIB dates are resolved by the service.
CREATE TYPE item_status AS ENUM ('menunggu_review', 'aktif', 'ditolak', 'dijeda', 'diarsipkan');

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_key ON categories (lower(name));

CREATE TABLE pickup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campus_id uuid NOT NULL REFERENCES campuses(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  -- Seven entries, Monday first: null (closed) or {"open":"HH:MM","close":"HH:MM"} in WIB.
  hours_json jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(hours_json) = 'array' THEN jsonb_array_length(hours_json) = 7 ELSE false END
  ),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pickup_points_name_key ON pickup_points (campus_id, lower(name));

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id), campus_id uuid NOT NULL REFERENCES campuses(id),
  category_id uuid NOT NULL REFERENCES categories(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 80),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 20 AND 2000),
  item_value bigint NOT NULL CHECK (item_value > 0), price_per_day bigint NOT NULL CHECK (price_per_day > 0),
  deposit bigint NOT NULL, min_days integer NOT NULL, max_days integer NOT NULL,
  status item_status NOT NULL DEFAULT 'menunggu_review', reject_reason text,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  rating_avg integer NOT NULL DEFAULT 0, rating_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
  -- No stemming: brand and model names stay searchable; the service adds prefix matching.
  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', description), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deposit > 0 AND min_days >= 1 AND max_days >= min_days),
  CHECK (status <> 'ditolak' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason)) >= 5)),
  CHECK (status NOT IN ('aktif', 'dijeda') OR published_at IS NOT NULL)
);
CREATE INDEX items_search ON items USING gin (search_tsv);
CREATE INDEX items_recent ON items (published_at DESC, id DESC) WHERE status = 'aktif';
CREATE INDEX items_price ON items (price_per_day, id) WHERE status = 'aktif';
CREATE INDEX items_campus ON items (campus_id, published_at DESC) WHERE status = 'aktif';
CREATE INDEX items_category ON items (category_id) WHERE status = 'aktif';
CREATE INDEX items_owner ON items (owner_id, created_at DESC);
CREATE INDEX items_review_queue ON items (submitted_at) WHERE status = 'menunggu_review';

CREATE TABLE item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE, thumb_path text NOT NULL UNIQUE, sort smallint NOT NULL CHECK (sort BETWEEN 0 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (item_id, sort)
);
CREATE TABLE item_pickup_points (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  pickup_point_id uuid NOT NULL REFERENCES pickup_points(id),
  PRIMARY KEY (item_id, pickup_point_id)
);
CREATE INDEX item_pickup_points_point ON item_pickup_points (pickup_point_id);
CREATE TABLE availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  period tstzrange NOT NULL CHECK (
    NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period)
    AND lower_inc(period) AND NOT upper_inc(period)
  ),
  reason text CHECK (reason IS NULL OR length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX availability_blocks_item ON availability_blocks (item_id);
-- Moderation history reads audit entries per listing.
CREATE INDEX audit_target ON admin_audit_logs (target_type, target_id, created_at);

-- A listing and its pickup points always belong to the same campus.
CREATE FUNCTION check_item_pickup_campus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM items i JOIN pickup_points p ON p.campus_id = i.campus_id
    WHERE i.id = NEW.item_id AND p.id = NEW.pickup_point_id
  ) THEN
    RAISE EXCEPTION 'Titik serah terima harus berada di kampus listing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_pickup_same_campus BEFORE INSERT OR UPDATE ON item_pickup_points
  FOR EACH ROW EXECUTE FUNCTION check_item_pickup_campus();
CREATE FUNCTION keep_campus_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.campus_id IS DISTINCT FROM OLD.campus_id THEN
    RAISE EXCEPTION 'Kampus tidak dapat dipindahkan setelah dibuat' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_campus_fixed BEFORE UPDATE OF campus_id ON items
  FOR EACH ROW EXECUTE FUNCTION keep_campus_fixed();
CREATE TRIGGER pickup_points_campus_fixed BEFORE UPDATE OF campus_id ON pickup_points
  FOR EACH ROW EXECUTE FUNCTION keep_campus_fixed();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['categories','pickup_points','items'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', table_name);
  END LOOP;
  -- Marketplace reads and writes go through the server, like the Sprint 1 tables.
  FOREACH table_name IN ARRAY ARRAY['categories','pickup_points','items','item_photos','item_pickup_points','availability_blocks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', table_name); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', table_name); END IF;
  END LOOP;
END $$;

ALTER TABLE upload_tickets DROP CONSTRAINT upload_tickets_purpose_check;
ALTER TABLE upload_tickets ADD CONSTRAINT upload_tickets_purpose_check
  CHECK (purpose IN ('identity_card', 'identity_selfie', 'avatar', 'item_photo'));

-- Listing photos are public after compression; EXIF is rejected by the server (04 §6.2).
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('items-public', 'items-public', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
