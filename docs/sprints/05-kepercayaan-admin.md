# Sprint 5 — Kepercayaan & admin

## Lingkup implementasi

| Fitur | Perilaku yang tersedia |
|---|---|
| F13/F24 | Tanggapan sengketa dan bukti dalam 24 jam snapshot; putusan lanjutkan/batal/bagi dana, alasan wajib, strike opsional, kunci transaksi, audit, dan notifikasi |
| F14 | Ulasan dua pihak, skor/tag/komentar, publikasi bersama atau setelah 7 hari snapshot; agregat pemilik/penyewa/barang; laporan ulasan |
| F16/F21/F26 | Laporan pengguna/listing/pesan/ulasan, abaikan/sembunyikan/strike/tangguhkan; cari pengguna berdasarkan nama/HP/kode transaksi; riwayat, aktivasi ulang, role dan pencabutan sesi |
| F25/F28 | Rekonsiliasi aktual vs ledger per rekening/tanggal WIB, catatan selisih, penarikan komisi oleh SA, tugas penyesuaian, rekap dan CSV, filter audit |
| F15 | Notifikasi kejadian penting tersimpan in-app dan dikirim melalui webhook Telegram setelah commit; tugas admin dikirim ke grup |
| F17 | Permintaan/penolakan/konfirmasi hapus akun via Telegram, cek kewajiban ulang, anonimisasi, pencabutan sesi, purge identitas setelah 30 hari |

Keputusan detail ada di [ADR 0006](../decisions/0006-kepercayaan-admin-sprint-5.md). `reports`, `user_blocks`, serta kolom rating barang sudah ada dari sprint sebelumnya; migration memperluas tabel yang tersedia.

## Aktivasi lingkungan bersama

Kode dan pengujian lokal tidak otomatis menerapkan migrasi, mengubah cron Supabase, atau melakukan deploy Vercel.

1. Tinjau migration `0011_sprint_5_trust_admin.sql` dan `0012_remove_web_push.sql`, lalu pada database aplikasi yang dituju jalankan `npm run db:migrate`. Migration lama tetap utuh; `0012` membersihkan data dan skema kanal browser. Tidak perlu mengulang transaksi lama. Seed tidak wajib karena nilai pengaturan Sprint 5 sudah tersedia di default Sprint 1.
2. Deploy kode. Callback `/api/internal/notifications/deliver` memakai `INTERNAL_JOB_SECRET` dan secret Vault `sewamates_notification_url` / `sewamates_notification_secret` yang sama dengan Sprint 3/4. Tidak ada env tambahan untuk notifikasi browser.
3. Jalankan kembali `supabase/jobs.sql` di SQL Editor. Nama job tetap idempoten. Total **13 job**: 10 sebelumnya + `reveal-reviews`, `auto-suspend`, `purge-identity`, masing-masing setiap menit. Strike kedaluwarsa diabaikan tanpa menghapus riwayat. Pengiriman Telegram tidak memakai cron.
4. Jalankan [UAT Sprint 5](05-kepercayaan-admin-e2e.md) dengan akun dan transaksi uji. Pengiriman Telegram, cron dan Storage nyata diverifikasi pada lingkungan HTTPS.

Menu baru: **Admin → Laporan / Pengguna / Rekonsiliasi / Rekap** dan **Profil → Privasi akun**. Form putusan ada setelah membuka detail di **Admin → Sengketa**. Pengaturan ambang strike, masa penilaian, dan SLA sengketa ada di **Admin → Pengaturan**.

## API tambahan

Semua endpoint privat memerlukan sesi dan pemeriksaan pemilik/role. Mutasi memeriksa Origin dan menerima Idempotency-Key melalui infrastruktur aplikasi.

| Rute | Kegunaan |
|---|---|
| `POST /api/disputes/:id/respond` | `{body, paths?:[]}`; pihak lawan, maksimal satu tanggapan per pihak |
| `POST /api/admin/disputes/:id/decision` | `{version,outcome,reason,ownerAmount?,renterAmount?,newStartAt?,strikeUserId?}` |
| `GET/POST /api/rentals/:id/reviews` | Ringkasan ulasan yang boleh dilihat / `{score,tags,comment}` |
| `GET /api/users/:id/reviews`, `/api/items/:id/reviews` | Ulasan publik yang tidak disembunyikan |
| `POST /api/reports` | `{targetType,targetId,reason,note?}`; body pesan lama `{messageId,reason}` tetap diterima |
| `GET /api/admin/reports`, `POST /:id/action` | Antrean / `{action,reason}` |
| `GET /api/admin/users?q=`, `GET /:id` | Pencarian dan riwayat pengguna |
| `POST /api/admin/users/:id/suspend`, `/reactivate`, `/strike` | `{reason}` |
| `PUT /api/admin/users/:id/role` | `{role,reason}`; hanya SA, semua sesi target dicabut |
| `GET /api/me/blocks`, `POST/DELETE /api/users/:id/block` | Daftar blokir dan buka/tutup blokir |
| `GET/POST /api/admin/reconciliations` | `{date,platformAccountId,actualBalance,note?}` |
| `POST /api/admin/commission-withdrawals` | SA: `{fromAccountId,amount,proofPath,note}` |
| `POST /api/admin/payout-tasks/adjustments` | SA: `{originalTaskId,amount,reason}`; penerima/rekening mengikuti tugas asli |
| `GET /api/admin/recap?format=csv` | Rekap JSON atau unduhan CSV |
| `POST /api/me/delete-account` | Membuat konfirmasi Telegram, tidak langsung menghapus |

`lanjutkan` dari `DIBAYAR` wajib mengirim `newStartAt` dalam ISO UTC dan tidak membagi dana. `batal` hanya dari `DIBAYAR`, komisi nol. `bagi_dana` hanya dari `BERJALAN`/`DIKEMBALIKAN`; bagian pemilik + penyewa harus sama dengan dana diterima dikurangi komisi snapshot. UI tanggal admin memakai WIB.

Penyesuaian tidak mengubah bukti atau tugas selesai. Tugas baru mengurangi komisi tersedia saat dibuat, kemudian memakai alur klaim/transfer/bukti biasa oleh admin bukan peserta. Koreksi yang memerlukan pengembalian uang dari penerima ditangani operasional, bukan nominal payout negatif.

## Verifikasi

Tes memakai PostgreSQL 17 loopback pada database khusus `sewamates_test` / `sewamates_e2e`; Storage dan pesan eksternal dimock. `tests/trust-admin.test.ts` mencakup tanggapan, keputusan sendiri, dana tidak seimbang, komisi, jadwal konflik, foto lama, visibilitas ulasan, moderasi, penangguhan konkuren, perubahan role, konfirmasi hapus dan retensi. `tests/e2e-transactions/sprint5.spec.ts` memeriksa formulir dan hasil antar sesi browser pengguna/admin.

Perintah:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
# Setelah DATABASE E2E lokal terpisah dan build .next-e2e disiapkan:
npm run test:e2e:transactions
```

Hasil pemeriksaan awal Sprint 5 (sebelum penyederhanaan kanal notifikasi), 23 Oktober 2026:

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint`, `npm run typecheck` | Lulus tanpa warning lint |
| Suite PostgreSQL 17 | 217 tes / 13 file lulus; 19 tes Sprint 5 juga dijalankan ulang setelah pemeriksaan terakhir |
| Sprint 5 PGlite | 19 tes lulus |
| Build produksi Next.js | Lulus, termasuk halaman admin baru dan privasi |
| Browser transaksi Sprint 3–5 | 36 skenario berbeda telah lulus di Chromium 360/768/1440 dan WebKit 390, termasuk pengujian ulang yang dijelaskan di bawah |
| Lockfile npm 11.21.1 | `ci --dry-run --ignore-scripts --no-audit --no-fund` lulus |

Batch browser awal berisi 32 skenario: 30 lulus dan dua WebKit gagal. Pencarian admin di tes menunggu data awal sebelum mengetik; input/tombol pencarian juga dinonaktifkan sampai siap. Satu galat fetch pada regresi pembayaran WebKit tidak terulang pada pengujian terpisah. Kedua skenario lulus saat diulang bersama tes privasi WebKit (3/3), kemudian pencarian dan privasi lulus pada keempat proyek (8/8). Empat variasi privasi baru melengkapi total 36 skenario berbeda; angka ini merupakan gabungan hasil pemeriksaan, bukan satu batch 36/36. Galat fetch WebKit tersebut tetap perlu dipantau di CI.

Lockfile disinkronkan dengan npm 11.21.1 mengikuti panduan repo untuk metadata dependency WASM lintas platform. Bukti lokal belum menyatakan Telegram fisik, bank/e-wallet, cron hosted, atau deployment telah diuji. Aktivasi mengikuti bagian di atas dan [UAT manual](05-kepercayaan-admin-e2e.md).

## Penyederhanaan notifikasi

Atas arahan pemilik aplikasi, kanal notifikasi dibatasi menjadi in-app dan Telegram. UI privasi mengelola blokir dan hapus akun. Migration `0012` membersihkan skema dan antrean kanal browser, dengan mempertahankan event Telegram dan notifikasi in-app. Hasil pemeriksaan setelah perubahan ini dicatat terpisah di bawah.

| Pemeriksaan setelah penghapusan | Hasil |
|---|---|
| `npm run lint`, `npm run typecheck` | Lulus tanpa warning lint |
| Suite PostgreSQL 17 | 221 tes / 13 file lulus |
| Regresi migrasi dan kepercayaan di PGlite | 42 tes / 2 file lulus |
| Build produksi Next.js | Lulus |
| Browser halaman privasi | 4/4 lulus di Chromium 360/768/1440 dan WebKit 390 |
| Lockfile npm 11.21.1 | `ci --dry-run --ignore-scripts --no-audit --no-fund` lulus setelah dependensi dihapus |

Tes migrasi merekonstruksi skema lama, menerapkan `0012`, lalu memastikan tabel dan antrean kanal browser hilang sementara notifikasi in-app dan pengiriman Telegram tetap tersedia. Tes browser memastikan API yang dihapus mengembalikan 404, metadata manifest tidak ada, serta alamat aset lama menampilkan HTML halaman tidak ditemukan. Pemeriksaan awal status aset disesuaikan karena respons not-found Next.js yang sudah streaming dapat berstatus 200; empat skenario lulus setelah memeriksa isi respons dan jenis kontennya.

Pemeriksaan ini memakai database lokal terpisah dan layanan eksternal tiruan. Migration `0012` belum diterapkan pada database hosted melalui pengujian ini.
