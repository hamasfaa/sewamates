-- Add reference metadata without changing IDs already linked to user profiles.
ALTER TABLE campuses ADD COLUMN source_key text UNIQUE;
ALTER TABLE campuses ADD COLUMN domains jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE campuses ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE campuses ADD CONSTRAINT campuses_domains_array
  CHECK (jsonb_typeof(domains) = 'array');
