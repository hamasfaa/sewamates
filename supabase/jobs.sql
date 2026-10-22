-- Jalankan sekali melalui SQL Editor Supabase setelah deployment HTTPS siap.
-- Aktifkan pg_cron, pg_net, dan Vault dari dashboard Integrations.
-- Buat secret Vault: sewamates_app_url (tanpa slash akhir), sewamates_job_secret.
-- Nilai secret kedua harus sama dengan INTERNAL_JOB_SECRET di Vercel.
-- Nama job tetap: cron.schedule memperbarui jadwal jika nama sudah ada.
-- Telegram memakai database webhook; cron ini hanya untuk kedaluwarsa.
DO $jobs$
DECLARE job_name text;
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='sewamates-deliver-notifications';
  FOREACH job_name IN ARRAY ARRAY[
    'expire-login-requests', 'expire-requests', 'expire-payments'
  ] LOOP
    PERFORM cron.schedule('sewamates-' || job_name, '* * * * *', format($command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sewamates_app_url') || %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sewamates_job_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 10000
      );
    $command$, '/api/internal/jobs/' || job_name));
  END LOOP;
END;
$jobs$;
