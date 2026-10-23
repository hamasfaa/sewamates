# Audit kelengkapan Sprint 3

Tanggal: 22 Oktober 2026. Audit awal pada commit `b1dd81e`, diikuti penyelesaian temuan pada working tree.

**Status: lima temuan UI sudah ditangani; tiga cron kedaluwarsa sudah aktif dan mendapat respons HTTP 200 dari Vercel.** Pemeriksaan DoD deployment terbaru, matriks Telegram, dan perangkat fisik tetap dicatat terpisah di bawah. Aktivasi cron menggunakan konfigurasi Vault yang sudah tersedia.

## Cakupan implementasi

| Backlog Sprint 3 | Hasil pemeriksaan |
| --- | --- |
| Migrasi transaksi | Tabel, exclusion constraint, kode unik aktif, event, pembayaran, ledger, chat, dan outbox tersedia; migrasi hosted sampai `0007` tercatat |
| Domain | State machine, harga/deposit/kode unik, periode 24 jam, buffer, jam titik WIB, dan snapshot tersedia dengan tes |
| F7 pengajuan dan persetujuan | Form, profil peserta, countdown, persetujuan/penolakan, hold, pemeriksaan bentrok, versi, dan idempotensi tersedia |
| F8 pembayaran manual | Bukti privat bertahap, rekening tujuan, nama/waktu/nominal, kode transaksi, status per bukti, kekurangan, dan kelebihan tersedia; ringkasan desktop sticky serta drag and drop ditambahkan |
| F22 verifikasi pembayaran | Verifikasi nominal aktual per bukti, larangan menyetujui transaksi sendiri, audit, ledger, templat alasan, tabel/filter/umur antrean, dan badge tersedia |
| F27 rekening platform | CRUD bank/e-wallet, hak super admin, nonaktifkan rekening terpakai, dan snapshot rekening bukti tersedia |
| Spike Realtime / F9 | Keputusan polling didokumentasikan di ADR 0004; chat teks/gambar, pesan sistem, read receipt, unread, filter, laporan, blokir, dan akses admin yang diaudit tersedia |
| Job kedaluwarsa | Tiga jadwal aktif di Supabase, eksekusi cron berhasil dan HTTP endpoint Vercel 200 |
| Telegram | Outbox event database, callback terotorisasi, retry/lease/throttle, DM peserta, grup tugas admin, `/transaksi`, dan `/bantuan` tersedia; matriks event nyata belum seluruhnya diverifikasi |

## Penyelesaian temuan implementasi

| Area | Perubahan | Bukti |
| --- | --- | --- |
| Templat penolakan bukti | Lima pilihan alasan dan opsi lainnya mengisi textarea yang tetap dapat disunting | `admin-payments.tsx`; E2E memilih templat, menolak bukti, dan memeriksa alasan pada penyewa |
| Antrean pembayaran | Tabel desktop, kartu HP, umur tugas, filter target, pencarian kode/nama pengirim di server, serta badge jumlah menunggu yang diperbarui berkala | `admin-payments.tsx`, `admin-layout.tsx`, `payment-service.ts`, `admin-service.ts`; tes pencarian di luar 100 baris pertama dan count 101 tugas |
| Tata letak pembayaran | Formulir kiri dan ringkasan sticky kanan mulai desktop, ringkasan tetap mendahului formulir pada HP | `transactions-view.tsx`; E2E desktop memeriksa posisi sticky dan koordinat kedua kolom |
| Unggah bukti | Drag and drop satu file, pemilih file tetap tersedia; validasi jenis/ukuran saat memilih, nama file terpilih, input dibersihkan setelah sukses | `PaymentForm`; E2E menolak file teks dan mengunggah PNG melalui drop pada desktop |
| Daftar chat | Waktu pesan terakhir ditampilkan memakai format WIB | `chat-view.tsx`; E2E memeriksa elemen waktu pada daftar percakapan |

Screenshot pembayaran dan antrean desktop diperiksa secara visual, tanpa tumpang tindih. Pencarian dan filter diterapkan sebelum limit antrean 100 baris; badge menghitung seluruh tugas menunggu, terlepas dari filter. Validasi dan otorisasi admin tetap dijalankan pada server. Tidak ada migrasi atau variabel env tambahan untuk perubahan UI ini.

## Konfigurasi hosted

Pemeriksaan awal menemukan jadwal kosong. Setelah pemilik aplikasi meminta penyelesaian temuan, [supabase/jobs.sql](../../supabase/jobs.sql) diterapkan dan diverifikasi:

- Migrasi `0001` sampai `0007` tercatat pada database yang dipakai `.env.local`.
- Tiga job aktif dengan jadwal `* * * * *`: `sewamates-expire-login-requests`, `sewamates-expire-requests`, dan `sewamates-expire-payments`.
- `cron.job_run_details` mencatat `succeeded`; respons `pg_net` untuk job login/konfirmasi dan kedua job rental bernilai HTTP 200, tanpa timeout. Respons dengan jumlah kedaluwarsa nol juga merupakan eksekusi yang valid.
- Probe POST dengan nama job yang tidak ada ke Vercel menghasilkan `404 NOT_FOUND`: Bearer secret Vault sekarang diterima. Temuan 403 pada pemeriksaan sebelumnya sudah tidak terulang.
- Probe endpoint notifikasi Vercel dengan UUID sengaja tidak valid menghasilkan `422 VALIDATION_ERROR`: endpoint baru aktif dan autentikasi berhasil, tanpa memicu sender.

Cron Telegram tidak terpasang. URL dan secret Vault tidak diubah; tiga cron memanggil deployment Vercel yang sudah tersedia. Perubahan UI/API filter pada working tree masih perlu ikut deployment berikutnya.

## Verifikasi sebelum menutup sprint

- Jalankan checklist [E2E Sprint 3](03-transaksi-i-e2e.md) di deployment Vercel: pengajuan sampai lunas dengan tiga akun berbeda, kurang bayar, penolakan, kedaluwarsa, dan chat.
- Uji Telegram dari event bisnis nyata pada akun uji: pengajuan, persetujuan/penolakan, hasil pembayaran, keputusan identitas/listing, serta satu pesan grup admin per tugas. Tes Telegram yang telah dikonfirmasi sebelumnya memakai tunnel dev; probe saat audit hanya membuktikan endpoint Vercel dan autentikasinya.
- Periksa bucket `evidence-private`, signed URL, dan penolakan akses tanpa otorisasi pada Supabase hosted. Tiruan Storage dalam E2E lokal tidak membuktikan kebijakan hosted.
- Ukur target pesan chat <2 detik di lingkungan bersama; periksa riwayat >50 pesan ketika pesan baru masuk sambil pengguna membaca halaman lama. Skenario E2E transaksi yang tersedia belum mencakup riwayat panjang tersebut.
- Lengkapi Chrome Android dan Safari iOS fisik, desktop Chrome/Edge/Firefox sesuai DoD, CI, code review tim, serta pemeriksaan Sentry staging.

Validasi penyelesaian: **159 tes PostgreSQL lulus**, ditambah pemeriksaan terarah dua tes filter/count setelah penambahan kasus antrean 101 tugas. Lint, TypeScript, dan build production lulus. **4 skenario E2E transaksi lulus** pada Chromium desktop/HP/tablet dan WebKit HP, lebar 1440/360/768/390 px. Skenario mencakup penolakan templat, pembayaran bertahap sampai lunas, filter, badge, drag and drop desktop, posisi sticky, dan waktu daftar chat. Tidak ditemukan overflow horizontal atau galat JavaScript pada tiga sesi peserta/admin. Tidak ada klaim bahwa seluruh E2E hosted atau DoD perangkat sudah lulus.

## Batas sprint

Serah terima foto/kode/QR, pengembalian, jadwal ulang, tidak hadir, pembatalan setelah lunas, dan pelaksanaan pencairan/refund mengikuti Sprint 4. Stepper lengkap dan pengembangan detail transaksi F12 perlu diselaraskan saat Sprint 4. Pengingat dan penanda SLA terjadwal juga berada pada backlog Sprint 4.

Callback Telegram saat ini melakukan retry terbatas sampai 240 detik dan tidak memiliki cron cadangan, sesuai keputusan pemilik aplikasi. Pemulihan event yang tertahan mengikuti [panduan operasional](03-transaksi-i.md#webhook-telegram-tanpa-cron).
