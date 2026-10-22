# ADR 0004 — Transaksi, pembayaran, dan chat Sprint 3

Tanggal: 21 Oktober 2026. Status: diterapkan pada implementasi lokal.

## Konteks

Sprint 3 menambahkan transaksi dan penerimaan uang di atas sesi Telegram milik aplikasi. Dua pemilik keputusan dapat menyetujui jadwal atau memverifikasi bukti bersamaan. Bukti yang tertunda tidak boleh hilang ketika transaksi berakhir. Chat memerlukan isolasi peserta tanpa membuka koneksi database atau service key ke browser.

## Keputusan

- Seluruh mutasi tetap melalui server dan transaksi PostgreSQL. Urutan penguncian transaksi: baris barang, baris rental, lalu bukti pembayaran. Semua pembuat hold dan blokir pemilik mengunci barang yang sama; exclusion constraint menjadi penjagaan kedua terhadap hold bertumpuk.
- Harga, deposit, deskripsi, foto, dan titik disalin saat pengajuan. Pengaturan dan komisi diperbarui sekali saat persetujuan, kemudian tetap memakai `rules_snapshot`. Kode pembayaran 001–999 dialokasikan dalam advisory lock global dan dilindungi partial unique index selama menunggu bayar/verifikasi. Kode publik memakai bulan WIB dan sequence database.
- Hanya nominal yang diverifikasi admin menambah `amount_received`. Semua bukti tertunda harus diputuskan sebelum status lunas/kurang bayar ditetapkan. Bukti yang sama tidak bisa diproses ulang; versi transaksi menghindari keputusan berdasarkan layar lama. Admin yang menjadi peserta harus meminta admin lain.
- Jurnal penerimaan memakai debit `kas:<rekening>` dan kredit `dana_ditahan`. Trigger deferred memeriksa keseimbangan saat commit; update/delete ledger ditolak. Pembatalan gratis dan kedaluwarsa setelah pembayaran parsial membuat kewajiban refund per bukti diterima. Verifikasi terlambat pada transaksi final juga menjadi refund, tanpa menghidupkan transaksi kembali.
- Fondasi `payout_tasks` dibuat lebih awal untuk menjaga kewajiban refund tetap tersimpan. Hanya pembuatan tugas refund dan snapshot rekening terenkripsi yang tersedia; klaim dan pelaksanaan transfer mengikuti Sprint 4. Fondasi `reports` dan `user_blocks` juga maju dari Sprint 5 karena laporan/blokir pesan adalah acceptance criteria F9; penanganan laporan menyeluruh tetap Sprint 5.
- Bukti bayar dan gambar chat memakai `evidence-private`, batas 5 MB, signed URL baca 5 menit. PDF hanya untuk bukti bayar; gambar menerima JPEG/PNG/WebP. Tiket unggah sekali pakai harus dimiliki pengirim. Tidak ada endpoint aplikasi untuk menghapus bukti.

URL bukti privat dipakai ulang pada server maksimal 4 menit (cache dibatasi 500 entri), sehingga gambar tidak dimuat ulang pada setiap polling. Otorisasi peserta/admin tetap dijalankan sebelum mengambil URL dari cache. Satu URL tidak dipakai melewati masa berlakunya.

## Hasil spike Realtime

Sesi aplikasi berupa token acak dengan hash pada tabel `sessions`, bukan sesi Supabase Auth. Konfigurasi yang tersedia tidak menyediakan kunci penandatangan JWT untuk identitas pengguna aplikasi. Service key Storage memberikan hak server dan tidak dijadikan token browser atau kunci penandatangan identitas pengguna.

Dokumentasi Supabase menjelaskan otorisasi koneksi [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), pengelolaan [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys), dan perbedaan [API keys](https://supabase.com/docs/guides/api/api-keys). Karena uji Realtime beridentitas pengguna belum dapat dilakukan dengan konfigurasi ini, keputusan sprint adalah polling terotorisasi, sesuai fallback roadmap. Tidak ada klaim bahwa koneksi Realtime hosted sudah diuji.

Pesan ruang chat dipoll setiap 1,5 detik ketika tab terlihat, daftar chat/transaksi/antrean setiap 5 detik, dan lonceng notifikasi mempertahankan interval 15 detik. Respons pesan hanya untuk peserta; admin mengakses endpoint terpisah jika ada laporan, dengan audit log. Target pesan muncul <2 detik bergantung latensi server/jaringan dan perlu diukur lagi di staging. Tabel chat tetap menolak akses langsung `anon`/`authenticated`; tidak ada endpoint JWT sementara atau service key pada klien.

Pesan sistem hanya berisi kode/status dari server sehingga tidak terkena filter nomor. Pesan pengantar pengajuan disimpan sebagai pesan pengguna, menjalani filter yang sama dengan chat biasa. Teks pengguna asli disimpan di DB, sementara keluaran peserta menyamarkan tautan dan deret minimal 8 digit, termasuk separator. Admin dapat membaca teks asli hanya setelah otorisasi laporan dan pencatatan akses.

## Notifikasi dan batas operasional

Insert notifikasi kritis membuat outbox Telegram di transaksi yang sama. Keputusan listing dan chat hanya in-app sesuai F15. Tugas verifikasi identitas/listing/pembayaran masuk ke semua admin aktif dan, jika dikonfigurasi, satu delivery ke grup admin. Worker memakai lease, maksimal 5 percobaan, backoff, `retry_after`, dan penanda bot diblokir pada 403. Throttle bersama menjaga jeda global 35 ms dan per chat 1 detik. Satu job memeriksa maksimal 30 delivery; backlog diproses pada pemanggilan berikutnya. Timeout jaringan setelah Telegram menerima pesan masih dapat menghasilkan duplikat pada retry; Bot API tidak memberikan idempotency key untuk pengiriman.

Batas tambahan implementasi: maksimal 10 pengajuan per pengguna per jam, chat 30 pesan per menit, pesan 2.000 karakter, dan daftar transaksi/chat/antrean maksimal 100 baris per respons. Riwayat pesan memakai cursor 50 pesan; panel pembayaran mendahulukan bukti terlama. Paginasi daftar transaksi yang besar dan optimasi kapasitas antrean mengikuti pengukuran hardening.

## Konsekuensi

Tidak ada integrasi Realtime atau secret baru untuk menjalankan Sprint 3. Migrasi `0005`, rekening platform aktif, dan tiga cron baru wajib disiapkan sebelum uji bersama. Migrasi ini perlu didahulukan sebelum kode baru menerima traffic. Akun yang ditangguhkan masih dapat menyelesaikan pembayaran/chat transaksi lama; pengajuan dan pembukaan chat baru tetap ditolak. Pembatalan setelah lunas, serah terima, pengembalian, dan pelaksanaan pencairan tidak dibuka pada sprint ini.
