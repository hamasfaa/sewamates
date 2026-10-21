# Sprint 2 — Marketplace

Tanggal pengerjaan: 21 Oktober 2026.

**Status: implementasi lokal tersedia dan terverifikasi pada PostgreSQL 17. Definition of Done belum penuh karena Supabase Storage nyata, staging, dan perangkat fisik belum diuji. Sprint ini dimulai atas permintaan pemilik aplikasi, sementara sisa DoD Sprint 1 masih terbuka (lihat [Sprint 1](01-fondasi.md)).**

| Backlog                                                    | Hasil implementasi                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrasi `categories`, `pickup_points`, `items`, dll.       | Migrasi `0004`: tabel, constraint A-3.2, `tsvector` terbentuk otomatis, trigger titik sekampus, kampus listing/titik tidak bisa dipindah, RLS, bucket `items-public`, indeks pencarian     |
| Unggahan signed URL + kompresi klien                       | Tujuan unggah `item_photo` khusus pengguna terverifikasi; foto utama 1600 px dan thumbnail 480 px (WebP, fallback JPEG); server memeriksa ukuran, jenis file, dan menolak metadata EXIF/XMP |
| F4 wizard listing, listing saya, kalender blok             | Wizard 4 langkah + pratinjau, validasi per field, perkiraan pendapatan bersih, draf lokal; edit dengan aturan review ulang; jeda/aktifkan/arsip; blokir tanggal per hari WIB               |
| F21 moderasi listing                                       | Antrean terlama dengan target `listing_sla_hours`, tampilan berdampingan, cek rentang deposit, riwayat keputusan, versi listing mencegah persetujuan isi yang sudah berubah                 |
| F27 CRUD kategori & titik (super admin)                    | Tab Pengaturan: kategori (unik, nonaktif, hapus hanya bila belum dipakai) dan titik per kampus dengan jam operasional; semua perubahan masuk audit log                                      |
| F5 beranda & pencarian                                     | Beranda (kategori, baru ditambahkan, paling sering disewa), pencarian teks awalan, filter kategori/kampus/titik/harga/tanggal, 4 urutan, paginasi cursor 20 item + infinite scroll          |
| Kampus pada listing, pencarian, titik                      | Listing memakai kampus pemilik saat dibuat; titik wajib sekampus (service + trigger DB); filter kampus default ke kampus pengguna, bisa "Semua kampus"                                      |
| F6 detail barang                                           | Galeri geser, fakta harga/deposit/nilai, ringkasan biaya dengan durasi, kalender ketersediaan, titik + jam, kartu pemilik, ulasan (kosong sampai Sprint 5), kartu sewa menempel di PC      |

Pengajuan sewa dan chat mengikuti Sprint 3. Tombol "Ajukan sewa" tampil nonaktif dengan keterangan untuk pengguna terverifikasi; pengunjung diarahkan masuk dan pengguna belum terverifikasi diarahkan ke verifikasi (F2).

## Verifikasi lokal

- ESLint dan TypeScript lulus tanpa galat. Build production Next.js 16.4.2 berhasil dengan rute baru: `/cari`, `/barang/[id]`, `/barang/[id]/ubah`, `/barang/[id]/kalender`, `/sewakan`, `/profil/listing`, `/admin/listing`, `/admin/pengaturan/kategori`, `/admin/pengaturan/titik`.
- Vitest: 100 tes lulus (57 Sprint 1 + 43 baru) memakai PGlite, dan juga lulus pada PostgreSQL 17 asli lewat `TEST_DATABASE_URL` seperti CI (termasuk tes keputusan bersamaan dengan konkurensi nyata). Tes baru mencakup contoh deposit A-3.2 (termasuk nilai Rp20.000.000 → tepat Rp1.000.000), komisi dan contoh pendapatan A-3.8, transisi status listing, pemicu review ulang, jam titik, tanggal WIB, sanitasi kata kunci, deteksi metadata foto, kelayakan pemilik, validasi kampus/titik/deposit, tiket foto sekali pakai, idempotensi, pemilik lain ditolak, blokir tumpang tindih, moderasi bersamaan, versi kedaluwarsa, larangan meninjau listing sendiri, CRUD super admin + audit, visibilitas pencarian, filter, paginasi tanpa duplikat untuk setiap urutan, detail tersembunyi, dan RLS.
- Playwright: 28 tes lulus (16 Sprint 1 + 12 baru) di Chromium dan WebKit pada 360, 390, 768, dan 1440 px: grid hasil, filter sidebar vs bottom sheet, infinite scroll, URL filter, chip filter, dan perlindungan halaman/API pemilik.
- Uji langsung pada PostgreSQL 17 (embedded) dengan runner `db:migrate` dan `db:seed` asli: migrasi `0001`–`0004` berhasil, seed idempoten (12 kategori lalu 0). Alur lengkap dijalankan di browser dengan sesi nyata dan tiruan endpoint Storage: super admin menambah titik → pemilik mengunggah 3 foto lewat wizard di 360 px → admin menyetujui → beranda, pencarian, dan detail di 360/768/1440 px → blokir tanggal → filter tanggal menyembunyikan listing → ubah harga tetap tayang, ubah judul kembali ke review. Tidak ada galat konsol, galat server, maupun overflow horizontal.
- Perbaikan dari uji langsung: kelas komponen di `globals.css` dipindah ke `@layer components` karena CSS tanpa layer selalu mengalahkan utilitas Tailwind (contoh: prefiks "Rp" menimpa nominal, `input min-h-24` Sprint 1 tidak berlaku); pratinjau foto wizard tidak lagi rusak setelah pindah langkah; menu admin tidak lagi melebar di layar 360 px.
- `package-lock.json` ditambah dua entri opsional (`@emnapi/core`, `@emnapi/runtime`) yang hilang sehingga `npm ci` gagal di npm 10 dan 11. Tidak ada versi paket yang berubah.

## Penyiapan lingkungan

1. Terapkan migrasi baru: `npm run db:migrate` (hosted) atau `npx supabase migration up` (CLI lokal). Migrasi membuat bucket publik `items-public` (5 MB, JPEG/PNG/WebP) bila schema Storage tersedia.
2. Jalankan `npm run db:seed`. Kategori awal hanya diisi bila tabel kategori masih kosong, sehingga perubahan super admin tidak tertimpa.
3. Super admin menambahkan titik serah terima per kampus di **Admin → Pengaturan → Titik serah terima**. Seed sengaja tidak mengarang lokasi kampus; datanya berasal dari pengelola. Tanpa titik aktif, wizard menampilkan pesan bahwa titik di kampus pengguna belum tersedia.
4. Batas unggah dinaikkan menjadi 60 tiket per jam per pengguna karena satu listing memakai hingga 16 file.

## Interpretasi yang perlu dikonfirmasi PM

- Rentang deposit dibulatkan ke dalam per Rp1.000 (batas bawah ke atas, batas atas ke bawah) agar persentase 10–50% tidak terlampaui; deposit wajib kelipatan Rp1.000.
- "Diubah pada foto" berarti kumpulan foto berubah (tambah/hapus). Mengubah urutan foto saja tidak memicu review. Perubahan deskripsi tidak memicu review sesuai A-3.2.
- Listing `ditolak` yang diubah apa pun dikirim ulang ke review. Listing yang dijeda lalu diubah judulnya menjadi `aktif` setelah disetujui.
- Arsip bersifat final (tidak ada endpoint "batal arsip" di dokumen 04).
- Batas yang belum diatur dokumen: judul 5–80 karakter, deskripsi 20–2.000, nilai barang Rp10.000–Rp100.000.000, harga Rp1.000–Rp10.000.000 per hari, durasi 1–90 hari, maksimal 10 titik per listing, blokir sampai 1 tahun ke depan dan maksimal 50 blokir mendatang.
- Listing di kategori nonaktif atau tanpa titik aktif disembunyikan dari pencarian dan detail publik; pemilik melihat peringatan di "Listing saya".

## Penyelesaian sebelum menutup sprint

- [ ] Terapkan migrasi `0004` dan seed pada Supabase dev/staging; pastikan bucket `items-public` publik.
- [ ] Uji unggah foto listing ke Supabase Storage nyata (signed upload, unduhan server, URL publik, penolakan EXIF).
- [ ] Isi titik serah terima dan jam operasional dari pengelola untuk kampus uji coba.
- [ ] Uji wizard, galeri, dan kalender di Chrome Android dan Safari iOS asli (termasuk fallback JPEG bila WebP tidak didukung encoder).
- [ ] Ukur p95 `GET /api/items` dengan 10.000 listing (target F5 < 500 ms) pada database staging.
- [ ] Review kode oleh reviewer tim; konfirmasi interpretasi di atas oleh PM.
- [ ] Sisa DoD Sprint 1 (staging, bot nyata, cron, Sentry) tetap berlaku.
