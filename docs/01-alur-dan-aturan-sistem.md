# 01 – Alur & Aturan Sistem

Dokumen ini adalah **sumber kebenaran** untuk logika transaksi. Dokumen lain merujuk ke sini; jika ada perbedaan, dokumen ini yang berlaku.

Konvensi:
- Semua angka bertanda `⚙` disimpan di tabel `settings` dan dapat diubah super admin tanpa rilis ulang. Nilai yang tertulis adalah default.
- Semua nominal uang disimpan sebagai **integer rupiah** (`BIGINT`), tanpa desimal.
- Semua waktu disimpan dalam UTC (`timestamptz`); aturan jam operasional dan tampilan memakai zona **Asia/Jakarta (WIB)**.

## 1. Alur Utama (9 tahap)

```
[1 Registrasi & verifikasi] → [2 Listing barang] → [3 Cari & ajukan sewa]
                                                          ↓
[6 Masa sewa berjalan] ← [5 Serah terima COD] ← [4 Pembayaran (escrow manual)]
        ↓
[7 Pengembalian & cek kondisi] → [8 Pencairan dana] → [9 Rating & review]
        ↓ (jika bermasalah)
[X Sengketa: rusak / hilang / telat / tidak sesuai → deposit + mediasi admin]
```

Catatan: pada diagram asli, kotak "Pengembalian & cek kondisi" muncul dua kali; kotak kedua diperlakukan sebagai **Pencairan dana**.

| # | Tahap | Aktor | Ringkasan | Bukti tersimpan |
|---|-------|-------|-----------|-----------------|
| 1 | Registrasi & verifikasi | Pengguna, admin | Login via Telegram bot, unggah KTM/KTP + selfie, isi rekening pencairan, admin memverifikasi | Dokumen identitas, keputusan admin |
| 2 | Listing barang | Pemilik, admin | Foto, deskripsi, nilai barang, harga/hari, deposit, titik serah terima; admin moderasi | Listing + riwayat moderasi |
| 3 | Cari & ajukan sewa | Penyewa, pemilik | Pilih barang, jadwal mulai, durasi, titik; pemilik terima/tolak | `rental_events` |
| 4 | Pembayaran | Penyewa, admin | Transfer ke rekening platform + unggah bukti; admin cocokkan dengan mutasi | Bukti transfer, `payments` |
| 5 | Serah terima | Pemilik, penyewa | Bertemu di titik kampus, foto kondisi awal, tukar kode | `handover_records` (start) |
| 6 | Masa sewa | Penyewa | Barang dipakai; pengingat jatuh tempo | `rental_events` |
| 7 | Pengembalian & cek | Pemilik, penyewa | Foto kondisi akhir, tukar kode, masa cek 24 jam | `handover_records` (end) |
| 8 | Pencairan dana | Admin | Transfer manual ke pemilik (sewa − komisi) dan refund deposit ke penyewa; unggah bukti | `payout_tasks` + bukti |
| 9 | Rating & review | Kedua pihak | Saling menilai | `reviews` |
| X | Sengketa | Admin | Putusan pembagian dana yang ditahan | `disputes` + bukti |

## 2. State Machine Transaksi (`rentals.status`)

### 2.1 Daftar status

| Status | Arti | Label UI |
|--------|------|----------|
| `DIAJUKAN` | Penyewa mengajukan, menunggu pemilik | Menunggu persetujuan |
| `DISETUJUI` | Pemilik setuju, tanggal di-hold, menunggu penyewa transfer + unggah bukti | Menunggu pembayaran |
| `MENUNGGU_VERIFIKASI` | Bukti diunggah, menunggu admin | Menunggu verifikasi |
| `DIBAYAR` | Dana diterima & ditahan platform, menunggu serah terima | Siap serah terima |
| `BERJALAN` | Barang sudah di tangan penyewa | Sedang disewa |
| `DIKEMBALIKAN` | Barang kembali ke pemilik, masa cek berjalan | Cek kondisi |
| `SENGKETA` | Ada masalah, menunggu putusan admin | Dalam mediasi |
| `PENCAIRAN_DIPROSES` | Tugas pencairan/refund menunggu admin | Dana diproses |
| `SELESAI` | Semua tugas pencairan berbukti | Selesai |
| `DITOLAK` | Pemilik menolak (final) | Ditolak |
| `KADALUARSA` | Tidak ditanggapi / tidak dibayar tepat waktu (final) | Kedaluwarsa |
| `DIBATALKAN` | Dibatalkan salah satu pihak atau putusan sengketa (final; refund diproses lewat `payout_tasks` bila ada dana) | Dibatalkan |

### 2.2 Tabel transisi

| Dari | Ke | Pemicu | Aktor | Syarat / efek samping |
|------|----|--------|-------|----------------------|
| – | `DIAJUKAN` | Ajukan sewa | Penyewa | Lihat aturan 3.3; tidak bentrok dengan hold/sewa lain |
| `DIAJUKAN` | `DISETUJUI` | Terima | Pemilik | Tidak bentrok; membuat **hold** tanggal; menetapkan kode unik & batas bayar |
| `DIAJUKAN` | `DITOLAK` | Tolak | Pemilik | Alasan opsional |
| `DIAJUKAN` | `KADALUARSA` | Batas tanggapan lewat | Sistem | – |
| `DIAJUKAN` | `DIBATALKAN` | Batalkan | Penyewa | Tanpa biaya |
| `DISETUJUI` | `MENUNGGU_VERIFIKASI` | Unggah bukti | Penyewa | Sebelum batas bayar |
| `DISETUJUI` | `KADALUARSA` | Batas bayar lewat tanpa bukti | Sistem | Hold dilepas |
| `DISETUJUI` | `DIBATALKAN` | Batalkan | Penyewa / pemilik | Tanpa biaya; pemilik yang membatalkan tidak kena strike |
| `MENUNGGU_VERIFIKASI` | `DIBAYAR` | Semua bukti diproses, total diterima ≥ tagihan | Admin | Jurnal ledger per bukti yang diterima |
| `MENUNGGU_VERIFIKASI` | `DISETUJUI` | Semua bukti diproses, total diterima < tagihan | Admin | Bukti diterima sebagian / ditolak (alasan wajib); batas bayar = maks(batas lama, sekarang + 2 jam ⚙); UI menampilkan sisa kekurangan |
| `MENUNGGU_VERIFIKASI` | `DIBATALKAN` | Belum `DIBAYAR` 24 jam ⚙ setelah jadwal mulai | Sistem | Dana yang sudah diterima direfund penuh (A-3.4) |
| `DIBAYAR` | `BERJALAN` | Serah terima selesai | Pemilik + penyewa | Foto awal + kode cocok (A-3.5) |
| `DIBAYAR` | `DIBATALKAN` | Batal; laporan tidak hadir tanpa bantahan; atau 24 jam ⚙ setelah jadwal mulai tanpa serah terima & tanpa laporan | Penyewa / pemilik / sistem | Pembagian dana sesuai A-3.6 |
| `DIBAYAR` | `SENGKETA` | Barang tidak sesuai saat serah terima; bantahan laporan tidak hadir | Penyewa / pihak yang dilaporkan | Kategori `tidak_sesuai` / `tidak_hadir` |
| `BERJALAN` | `DIKEMBALIKAN` | Pengembalian selesai | Pemilik + penyewa | Foto akhir + kode cocok; denda telat dihitung otomatis (A-3.7) |
| `BERJALAN` | `SENGKETA` | Lapor masalah; bantahan laporan tidak hadir saat pengembalian; telat > 72 jam ⚙ | Penyewa, pemilik, sistem | Telat > 72 jam otomatis kategori `hilang` |
| `DIKEMBALIKAN` | `PENCAIRAN_DIPROSES` | Kedua pihak klik "Sesuai" **atau** masa cek 24 jam ⚙ habis | Pemilik, penyewa, sistem | Membuat `payout_tasks` |
| `DIKEMBALIKAN` | `SENGKETA` | "Ada masalah" dalam masa cek | Pemilik / penyewa | Dana tetap ditahan |
| `SENGKETA` | `PENCAIRAN_DIPROSES` | Putusan: bagi dana | Admin | Membuat `payout_tasks` sesuai putusan |
| `SENGKETA` | `DIBATALKAN` | Putusan: batal | Admin | Hanya untuk sengketa yang dibuka dari `DIBAYAR` |
| `SENGKETA` | `DIBAYAR` / `BERJALAN` | Putusan: lanjutkan transaksi | Admin | Kembali ke status sebelum sengketa (`status_before_dispute`); dari `DIBAYAR` wajib jadwal mulai baru |
| `PENCAIRAN_DIPROSES` | `SELESAI` | Semua tugas berbukti | Sistem | – |

Catatan:
- Selama `MENUNGGU_VERIFIKASI`, transaksi **tidak bisa dibatalkan** (menunggu admin maks 2 jam dalam jam operasional) agar tidak ada dana yang statusnya belum jelas.
- Setiap transaksi yang berakhir di `KADALUARSA` atau `DIBATALKAN` sementara ada dana diterima otomatis mendapat tugas refund ke penyewa sesuai A-3.6. Bukti bayar yang baru diverifikasi setelah transaksi final juga otomatis menjadi tugas refund.
- Semua transisi lewat satu fungsi layanan (`RentalService.transition`) dan dicatat di `rental_events` (dari, ke, aktor, waktu, metadata). Transisi lain selain tabel di atas **ditolak** server.

## 3. Aturan yang Ditegakkan Sistem

### 3.1 Akun & verifikasi
- **Login lewat Telegram bot** (tanpa password, tanpa SMS). Akun Telegram wajib; satu akun Telegram tertaut ke satu akun SewaMates.
  1. Web membuat permintaan login (token acak, berlaku 10 menit ⚙, terikat ke browser lewat cookie) dan menampilkan **angka pencocokan 2 digit**, lalu membuka `t.me/<bot>?start=<token>`.
  2. Pertama kali: bot meminta pengguna **membagikan nomor HP** lewat tombol kontak Telegram. Sistem hanya menerima kontak milik pengirimnya sendiri (`contact.user_id == from.id`), sehingga nomor HP terverifikasi tanpa OTP. Nomor menjadi identitas akun.
  3. Bot menampilkan 3 angka; pengguna menekan angka yang sama dengan di web (mencegah login lewat tautan yang dikirim orang lain).
  4. Browser yang memulai login menerima sesi (cookie httpOnly, 30 hari).
  - Maks 5 permintaan login per 15 menit per browser/IP ⚙.
  - Ganti akun Telegram: login dengan akun Telegram baru yang membagikan nomor HP yang sama → tautan dipindah, akun Telegram lama diberi tahu.
- **Aksi sensitif** (ubah rekening pencairan, hapus akun) wajib dikonfirmasi lewat tombol di Telegram bot (berlaku 10 menit ⚙).
- Jika pengguna memblokir bot, notifikasi Telegram berhenti dan aplikasi menampilkan banner untuk membuka bot dan menekan Start lagi.
- Pengguna yang belum terverifikasi hanya bisa melihat-lihat. Mengajukan sewa, membuat listing, dan memulai chat butuh status `terverifikasi`.
- Verifikasi: foto KTM **atau** KTP + selfie memegang kartu tersebut. Nama di kartu harus sama dengan nama profil. Admin memutuskan `terverifikasi` / `ditolak` (alasan wajib). Pengguna yang ditolak boleh mengajukan ulang.
- **Rekening pencairan wajib** diisi sebelum mengajukan sewa atau menerbitkan listing (dibutuhkan untuk refund dan pencairan).
- Status akun: `aktif`, `ditangguhkan`, `dihapus`. Akun ditangguhkan tidak bisa membuat pengajuan/listing baru dan listingnya disembunyikan dari pencarian. Saat ditangguhkan, pengajuan `DIAJUKAN` yang melibatkannya otomatis `DITOLAK` (bila ia pemilik) atau `DIBATALKAN` (bila ia penyewa); transaksi yang sudah `DISETUJUI` ke atas tetap diselesaikan.
- Admin adalah pengguna biasa (login lewat Telegram) yang role-nya dinaikkan oleh super admin. Sesi dengan role admin berlaku 12 jam ⚙.

### 3.2 Listing
- Wajib: 3–8 foto (JPEG/PNG/WebP, maks 5 MB per foto sebelum kompresi), judul, kategori, deskripsi kondisi, **nilai barang perkiraan**, harga per hari, deposit, durasi min/maks (hari), minimal satu titik serah terima.
- Deposit: **10%–50% dari nilai barang** ⚙, dengan batas atas absolut **Rp1.000.000** ⚙. Rumus rentang yang sah: `min(10% × nilai, 1.000.000) ≤ deposit ≤ min(50% × nilai, 1.000.000)`, dibulatkan ke Rp1.000. Deposit tidak boleh nol agar denda dan kerusakan bisa dipotong. (Contoh: nilai Rp20.000.000 → deposit wajib tepat Rp1.000.000.)
- Status listing: `menunggu_review` → `aktif` / `ditolak` (alasan) ; `aktif` ↔ `dijeda` ; `diarsipkan`. Listing yang diubah pada judul, foto, atau kategori kembali ke `menunggu_review` (tersembunyi dari pencarian, transaksi yang sudah ada tidak terpengaruh); perubahan harga/deposit/nilai langsung berlaku tanpa review, tetapi tidak memengaruhi transaksi yang sudah dibuat (harga di-snapshot).
- Rating barang = rata-rata rating yang diberikan penyewa kepada pemilik pada transaksi barang tersebut (A-3.12).
- Listing tidak dapat diarsipkan selama ada transaksi berstatus non-final.
- Kategori dikelola super admin; kategori terlarang tidak tersedia di pilihan. Pengguna dapat melaporkan listing.

### 3.3 Pengajuan sewa & ketersediaan
- Penyewa memilih **jadwal mulai** (tanggal + jam, dalam jam operasional titik serah terima), **durasi dalam hari** (antara min dan maks listing), dan titik serah terima.
- **Jatuh tempo** = jadwal mulai + durasi × 24 jam. Jam pengembalian sama dengan jam mulai.
- Pengajuan minimal **12 jam** ⚙ sebelum jadwal mulai, maksimal **60 hari** ⚙ ke depan.
- Ketersediaan: rentang `[mulai, jatuh tempo + jeda 3 jam ⚙)` tidak boleh tumpang tindih dengan rentang transaksi lain berstatus `DISETUJUI`, `MENUNGGU_VERIFIKASI`, `DIBAYAR`, `BERJALAN`, atau dengan blok kalender pemilik. Ditegakkan dengan exclusion constraint di database.
- Beberapa pengajuan `DIAJUKAN` boleh tumpang tindih. Saat pemilik menyetujui satu, tombol setuju pada pengajuan lain yang bentrok dinonaktifkan; bila hold dilepas (kedaluwarsa/batal), pengajuan tersebut bisa disetujui lagi selama belum kedaluwarsa.
- Penyewa tidak bisa menyewa barang miliknya sendiri.
- **Batas akun baru**: penyewa dengan < 3 ⚙ transaksi `SELESAI` tanpa putusan sengketa yang merugikannya hanya bisa menyewa barang bernilai ≤ Rp500.000 ⚙.
- Batas tanggapan pemilik: **min(24 jam ⚙ sejak diajukan, jadwal mulai − 6 jam ⚙)**.

### 3.4 Pembayaran (manual, tanpa pihak ketiga)
- Saat disetujui, sistem menetapkan:
  - **Tagihan** = total sewa + deposit + **kode unik** (1–999, unik di antara transaksi `DISETUJUI`/`MENUNGGU_VERIFIKASI` yang aktif; bila 999 kode habis terpakai, persetujuan baru ditunda dengan pesan galat). Kode unik **dihitung sebagai bagian deposit** dan ikut dikembalikan.
  - **Batas bayar** = **min(6 jam ⚙ sejak disetujui, jadwal mulai − 3 jam ⚙)**.
- Penyewa memilih satu rekening tujuan dari `platform_accounts` aktif (mis. Mandiri, BCA, OVO), transfer, lalu mengunggah bukti + rekening tujuan + nominal + nama pengirim + waktu transfer. Bukti boleh diunggah lebih dari sekali (mis. transfer kurang lalu menambah).
- Penyewa diminta menulis **kode transaksi** (`public_code`, mis. `SM-2610-00123`) di berita/catatan transfer bila metode mendukung; admin mencocokkan dengan kode unik **dan** kode transaksi, karena kode unik bisa dipakai ulang setelah transaksi selesai.
- Bukti diunggah sebelum batas bayar → transaksi tidak kedaluwarsa selama menunggu admin.
- Admin mencocokkan **setiap bukti** dengan **mutasi rekening asli** (bukan hanya screenshot):
  - Dana ditemukan → bukti **diterima** dengan nominal yang benar-benar masuk (boleh berbeda dari yang ditulis penyewa). Setiap bukti diterima langsung dicatat di ledger.
  - Dana tidak ditemukan → bukti **ditolak** dengan alasan.
  - Setelah semua bukti diproses: total diterima ≥ tagihan → `DIBAYAR` (kelebihan bayar ditambahkan ke refund deposit); kurang → kembali `DISETUJUI` dengan sisa kekurangan, penyewa mentransfer kekurangannya dan mengunggah bukti tambahan.
- Jam operasional admin: **08.00–21.00 WIB setiap hari** ⚙. Target verifikasi: **≤ 2 jam** dalam jam operasional; bukti yang masuk di luar jam operasional diverifikasi paling lambat **10.00** berikutnya.
- Jika transaksi belum `DIBAYAR` saat jadwal mulai tiba, serah terima tidak bisa dilakukan; sistem menawarkan jadwal ulang (A-3.5). Jika 24 jam ⚙ setelah jadwal mulai masih belum `DIBAYAR`, transaksi `DIBATALKAN` dan dana yang sudah diterima direfund penuh.

### 3.5 Serah terima & pengembalian
- **Serah terima (mulai)**:
  1. Masing-masing pihak menekan "Saya sudah sampai" (mencatat waktu dan, jika diizinkan, lokasi).
  2. Penyewa memotret kondisi barang (min 2 foto) dan pemilik mengonfirmasi foto tersebut.
  3. Penyewa menunjukkan **kode 6 digit / QR**; pemilik memasukkan/memindai. Kode cocok → `BERJALAN`.
  4. Jika barang tidak sesuai listing, penyewa memilih "Barang tidak sesuai" → `SENGKETA`.
- **Pengembalian**:
  1. Pemilik memotret kondisi akhir (min 2 foto).
  2. Pemilik menunjukkan kode; penyewa memasukkan/memindai. Kode cocok → `DIKEMBALIKAN`.
  3. **Masa cek 24 jam** ⚙: kedua pihak dapat memilih "Sesuai" atau "Ada masalah". Diam sampai masa cek habis dianggap "Sesuai". Setelah masa cek, pengembalian final dan tidak bisa disengketakan.
- **Pengembalian lebih awal** boleh kapan saja (atur waktu lewat chat); biaya sewa tidak dikembalikan.
- **Jadwal ulang serah terima**: hanya pada status `DISETUJUI`, `MENUNGGU_VERIFIKASI`, atau `DIBAYAR`. Salah satu pihak mengusulkan jadwal mulai baru; berlaku setelah pihak lain menyetujui. Jatuh tempo ikut bergeser (durasi tetap). Maksimal 2 kali ⚙ per transaksi, tidak boleh membuat bentrok, dan tetap mematuhi jam operasional titik. Menggeser jatuh tempo saat `BERJALAN` = perpanjangan sewa (di luar MVP).
- **Tidak hadir**: jika satu pihak sudah "Saya sudah sampai" dan pihak lain belum hadir 30 menit ⚙ setelah jadwal, pihak yang hadir boleh melapor "Pihak lain tidak datang". Pihak yang dilaporkan mendapat notifikasi dan boleh membantah dalam **12 jam** ⚙ (→ `SENGKETA`). Tanpa bantahan, konsekuensi diterapkan:
  - Pemilik tidak datang (serah terima) → `DIBATALKAN`, refund penuh ke penyewa, strike pemilik.
  - Penyewa tidak datang (serah terima) → pembatalan mendadak oleh penyewa (A-3.6) + strike penyewa.
  - Penyewa tidak datang (pengembalian) → dihitung sebagai keterlambatan (A-3.7).
  - Pemilik tidak datang (pengembalian) → denda telat berhenti dihitung sejak waktu penyewa menekan "Saya sudah sampai", dan sengketa otomatis "hilang" (A-3.7) **tidak berlaku**; kedua pihak diminta menjadwalkan ulang pengembalian lewat chat. Bila 72 jam ⚙ setelah laporan barang belum juga kembali → `SENGKETA` kategori `tidak_hadir`.
- **Tidak ada yang hadir**: 24 jam ⚙ setelah jadwal mulai tanpa serah terima dan tanpa laporan tidak hadir → `DIBATALKAN`, refund penuh ke penyewa, tanpa strike.

### 3.6 Pembagian dana saat transaksi batal
"Dana diterima" = total nominal bukti bayar yang diterima admin (termasuk kode unik dan kelebihan bayar).

| Kondisi | Ke penyewa | Ke pemilik | Komisi | Strike |
|---------|-----------|-----------|--------|--------|
| `KADALUARSA` / batal sebelum `DIBAYAR` dengan dana diterima sebagian | Seluruh dana diterima | – | – | – |
| Belum `DIBAYAR` 24 jam setelah jadwal mulai | Seluruh dana diterima | – | – | – |
| Penyewa batal ≥ 24 jam ⚙ sebelum jadwal mulai | Seluruh dana diterima | – | – | – |
| Penyewa batal < 24 jam sebelum jadwal mulai / penyewa tidak datang | Dana diterima − biaya batal | Biaya batal − komisi | 10% dari biaya batal | Penyewa (hanya jika tidak datang) |
| Pemilik batal setelah `DIBAYAR` / pemilik tidak datang | Seluruh dana diterima | – | – | Pemilik |
| Tidak ada yang hadir 24 jam setelah jadwal mulai | Seluruh dana diterima | – | – | – |
| Putusan sengketa: batal | Sesuai putusan | Sesuai putusan | Tidak ada | Sesuai putusan |

Biaya batal = 20% ⚙ dari total sewa. Contoh (sewa Rp60.000, dana diterima Rp160.347): biaya batal Rp12.000 → pemilik Rp10.800, komisi Rp1.200, penyewa Rp148.347.

### 3.7 Keterlambatan & barang hilang
- Toleransi **2 jam** ⚙ setelah jatuh tempo.
- Setelah toleransi, denda = **50% ⚙ harga per hari untuk setiap 24 jam yang dimulai**: `ceil((waktu_kembali − jatuh_tempo − toleransi) / 24 jam) × 50% × harga_per_hari` bila hasil pengurangan > 0, selain itu 0.
- `waktu_kembali` = waktu kode pengembalian cocok, atau waktu penyewa menekan "Saya sudah sampai" bila pemilik dilaporkan tidak hadir saat pengembalian (A-3.5).
- Dihitung otomatis saat transaksi menjadi `DIKEMBALIKAN` dan dipotong dari deposit (tidak termasuk kode unik). Denda yang melebihi deposit dibatasi sebesar deposit; sisanya di luar sistem.
- Penyewa yang terlambat melewati toleransi mendapat strike.
- Belum dikembalikan **72 jam** ⚙ setelah jatuh tempo → otomatis `SENGKETA` kategori `hilang`; admin dan kedua pihak diberi notifikasi. Pengecualian: ada laporan "pemilik tidak datang" saat pengembalian yang diterima (A-3.5).

### 3.8 Keuangan
- **Komisi platform 10%** ⚙ dari total sewa (bukan deposit), dipotong dari bagian pemilik. Pembulatan: komisi dibulatkan ke rupiah terdekat (setengah ke atas).
- Tidak ada biaya layanan untuk penyewa di MVP.
- **Contoh**: Rp20.000/hari × 3 hari = Rp60.000; deposit Rp100.000; kode unik 347. Tagihan Rp160.347. Normal: pemilik menerima Rp54.000, penyewa menerima refund Rp100.347, komisi Rp6.000. Jika telat 30 jam (toleransi 2 jam, sisa 28 jam = 2 periode): denda 2 × Rp10.000 = Rp20.000 → pemilik Rp74.000, refund penyewa Rp80.347. Denda tidak dikenakan komisi.
- Rumus pencairan **tanpa sengketa**:
  - Ke pemilik = total sewa − komisi + denda telat.
  - Ke penyewa = deposit + kode unik + kelebihan bayar − denda telat.
- Rumus pencairan **dengan putusan sengketa "bagi dana"**: komisi tetap 10% dari total sewa dan dipotong lebih dulu; admin membagi **sisa dana ditahan** (dana diterima − komisi) menjadi bagian pemilik dan bagian penyewa. Perhitungan denda telat otomatis menjadi saran di layar putusan, bukan nilai final.
- Invarian: ke pemilik + ke penyewa + komisi = dana diterima. Diperiksa sistem sebelum tugas pencairan dibuat.
- Tugas pencairan bernominal 0 tidak dibuat.
- **Biaya transfer** antarbank/e-wallet saat pencairan ditanggung platform ⚙ (dicatat sebagai biaya, tidak mengurangi hak penerima).

### 3.9 Pencairan manual
- Saat masuk `PENCAIRAN_DIPROSES` (atau `DIBATALKAN`/`KADALUARSA` dengan dana diterima), sistem membuat **`payout_tasks`** per penerima berisi nominal dan **snapshot rekening tujuan**.
- Admin **mengklaim** tugas (terkunci 30 menit ⚙ untuk admin tersebut), mentransfer, lalu mengisi **rekening platform sumber**, nominal, biaya transfer, waktu, dan mengunggah **bukti transfer**. Tugas yang sudah selesai tidak bisa diubah; koreksi dilakukan dengan tugas penyesuaian baru oleh super admin.
- Target: tugas yang dibuat sebelum 18.00 selesai hari itu sebelum 21.00; setelah 18.00 selesai hari berikutnya sebelum 12.00 ⚙. Lewat target → ditandai terlambat dan admin diberi notifikasi.
- Penerima mendapat notifikasi dan dapat melihat bukti di detail transaksi.
- **Semua admin boleh memegang dana** (memverifikasi pembayaran dan mentransfer). Kontrol: klaim tugas, pencatatan `verified_by`/`transferred_by`, audit log, dan bukti yang tidak bisa dihapus.
- **Pergerakan kas lain** dicatat lewat panel admin dengan bukti: pemindahan dana antar rekening platform (mis. OVO → BCA agar bisa mencairkan) dan penarikan komisi oleh pemilik platform (super admin). Penarikan komisi tidak boleh melebihi saldo komisi.
- **Rekonsiliasi harian**: admin memasukkan saldo aktual setiap rekening platform; sistem membandingkan dengan saldo kas rekening tersebut menurut ledger dan menampilkan selisih. Selisih ≠ 0 wajib diberi catatan.

### 3.10 Sengketa
- Kategori: `rusak`, `hilang`, `telat`, `tidak_sesuai`, `tidak_hadir`, `lainnya`.
- Dibuka dari status `DIBAYAR`, `BERJALAN`, atau `DIKEMBALIKAN` (dalam masa cek), lewat bantahan laporan tidak hadir, atau otomatis oleh sistem (telat > 72 jam). Hanya boleh ada **satu sengketa terbuka** per transaksi; transaksi yang dilanjutkan boleh bersengketa lagi kemudian.
- Bukti: foto awal & akhir, chat, `rental_events`, unggahan tambahan kedua pihak (maks 10 file per pihak ⚙). Pihak lawan diberi 24 jam ⚙ untuk menanggapi.
- Admin memutuskan dalam **72 jam** ⚙ sejak dibuka, dengan alasan tertulis. Jenis putusan:
  | Putusan | Berlaku untuk sengketa dari | Hasil |
  |---------|-----------------------------|-------|
  | Lanjutkan | `DIBAYAR`, `BERJALAN` | Kembali ke status sebelumnya (mis. tuduhan tidak hadir tidak terbukti → jadwal ulang; barang hilang ternyata dikembalikan → alur pengembalian normal) |
  | Batal | `DIBAYAR` | `DIBATALKAN`; pembagian dana ditentukan admin, tanpa komisi |
  | Bagi dana | `BERJALAN`, `DIKEMBALIKAN` | `PENCAIRAN_DIPROSES`; pembagian sesuai A-3.8 |
- Total pembagian divalidasi sistem (invarian A-3.8). Kerugian di atas deposit dicatat sebagai catatan kasus, tidak diproses sistem.
- Putusan bisa menambahkan strike ke pihak yang bersalah.

### 3.11 Strike & penangguhan
- Strike diberikan untuk: pemilik batal setelah dibayar, tidak hadir, terlambat mengembalikan melewati toleransi, putusan sengketa yang menyatakan bersalah, laporan yang terbukti.
- **3 strike ⚙ dalam 90 hari ⚙** → akun otomatis `ditangguhkan` dan masuk antrean admin untuk ditinjau.

### 3.12 Rating
- Dapat diberikan setelah status `PENCAIRAN_DIPROSES` atau `SELESAI`, paling lambat 7 hari ⚙ setelahnya.
- Skor 1–5, komentar opsional (maks 500 karakter), tag cepat.
- Rating tersembunyi sampai kedua pihak mengisi atau 7 hari berlalu. Rating tidak bisa diubah setelah terlihat.
- Rating penyewa → pemilik dihitung ke rating pemilik **dan** rating barang; rating pemilik → penyewa dihitung ke rating penyewa. Rata-rata disimpan terdenormalisasi dan diperbarui saat rating terlihat.
- Transaksi yang `DIBATALKAN`/`KADALUARSA`/`DITOLAK` tidak bisa diberi rating.

## 4. Di Luar Lingkup MVP
- Pembayaran otomatis lewat payment gateway (disiapkan lewat antarmuka `PaymentProvider`).
- Pengiriman kurir; transaksi di luar titik kampus.
- Perpanjangan sewa saat `BERJALAN` (P1).
- Multi-kampus (skema sudah menyiapkan `campus_id`).
