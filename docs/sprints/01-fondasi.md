# Sprint 1 — Fondasi

Tanggal pengerjaan: 21 Oktober 2026.

**Status: implementasi lokal tersedia; Definition of Done belum penuh karena integrasi/deployment staging dan uji perangkat nyata belum diverifikasi. Sprint 2 belum dimulai.**

| Backlog                   | Hasil implementasi                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo, lint/typecheck, CI  | Next.js/TypeScript, ESLint, npm lockfile, CI PostgreSQL dan browser, workflow staging bersyarat                                              |
| Sentry                    | Instrumentasi browser/server, konfigurasi DSN dan source map opsional; event nyata belum diuji                                               |
| Design token dan komponen | Token PM, Tailwind, tema shadcn/ui, Plus Jakarta Sans, tombol/input/chip/kartu                                                               |
| Layout responsif          | Header, navigasi bawah di HP/tablet, navigasi atas mulai 1024 px, container 1200 px                                                          |
| Migrasi dan seed          | Seluruh tabel Sprint 1, RLS, constraint, trigger audit, bucket identitas/avatar; seed 197 kampus Indonesia dan settings                      |
| Job                       | Endpoint internal bersecret, expiry login/aksi, SQL cron menggunakan Vault                                                                   |
| F18 bot                   | Webhook bersecret, dedup dengan rollback, `/start`, kontak sendiri, angka, konfirmasi, deteksi bot diblokir, `/bantuan`                      |
| F1 auth                   | Cookie httpOnly/SameSite, nonce browser, token sekali pakai, polling/QR, batas laju, sesi 30 hari/admin maks. 12 jam, cabut sesi             |
| F2 + F20 identitas        | Stepper dan kompresi 1600 px, tiket unggah, antrean terlama, bukti privat 5 menit, terima/tolak beralasan, pengajuan ulang                   |
| F3 profil/rekening        | Nama/kampus/foto, pencarian dan pilihan multi-kampus, persetujuan ketentuan, profil publik tanpa HP, rekening terenkripsi dan konfirmasi bot |
| Kerangka admin + F27      | Ringkasan antrean, role guard, audit permanen/filter, settings tervalidasi khusus super admin                                                |
| Notifikasi dasar          | Tabel, lonceng jumlah belum dibaca, daftar, tandai dibaca, tautan terkait                                                                    |

## Verifikasi lokal

- ESLint dan TypeScript: lulus tanpa galat maupun peringatan pada pemeriksaan final.
- Vitest: 57 tes unit/integrasi lulus menggunakan PGlite. Mencakup nonce, replay, rate limit, sesi, Telegram, relink, rekening, upload, keputusan bersamaan, idempotensi, settings, job, RLS, redaksi data monitoring, tautan aplikasi/web dengan token sama, impor kampus idempoten, pencarian, validasi dan pelestarian pilihan profil, konfigurasi Storage kosong, penerbitan tiket unggah, dan bootstrap super admin (audit UUID/teks, pencabutan sesi, penolakan akun tidak memenuhi syarat, idempotensi, serta rollback).
- Build production: berhasil dengan Next.js 16.4.2 dan Plus Jakarta Sans dari `next/font`.
- Browser: 16 tes lulus pada Chromium dan WebKit, ukuran layar 360, 390, 768, dan 1440 px. Tampilan desktop dan HP juga ditinjau dari screenshot lokal.
- Pemeriksaan ulang memperbaiki pemuatan aset WebKit pada server lokal HTTP: CSP `upgrade-insecure-requests` hanya diterapkan pada permintaan HTTPS, dan tes navigasi memeriksa regresi tersebut.
- Perbaikan pembukaan Telegram menambahkan tombol aplikasi langsung dan Telegram Web. Pemeriksaan langsung di Chromium desktop dan WebKit mobile memastikan parameter login sama, opsi web membuka tab terpisah, dan halaman pencocokan tetap terbuka. Peluncuran aplikasi native tetap memerlukan Telegram terpasang dan izin browser pada perangkat nyata.
- Multi-kampus: migrasi dan impor 197 kampus berhasil pada Supabase dev; API nyata mengembalikan daftar dan pencarian, serta menolak kueri terlalu panjang. Komponen pilihan diuji pada harness browser dengan CSS aplikasi dan data API nyata di Chromium 1440 px serta WebKit 390 px: pilihan wajib, pencarian, pelestarian pilihan, arsip, dan tidak ada overflow/galat JavaScript. Penyimpanan profil diuji pada database tes; pengujian form dengan sesi Telegram nyata tetap bagian pemeriksaan manual.
- Konfigurasi unggah: URL/key Storage yang kosong kini menghasilkan `503 STORAGE_NOT_CONFIGURED` sebelum transaksi database dibuka. Pesan respons tidak memuat secret. Saat pemeriksaan galat unggah, key server di environment dev belum diisi; unggahan Storage nyata masih menunggu pengisian konfigurasi dan pengujian ulang.
- Bootstrap admin: galat SQL `42P08` akibat parameter audit yang sama dipakai untuk UUID dan teks diperbaiki melalui parameter terpisah pada insert Drizzle. Seed ulang ke Supabase dev berhasil; pengujian panel dengan sesi Telegram baru tetap perlu dilakukan pengguna.
- Responsif profil: masalah konten melebar 706 px pada viewport 360 px berhasil direproduksi dan diperbaiki dengan batas kolom grid, menu dua kolom di HP, serta penataan kartu/badge/tombol. Pemeriksaan 32 kombinasi halaman/viewport/browser pada profil, identitas, rekening, dan sesi lulus di Chromium (320, 360, 390, 768, 1024, 1440 px) serta WebKit (360, 390 px), pada zoom 100% tanpa overflow horizontal. Harness memakai komponen, CSS, dan font aplikasi dengan data API uji; penyimpanan formulir memakai respons mock. Typecheck, lint komponen, dan build production lulus setelah perbaikan.
- PostgreSQL 17 native: workflow sudah disiapkan; belum dijalankan pada GitHub dari workspace ini.
- Audit npm produksi: 0 advisori. Audit termasuk dev tools masih mencatat 5 advisori high pada rantai `eslint-config-next → fast-glob → micromatch → braces` (versi upstream terbaru masih terdampak). Tidak dilakukan downgrade Next/ESLint yang tidak kompatibel; pantau pembaruan upstream sebelum hardening.

## Penyelesaian sebelum menutup sprint

- [ ] Isi environment dev/staging untuk Supabase, Telegram, kunci enkripsi, dan job.
- [x] Terapkan migrasi `0003` dan impor 197 kampus pada Supabase dev yang dikonfigurasi di workspace; ID profil lama tetap tersimpan.
- [ ] Terapkan migrasi dan seed pada Supabase staging, tinjau cakupan data kampus, bootstrap admin yang sebenarnya.
- [ ] Uji login/angka/QR/relink dan konfirmasi rekening dengan bot nyata.
- [ ] Uji unggah, akses privat, dan expiry signed URL pada Supabase Storage nyata.
- [ ] Aktifkan cron/Vault dan periksa eksekusi berkala.
- [ ] Jalankan CI di GitHub, deploy HTTPS staging, dan periksa Sentry.
- [ ] Uji Chrome Android/Safari iOS dan desktop sesuai DoD PM.
- [ ] Review kode oleh reviewer tim.

Langkah konfigurasi tersedia di [setup Sprint 1](../setup-sprint-1.md). Jangan menandai Sprint 1 selesai atau mulai Sprint 2 sebelum sisa DoD disepakati.
