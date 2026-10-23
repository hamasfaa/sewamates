# SewaMates – Dokumen Teknis Pengembangan

Aplikasi sewa-menyewa barang antar mahasiswa (peer-to-peer) dengan serah terima COD di titik kampus, dana ditahan platform lewat verifikasi dan pencairan manual oleh admin, serta mediasi sengketa. Pengguna utama: mahasiswa, lewat HP maupun PC (web responsif).

## Daftar Dokumen

| # | Dokumen | Isi |
|---|---------|-----|
| 01 | [Alur & Aturan Sistem](01-alur-dan-aturan-sistem.md) | **Sumber kebenaran logika**: flow, state machine + tabel transisi, aturan waktu/uang/sengketa, contoh perhitungan |
| 02 | [PRD & Fitur MVP](02-prd-fitur-mvp.md) | Daftar fitur (F1–F28 MVP, F40+ nanti), acceptance criteria, matriks notifikasi, kebutuhan non-fungsional |
| 03 | [Panduan UX/UI](03-panduan-ux-ui.md) | Navigasi, tata letak responsif HP/PC, layar pengguna & admin, pemetaan status ke UI, komponen, gaya visual & design token |
| 04 | [Arsitektur Teknis](04-arsitektur-teknis.md) | Stack, struktur repo, skema data, ledger, API, keamanan, job, tes, observability |
| 05 | [Roadmap & Backlog](05-roadmap-dan-backlog.md) | Persiapan dependensi, sprint 1–6, DoR/DoD |

Urutan baca untuk developer baru: 01 → 04 → 02 → 03 → 05.

## Keputusan yang sudah diambil

| Keputusan | Rincian |
|-----------|---------|
| Pembayaran tanpa payment gateway | Penyewa transfer ke rekening/e-wallet platform (Mandiri, BCA, OVO, dll) dan unggah bukti; admin verifikasi manual; admin transfer pencairan/refund dan ung~gah bukti |
| Kode unik | 3 digit, dihitung sebagai bagian deposit (dikembalikan) |
| Jam operasional admin | 08.00–21.00 WIB setiap hari |
| Pemegang dana | Semua admin; kontrol lewat klaim tugas, audit log, bukti permanen |
| Komisi | 10% dari total sewa, dipotong dari bagian pemilik |
| Platform | Web responsif (mobile-first, penuh di PC) + PWA, Next.js + Supabase (lihat 04). Serah terima & pengembalian hanya dari HP |
| Gaya visual | Berangkat dari warna ITS (biru & kuning) dibuat lebih cerah dan muda; font Plus Jakarta Sans; logo/nama/pola ITS tidak dipakai (lihat 03 bagian 7) |
| Login & notifikasi | **Telegram bot** (BotFather): login tanpa password/SMS dengan nomor HP terverifikasi lewat bagikan kontak, notifikasi kritis, konfirmasi aksi sensitif, grup notifikasi admin. Gratis, tanpa WhatsApp/SMS |
| Parameter aturan | Nilai default di dokumen 01 (⚙) **disetujui**; disimpan di `settings`, dapat diubah super admin tanpa rilis, dan di-snapshot per transaksi |
| Pilihan kampus | Atas permintaan pemilik aplikasi, registrasi/profil mendukung banyak kampus Indonesia sejak Sprint 1; snapshot Hipo dan keputusan ada di [ADR 0002](decisions/0002-pilihan-multi-kampus.md) |
| Biaya transfer pencairan | Ditanggung platform (⚙), dicatat sebagai biaya di ledger |

## Catatan atas diagram alur

Pada diagram asli, kotak "Pengembalian & cek kondisi" muncul dua kali. Kotak kedua diperlakukan sebagai **Pencairan dana**.

## Pelaksanaan sprint

Pengembangan dimulai dari [Sprint 1 — Fondasi](sprints/01-fondasi.md). Panduan konfigurasi ada di [Setup Sprint 1](setup-sprint-1.md), dan keputusan implementasi awal dicatat pada [ADR 0001](decisions/0001-fondasi-sprint-1.md).

[Sprint 2 — Marketplace](sprints/02-marketplace.md) dikerjakan atas permintaan pemilik aplikasi sementara sisa DoD Sprint 1 (staging dan integrasi nyata) masih terbuka. Keputusan implementasinya ada di [ADR 0003](decisions/0003-marketplace-sprint-2.md), dan langkah penyiapan tambahan ada di dokumen sprint tersebut.

Setelah pemilik aplikasi menyatakan uji Sprint 2 aman, pekerjaan dilanjutkan ke [Sprint 3 — Transaksi I](sprints/03-transaksi-i.md). Keputusan polling, uang, dan fondasi refund ada di [ADR 0004](decisions/0004-transaksi-sprint-3.md); langkah pengujian bersama tersedia di [checklist E2E Sprint 3](sprints/03-transaksi-i-e2e.md).

Setelah Sprint 3 dinyatakan selesai, pekerjaan dilanjutkan ke [Sprint 4 — Transaksi II](sprints/04-transaksi-ii.md): serah terima dan pengembalian, masa cek, pembatalan, jadwal ulang, tidak hadir, pembukaan sengketa, strike, serta pencairan manual dan kas. Keputusan penyelesaian dana, kode serah terima, dan klaim pencairan ada di [ADR 0005](decisions/0005-transaksi-sprint-4.md); langkah yang belum dijalankan di lingkungan bersama dicatat di [sisa Sprint 4](sprints/04-transaksi-ii-sisa.md).

[Sprint 5 — Kepercayaan & admin](sprints/05-kepercayaan-admin.md) melengkapi tanggapan dan putusan sengketa, ulasan, laporan, pengelolaan pengguna, rekonsiliasi, komisi, penyesuaian, hapus akun. Keputusan implementasi ada di [ADR 0006](decisions/0006-kepercayaan-admin-sprint-5.md) dan pengujian bersama di [UAT Sprint 5](sprints/05-kepercayaan-admin-e2e.md). Sprint 6 belum dimulai.
