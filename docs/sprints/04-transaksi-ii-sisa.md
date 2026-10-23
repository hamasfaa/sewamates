# Sprint 4 — Sisa pekerjaan dan langkah yang belum dijalankan

Per 23 Oktober 2026. Implementasi dan hasil tes lokal ada di [Sprint 4 — Transaksi II](04-transaksi-ii.md). Semua pemeriksaan lokal sudah lulus: lint, typecheck, build, 186 tes PostgreSQL, 8 skenario E2E transaksi, dan 28 tes regresi. Daftar berikut berisi hal yang **belum** dikerjakan atau dijalankan.

## 1. Pembaruan dokumen kecil

- [x] `docs/05-roadmap-dan-backlog.md`: status Sprint 4 dengan tautan ke [laporan Sprint 4](04-transaksi-ii.md) dan [ADR 0005](../decisions/0005-transaksi-sprint-4.md).
- [x] `docs/README.md`: paragraf Sprint 4 pada bagian "Pelaksanaan sprint".
- [x] `README.md`: "Lingkup saat ini" menjadi Sprint 4, dengan migrasi sampai `0008` dan 10 job.
- [x] `docs/02-prd-fitur-mvp.md` (F15): catatan kanal Sprint 4 dan Sprint 5.

## 2. Langkah lingkungan bersama

- [x] Commit kode Sprint 4 (`efecd88`). Pembaruan dokumen bagian 1 belum di-commit.
- [x] Database Supabase yang dipakai `sewamates-ashy.vercel.app` sudah menerapkan migrasi sampai `0010`. `0009` memisahkan foto setiap jadwal; `0010` memperluas event Telegram. Untuk database lingkungan lain, jalankan `npm run db:migrate` setelah memastikan targetnya benar.
- [ ] Jalankan ulang [supabase/jobs.sql](../../supabase/jobs.sql). Periksa ada 10 job `sewamates-*` di `cron.job` dan setiap job mendapat HTTP 200 di `net._http_response`.
- [ ] Deploy perubahan handler notifikasi terbaru setelah migrasi: pemberitahuan kondisi pertama "Sesuai" dan serah terima selesai ke kedua peserta. Hasil pengujian dan aktivasi database ada di [perbaikan Telegram](04-notifikasi-telegram.md).

## 3. Pengujian manual

- [ ] Kamera dalam app, izin lokasi, dan cadangan galeri di Chrome Android dan Safari iOS fisik melalui HTTPS.
- [ ] Pemindaian QR kode serah terima: tombol "Pindai QR" di Chrome Android, dan kamera bawaan iOS yang membuka halaman dengan kode terisi.
- [ ] Panel "Lanjutkan di HP" di PC ≥ 1024 px: QR membuka transaksi yang sama di HP.
- [ ] Matriks Telegram Sprint 4: pengingat, jadwal ulang, laporan tidak hadir, terlambat, pencairan selesai, sengketa dibuka, dan strike. Grup admin menerima tugas pencairan, sengketa baru, dan antrean lewat target.
- [ ] Job hosted dengan data uji: `stale-start`, `close-review-window`, `overdue-returns`, `no-show-timeouts`, `release-claims`, `reminders`, `sla-flags`. Jalankan dua kali untuk memastikan tidak ada aksi atau pesan ganda.
- [ ] Pencairan dengan rekening uji: klaim, transfer, biaya, bukti, lalu cocokkan saldo kas di `/admin/kas` dengan mutasi.
- [ ] Sentry staging tidak menunjukkan galat baru.

## 4. Diserahkan ke Sprint 5

- Putusan sengketa (F24): lanjutkan, batal, dan bagi dana. Putusan "lanjutkan" wajib memeriksa ulang ketersediaan karena `SENGKETA` tidak menahan tanggal (A-3.3).
- Tanggapan sengketa (F13), penangguhan otomatis 3 strike, penarikan komisi, rekonsiliasi, tugas penyesuaian super admin, rating, dan web push.
