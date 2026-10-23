# Audit browser Sprint 4 — 23 Oktober 2026

Kode yang diperiksa: `efecd88` (implementasi Sprint 4). Acuan: [roadmap](../05-roadmap-dan-backlog.md), [aturan A-3.5–A-3.10](../01-alur-dan-aturan-sistem.md), [PRD F10/F11/F12/F23](../02-prd-fitur-mvp.md), dan [ADR 0005](../decisions/0005-transaksi-sprint-4.md).

**Hasil audit awal: alur utama berjalan sampai `SELESAI`, dengan tiga temuan di bawah. Ketiganya sudah diperbaiki setelah audit; lihat tindak lanjut di akhir laporan.** Screenshot dan langkah reproduksi di bawah merekam perilaku sebelum perbaikan. Pengujian lokal belum membuktikan kesiapan deployment atau integrasi hosted.

## Lingkungan dan cara pengujian

- Build production Next.js 16.4.2 dari kode lokal, dijalankan di `http://localhost:3100`.
- PostgreSQL 17 lokal `sewamates_e2e`, migrasi `0001`–`0008`. Fixture menolak database selain loopback dengan nama tersebut.
- Akun dummy pemilik, penyewa, super admin, dan admin kedua menggunakan sesi terpisah.
- Halaman dioperasikan melalui Playwright: klik tombol, isi formulir, unggah file, periksa respons/status, lalu inspeksi screenshot. API digunakan untuk menyiapkan transaksi dan beberapa langkah yang tidak menjadi fokus skenario. Ini bukan pengujian perangkat HP fisik.
- Storage memakai server tiruan lokal; Telegram dan Sentry dinonaktifkan. Bukti dan dana seluruhnya dummy.
- Tenggat 12/24/72 jam serta kedaluwarsa klaim disimulasikan dengan mengubah waktu pada fixture lokal, lalu memanggil endpoint job terotorisasi. Tidak menunggu waktu nyata dan tidak memasang cron hosted.

## Temuan

### S4-01 — Foto sebelum perubahan jadwal tetap memenuhi syarat pertemuan baru

Prioritas **menengah**, berkaitan dengan integritas bukti kondisi F10/A-3.5.

Langkah reproduksi:

1. Gunakan transaksi `DIBAYAR`; kedua pihak menekan **Saya sudah sampai**.
2. Penyewa mengunggah dua foto kondisi, tetapi belum mengonfirmasi kode.
3. Salah satu pihak mengusulkan jadwal lain, lalu pihak lawan menyetujui.
4. Pada waktu pertemuan baru, kedua pihak menandai hadir kembali. Dalam pengujian, jendela waktunya dipercepat melalui fixture lokal.
5. Tanpa mengunggah foto baru, penyewa menekan **Tampilkan kode** dan pemilik mengonfirmasinya.

Aktual: penanda hadir dan kode lama direset, tetapi dua ID foto sebelumnya tetap sama. `actions.canShowCode` kembali `true` setelah kedua pihak hadir; konfirmasi berhasil mengubah transaksi ke `BERJALAN` memakai foto pertemuan sebelumnya.

Dampak: kondisi barang bisa berubah di antara pertemuan, sementara syarat foto sudah dianggap terpenuhi. Rekomendasi QA: foto minimum harus berasal dari sesi pertemuan yang berlaku; foto lama tetap disimpan sebagai arsip bukti. Dokumen belum merinci invalidasi foto setelah jadwal ulang, sehingga aturan sesi foto ini perlu ditegaskan saat perbaikan.

Lokasi: [reset saat jadwal disetujui](../../src/services/reschedule-service.ts#L188) dan [penghitungan foto berdasarkan record yang sama](../../src/services/handover-service.ts#L88). [Screenshot](evidence/04/reschedule-old-photos.png).

### S4-02 — Detail pencairan tidak mengikuti klaim admin lain

Prioritas **menengah**, ketidaksesuaian tampilan kunci F23.

Langkah reproduksi:

1. Admin A dan B membuka detail tugas pencairan yang sama sebelum diklaim.
2. Admin A menekan **Klaim tugas**.
3. Biarkan halaman admin B terbuka lebih dari interval pembaruan antrean; pada pengujian ditunggu 6,5 detik.

Aktual: baris antrean B sudah menampilkan **Diklaim Admin E2E · 30 menit**, tetapi detail di bawahnya masih menampilkan **Klaim tugas**. Detail tidak mengikuti perubahan dari admin lain.

Backend tetap melindungi dana: percobaan klaim kedua ditolak HTTP `409`, kode `PAYOUT_CLAIMED`. Setelah A melepas klaim, B dapat mengambilnya. Tidak terjadi penyelesaian ganda pada skenario ini.

Harapan: detail menampilkan kunci dan sisa waktu yang konsisten dengan antrean tanpa perlu aksi gagal atau muat ulang. Saat ini antrean memakai polling, sedangkan detail hanya mengambil data ketika dibuka atau setelah aksi lokal.

Lokasi: [PayoutReview](../../src/components/admin-payouts.tsx#L227). [Screenshot ketidaksesuaian antrean dan detail](evidence/04/payout-second-admin.png).

### S4-03 — Detail sengketa tidak memperbarui bukti tambahan

Prioritas **menengah**, berkaitan dengan kelengkapan bukti yang terlihat admin.

Langkah reproduksi:

1. Penyewa membuka sengketa dengan satu file bukti; admin membuka **Lihat bukti**.
2. Pemilik menambahkan satu file melalui **Tambah bukti** dari browser lain.
3. Biarkan detail admin terbuka; pada pengujian ditunggu 6,5 detik.

Aktual: API dan halaman peserta sudah berisi dua bukti, tetapi detail admin masih menunjukkan satu. Setelah browser admin dimuat ulang dan detail dibuka lagi, kedua bukti tampil. Terulang pada sengketa yang dibuka saat `DIBAYAR`, `BERJALAN`, dan `DIKEMBALIKAN`.

Dampak: admin dapat membaca himpunan bukti yang belum lengkap. Harapan: detail memperbarui bukti secara berkala atau menyediakan tombol pembaruan yang jelas. Antrean yang melakukan polling belum memperbarui detail terpilih.

Lokasi: [DisputeReview](../../src/components/admin-disputes.tsx#L73). [Screenshot detail sebelum dimuat ulang](evidence/04/dispute-evidence-stale.png).

## Hasil pengujian

Build production berhasil. Empat pengujian E2E alur utama dari `tests/e2e-transactions/handover.spec.ts` lulus:

| Browser/viewport | Hasil |
| --- | --- |
| Chromium 360 px | Serah terima, pengembalian, masa cek, dua pencairan sampai `SELESAI` |
| WebKit 390 px | Alur yang sama pada mesin WebKit; bukan Safari iOS fisik |
| Chromium 768 px | Alur yang sama pada lebar tablet |
| Chromium 1440 px | Panel **Lanjutkan di HP**, masa cek, dan pencairan; langkah serah terima/pengembalian disiapkan melalui API |

Enam belas skenario eksplorasi tambahan dijalankan di Chromium. Baris yang menghasilkan temuan bukan dinyatakan lulus tanpa catatan:

| Skenario | Bukti hasil |
| --- | --- |
| Penyewa batal <24 jam setelah pembayaran | Dana Rp150.001 → pemilik Rp9.000, penyewa Rp140.001, komisi Rp1.000; dua tugas, tanpa strike |
| Pemilik batal setelah pembayaran | Refund penuh Rp150.001, satu tugas, satu strike pemilik |
| Jadwal ulang dua kali | Wajib persetujuan lawan; durasi tetap; tombol tidak muncul setelah dua kali; API menolak ketiga dengan `RESCHEDULE_LIMIT` |
| Laporan tidak hadir dibantah | Form bantahan mengubah status menjadi `SENGKETA`; tidak membuat pencairan |
| Pemilik tidak hadir saat mulai, tanpa bantahan | Job membatalkan, refund penuh, satu strike; pengulangan tidak menambah aksi |
| Kamera dalam app dan kode salah lima kali | Dua frame dari kamera sintetis diterima sebagai `camera`; percobaan kelima HTTP 429 `CODE_LOCKED`; kode benar ditolak selama kunci dan diterima setelah tenggat lokal dipercepat |
| Dua admin mengklaim tugas | Backend menolak klaim kedua; lepas dan alihkan klaim berhasil; tampilan detail bermasalah: S4-02 |
| Pengembalian terlambat dan masa cek habis | Terlambat 30 jam, toleransi 2 jam, harga Rp50.000/hari → denda Rp50.000; preview pemilik Rp95.000, penyewa Rp50.001; job menutup masa cek satu kali |
| Pemindahan kas dengan bukti dan biaya | Pindah Rp50.000 + biaya Rp2.500 dari dana Rp150.001 → saldo sumber Rp97.501, tujuan Rp50.000, biaya tercatat Rp2.500 |
| Foto setelah perubahan jadwal | Menghasilkan S4-01: foto lama masih bisa dipakai untuk memenuhi syarat |
| Sengketa saat serah terima | Laporan tidak sesuai, unggah bukti dua pihak, dana ditahan; menghasilkan S4-03 |
| Sengketa saat barang disewa | Laporan kerusakan dan bukti dua pihak berhasil; menghasilkan S4-03 |
| Sengketa dalam masa cek | Laporan kerusakan dan bukti dua pihak berhasil; menghasilkan S4-03 |
| Pengingat, stale-start, klaim kedaluwarsa, SLA | Pengingat sekali; stale-start refund penuh; klaim dilepas; tugas lewat target terlihat; pengulangan masing-masing menghasilkan nol aksi baru |
| Barang tidak kembali >72 jam | `overdue-returns` membuka satu sengketa `hilang`; pengulangan tidak menggandakan |
| Pemilik absen saat pengembalian | `lateUntil` sama dengan kedatangan penyewa; melewati tenggat hilang tidak langsung membuka `hilang`; 72 jam setelah laporan membuka `tidak_hadir`, satu kali |

Ketujuh endpoint job Sprint 4 diuji lokal: `stale-start`, `close-review-window`, `overdue-returns`, `no-show-timeouts`, `release-claims`, `reminders`, dan `sla-flags`. Hasil tidak menggandakan transisi/alert ketika dijalankan kembali pada keadaan yang sama. Ini memverifikasi logika job dan pencatatan alert, bukan pengiriman Telegram nyata atau pemasangan jadwal hosted.

Tidak ada `pageerror` atau HTTP 5xx pada skenario tambahan yang selesai. Tidak ditemukan overflow horizontal pada lebar yang diperiksa; screenshot utama dan temuan ditinjau secara visual. Tidak ada transfer bank/e-wallet nyata.

## Yang belum dibuktikan dalam audit ini

- Kamera, izin lokasi, dan pemindaian QR pada Chrome Android/Safari iOS fisik melalui HTTPS; kamera sintetis dan WebKit emulasi tidak menggantikannya.
- Storage/RLS dan URL privat pada Supabase hosted. Tes ini hanya memakai Storage tiruan; verifikasi identitas serta login Telegram tidak diulang.
- Pengiriman notifikasi Telegram ke peserta/grup admin dan pemulihan kegagalan kirim di staging.
- Migrasi `0008`, pemasangan total 10 cron, respons HTTP job hosted, deployment Vercel, dan Sentry staging. Keadaan hosted tidak diubah maupun diasumsikan dari hasil lokal.
- Tidak semua kombinasi pembatalan, bentrok jadwal, bukti PDF, izin ditolak, gangguan jaringan, dan role diulang lewat UI. Cakupan di atas menyebut jalur yang benar-benar dijalankan; hasil tes otomatis pada laporan implementasi bukan dianggap hasil audit baru ini.

Putusan admin atas sengketa, tanggapan F13, penangguhan otomatis tiga strike, rekonsiliasi, penarikan komisi, dan rating memang masuk Sprint 5. Ketiadaan fitur-fitur tersebut tidak dicatat sebagai kekurangan Sprint 4. Langkah lingkungan bersama tetap mengikuti [Sisa Sprint 4](04-transaksi-ii-sisa.md).

## Tindak lanjut perbaikan — 23 Oktober 2026

- **S4-01 diperbaiki:** foto menyimpan versi jadwal dari server. Setelah usulan jadwal disetujui, foto lama tetap terlihat sebagai arsip "jadwal sebelumnya", tetapi tidak dihitung untuk minimum/maksimum foto atau konfirmasi kode pada jadwal baru. Penolakan usulan tidak membatalkan foto jadwal berjalan. Pengujian server mencakup dua kali perubahan jadwal dan pengembalian setelahnya.
- **S4-02 diperbaiki:** detail pencairan memperbarui status setiap 5 detik dan saat fokus kembali. Klaim, lepas klaim, dan pengambilalihan dari browser lain mengubah detail tanpa reload. Isian nominal pencairan tetap ada saat pembaruan.
- **S4-03 diperbaiki:** detail sengketa memperbarui bukti setiap 5 detik dan saat fokus kembali. Unggahan beserta catatan pihak lain terlihat otomatis.
- Perlu menerapkan [migrasi `0009`](../../supabase/migrations/0009_handover_photo_schedule.sql) sebelum menjalankan/deploy kode baru: `npm run db:migrate`. Migrasi hanya menambah/mengisi metadata versi jadwal; arsip foto dan trigger bukti tidak dapat diubah/dihapus tetap dipertahankan. Tidak ada env, bucket, atau cron baru.
- Tes regresi permanen tersedia di [tes server](../../tests/transactions-ii.test.ts) dan [tes browser](../../tests/e2e-transactions/sprint4-regressions.spec.ts). Cakupan integrasi hosted/perangkat fisik tetap mengikuti batas audit di atas.
- Verifikasi perbaikan: lint, typecheck, dan build production lulus; suite PostgreSQL penuh lulus 187 tes, kemudian 18 tes Transaksi II dijalankan ulang setelah penambahan tes migrasi dan lulus di PostgreSQL 17 serta PGlite. **20 E2E transaksi lulus** pada Chromium 360/768/1440 px dan WebKit 390 px, termasuk tiga regresi baru dan alur sampai `SELESAI`. Langkah peserta pada tes regresi memakai viewport HP, sedangkan kedua admin memakai viewport 1440 px. Database pengujian menerapkan migrasi sampai `0009`; Supabase hosted tidak diubah.
