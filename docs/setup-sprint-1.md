# Setup Sprint 1

## Lingkungan dan secret

Gunakan proyek Supabase serta bot Telegram terpisah untuk dev, staging, dan production. Hosting mengikuti keputusan PM: Vercel dan Supabase di Singapura. Jangan masukkan secret ke Git atau percakapan.

| Variabel                                            | Pemakaian                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                               | Origin browser yang diizinkan, URL bot, dan webhook; HTTPS untuk staging                       |
| `DATABASE_URL`                                      | Koneksi runtime server; Supabase transaction pooler di Vercel, maksimal 3 koneksi per instance |
| `DIRECT_DATABASE_URL`                               | Koneksi direct/session untuk migrasi dan seed; fallback ke `DATABASE_URL`                      |
| `SUPABASE_URL`                                      | URL proyek Supabase                                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`                         | Server-only; menerbitkan URL unggahan dan pembacaan privat                                     |
| `TELEGRAM_BOT_TOKEN`                                | Token BotFather, tidak memakai awalan `bot`                                                    |
| `TELEGRAM_BOT_USERNAME`                             | Username tanpa `@`, misalnya `SewaMatesDevBot`                                                 |
| `TELEGRAM_WEBHOOK_SECRET`                           | Secret acak untuk header webhook Telegram                                                      |
| `ACCOUNT_ENCRYPTION_KEY`                            | Kunci AES-256-GCM, tepat 32 byte dalam base64                                                  |
| `INTERNAL_JOB_SECRET`                               | Secret acak untuk endpoint job internal                                                        |
| `SEED_SUPER_ADMIN_PHONE`                            | Opsional: nomor akun yang sudah login untuk bootstrap admin                                    |
| `NEXT_PUBLIC_SENTRY_DSN`                            | Opsional: DSN Sentry; kosong berarti monitoring dinonaktifkan                                  |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Unggah source map saat build staging                                                           |
| `TELEGRAM_ADMIN_CHAT_ID`                            | Disiapkan untuk notifikasi grup di Sprint 3                                                    |

Buat kunci enkripsi atau secret acak secara lokal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Jangan mengganti kunci enkripsi tanpa proses rotasi data; rekening dan konfirmasi yang sudah tersimpan memakai kunci tersebut.

## Database dan storage

1. Buat proyek Supabase region Singapura. Isi URL, service role key, dan koneksi PostgreSQL di `.env.local`.
2. Jalankan `npm run db:migrate`, lalu `npm run db:seed`.
3. Pastikan bucket `identity-private` berstatus privat dan `avatars-public` berstatus publik. Migrasi membuat keduanya dengan batas 5 MB dan MIME JPEG/PNG/WebP.
4. Tidak ada policy baca/tulis langsung untuk foto identitas. Browser mengunggah melalui signed URL yang diterbitkan server; admin membaca melalui signed URL 300 detik. Tiket unggahan membatasi pemilik, tujuan, dan pemakaian sekali.

Jika `/api/uploads/sign` gagal karena konfigurasi belum lengkap, periksa `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` di `.env.local`. Respons `503 STORAGE_NOT_CONFIGURED` berarti salah satunya kosong. Di Supabase Dashboard proyek yang sama, buka **Settings → API Keys**, lalu isi variabel `SUPABASE_SERVICE_ROLE_KEY` dengan **secret key** (`sb_secret_...`); nama variabel tetap dipertahankan untuk kompatibilitas, dan legacy `service_role` juga didukung. Publishable/anon key tidak memberikan akses server yang dibutuhkan. Jenis key dan lokasi Dashboard dijelaskan pada [dokumentasi API keys Supabase](https://supabase.com/docs/guides/getting-started/api-keys). Simpan key langsung di environment, lalu restart server dev dan coba unggah lagi. Di Vercel, isi pada environment deployment yang sesuai, lalu redeploy. Nilai key tidak perlu dikirim ke chat atau dicantumkan dalam log.

Untuk Supabase lokal, jalankan Docker Desktop dan `npx supabase start`. CLI menerapkan berkas `supabase/migrations` saat menyiapkan database; setelah itu cukup jalankan `npm run db:seed`. Terapkan migrasi lokal berikutnya dengan `npx supabase migration up`. **Jangan jalankan `npm run db:migrate` pada database yang riwayatnya sudah dikelola CLI.** Gunakan runner npm untuk database staging/hosted kosong, dengan riwayat `_sewamates_migrations`; gunakan CLI secara konsisten untuk database lokal. Kedua runner membaca SQL yang sama tetapi riwayatnya terpisah. Perilaku inisialisasi CLI dijelaskan dalam [alur pengembangan lokal Supabase](https://supabase.com/docs/guides/local-development/cli-workflows). CI database biasa tidak mempunyai schema Storage; migrasi bucket sengaja dilewati pada lingkungan tersebut.

Seed mengimpor 197 kampus Indonesia dari snapshot Hipo berlisensi MIT. Profil menyediakan pencarian nama/singkatan dan wajib memilih kampus secara eksplisit. Tidak ada API key baru atau panggilan ke API eksternal saat pengguna membuka profil. Data komunitas ini belum mencakup seluruh perguruan tinggi; asal data dan cara memperbaruinya tersedia di [referensi kampus](../data/campuses/README.md).

Untuk database hosted yang sudah memakai seed lama, jalankan `npm run db:migrate`, lalu `npm run db:campuses`. Untuk database lokal yang dikelola CLI, jalankan `npx supabase migration up`, lalu `npm run db:campuses`. Impor dapat diulang tanpa menggandakan kampus atau mengganti ID. Placeholder `Kampus Surabaya` diarsipkan; referensi profil lama tetap tersimpan dan dapat diganti melalui halaman profil. Perluasan cakupan ini mengikuti permintaan pemilik aplikasi pada [ADR 0002](decisions/0002-pilihan-multi-kampus.md). Seed kategori dan pengelolaan titik serah terima per kampus ditambahkan di [Sprint 2](sprints/02-marketplace.md).

## Bot Telegram

1. Buat bot dev lewat BotFather; isi token, username, dan secret webhook.
2. Jalankan aplikasi dan arahkan tunnel HTTPS ke port 3000 untuk dev. Set `NEXT_PUBLIC_APP_URL` ke origin HTTPS tunnel tersebut, lalu restart aplikasi.
3. Jalankan `npm run telegram:webhook`. Script mendaftarkan webhook, `/start`, dan `/bantuan`; pengiriman update diserialkan dengan `max_connections=1`.
4. Buka halaman `/masuk` dan buat permintaan. Pilih **Buka aplikasi Telegram** jika aplikasinya sudah terpasang, atau **Buka Telegram Web** untuk melanjutkan lewat browser. Izinkan browser membuka aplikasi bila diminta, lalu tekan **Start / Mulai** di bot, bagikan **kontak sendiri**, dan pilih angka yang sama. Pada desktop QR membuka deep link yang sama di HP; sesi diberikan ke browser pemulai.
5. Uji salah angka, kedaluwarsa, logout, dan cabut sesi. Untuk menguji relink, gunakan akun Telegram baru dengan nomor yang sama; perpindahan baru dilakukan sesudah angka disetujui, lalu sesi lama dicabut.

Konfigurasi `allowedDevOrigins` di `next.config.ts` otomatis memakai hostname dari `NEXT_PUBLIC_APP_URL`. Jika URL tunnel berubah, perbarui `.env.local` lalu restart `npm run dev`. Next.js memerlukan hostname saja pada daftar tersebut, tanpa protokol atau spasi. URL lengkap tetap dipakai untuk `NEXT_PUBLIC_APP_URL`. Aset JavaScript yang ditolak dengan HTTP 403 dapat menyebabkan tombol login tidak merespons.

Tombol aplikasi menggunakan skema resmi `tg://resolve`, sedangkan opsi Telegram Web membawa token yang sama melalui parameter `tgaddr`. Keduanya memerlukan pengguna menekan Start di Telegram. Aplikasi desktop/HP hanya dapat dibuka jika Telegram terpasang dan browser mengizinkannya; pilihan web tetap tersedia di halaman login. Buat permintaan baru bila tautan sudah kedaluwarsa, tanpa memakai ulang tautan dari percakapan atau browser lain.

Webhook wajib `X-Telegram-Bot-Api-Secret-Token`. Dedup update dicatat dalam transaksi yang sama dengan pemrosesannya. Jika handler gagal, transaksi termasuk dedup di-rollback agar Telegram bisa mencoba lagi. Pesan keluar bersifat at-least-once: pesan dapat terulang jika jaringan gagal sesudah Telegram menerima pesan tetapi sebelum commit DB; perubahan DB tetap terlindungi. Antrean pengiriman dan rate limiting notifikasi massal dikerjakan di Sprint 3.

## Bootstrap super admin

1. Login lewat Telegram dengan akun calon admin; isi profil.
2. Isi `SEED_SUPER_ADMIN_PHONE` dengan nomor E.164 akun tersebut.
3. Jalankan `npm run db:seed`. Script hanya menaikkan akun aktif yang sudah tertaut ke Telegram, mencabut seluruh sesi, dan membuat audit log.
4. Login kembali. `/admin` tersedia dan `/admin/pengaturan` khusus super admin.

Seed dapat diulang; akun yang sudah menjadi super admin tidak mendapat audit atau pencabutan sesi tambahan. Kenaikan role, pencabutan sesi, dan audit berjalan dalam transaksi yang sama. Jika seed gagal sebelum commit, seluruh perubahan dibatalkan. Galat lama `42P08: uuid versus text` pada pencatatan audit sudah diperbaiki dengan parameter UUID admin dan teks target yang terpisah; tidak memerlukan migrasi database baru.

Tidak ada nomor default, kredensial tetap, atau endpoint publik untuk menaikkan role. Pengelolaan role dari panel mengikuti backlog admin sprint berikutnya.

## Job terjadwal

1. Aktifkan integrasi `pg_cron`, `pg_net`, dan Vault di Supabase.
2. Buat secret Vault `sewamates_app_url` (URL HTTPS tanpa slash akhir) dan `sewamates_job_secret` (sama dengan `INTERNAL_JOB_SECRET`).
3. Jalankan [supabase/jobs.sql](../supabase/jobs.sql) melalui SQL Editor.
4. Periksa `cron.job_run_details` dan hasil `net.http_post`. Endpoint `/api/internal/jobs/expire-login-requests` hanya menerima POST dengan `Authorization: Bearer <secret>`.

Job menandai login dan konfirmasi kedaluwarsa, membersihkan riwayat lebih dari 7 hari, serta membuang cache idempotensi yang habis. Pemeriksaan waktu juga dilakukan langsung saat login/konfirmasi, sehingga job terlambat tidak membuat token lama sah.

## Staging dan Sentry

1. Hubungkan repo dengan proyek Vercel, region `sin1`, dan Supabase staging. Isi semua variabel aplikasi pada environment Preview di Vercel. Gunakan domain staging stabil, lalu sesuaikan `NEXT_PUBLIC_APP_URL` dan webhook ke origin tersebut.
2. Tambahkan secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, dan `VERCEL_PROJECT_ID` pada GitHub environment `staging`.
3. Migrasikan database staging dan jalankan seed dari lingkungan tepercaya. Workflow tidak membawa secret database ke pull request.
4. Push/merge ke `main` setelah review. Workflow deploy hanya berjalan setelah CI push `main` berhasil. Jika secrets belum diisi, workflow menuliskan bahwa deployment dilewati.
5. Daftarkan webhook staging, pasang cron, dan bootstrap super admin staging.
6. Isi DSN Sentry, lalu periksa event browser dan server dengan data uji. Source map hanya diunggah jika token Sentry ada. Data request, cookie, dan identitas pengguna tidak sengaja dikirimkan.

Pemeriksaan nyata sebelum Sprint 1 dinyatakan selesai: login Telegram dev/staging, unggah dan baca foto dari Supabase Storage, review admin, konfirmasi rekening, cron tiap menit, deployment HTTPS, serta tidak ada galat baru di Sentry. Uji juga pada Chrome Android dan Safari iOS asli; WebKit emulasi tidak menggantikan pemeriksaan perangkat.
