-- Jalankan sekali melalui SQL Editor Supabase setelah deployment HTTPS siap.
-- Aktifkan pg_cron, pg_net, dan Vault dari dashboard Integrations.
-- Buat secret Vault: sewamates_app_url (tanpa slash akhir), sewamates_job_secret.
-- Nilai secret kedua harus sama dengan INTERNAL_JOB_SECRET di Vercel.
SELECT cron.schedule('sewamates-expire-login-requests', '* * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sewamates_app_url') || '/api/internal/jobs/expire-login-requests',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sewamates_job_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 10000
  );
$$);
