# Perbaikan event transaksi ke Telegram — 23 Oktober 2026

## Penyebab

Pengujian bersama pada `SM-2610-00003` menemukan event kedatangan, serah terima selesai, pengembalian, dan pencairan dijadwalkan tersimpan sebagai notifikasi in-app tanpa `notification_deliveries`. Fungsi `enqueue_telegram_notification()` dari migrasi `0008` belum memasukkan tipe tersebut. Pemeriksaan hosted menunjukkan URL dan secret webhook sudah cocok; tugas pencairan ke grup admin berhasil terkirim. Masalahnya berada pada pemilihan event, bukan kebutuhan menambah cron Telegram.

## Perubahan

- [Migrasi `0010`](../../supabase/migrations/0010_transaction_event_telegram.sql) memperluas daftar tipe outbox dengan `handover_arrived`, `handover_completed`, `return_completed`, `return_check_confirmed`, `review_ending`, `payout_scheduled`, dan `dispute_evidence`.
- Penyewa sampai → pemilik diberi tahu; pemilik sampai → penyewa diberi tahu, baik saat serah terima maupun pengembalian.
- Serah terima selesai dan pengembalian diberitahukan ke kedua peserta. Konfirmasi kondisi pertama memberi tahu pihak lawan yang belum mengonfirmasi. Pencairan/refund dijadwalkan dan selesai tetap ditujukan ke penerimanya.
- Nomor telepon tetap dipetakan melalui akun ke `telegram_chat_id` yang tertaut. Nomor telepon bukan alamat pengiriman Bot API.
- Notifikasi tugas admin tetap satu pesan grup per tugas; tidak ada DM tugas admin otomatis. Pesan chat biasa tetap in-app.
- Pengiriman tetap dipicu insert outbox setelah commit melalui webhook database. Tidak ada cron Telegram baru, env baru, atau perubahan bot login.
- Migrasi tidak memutar ulang notifikasi historis. Aksi kedatangan atau konfirmasi yang diulang tidak membuat notifikasi baru.

## Aktivasi

1. Jalankan `npm run db:migrate` pada database aplikasi untuk menerapkan `0010`.
2. Deploy kode terbaru agar serah terima memberi tahu kedua peserta dan konfirmasi kondisi pertama membuat event baru.
3. Uji lewat transaksi dummy baru. Periksa notifikasi masuk ke pihak lawan saat kedatangan, kemudian `notification_deliveries.status = terkirim` dan `telegram_message_id` terisi.

Tes otomatis mencakup pemicu webhook untuk seluruh tipe baru, penerima kedatangan dua arah pada kedua tahap, aksi berulang, callback berulang, dan pengecualian DM untuk tugas admin/chat. Jalur pengiriman tidak dipanggil langsung dari handler bisnis.

## Hasil verifikasi

- Lint, typecheck, dan build production lulus. Tes PostgreSQL: 86 lulus pada suite transaksi/webhook; PGlite: 38 lulus pada suite webhook/Transaksi II. Dua regresi E2E alur serah terima sampai pencairan lulus pada Chromium mobile dan WebKit mobile, memakai database/Storage lokal terisolasi.
- Migrasi `0010_transaction_event_telegram.sql` diterapkan ke Supabase yang dipakai `sewamates-ashy.vercel.app`. Tidak ada riwayat notifikasi lama yang diputar ulang dan tidak ada status/dana transaksi yang diubah oleh migrasi.
- Satu notifikasi uji bertipe `handover_arrived` dibuat untuk pemilik yang mengizinkan pengujian. Insert notifikasi otomatis membuat outbox dan webhook; skrip tidak memanggil pengirim langsung atau memasukkan delivery secara manual. Hasil: `status=terkirim`, satu percobaan, `last_error=NULL`, dispatch tercatat, dan message ID Telegram terisi.
- Pemilik mengonfirmasi pesan **UJI-TIBA-E77C7CDE** masuk di Telegram. Pesan jelas bertanda simulasi dan tidak mengubah keadaan `SM-2610-00003`.
- Daftar event baru sudah aktif pada database hosted. Perubahan handler yang menambah notifikasi konfirmasi kondisi pertama serta memberi tahu kedua peserta saat serah terima selesai masih memerlukan deployment kode terbaru. Kedatangan, pengembalian, dan pencairan dijadwalkan yang sudah dibuat handler lama langsung mengikuti kebijakan outbox baru.
