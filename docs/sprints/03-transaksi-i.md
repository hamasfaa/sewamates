# Sprint 3 — Transaksi I

Tanggal pengerjaan: 21 Oktober 2026. Dimulai setelah pemilik aplikasi menyatakan pengujian Sprint 2 aman.

**Status: implementasi lokal tersedia; lint, TypeScript, build production, 129 tes PostgreSQL dan 32 tes browser lulus. Integrasi hosted, Telegram nyata, cron Supabase, dan perangkat fisik tetap memerlukan verifikasi lingkungan.** Keputusan ada di [ADR 0004](../decisions/0004-transaksi-sprint-3.md).

## Implementasi

| Backlog | Hasil |
| --- | --- |
| Migrasi transaksi | `0005`: rental/status/event, platform account, payments, ledger, conversations/messages, outbox, constraint hold dan kode unik; RLS server-only |
| Domain | State machine terpusat, tagihan/kode unik/kelebihan bayar, periode 24 jam + buffer, jam titik WIB dan target verifikasi |
| F7 | Form jadwal/durasi/titik/pesan, kelayakan penyewa, snapshot listing, batas tanggapan, persetujuan/penolakan pemilik, hold, versi dan idempotensi |
| F8 dan F22 | Pilihan rekening platform, kode transaksi dan kode unik, unggah privat, bukti bertahap, nominal aktual admin, kekurangan dan perpanjangan batas bayar, audit dan jurnal seimbang |
| F27 | Super admin mengelola rekening bank/e-wallet platform di `/admin/pengaturan/rekening`; rekening yang sudah dipakai dapat dinonaktifkan |
| F9 | Chat per barang/pasangan, gambar privat, pesan sistem, filter nomor/tautan, read receipt, unread count, cursor, laporan dan blokir; polling 1,5 detik |
| Job | `expire-requests`, `expire-payments`, `deliver-notifications`, memakai secret internal dan transaksi/lease |
| Telegram | Outbox notifikasi kritis Sprint 1–3, grup tugas admin, retry/429/403, `/transaksi` dan `/bantuan` |
| Fondasi refund | Pembayaran parsial pada pembatalan/kedaluwarsa dan verifikasi terlambat membuat kewajiban refund permanen; pelaksanaan transfer mengikuti Sprint 4 |

Halaman pengguna tersedia di `/barang/[id]/sewa`, `/transaksi`, `/transaksi/[id]`, `/chat`, `/chat/[id]`. Verifikasi pembayaran tersedia bagi admin di `/admin/pembayaran`. Pengguna/admin lain tidak memperoleh akses chat peserta hanya karena mempunyai role admin.

## Penyiapan dev/staging

1. Pastikan target `.env.local` memang lingkungan yang akan diperbarui, lalu jalankan `npm run db:migrate` untuk menerapkan `0005`. Untuk Supabase CLI lokal gunakan alur migrasi CLI seperti setup sebelumnya. Migrasi membuat/menyesuaikan bucket `evidence-private` privat, 5 MB, JPEG/PNG/WebP/PDF bila schema Storage tersedia. Tidak ada migrasi hosted yang dijalankan otomatis selama implementasi ini.
2. Jalankan `npm run db:seed` bila perlu melengkapi pengaturan. Super admin menambahkan rekening operasional bank atau e-wallet lewat **Admin → Pengaturan → Rekening platform**. Gunakan data uji pada lingkungan dev. Persetujuan pengajuan ditolak jika belum ada rekening platform aktif.
3. Pastikan titik serah terima aktif dan jam WIB benar. Siapkan dua akun pengguna berbeda yang sudah terverifikasi serta rekening/e-wallet terkonfirmasi, dan satu admin yang bukan peserta transaksi untuk memeriksa bukti.
4. Isi `TELEGRAM_ADMIN_CHAT_ID` dengan ID grup admin dan masukkan bot ke grup. Tetapkan URL HTTPS dan bot sesuai lingkungan, lalu `npm run telegram:webhook` untuk memperbarui webhook dan menu `/transaksi`. Perintah ini mengganti tujuan webhook bot; gunakan bot terpisah dari production.
5. Pada Supabase aktifkan `pg_cron`, `pg_net`, Vault. Buat secret Vault `sewamates_app_url` dan `sewamates_job_secret` sesuai `INTERNAL_JOB_SECRET`, lalu jalankan [supabase/jobs.sql](../../supabase/jobs.sql). File tersebut menjadwalkan empat job setiap menit, termasuk job login Sprint 1, dengan nama tetap agar dapat dipasang ulang.
6. Deploy kode setelah migrasi siap. Uji [checklist manual](03-transaksi-i-e2e.md), lalu periksa Sentry, hasil HTTP job, outbox gagal, dan audit log.

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

Hasil lokal:

- ESLint dan TypeScript lulus tanpa galat; build production Next.js 16.4.2 berhasil dengan halaman transaksi, chat, formulir sewa, verifikasi pembayaran dan rekening platform.
- PostgreSQL 17: **129 tes lulus**. Termasuk persetujuan rental bersamaan yang hanya menghasilkan satu hold, keputusan bukti oleh dua admin yang hanya mencatat satu penerimaan, exclusion constraint langsung, jurnal deferred, bukti bertahap, batas pembayaran yang berubah, refund, otorisasi dan outbox.
- PGlite: tes transaksi baru **27 lulus, 2 dilewati** karena dua tes tersebut khusus konkurensi PostgreSQL nyata. Regresi domain/service Sprint 1–2 juga diperiksa pada suite sebelumnya.
- Regresi Playwright Sprint 1–2: **28 tes lulus** di Chromium/WebKit pada 360/390/768/1440 px. Dijalankan pada port 3200 terpisah dari server pengembangan.
- Playwright transaksi: **4 skenario penuh lulus** di Chromium/WebKit pada 360/390/768/1440 px. Tiga sesi berbeda mencakup pembuatan rekening platform, pengajuan, persetujuan, dua transfer, verifikasi admin, siap serah terima, chat teks/gambar privat, read receipt, penyamaran teks, laporan/blokir dan otorisasi. Gambar diterima dan berhasil didekode oleh browser; URL tanpa token ditolak. Pemeriksaan lebar halaman tidak menemukan overflow horizontal, dan tidak ada `pageerror` pada sesi penyewa. Total dengan regresi: **32 tes browser lulus**.
- Tidak ada migrasi, perubahan webhook, pengiriman notifikasi, atau deployment ke lingkungan bersama selama pemeriksaan ini. Data fixture hanya berada pada PostgreSQL loopback dan tiruan Storage.

Tiruan Storage tidak membuktikan kebijakan bucket Supabase nyata. Pengiriman Telegram aktual, pemasangan cron/Vault, latensi chat staging, Sentry staging, dan Chrome Android/Safari iOS fisik harus diuji bersama pengelola. Tidak ada klaim deploy atau persetujuan code review tim dari tes lokal.

Serah terima, pengembalian, pembatalan setelah lunas, jadwal ulang, sengketa, serta klaim/pembayaran refund mengikuti Sprint 4 dan seterusnya. Transaksi `DIBAYAR` pada Sprint 3 berhenti di status **Siap serah terima**.
