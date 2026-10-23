# Sprint 4 — Transaksi II

Tanggal pengerjaan: 23 Oktober 2026. Dimulai setelah pemilik aplikasi menyatakan Sprint 3 selesai.

**Status: implementasi lokal lulus pemeriksaan otomatis. Uji bersama di Vercel mencapai `PENCAIRAN_DIPROSES`; migrasi sampai `0010` terpasang pada database hosted dan pesan uji kedatangan Telegram diterima. Perubahan handler notifikasi terbaru masih perlu deployment; pemasangan seluruh job dan uji perangkat fisik tetap perlu diverifikasi.** Keputusan implementasi ada di [ADR 0005](../decisions/0005-transaksi-sprint-4.md). Daftar langkah lingkungan ada di [Sisa Sprint 4](04-transaksi-ii-sisa.md).

Perbaikan setelah [audit browser](04-transaksi-ii-manual.md): migrasi `0009` memisahkan foto berdasarkan versi jadwal, dan detail pencairan/sengketa admin diperbarui otomatis setiap 5 detik. Terapkan migrasi sampai `0009` sebelum menjalankan kode terbaru. Foto lama tetap disimpan sebagai arsip.

Perbaikan kanal Telegram: migrasi `0010` menambahkan event kedatangan, serah terima selesai, pengembalian, konfirmasi kondisi, masa cek hampir habis, pencairan dijadwalkan, dan bukti sengketa tambahan ke outbox. Rincian ada di [perbaikan notifikasi Telegram](04-notifikasi-telegram.md). Terapkan migrasi sampai `0010` untuk kode terbaru.

## Implementasi

| Backlog | Hasil |
| --- | --- |
| Migrasi | `0008`: `handover_records`, `handover_photos`, `reschedule_requests`, `no_show_reports`, `disputes`, `dispute_evidence`, `strikes`, `cash_movements`, `sent_alerts`; kolom serah terima/masa cek/denda/sengketa/penyelesaian pada `rentals`; klaim dan bukti pada `payout_tasks`; `payments.settled_at`; referensi tugas/pemindahan kas pada `ledger_entries`; trigger bukti tidak dapat diubah; RLS server-only |
| `payout.ts` | Pembagian normal (A-3.8), biaya batal (A-3.6), refund penuh, invarian pemilik + penyewa + komisi = dana diterima, denda telat dengan batas deposit, konsekuensi pembatalan, target pencairan 18.00/21.00/12.00 |
| F10 serah terima & pengembalian | Langkah "Saya sudah sampai" (waktu + lokasi bila diizinkan) → foto kondisi min. 2 (kamera dalam app, cadangan galeri bertanda "dari galeri", waktu server) → kode 6 digit/QR → `BERJALAN`/`DIKEMBALIKAN`. Kode disimpan sebagai hash; salah 5 kali dikunci 15 menit. PC ≥ 1024 px melihat panel **Lanjutkan di HP** dengan QR ke halaman yang sama |
| Masa cek | Rincian pencairan dan denda telat otomatis, tombol "Sesuai"/"Ada masalah", hitung mundur 24 jam; kedua pihak "Sesuai" atau masa cek habis → `PENCAIRAN_DIPROSES` |
| F11 pembatalan | Konsekuensi A-3.6 ditampilkan sebelum konfirmasi; server menolak bila biaya yang dilihat berbeda. Penyewa < 24 jam membayar biaya batal 20% sewa (pemilik menerima biaya − komisi); pemilik yang membatalkan setelah dibayar mendapat strike. Tidak tersedia saat `MENUNGGU_VERIFIKASI`, setelah `BERJALAN`, atau selama laporan tidak hadir berjalan |
| F11 jadwal ulang | Usulan pada `DISETUJUI`/`MENUNGGU_VERIFIKASI`/`DIBAYAR`, berlaku setelah pihak lain setuju; maksimal 2 kali, cek jam titik dan bentrok saat diusulkan dan saat disetujui; jatuh tempo, hold, dan batas bayar ikut bergeser |
| F11 tidak hadir | Laporan 30 menit setelah jadwal oleh pihak yang sudah sampai; terlapor punya 12 jam untuk membantah (→ `SENGKETA` `tidak_hadir`). Tanpa bantahan: pemilik absen saat mulai → batal + refund penuh + strike; penyewa absen saat mulai → biaya batal + strike; penyewa absen saat kembali → dihitung telat; pemilik absen saat kembali → denda berhenti pada kedatangan penyewa + strike |
| Sengketa (pembukaan) | Semua pemicu A-3.10: barang tidak sesuai saat serah terima, lapor masalah saat disewa, ada masalah dalam masa cek, bantahan tidak hadir, sistem (telat > 72 jam `hilang`, atau 72 jam setelah laporan pemilik tidak hadir `tidak_hadir`). Satu sengketa terbuka per transaksi, bukti maks. 10 file per pihak, dana tetap ditahan. Admin melihat bukti, foto awal–akhir, chat (diaudit), dan riwayat di `/admin/sengketa` |
| Strike | Diberikan untuk pemilik batal setelah dibayar, tidak hadir, dan telat melewati toleransi; satu per pengguna/transaksi/alasan, notifikasi Telegram |
| Pencairan | Penyelesaian membuat tugas per penerima dengan snapshot rekening untuk semua jalur (normal, batal, kedaluwarsa, tidak hadir). F23 di `/admin/pencairan`: klaim 30 menit (terkunci untuk admin lain dengan nama dan sisa waktu), rekening tujuan lengkap, form rekening sumber/nominal/biaya/waktu/bukti, konfirmasi ulang; transaksi menjadi `SELESAI` setelah bukti terakhir |
| Kas | `/admin/kas`: saldo ledger per rekening platform, posisi dana ditahan/hutang/komisi/biaya transfer, pemindahan antar rekening dengan bukti dan biaya |
| F12 | Stepper 6 langkah, chip status termasuk "Terlambat", timeline `rental_events` dengan aktor, foto kondisi awal/akhir, bukti bayar, rincian penyelesaian, serta bukti transfer pencairan/refund untuk penerimanya |
| Job | `stale-start`, `close-review-window`, `overdue-returns`, `no-show-timeouts`, `release-claims`, `reminders`, `sla-flags` |

Notifikasi Telegram tersedia untuk pengingat, kedatangan pihak lain, serah terima selesai, pengembalian, konfirmasi kondisi pertama, masa cek hampir habis, jadwal ulang, laporan tidak hadir, terlambat, pencairan dijadwalkan/selesai, sengketa dibuka/bukti ditambah, dan strike. Kedatangan serta konfirmasi kondisi dikirim ke pihak lawan; serah terima selesai dan pengembalian dikirim ke kedua peserta; pencairan dikirim ke penerimanya. Tugas pencairan baru, sengketa baru, dan antrean lewat target dikirim hanya ke grup admin. Pesan chat biasa tetap in-app.

## API baru

```
POST /api/rentals/:id/arrive                    { location? }
POST /api/rentals/:id/handover/photos           { path, source: camera|gallery }
POST /api/rentals/:id/handover/code             (kode baru untuk pihak yang menunjukkan)
POST /api/rentals/:id/handover/confirm          { code, photosConfirmed? }
POST /api/rentals/:id/check                     { decision: sesuai } | { decision: masalah, category, description, evidencePaths }
POST /api/rentals/:id/cancel                    { version, reason?, fee }   (fee wajib saat DIBAYAR)
POST /api/rentals/:id/reschedule                { version, startAt }
POST /api/rentals/:id/reschedule/:reqId/respond { version, decision }
POST /api/rentals/:id/no-show                   POST /api/rentals/:id/no-show/:reportId/dispute { description, evidencePaths }
POST /api/rentals/:id/disputes                  { category, description, evidencePaths }
POST /api/disputes/:id/evidence                 { paths, note? }
GET  /api/admin/payout-tasks?state=open|done&sla=&q=     GET /api/admin/payout-tasks/:id
POST /api/admin/payout-tasks/:id/claim | release | complete
GET  /api/admin/cash                            POST /api/admin/cash-movements
GET  /api/admin/disputes                        GET /api/admin/disputes/:id
POST /api/internal/jobs/<tujuh job Sprint 4>
```

`GET /api/rentals/:id` kini menyertakan `handover`, `reschedules`, `noShows`, `dispute`, `payouts`, `cancellation`, `preview`, dan `actions`. Tujuan unggah baru: `handover_photo` (gambar), `dispute_evidence`, `payout_proof`, `cash_proof` (gambar atau PDF); dua yang terakhir hanya untuk admin.

## Penyiapan dev/staging

1. Pastikan target database benar, lalu jalankan `npm run db:migrate` untuk menerapkan migrasi sampai `0010`. Migrasi `0008` menandai bukti yang sudah punya tugas refund Sprint 3 sebagai sudah diselesaikan agar tidak direfund dua kali; `0009` menambah metadata versi jadwal foto tanpa menghapus arsip; `0010` memperluas event Telegram tanpa memutar ulang notifikasi lama. Tidak ada env atau bucket baru; bukti baru memakai `evidence-private`.
2. Jalankan ulang [supabase/jobs.sql](../../supabase/jobs.sql) di SQL Editor. File memasang **10 job** setiap menit (3 job lama + 7 job Sprint 4) dengan nama tetap, memakai secret Vault yang sama.
3. Deploy kode setelah migrasi. Kamera dalam app memerlukan HTTPS (atau `localhost`); `Permissions-Policy` sudah mengizinkan `camera` dan `geolocation` untuk origin aplikasi. Browser tanpa izin kamera tetap bisa memakai galeri.
4. Siapkan minimal dua rekening platform bila ingin menguji pemindahan kas, dan satu admin yang bukan peserta transaksi untuk mengklaim pencairan.

## Pemeriksaan otomatis (23 Oktober 2026)

- `npm run lint` dan `npm run typecheck` lulus. Build production Next.js 16.4.2 berhasil, termasuk `/admin/pencairan`, `/admin/kas`, dan `/admin/sengketa`.
- Vitest PGlite: **184 lulus, 2 dilewati** (khusus PostgreSQL nyata). PostgreSQL 17 lokal (`sewamates_test`): **186 lulus**. Tes baru: 11 tes domain (contoh angka A-3.6 dan A-3.8, batas denda, pembulatan, target pencairan, kunci kode) dan 16 tes integrasi (alur lengkap sampai `SELESAI` dengan ledger seimbang, kode/foto/kunci, denda + strike, masa cek, sengketa dan bukti, tabel pembatalan, tidak hadir di kedua tahap, sengketa otomatis, jadwal ulang, `stale-start` dan refund bukti terlambat, otorisasi, klaim bersamaan, pemindahan kas, pengingat dan SLA sekali kirim).
- Playwright transaksi: **8 skenario lulus** di Chromium 360/768/1440 px dan WebKit 390 px. Skenario baru menjalankan serah terima lewat galeri, kode salah lalu benar, pengembalian, masa cek, serta dua pencairan berbukti oleh admin sampai `SELESAI`; di 1440 px memastikan panel "Lanjutkan di HP" dan melanjutkan langkah lokasi lewat API. Tidak ada overflow horizontal atau `pageerror`. Regresi Sprint 1–2: **28 tes lulus**.
- Semua pemeriksaan memakai PostgreSQL loopback dan tiruan Storage. Tidak ada migrasi hosted, pengiriman Telegram nyata, deployment, atau commit.

## Batas dan sprint berikutnya

- Putusan admin (lanjutkan/batal/bagi dana, F24), tanggapan sengketa (F13), penangguhan otomatis 3 strike, penarikan komisi, rekonsiliasi, tugas penyesuaian super admin, rating, dan web push mengikuti Sprint 5. Sengketa tetap terbuka sampai fitur putusan tersedia.
- Sesuai A-3.3, `SENGKETA` tidak menahan tanggal. Putusan "lanjutkan" pada Sprint 5 perlu memeriksa ulang ketersediaan.
- Pemindai QR dalam app memakai `BarcodeDetector` bila browser mendukung; di iOS QR dibuka dengan kamera bawaan dan kode terisi dari fragmen URL. Kode selalu bisa diketik.
- Saldo kas per rekening ditampilkan, tetapi pencairan tidak diblokir bila saldo ledger kurang karena biaya transfer ditanggung platform dan setoran modal belum dicatat sistem.
- Kamera, lokasi, dan QR perlu diuji di Chrome Android dan Safari iOS fisik melalui HTTPS staging. Matriks Telegram Sprint 4 dan job hosted belum diuji.
