# ADR 0002 — Pilihan multi-kampus sejak Sprint 1

Tanggal: 21 Oktober 2026. Status: diterapkan.

## Konteks

Dokumen awal membatasi MVP pada satu kampus. Pemilik aplikasi kemudian meminta banyak kampus sekaligus. Perubahan ini memasukkan referensi kampus Indonesia dan pemilihan kampus pada registrasi/profil ke Sprint 1. Marketplace dan transaksi tetap mengikuti sprint masing-masing.

## Keputusan

- Mengimpor snapshot 197 kampus Indonesia dari Hipo, berlisensi MIT, dengan commit sumber tercatat di `data/campuses/source.json`. Dataset komunitas ini tidak dianggap sebagai daftar resmi atau lengkap PDDikti.
- Daftar tersedia dari database sendiri melalui `GET /api/campuses`; parameter opsional `q` mencari nama/domain, maksimum 100 karakter. Form profil memuat daftar sekali, lalu mencari nama atau singkatan secara lokal. Singkatan domain yang tepat diprioritaskan.
- Kampus harus dipilih secara eksplisit. Mencari kampus lain tidak menghapus pilihan sebelumnya. Server memvalidasi UUID dan ketersediaan kampus.
- `campuses` mendapat `source_key` unik, `domains`, dan `is_active`. Impor berulang memperbarui nama/domain tanpa mengganti ID, menghapus data, atau mengaktifkan kembali kampus yang diarsipkan. Domain utama menjadi identitas sumber; perubahan domain utama perlu rekonsiliasi manual.
- Placeholder lama diarsipkan saat impor bila ID dan namanya belum diubah. Referensi pengguna lama tetap utuh dan dapat disimpan kembali, tetapi kampus yang diarsipkan tidak ditawarkan sebagai pilihan baru.
- `db:seed` mengimpor snapshot bersama seed lain. `db:campuses` hanya mengimpor kampus, tanpa menyentuh pengaturan atau bootstrap admin. Keduanya menggunakan transaksi dan tidak memanggil API luar.

## Konsekuensi

Tidak diperlukan variabel environment atau layanan tambahan. Snapshot dapat ditinjau sebelum pembaruan. Cakupan data dan perubahan nama perlu dipelihara; kampus yang belum terdaftar dapat ditambahkan melalui seed/migrasi terpisah. Pengaturan titik serah terima dan filter listing per kampus perlu diterapkan pada Sprint 2, sesuai skema `campus_id` yang direncanakan. Tema per kampus dan pengelolaan operasional lanjutan tetap di luar fondasi ini.
