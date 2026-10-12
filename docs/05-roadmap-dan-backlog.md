# 05 – Roadmap & Backlog

Asumsi: tim 2–4 developer, sprint 2 minggu. Estimasi kasar; dihitung ulang setelah desain selesai.

## 1. Persiapan (mulai segera, paralel dengan desain)

Beberapa dependensi eksternal butuh waktu persetujuan, jadi harus diurus sebelum Sprint 1:

| Item | Untuk | Catatan |
|------|-------|---------|
| Akun Supabase (staging + production), Vercel, GitHub | Infrastruktur | Region Singapura |
| Bot Telegram via BotFather: 3 bot (dev, staging, production), nama, foto, deskripsi, daftar perintah | Login, notifikasi | Gratis, selesai dalam hitungan menit; token bot disimpan sebagai secret |
| Grup Telegram admin + bot dimasukkan ke grup | Notifikasi antrean admin | – |
| Domain + HTTPS | PWA, webhook Telegram (wajib HTTPS) | – |
| Data rekening/e-wallet platform (Mandiri, BCA, OVO, …) | `platform_accounts` | Diisi super admin, bukan di kode |
| Data titik serah terima + jam operasional, daftar kategori | Seed | – |
| Teks S&K dan kebijakan privasi | Halaman statis | Konten dari pemilik bisnis |
| Logo SewaMates + turunan ikon ([03](03-panduan-ux-ui.md) bagian 7.8) | PWA, favicon, pratinjau tautan, foto bot | Wordmark sementara boleh dipakai sampai logo final siap; logo final wajib ada sebelum Sprint 6 |

## 2. Fase

| Fase | Durasi | Keluaran |
|------|--------|----------|
| Desain | 2 minggu (paralel Sprint 1) | Figma layar kunci versi **HP dan PC** ([03](03-panduan-ux-ui.md) bagian 2.1 & 3), design token (bagian 7), logo |
| Sprint 1 – Fondasi | 2 minggu | Repo, CI, auth, profil, verifikasi, kerangka admin |
| Sprint 2 – Marketplace | 2 minggu | Listing, moderasi, pencarian, detail |
| Sprint 3 – Transaksi I | 2 minggu | Pengajuan, pembayaran manual, chat, notifikasi Telegram, job |
| Sprint 4 – Transaksi II | 2 minggu | Serah terima, pengembalian, pembatalan, pencairan manual |
| Sprint 5 – Kepercayaan & admin | 2 minggu | Sengketa, rating, laporan, strike, rekonsiliasi, push |
| Sprint 6 – Hardening | 2 minggu | Keamanan, performa, e2e, uji pemulihan, beta terbatas |
| Rilis | 1 minggu | Production, monitoring, runbook |
| Iterasi | berkelanjutan | Fitur P1/P2 (F40–F47), terutama payment gateway (F43) bila beban admin terlalu besar |

Total sampai rilis: ±13–14 minggu.

## 3. Backlog per Sprint

ID fitur merujuk ke [02](02-prd-fitur-mvp.md); aturan ke [01](01-alur-dan-aturan-sistem.md).

**Sprint 1 – Fondasi**
- Setup repo, struktur folder ([04](04-arsitektur-teknis.md) bagian 3), lint/typecheck, CI, Sentry, deploy staging.
- Design token (CSS variable + Tailwind + tema shadcn/ui, [03](03-panduan-ux-ui.md) bagian 7.9), font Plus Jakarta Sans via `next/font`, komponen dasar (tombol, input, chip status, kartu).
- Kerangka layout responsif: navigasi bawah (HP) dan navigasi atas (PC ≥ 1024 px), kontainer maks 1200 px.
- Migrasi awal: `campuses`, `users`, `identity_verifications`, `payout_accounts`, `settings`, `admin_audit_logs`, `notifications`, `sessions`, `login_requests`, `action_confirmations`, `telegram_updates`; seed.
- Infrastruktur job (`pg_cron` → `/api/internal/jobs`) + job `expire-login-requests`.
- F18 kerangka bot Telegram (webhook, dedup update, `/start`, bagikan kontak, angka pencocokan, tombol konfirmasi aksi).
- F1 login via Telegram, middleware role (sesi admin 12 jam), daftar & cabut sesi.
- F2 verifikasi identitas + F20 antrean verifikasi admin.
- F3 profil + rekening pencairan (enkripsi nomor rekening, konfirmasi via bot).
- Kerangka panel admin + audit log + F27 settings dasar.
- Notifikasi in-app dasar (tabel + lonceng).

**Sprint 2 – Marketplace**
- Migrasi: `categories`, `pickup_points`, `items`, `item_photos`, `item_pickup_points`, `availability_blocks`.
- Unggahan via signed URL + kompresi klien.
- F4 wizard listing, listing saya, kalender blok.
- F21 moderasi listing; F27 CRUD kategori & titik (super admin).
- F5 beranda & pencarian (full-text, filter tanggal, cursor pagination).
- F6 detail barang.

**Sprint 3 – Transaksi I**
- Migrasi: `rentals` (+ exclusion constraint & partial unique), `rental_events`, `payments`, `platform_accounts`, `ledger_entries`, `conversations`, `messages`, `notification_deliveries`.
- `/src/domain`: state machine, `pricing.ts`, `availability.ts` + seluruh unit test-nya.
- F27 CRUD rekening platform (super admin) — dibutuhkan halaman bayar.
- F7 pengajuan & persetujuan (hold, batas tanggapan, `rules_snapshot`).
- F8 pembayaran manual (bukti bertahap, kurang bayar) + F22 verifikasi per bukti + jurnal ledger pertama.
- **Spike di awal sprint**: Supabase Realtime dengan JWT yang diterbitkan server ([04](04-arsitektur-teknis.md) bagian 2); bila gagal, putuskan polling.
- F9 chat (real-time atau polling, pesan sistem, filter nomor/tautan).
- Job `expire-requests`, `expire-payments`, `deliver-notifications`.
- Notifikasi Telegram (pesan + tombol "Buka di SewaMates") untuk kejadian Sprint 1–3; perintah `/transaksi` & `/bantuan`; notifikasi grup admin.

**Sprint 4 – Transaksi II**
- Migrasi: `handover_records`, `handover_photos`, `reschedule_requests`, `no_show_reports`, `payout_tasks`, `cash_movements`, `strikes`, `disputes`, `dispute_evidence`.
- F10 serah terima & pengembalian (kamera, kode/QR, "Saya sudah sampai"), denda telat, masa cek; panel "Lanjutkan di HP" (QR) untuk PC.
- F11 pembatalan (tabel A-3.6), jadwal ulang, tidak hadir + bantahan, pemberian strike.
- Pembukaan sengketa dari semua pemicu (status `SENGKETA` + bukti); UI putusan admin menyusul di Sprint 5.
- `payout.ts` + pembuatan tugas pencairan untuk semua jalur (normal, batal, kedaluwarsa); F23 antrean pencairan (klaim, rekening sumber, biaya transfer, unggah bukti); pemindahan antar rekening.
- F12 detail & riwayat transaksi (timeline, bukti pencairan).
- Job: `stale-start`, `close-review-window`, `overdue-returns`, `no-show-timeouts`, `release-claims`, `reminders`, `sla-flags`.

**Sprint 5 – Kepercayaan & admin**
- Migrasi: `reviews`, `reports`, `user_blocks`, `reconciliations`, `push_subscriptions`; kolom rating di `items`.
- F13 tanggapan sengketa + F24 putusan admin (lanjutkan / batal / bagi dana, invarian A-3.8).
- F14 rating (job `reveal-reviews`, rating barang).
- F16 laporan & blokir; F26 manajemen pengguna, penangguhan otomatis (`auto-suspend`).
- F25 rekonsiliasi + penarikan komisi; F28 rekap & audit log; tugas penyesuaian (SA).
- F15 web push; F17 hapus akun (+ job `purge-identity`).

**Sprint 6 – Hardening**
- Review keamanan (otorisasi per endpoint, RLS, rate limit, header).
- E2E Playwright alur lengkap; tes konkuren untuk pemesanan dan pencairan.
- Performa (LCP, ukuran bundle, indeks DB untuk pencarian).
- Uji pemulihan backup; runbook insiden (job macet, webhook Telegram mati, salah transfer).
- PWA (manifest, ikon logo final, install prompt di HP & PC), gambar Open Graph, halaman S&K & privasi.
- Uji visual & kontras di HP dan PC (lebar 360, 768, 1024, 1440 px).
- Beta terbatas di production dengan pengguna undangan; perbaikan bug.

## 4. Definition of Ready
- User story dan acceptance criteria ada di [02](02-prd-fitur-mvp.md); aturan terkait ada di [01](01-alur-dan-aturan-sistem.md).
- Desain layar tersedia (atau dinyatakan tidak perlu).
- Dependensi eksternal (bot Telegram per lingkungan, data seed) sudah siap.

## 5. Definition of Done
- Memenuhi acceptance criteria dan lolos code review.
- Tes otomatis untuk logika domain dan otorisasi ([04](04-arsitektur-teknis.md) bagian 8) lulus di CI.
- Berfungsi di Chrome Android dan Safari iOS pada lebar 360 px **dan** di desktop ≥ 1024 px (Chrome/Edge/Firefox) sesuai tata letak [03](03-panduan-ux-ui.md) bagian 2.1; panel admin di Chrome desktop.
- Aksi admin tercatat di audit log; transisi status tercatat di `rental_events`.
- Tidak ada galat baru di Sentry staging.
- Dokumen di `/docs` diperbarui bila aturan, skema, atau API berubah.

## 6. Cara Kerja Tim
- Sprint planning, review, dan retro tiap sprint; standup singkat 3×/minggu.
- Branch per fitur → pull request dengan minimal satu reviewer → merge ke `main` (deploy staging otomatis) → tag rilis (deploy production).
- Keputusan arsitektur dicatat sebagai ADR di `docs/decisions/` (format: konteks, keputusan, konsekuensi).
- Perubahan pada aturan di dokumen 01 wajib disertai pembaruan test case.
