# Sprint 3 — Transaksi I

Tanggal pengerjaan: 21 Oktober 2026; pembaruan notifikasi: 22 Oktober 2026. Dimulai setelah pemilik aplikasi menyatakan pengujian Sprint 2 aman.

**Status: implementasi tersedia; pengiriman Telegram berbasis event berhasil diuji dari Supabase hosted ke aplikasi melalui tunnel dan diterima akun penguji. Telegram tidak memakai cron.** Hasil pemeriksaan otomatis dan batas verifikasi dicatat di bawah. Keputusan ada di [ADR 0004](../decisions/0004-transaksi-sprint-3.md).

[Audit kelengkapan dan penyelesaian terbaru](03-transaksi-i-audit.md) mencatat templat penolakan pembayaran, tabel/filter/umur antrean dan badge, ringkasan pembayaran desktop sticky, drag and drop bukti, serta waktu daftar chat yang sudah dilengkapi. Tiga cron kedaluwarsa sudah aktif dan diverifikasi HTTP 200; masalah 403 sebelumnya sudah tidak terulang. Perubahan UI masih perlu ikut deployment berikutnya dan seluruh DoD lingkungan/perangkat belum dinyatakan selesai.

## Implementasi

| Backlog | Hasil |
| --- | --- |
| Migrasi transaksi | `0005`: rental/status/event, platform account, payments, ledger, conversations/messages, outbox, constraint hold dan kode unik; RLS server-only |
| Domain | State machine terpusat, tagihan/kode unik/kelebihan bayar, periode 24 jam + buffer, jam titik WIB dan target verifikasi |
| F7 | Form jadwal/durasi/titik/pesan, kelayakan penyewa, snapshot listing, batas tanggapan, persetujuan/penolakan pemilik, hold, versi dan idempotensi |
| F8 dan F22 | Pilihan rekening platform, kode transaksi dan kode unik, unggah privat, bukti bertahap, nominal aktual admin, kekurangan dan perpanjangan batas bayar, audit dan jurnal seimbang |
| F27 | Super admin mengelola rekening bank/e-wallet platform di `/admin/pengaturan/rekening`; rekening yang sudah dipakai dapat dinonaktifkan |
| F9 | Chat per barang/pasangan, gambar privat, pesan sistem, filter nomor/tautan, read receipt, unread count, cursor, laporan dan blokir; polling 1,5 detik |
| Job | `expire-login-requests`, `expire-requests`, `expire-payments`, memakai secret internal dan transaksi |
| Telegram | Outbox notifikasi kritis Sprint 1–3, dipicu trigger database setelah commit melalui migrasi `0007`, termasuk dari skrip; keputusan listing melalui migrasi `0006`, grup tugas admin, retry/429/403, `/transaksi` dan `/bantuan`; tanpa cron Telegram |
| Fondasi refund | Pembayaran parsial pada pembatalan/kedaluwarsa dan verifikasi terlambat membuat kewajiban refund permanen; pelaksanaan transfer mengikuti Sprint 4 |

Halaman pengguna tersedia di `/barang/[id]/sewa`, `/transaksi`, `/transaksi/[id]`, `/chat`, `/chat/[id]`. Verifikasi pembayaran tersedia bagi admin di `/admin/pembayaran`. Pengguna/admin lain tidak memperoleh akses chat peserta hanya karena mempunyai role admin.

Akun baru boleh menyewa barang dengan nilai berapa pun di katalog, termasuk dengan 0 transaksi selesai. Verifikasi identitas, rekening/e-wallet terkonfirmasi, ketersediaan, dan persetujuan pemilik diperlukan. Pengaturan aplikasi divalidasi secara strict sesuai schema.

## Penyiapan dev/staging

1. Pastikan target `.env.local` memang lingkungan yang akan diperbarui, lalu jalankan `npm run db:migrate` untuk menerapkan migrasi sampai `0007`. Untuk Supabase CLI lokal gunakan alur migrasi CLI seperti setup sebelumnya. Migrasi `0005` membuat/menyesuaikan bucket `evidence-private` privat, 5 MB, JPEG/PNG/WebP/PDF bila schema Storage tersedia. Migrasi `0006` menambahkan keputusan listing ke outbox Telegram. Migrasi `0007` menambahkan trigger pengiriman dan menghapus hanya jadwal `sewamates-deliver-notifications` bila ada.
2. Jalankan `npm run db:seed` bila perlu melengkapi pengaturan. Super admin menambahkan rekening operasional bank atau e-wallet lewat **Admin → Pengaturan → Rekening platform**. Gunakan data uji pada lingkungan dev. Persetujuan pengajuan ditolak jika belum ada rekening platform aktif.
3. Pastikan titik serah terima aktif dan jam WIB benar. Siapkan dua akun pengguna berbeda yang sudah terverifikasi serta rekening/e-wallet terkonfirmasi, dan satu admin yang bukan peserta transaksi untuk memeriksa bukti.
4. Isi `TELEGRAM_ADMIN_CHAT_ID` dengan ID grup admin bernilai negatif (misalnya `-1001234567890`) dan masukkan bot ke grup. ID chat pribadi tidak dipakai untuk tugas admin. Tetapkan URL HTTPS dan bot sesuai lingkungan, lalu `npm run telegram:webhook` untuk memperbarui webhook dan menu `/transaksi`. Perintah ini mengganti tujuan webhook bot; gunakan bot terpisah dari production.
5. Pada Supabase aktifkan `pg_cron`, `pg_net`, Vault (nama ekstensi SQL: `supabase_vault`; schema: `vault`). Pemeriksaan dan penanganan error `vault.control` ada di [setup job](../setup-sprint-1.md#job-terjadwal). Buat secret Vault `sewamates_app_url` dan `sewamates_job_secret` sesuai `INTERNAL_JOB_SECRET`, lalu jalankan [supabase/jobs.sql](../../supabase/jobs.sql). File tersebut menjadwalkan **tiga job kedaluwarsa** setiap menit, termasuk job login Sprint 1, dengan nama tetap agar dapat dipasang ulang. File juga menghapus jadwal Telegram lama bila masih ada.
6. Deploy/restart kode setelah migrasi siap, lalu pasang webhook notifikasi sesuai langkah berikut. Uji [checklist manual](03-transaksi-i-e2e.md), lalu periksa Sentry, hasil HTTP job/webhook, outbox gagal, dan audit log.

## Webhook Telegram tanpa cron

Alurnya: aksi aplikasi → notifikasi dan outbox dalam satu transaksi → commit → trigger `pg_net` → `POST /api/internal/notifications/deliver` → Telegram. Nomor HP mencari akun yang chat Telegram-nya sudah tertaut melalui login/bagikan kontak; bot mengirim ke chat ID tersebut. Tugas admin tetap hanya dikirim ke grup admin. Menjalankan service dari skrip juga memicu webhook; SQL yang hanya mengubah status tanpa membuat notifikasi/outbox tidak mengirim pesan.

1. Pastikan migrasi `0007` sudah diterapkan, `pg_net` dan Vault aktif, serta endpoint baru sudah berjalan pada URL HTTPS yang dapat diakses Supabase. Pada Vercel aktifkan Fluid Compute untuk mendukung durasi callback sampai 300 detik.
2. Isi `NEXT_PUBLIC_APP_URL` dengan URL aplikasi yang sedang berjalan, serta `INTERNAL_JOB_SECRET` dan `TELEGRAM_BOT_TOKEN` dengan nilai yang sama pada aplikasi dan lingkungan setup. Tidak ada env baru. Untuk tunnel, perbarui URL dan jalankan ulang setup setiap tunnel berubah.
3. Jalankan `npm run telegram:notifications`. Perintah ini mengisi/memperbarui **dua secret Vault khusus**: `sewamates_notification_url` dan `sewamates_notification_secret`. Secret `sewamates_app_url`/`sewamates_job_secret` milik cron kedaluwarsa tidak diubah. Perintah ini juga terpisah dari `telegram:webhook` untuk update/login yang masuk dari Telegram.
4. Dengan izin pemilik akun, jalankan `npm run telegram:test -- --phone <nomor akun>`. Skrip hanya membuat satu event uji dan memeriksa delivery itu; tidak memanggil sender dan tidak mengirim antrean pengguna lain. Konfirmasi kode uji yang diterima pengguna, `status=terkirim`, dan `telegram_message_id`.
5. Saat pindah ke Vercel, deploy endpoint baru terlebih dahulu, arahkan `NEXT_PUBLIC_APP_URL` setup ke domain Vercel, lalu ulangi `npm run telegram:notifications`. Tunnel dev bukan endpoint permanen deployment.

Callback memproses satu ID delivery, dengan lease, maksimal 5 percobaan, backoff, dan batas waktu 240 detik. Telegram 403 menghentikan percobaan dan menandai bot diblokir; 429 mengikuti `retry_after`. Pengiriman tidak menunggu pergantian menit dan tidak bergantung pada browser tetap terbuka.

**Tidak ada cron cadangan Telegram.** Jika endpoint mati, proses terputus, atau retry melewati anggaran callback, outbox tetap tersimpan tetapi belum tentu terkirim otomatis. Periksa `notification_deliveries.last_error`, `dispatch_request_id`, `claimed_until`, serta `net._http_response` untuk hasil HTTP; jangan menampilkan header Authorization/Vault ke log. Setelah endpoint pulih dan lease berakhir, operator dapat memicu ulang **satu delivery yang masih `antre`** melalui SQL Editor dengan akses pemilik database:

```sql
select public.dispatch_telegram_delivery('<delivery-id>'::uuid);
```

Fungsi tidak mengirim ulang baris yang sudah `terkirim` atau `gagal`. Jangan redispatch seluruh antrean saat pengujian bersama. Timeout setelah Telegram menerima pesan tetap bisa menyebabkan pesan ganda pada retry.

## Pemeriksaan otomatis

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Vitest menggunakan PGlite secara default. Untuk konkurensi sesungguhnya, isi `TEST_DATABASE_URL` ke database khusus `sewamates_test` seperti CI; schema tersebut dikosongkan saat tes. Pengujian mencakup hold/jeda, versi, snapshot, pembayaran bertahap, semua bukti harus selesai diputuskan, ledger, refund, isolasi chat, blokir, retry, dan rate limit.

E2E transaksi menjalankan Next production, sesi nyata pada database lokal, serta tiruan HTTP Storage; tidak memanggil bot atau Supabase hosted. **Database lokal bernama `sewamates_e2e` wajib khusus tes karena schema dikosongkan sebelum setiap skenario.** URL non-loopback dan nama database lain ditolak. Buat database itu terlebih dahulu.

```powershell
$env:E2E_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/sewamates_e2e'
$env:NEXT_BUILD_DIR='.next-e2e'
$env:NEXT_PUBLIC_APP_URL='http://localhost:3100'
$env:NEXT_PUBLIC_SENTRY_DSN=''
$env:SENTRY_AUTH_TOKEN=''
npm run build
npm run test:e2e:transactions
```

Port 3100 dan 3101 harus bebas. Konfigurasi ini terpisah dari `npm run test:e2e` untuk regresi Sprint 1–2. CI menjalankan keduanya. Akun/sesi fixture hanya dibuat pada database lokal yang sudah lolos guard; tidak ada endpoint bypass login dalam aplikasi. Hapus environment sementara pada shell setelah selesai atau gunakan terminal pengujian tersendiri.

## Batas verifikasi dan sprint berikutnya

Pemeriksaan webhook tanpa cron (22 Oktober 2026):

- **157 tes PostgreSQL lulus**, termasuk trigger outbox, rollback HTTP, konfigurasi hilang, isolasi satu delivery, callback ganda, autentikasi webhook, retry 429, dan anggaran retry. Lint, TypeScript, dan build production lulus. **4 skenario E2E transaksi lulus** di Chromium/WebKit pada lebar 360/390/768/1440 px.
- Setelah seluruh asersi browser lulus, cleanup server Playwright pada Windows sempat tertahan. Fixture E2E beserta proses server anaknya dihentikan secara manual; perintah kemudian selesai dengan exit code 0. Server dev untuk pengujian Telegram tetap berjalan terpisah.
- Migrasi `0007` dan dua secret Vault khusus notifikasi diterapkan ke Supabase untuk pengujian yang diminta pemilik aplikasi. Event dari skrip memicu HTTP dan mengirim satu pesan dalam satu percobaan, mencatat request ID serta message ID Telegram. Kode **UJI-TG-3F6C5F72** dikonfirmasi sudah diterima pemilik akun penguji. Sender tidak dipanggil manual dan antrean pengguna lain tidak dikuras.
- Pengujian hosted menggunakan server dev dan tunnel HTTPS sementara. Tidak ada deployment Vercel atau perubahan webhook login bot pada pemeriksaan ini. Pengiriman grup dan seluruh matriks event nyata tetap mengikuti checklist manual; keberhasilan satu pesan tidak membuktikan seluruh integrasi tersebut.
- Pemeriksaan read-only menemukan belum ada job `sewamates-*` di Supabase. Secret cron kedaluwarsa yang tersimpan di Vault ditolak endpoint Vercel dengan 403, diuji memakai nama job yang tidak ada agar tidak mengubah transaksi. Sebelum menjalankan `supabase/jobs.sql`, pengelola perlu menyamakan `sewamates_job_secret` dengan `INTERNAL_JOB_SECRET` deployment Vercel. Konfigurasi Vault kedaluwarsa tidak diubah selama pengujian notifikasi.

Pemeriksaan pembaruan notifikasi sebelumnya (22 Oktober 2026, sebelum webhook database):

- Lint, TypeScript, dan build production lulus. Seluruh **155 tes PostgreSQL lulus**, termasuk pengiriman setelah respons, penerima pengajuan/persetujuan/penolakan/pembatalan, satu pesan grup per tugas admin, ID grup tidak valid, keputusan listing, rollback, retry, batas waktu, dan dua worker bersamaan.
- **4 skenario E2E transaksi lulus** di Chromium/WebKit pada 360/390/768/1440 px. Halaman notifikasi pemilik yang sudah terbuka menerima pengajuan dari browser penyewa tanpa refresh; angka lonceng bertambah dan notifikasi membuka transaksi yang sesuai. Alur pembayaran, verifikasi, dan chat tetap lulus.
- Telegram dimock pada tes service/worker dan dinonaktifkan pada server browser E2E. Pemeriksaan otomatis tersebut tidak mengirim pesan Telegram nyata atau menerapkan migrasi hosted.

Hasil lokal awal (21 Oktober 2026):

- ESLint dan TypeScript lulus tanpa galat; build production Next.js 16.4.2 berhasil dengan halaman transaksi, chat, formulir sewa, verifikasi pembayaran dan rekening platform.
- PostgreSQL 17: **129 tes lulus**. Termasuk persetujuan rental bersamaan yang hanya menghasilkan satu hold, keputusan bukti oleh dua admin yang hanya mencatat satu penerimaan, exclusion constraint langsung, jurnal deferred, bukti bertahap, batas pembayaran yang berubah, refund, otorisasi dan outbox.
- PGlite: tes transaksi baru **27 lulus, 2 dilewati** karena dua tes tersebut khusus konkurensi PostgreSQL nyata. Regresi domain/service Sprint 1–2 juga diperiksa pada suite sebelumnya.
- Regresi Playwright Sprint 1–2: **28 tes lulus** di Chromium/WebKit pada 360/390/768/1440 px. Dijalankan pada port 3200 terpisah dari server pengembangan.
- Playwright transaksi: **4 skenario penuh lulus** di Chromium/WebKit pada 360/390/768/1440 px. Tiga sesi berbeda mencakup pembuatan rekening platform, pengajuan, persetujuan, dua transfer, verifikasi admin, siap serah terima, chat teks/gambar privat, read receipt, penyamaran teks, laporan/blokir dan otorisasi. Gambar diterima dan berhasil didekode oleh browser; URL tanpa token ditolak. Pemeriksaan lebar halaman tidak menemukan overflow horizontal, dan tidak ada `pageerror` pada sesi penyewa. Total dengan regresi: **32 tes browser lulus**.
- Tidak ada migrasi, perubahan webhook, pengiriman notifikasi, atau deployment ke lingkungan bersama selama pemeriksaan ini. Data fixture hanya berada pada PostgreSQL loopback dan tiruan Storage.

Tiruan Storage tidak membuktikan kebijakan bucket Supabase nyata. Seluruh matriks Telegram, cron kedaluwarsa, latensi chat staging, Sentry staging, dan Chrome Android/Safari iOS fisik masih perlu diuji bersama pengelola. Tidak ada klaim deploy atau persetujuan code review tim dari tes lokal.

Serah terima, pengembalian, pembatalan setelah lunas, jadwal ulang, sengketa, serta klaim/pembayaran refund mengikuti Sprint 4 dan seterusnya. Transaksi `DIBAYAR` pada Sprint 3 berhenti di status **Siap serah terima**.
