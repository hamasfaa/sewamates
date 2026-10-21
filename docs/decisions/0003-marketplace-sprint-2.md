# ADR 0003 — Marketplace Sprint 2

Tanggal: 21 Oktober 2026. Status: diterapkan pada kode, menunggu validasi Storage dan staging.

## Konteks

Sprint 2 membangun listing, moderasi, pencarian, dan detail barang (dokumen 05) di atas fondasi Sprint 1. Beberapa detail teknis belum ditentukan dokumen 01–04: konfigurasi pencarian teks, penyimpanan foto publik, urutan "terbaru", penguncian moderasi, dan cara titik serah terima terikat kampus. Rental, chat, dan rating belum ada, tetapi kolom dan filter harus siap dipakai sprint berikutnya.

## Keputusan

- **Pencarian** memakai kolom `search_tsv` yang dibangkitkan PostgreSQL dengan konfigurasi `simple` (judul bobot A, deskripsi bobot B) dan indeks GIN. Tidak memakai stemming bahasa Indonesia agar merek dan model ("EOS 1200D", "PS5") tetap cocok persis. Kata kunci dibersihkan menjadi huruf/angka lalu dicocokkan sebagai awalan (`kame:*`), sehingga hasil muncul saat pengguna masih mengetik. Relevansi memakai `ts_rank`.
- **Paginasi cursor** berbasis keyset untuk setiap urutan (relevan, terbaru, termurah, rating), selalu diakhiri `id` sebagai pemutus seri. Cursor menyimpan urutan asalnya dan nilai waktu dengan presisi mikrodetik agar tidak ada item terlewat atau ganda.
- **Visibilitas publik** didefinisikan sekali (`publiclyListed`): status `aktif`, akun pemilik `aktif`, kategori aktif, dan minimal satu titik aktif. Kolom `published_at` diisi saat persetujuan pertama dan dipakai untuk "Baru ditambahkan"; persetujuan ulang setelah edit tidak menaikkan urutan.
- **Review ulang** mengikuti A-3.2 lewat fungsi murni `needsReview` (judul, kategori, kumpulan foto) dan `statusAfterEdit`. Kolom `submitted_at` menjaga urutan antrean, sedangkan `version` naik pada setiap perubahan pemilik. Keputusan admin wajib membawa versi yang dilihatnya; jika pemilik mengubah listing di antaranya, keputusan ditolak (409). Kunci baris dan status `menunggu_review` mencegah dua keputusan.
- **Kampus**: listing memakai kampus pemilik saat dibuat dan tidak bisa dipindahkan. Titik serah terima harus aktif dan sekampus; aturan ini divalidasi service dan dijaga trigger database. Kampus titik juga tidak bisa diubah setelah dibuat.
- **Foto listing** disimpan di bucket publik `items-public` sebagai pasangan foto 1600 px dan thumbnail 480 px. Browser mengompres lewat canvas (WebP, fallback JPEG), yang sekaligus menghapus metadata. Server memverifikasi tiket, ukuran, jenis file, dan menolak file yang masih membawa EXIF/XMP sebelum transaksi database dibuka; tiket ditandai terpakai dalam satu pernyataan di dalam transaksi. Hanya pengguna terverifikasi yang dapat meminta tiket foto barang. Foto lama yang diganti tidak dihapus dari Storage agar tetap tersedia sebagai bukti bila Sprint 3 perlu snapshot untuk sengketa "barang tidak sesuai".
- **Kalender blokir** disimpan sebagai `tstzrange` `[mulai, akhir)` dari tanggal WIB. Tumpang tindih antarblokir dicek di service di bawah kunci baris `items`, sesuai catatan 04 §4.3; Sprint 3 memakai kunci yang sama untuk hold rental. Exclusion constraint `btree_gist` ditunda ke Sprint 3 bersama tabel `rentals`.
- **Kolom rating dan `completed_count`** pada `items` dibuat sekarang dengan nilai 0 (seperti tabel `users` di Sprint 1), sehingga urutan rating dan bagian "Paling sering disewa" tidak perlu migrasi ulang. Nilainya diisi Sprint 4–5.
- **Pengaturan baru** `listing_sla_hours` (default 24 jam) untuk penanda terlambat antrean moderasi. Panel super admin juga menampilkan rentang deposit dan komisi karena kini dipakai validasi listing.
- **Seed** mengisi 12 kategori umum hanya bila tabel kosong. Titik serah terima tidak di-seed karena merupakan lokasi nyata kampus; super admin menambahkannya dari panel.
- **CSS**: kelas komponen (`.input`, `.notice`, `.skeleton`, dll.) dipindah ke `@layer components` agar utilitas Tailwind dapat menimpanya. Fokus `.input:focus` dan `.page-container` tetap di luar layer untuk mempertahankan perilaku Sprint 1.

## Konsekuensi

Rentang deposit dan komisi berasal dari `settings`, sehingga listing lama dapat berada di luar rentang setelah super admin mengubah settings; moderasi menampilkan penanda "Di luar rentang" dan pemilik harus menyesuaikan saat mengedit. Pencarian tanpa stemming tidak menyamakan kata berimbuhan ("menyewakan" dengan "sewa"); bila diperlukan, konfigurasi dapat diganti lewat migrasi baru. Filter tanggal saat ini hanya membaca blokir pemilik; Sprint 3 menambahkan hold rental ke fungsi yang sama. Pengarsipan belum dapat memeriksa transaksi non-final karena tabel `rentals` belum ada; pemeriksaan itu wajib ditambahkan di Sprint 3.
