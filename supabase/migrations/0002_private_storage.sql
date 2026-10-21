-- Applied on Supabase only. No client INSERT/SELECT policies: uploads and reads use signed URLs.
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('identity-private', 'identity-private', false, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
      ('avatars-public', 'avatars-public', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
