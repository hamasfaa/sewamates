# 03 – Panduan UX/UI

Tujuan: cepat, visual, dan ramah seperti aplikasi yang biasa dipakai mahasiswa, tetapi selalu memperlihatkan **rasa aman** (verifikasi, dana ditahan, bukti).

## 1. Prinsip Desain

1. **Mobile-first, tetap nyaman di PC**: dirancang dulu untuk lebar 360–414 px dan satu tangan, lalu diperluas untuk tablet dan desktop (bagian 2.1). Semua fitur pengguna tersedia di PC kecuali yang memang butuh HP di lokasi (kamera serah terima).
2. **Visual-first**: foto barang dominan; teks seperlunya.
3. **Kepercayaan terlihat**: badge terverifikasi, rating, "dana ditahan aman", foto kondisi, bukti transfer.
4. **Satu aksi utama per layar**: di detail transaksi selalu ada satu tombol utama untuk langkah berikutnya.
5. **Biaya transparan**: rincian biaya sama di detail barang, pengajuan, pembayaran, dan riwayat.
6. **Ramah dan santai**: nada seperti teman, tetap jelas dan sopan.

## 2. Arsitektur Informasi

**Navigasi bawah (5 tab):** Beranda · Cari · **+ Sewakan** (tombol tengah menonjol, warna `accent`) · Transaksi · Profil
**Header:** ikon chat (dengan jumlah belum dibaca) dan ikon notifikasi (lonceng).

```
Beranda      → kategori, baru ditambahkan, paling sering disewa
Cari         → kata kunci + filter (tanggal, harga, kategori, titik serah terima) + urutan
Sewakan      → wizard listing 4 langkah (atau ajakan verifikasi bila belum terverifikasi)
Transaksi    → tab Menyewa · Disewakan; filter Aktif / Selesai / Dibatalkan
Profil       → status verifikasi, rekening pencairan, listing saya, ulasan, pengaturan notifikasi,
               bantuan, keluar, hapus akun
Chat         → daftar percakapan → ruang chat
Notifikasi   → daftar notifikasi, tap membuka halaman terkait
```

### 2.1 Responsif: HP, tablet, PC

Satu aplikasi web yang sama, tata letaknya menyesuaikan lebar layar (breakpoint Tailwind):

| Lebar | Perangkat | Navigasi | Tata letak |
|-------|-----------|----------|------------|
| < 768 px | HP | Navigasi bawah 5 tab + header (chat, lonceng) | Satu kolom |
| 768–1023 px | Tablet / laptop kecil | Navigasi bawah tetap | Grid lebih lebar, konten maks 720 px di tengah |
| ≥ 1024 px | PC / laptop | **Navigasi atas**: logo · kotak pencarian · Beranda · Transaksi · Chat · lonceng · tombol "+ Sewakan" (`accent`) · avatar (menu profil) | Konten maks **1200 px** di tengah, beberapa kolom (tabel di bawah) |

Perubahan per layar di PC (≥ 1024 px):

| Layar | Di PC |
|-------|-------|
| Beranda & hasil cari | Grid 4 kolom (3 kolom di 1024–1279 px); filter pindah ke **sidebar kiri** yang selalu terlihat (bukan bottom sheet) |
| Detail barang | Dua kolom: galeri + deskripsi + ulasan di kiri; **kartu sewa menempel** (sticky) di kanan berisi harga, kalender, pilih jadwal, ringkasan biaya, tombol "Ajukan sewa" dan "Chat pemilik" |
| Ajukan sewa & pembayaran | Formulir di kiri, ringkasan biaya/tagihan menempel di kanan |
| Transaksi | Pola **daftar–detail**: daftar transaksi di kiri, detail transaksi terpilih di kanan |
| Chat | Pola **daftar–detail**: daftar percakapan di kiri, ruang chat di kanan, kartu barang/transaksi di panel kanan atas |
| Wizard listing | Langkah di sidebar kiri, formulir di tengah, pratinjau kartu barang langsung di kanan; foto bisa di-*drag & drop* |
| Profil & pengaturan | Menu di sidebar kiri, isi di kanan |
| Dialog & bottom sheet | Bottom sheet di HP menjadi **modal di tengah** atau dropdown di PC |

Pada profil dan pengaturan, menu memakai dua kolom di HP, tiga kolom pada tablet (768–1023 px), dan sidebar kiri mulai 1024 px. Konten profil tetap satu kolom di bawah menu pada HP/tablet. Kartu dan kontrol mengikuti lebar layar; judul, badge verifikasi, serta tombol ditumpuk pada layar kecil. Tombol utama dan cabut sesi memenuhi lebar kartu pada HP agar mudah disentuh.

Perilaku khusus PC:
- **Login**: tombol "Masuk dengan Telegram" membuka Telegram Desktop/Web. Di sampingnya ditampilkan **QR code** deep link bot, supaya pengguna bisa memindai dengan HP dan menyelesaikan login di Telegram HP. Sesi tetap diberikan ke browser PC (A-3.1).
- **Serah terima & pengembalian** dilakukan di lokasi, jadi butuh HP. Di PC, tombol langkah ini diganti panel "Lanjutkan di HP" dengan QR code menuju halaman transaksi yang sama. Masa cek, sengketa, rating, dan pembatalan tetap bisa dari PC.
- **Unggah foto** (listing, verifikasi, bukti transfer, bukti sengketa): pemilih file + *drag & drop*; webcam opsional untuk selfie verifikasi.
- **Hover**: kartu barang sedikit terangkat (bayangan), tombol berubah ke `primary-hover`; semua aksi tetap bisa diakses keyboard (Tab, Enter, Esc menutup modal).
- **Pintasan**: `/` memfokuskan kotak pencarian; `Enter` mengirim chat, `Shift+Enter` baris baru.
- PWA juga bisa dipasang di PC (Chrome/Edge); penyempurnaan pemasangan mengikuti Sprint 6.

## 3. Layar Pengguna

| Layar | Elemen penting |
|-------|----------------|
| Onboarding | Maks 3 slide: sewa hemat, dana aman (ditahan sampai barang kembali), dekat (COD di kampus); tombol Lewati |
| Login | Tombol "Masuk dengan Telegram" (warna `primary` + ikon Telegram; biru resmi Telegram tidak dipakai karena kontrasnya dengan teks putih di bawah standar), angka pencocokan 2 digit besar, langkah singkat "1 Buka bot → 2 Bagikan nomor (sekali saja) → 3 Pilih angka ini", status menunggu, tautan unduh Telegram |
| Banner Telegram | Muncul di atas aplikasi bila bot diblokir/belum tertaut: "Notifikasi Telegram mati. Buka bot & tekan Start" |
| Verifikasi | Stepper: jenis kartu → foto kartu → selfie dengan kartu; contoh foto benar/salah; status jelas |
| Beranda | Search bar, chip kategori, kartu barang, section horizontal |
| Hasil cari | Grid 2 kolom kartu barang, chip filter aktif, tombol filter & urutan (bottom sheet) |
| Detail barang | Galeri, harga/hari + deposit, nilai barang, durasi min/maks, kalender ketersediaan, titik serah terima, kartu pemilik, ulasan; bar bawah: ikon chat + "Ajukan sewa" |
| Ajukan sewa | Pilih tanggal & jam mulai, durasi (stepper hari), titik; ringkasan biaya & jatuh tempo; pesan opsional |
| Pembayaran | Tagihan dengan kode unik disorot ("termasuk deposit, dikembalikan"), pilihan rekening platform + tombol salin, hitung mundur, unggah bukti, jam operasional admin; daftar bukti yang sudah diunggah dengan statusnya; bila kurang bayar tampil "Kurang Rp… " sebagai nominal utama |
| Detail transaksi | Header status (chip + hitung mundur bila ada), stepper progres, tombol aksi utama, rincian biaya, jadwal & titik, foto kondisi, bukti bayar & bukti pencairan, tombol chat, menu (batalkan, jadwal ulang, laporkan masalah) |
| Serah terima / pengembalian | Mode layar penuh langkah demi langkah: "Saya sudah sampai" → kamera → kode / pemindai QR → berhasil |
| Masa cek | Rincian pencairan (termasuk denda telat), tombol "Sesuai" / "Ada masalah", hitung mundur |
| Sengketa | Pilih kategori, deskripsi, unggah bukti, tanggapan pihak lawan, status & putusan (lanjutkan / batal / bagi dana + rincian nominal) |
| Laporan tidak hadir | Pelapor: status menunggu bantahan + hitung mundur 12 jam. Terlapor: penjelasan konsekuensi + tombol "Bantah" |
| Rating | Bintang, tag cepat, komentar |
| Listing saya | Daftar dengan status (menunggu review / aktif / dijeda / ditolak + alasan), aksi ubah/jeda, kalender blok |
| Wizard listing | 1 Foto → 2 Detail → 3 Harga (perkiraan pendapatan bersih) → 4 Titik → Pratinjau |
| Rekening pencairan | Pilih bank/e-wallet, nomor, nama pemilik; saat mengubah tampil "Konfirmasi di Telegram" dan menunggu tombol di bot ditekan |
| Daftar chat | Foto barang, nama lawan bicara, cuplikan pesan, waktu, jumlah belum dibaca |
| Ruang chat | Kartu barang/transaksi di atas (tap ke detail), gelembung pesan, pesan sistem di tengah (abu), status terkirim/dibaca, kirim gambar, menu laporkan/blokir. Teks yang disamarkan tampil sebagai "•••• (disembunyikan)" dengan peringatan |

## 4. Status Transaksi di UI

Stepper progres menampilkan **6 langkah**; status internal dipetakan sebagai berikut:

| Langkah stepper | Status internal | Chip | Token warna (bagian 7.3) |
|-----------------|-----------------|------|--------------------------|
| 1 Diajukan | `DIAJUKAN` | Menunggu persetujuan | `neutral` |
| 2 Pembayaran | `DISETUJUI` | Menunggu pembayaran | `warning` |
| | `MENUNGGU_VERIFIKASI` | Menunggu verifikasi | `warning` |
| 3 Serah terima | `DIBAYAR` | Siap serah terima | `info` |
| 4 Disewa | `BERJALAN` | Sedang disewa (`danger` "Terlambat" bila lewat jatuh tempo) | `info` |
| 5 Pengembalian | `DIKEMBALIKAN` | Cek kondisi | `info` |
| 6 Selesai | `PENCAIRAN_DIPROSES` | Dana diproses (ikon jam) | `success` |
| | `SELESAI` | Selesai (ikon centang) | `success` |
| (di luar stepper) | `SENGKETA` | Dalam mediasi | `danger` |
| | `DITOLAK` / `KADALUARSA` / `DIBATALKAN` | Ditolak / Kedaluwarsa / Dibatalkan (+ "Refund diproses/selesai" bila ada dana) | `neutral` |

Chip selalu berisi **ikon + teks**; warna tidak pernah menjadi satu-satunya penanda status.

## 5. Panel Admin (desktop-first, ≥ 1280 px)

- Sidebar: Ringkasan · Verifikasi identitas · Moderasi listing · Laporan · **Pembayaran** · **Pencairan** · Sengketa · Pengguna · Kas & rekonsiliasi · Rekap & audit · Pengaturan (super admin).
- Setiap antrean berupa tabel dengan kolom umur tugas, penanda terlambat (token `danger`), dan filter. Badge jumlah di sidebar.
- Panel admin memakai token warna dan font yang sama dengan aplikasi pengguna, dengan kepadatan lebih tinggi (baris tabel 40 px, teks tabel 14 px).
- Layar keputusan dibuat **berdampingan**: bukti di kiri, data pembanding di kanan (mis. bukti transfer vs tagihan + kode unik; kartu identitas vs nama profil; foto awal vs foto akhir).
- Aksi berisiko (terima pembayaran, selesaikan pencairan, putusan sengketa, tangguhkan akun) memakai dialog konfirmasi yang menampilkan ulang nominal dan rekening.
- Tugas yang diklaim admin lain tampil terkunci dengan nama admin dan sisa waktu klaim.

## 6. Komponen Utama
- **Kartu barang**: foto 4:3, judul (maks 2 baris), harga/hari tebal, rating + jumlah ulasan, nama titik serah terima.
- **Chip status** sesuai tabel bagian 4.
- **Ringkasan biaya**: satu komponen yang sama dipakai di semua tempat.
- **Stepper transaksi** dan **timeline event**.
- **Hitung mundur**: dipakai untuk batas tanggapan, batas bayar, jatuh tempo, masa cek.
- **Pengunggah foto**: pratinjau, progres, tombol ulang bila gagal.
- **Banner kepercayaan**: "Dana kamu aman, ditahan SewaMates sampai barang kembali."
- **Empty state** dengan ajakan aksi (mis. "Belum ada barang. Sewakan barang pertamamu").
- **Skeleton loading** untuk daftar dan detail.

## 7. Gaya Visual (berangkat dari warna ITS, dibuat lebih muda)

**Arah:** biru dan kuning ITS dipakai sebagai akar warna agar terasa akrab bagi mahasiswa ITS, tetapi dibuat **lebih cerah, lebih bulat, dan lebih santai** daripada gaya web ITS yang formal. Rasa yang dituju: seperti aplikasi anak muda (e-wallet, food delivery), bukan portal akademik.

Sumber warna: *Brand Guidelines ITS* (Februari 2021, berkas revisi 2023), bagian Warna ([PDF](https://www.its.ac.id/drpm/wp-content/uploads/sites/71/2024/02/Brand-Guideline_2023.pdf)).

**Batas pemakaian:** hanya inspirasi warna. Logo/lambang ITS, wordmark, *Key Graphic* (pola gerigi/batik), font resmi ITS, dan nama "ITS" **tidak dipakai** dalam UI maupun branding, supaya aplikasi tidak terlihat sebagai aplikasi resmi kampus.

### 7.1 Dari warna ITS ke warna SewaMates

| Warna ITS (hex) | Diubah menjadi | Alasan |
|-----------------|----------------|--------|
| Biru Tua `#013880` | **Biru SewaMates** `#1F5BD8` (primary) | Lebih terang dan "elektrik" agar tidak kaku; tetap lolos kontras dengan teks putih |
| Biru Tua `#013880` / Biru Cover `#243E80` | **Navy** `#0B1F4D` (teks utama, header gelap) | Mempertahankan kedalaman biru ITS untuk teks dan elemen gelap |
| Kuning Tua `#FFBD07` | **Kuning Cerah** `#FFC72C` (accent) | Sedikit lebih hangat dan ceria |
| Biru Muda Lambang `#75BEDE` | **Langit** `#7CC8EE` | Lebih segar untuk ilustrasi dan latar dekoratif |
| Kuning Lambang `#FFF200` | Tidak dipakai | Terlalu terang, kontras buruk |
| Fire Brick `#B31E23` (warna fakultas) | Danger `#B31E23` | Merah yang sudah lolos kontras |

### 7.2 Token warna (mode terang)

| Token | Hex | Pemakaian | Kontras |
|-------|-----|-----------|---------|
| `primary` | `#1F5BD8` | Tombol utama, tab aktif, tautan, fokus | Teks putih 5,92:1 ✓ ; sebagai teks di putih 5,92:1 ✓ |
| `primary-hover` | `#1A4AB5` | Hover/pressed | Teks putih ✓ |
| `on-primary` | `#FFFFFF` | Teks/ikon di atas primary | – |
| `navy` | `#0B1F4D` | Teks utama, header, latar gelap kartu sorotan | Di atas `bg` 14,87:1 ✓ ; teks putih di atasnya 15,94:1 ✓ |
| `accent` | `#FFC72C` | Tombol tengah "+ Sewakan", sorotan kode unik, badge "Baru", bintang rating, ilustrasi | **Bukan untuk teks** di atas putih |
| `on-accent` | `#0B1F4D` | Teks/ikon di atas accent | 10,22:1 ✓ |
| `accent-soft` | `#FFF4D6` | Latar sorotan (kotak tagihan, tips) | – |
| `sky` | `#7CC8EE` | Ilustrasi, blob dekoratif, chip terpilih | Teks `navy` di atasnya 8,62:1 ✓ |
| `sky-soft` | `#EAF1FF` | Latar banner kepercayaan, kartu info | – |
| `bg` | `#F4F7FF` | Latar halaman (putih kebiruan, bukan abu) | – |
| `surface` | `#FFFFFF` | Kartu, sheet, input | – |
| `surface-2` | `#EEF1F5` | Latar sekunder, skeleton | – |
| `border` | `#DDE3F0` | Garis pemisah, border input | – |
| `text` | `#0B1F4D` | Teks utama (sama dengan `navy`) | – |
| `text-muted` | `#56627A` | Teks sekunder | Di atas `bg` 5,72:1 ✓ |

### 7.3 Token status

| Token | Teks/ikon | Latar | Kontras | Dipakai untuk |
|-------|-----------|-------|---------|---------------|
| `warning` | `#7A5200` | `#FFF4D6` | 6,32:1 ✓ | Menunggu pembayaran/verifikasi, peringatan |
| `info` | `#1A4AB5` | `#EAF1FF` | 6,88:1 ✓ | Status berjalan, informasi |
| `success` | `#1E7A4C` | `#E3F4EA` | 4,66:1 ✓ | Selesai, dana cair, pembayaran lunas |
| `danger` | `#B31E23` | `#FCE8E8` | 5,71:1 ✓ | Sengketa, terlambat, galat, aksi destruktif |
| `neutral` | `#4A5568` | `#EEF1F5` | 6,64:1 ✓ | Diajukan, ditolak, kedaluwarsa, dibatalkan |

Status `warning` memakai latar lembut + ikon, sehingga tetap berbeda dari `accent` kuning solid yang dipakai untuk sorotan brand.

### 7.4 Mode gelap (fase berikutnya; token disiapkan sejak awal)

| Token | Hex | Catatan |
|-------|-----|---------|
| `bg` | `#0A1430` | – |
| `surface` | `#13213F` | – |
| `border` | `#24345A` | – |
| `text` | `#E6EAF2` | – |
| `text-muted` | `#9AA4B8` | Di atas `surface` 6,36:1 ✓ |
| `primary` | `#7CC8EE` | Di atas `bg` 9,82:1 ✓ ; teks di atasnya `#0B1F4D` 8,62:1 ✓ |
| `accent` | `#FFC72C` | Teks di atasnya `#0B1F4D` 10,22:1 ✓ |

Token status mode gelap: latar menjadi versi transparan (mis. `rgba(255,199,44,.14)`) dengan teks versi terang; kontras diverifikasi saat implementasi.

### 7.5 Aturan pemakaian warna
- Proporsi kasar **60 / 30 / 10**: netral (latar, kartu) 60%, biru (primary, navy) 30%, kuning (accent) 10%.
- Satu tombol utama per layar memakai `primary`. Tombol tengah "+ Sewakan" memakai `accent` dengan ikon `on-accent`.
- Kuning tidak pernah dipakai sebagai warna teks di atas latar terang.
- Harga dan nominal memakai `text` agar mudah dibaca; kode unik pada tagihan disorot dengan latar `accent-soft`.
- Kartu sorotan (mis. banner "Dana kamu aman", ringkasan pendapatan pemilik) boleh memakai latar `navy` dengan aksen kuning: kombinasi paling "SewaMates".
- Foto barang tidak diberi overlay warna.

### 7.6 Tipografi
- **Plus Jakarta Sans** untuk seluruh UI (Google Fonts, karya studio lokal Tokotype). Bentuknya geometris, ramah, dan banyak dipakai aplikasi anak muda Indonesia, jauh dari kesan formal font institusi.
- Dimuat lewat `next/font` (subset latin, `display: swap`). Bobot: 400, 500, 600, 700, 800.
- Skala: 12 (keterangan) / 14 (sekunder) / 16 (body) / 20 (judul bagian) / 24 (judul halaman) / 32 (nominal besar & judul hero) px. Line-height 1,5 body, 1,2 judul.
- Judul memakai bobot 700–800 dengan `letter-spacing: -0.02em` agar terasa tegas dan modern; body 400–500.
- Nominal, kode unik, dan hitung mundur memakai `font-variant-numeric: tabular-nums`.

### 7.7 Bentuk, ikon, gerak, ilustrasi
- **Bentuk**: sudut membulat besar: kartu 16 px, input 12 px, tombol dan chip **pill** (999 px). Bayangan lembut kebiruan `0 4px 16px rgba(31,91,216,.08)`. Spasi kelipatan 4 px.
- **Ikon**: Lucide, 20/24 px, stroke 2, ujung membulat.
- **Ilustrasi**: gaya flat sederhana dengan bentuk blob `sky` + `accent` untuk onboarding dan empty state; tidak memakai foto stok.
- **Gerak**: transisi 150–250 ms; umpan balik kecil yang menyenangkan (tombol sedikit mengecil saat ditekan, centang beranimasi saat pembayaran lunas atau dana cair). Hormati `prefers-reduced-motion`.
- **Nada visual**: bersih dan ringan; tidak ramai gradien. Satu gradien boleh dipakai di header beranda (`#1F5BD8` → `#0B1F4D`).

### 7.8 Logo & ikon aplikasi
- **Logo SewaMates** belum ada dan perlu didesain di fase Desain. Sampai logo final tersedia, dipakai **wordmark sementara**: teks "SewaMates" Plus Jakarta Sans 800, warna `navy`, dengan titik/aksen kuning `accent` (mis. pada huruf "M").
- Logo tidak boleh memakai unsur lambang ITS (gerigi, bentuk lambang, Key Graphic).
- Turunan yang wajib ada sebelum rilis: ikon PWA 192 px & 512 px (termasuk versi *maskable*), favicon (32 px + SVG), `apple-touch-icon` 180 px, gambar Open Graph 1200 × 630 untuk pratinjau tautan di WhatsApp/Telegram, dan foto profil bot Telegram.
- Latar ikon aplikasi: `primary` atau `navy`, simbol putih/kuning.

### 7.9 Implementasi token
Token didefinisikan sebagai CSS variable dan dipetakan ke Tailwind, sehingga komponen tidak pernah menulis hex langsung. Bila kelak multi-kampus (F46), tema per kampus cukup mengganti nilai variabel ini.

```css
:root {
  --color-primary: #1F5BD8;   --color-primary-hover: #1A4AB5;  --color-on-primary: #FFFFFF;
  --color-navy: #0B1F4D;
  --color-accent: #FFC72C;    --color-on-accent: #0B1F4D;      --color-accent-soft: #FFF4D6;
  --color-sky: #7CC8EE;       --color-sky-soft: #EAF1FF;
  --color-bg: #F4F7FF;        --color-surface: #FFFFFF;        --color-surface-2: #EEF1F5;
  --color-border: #DDE3F0;    --color-text: #0B1F4D;           --color-text-muted: #56627A;
  --color-warning: #7A5200;   --color-warning-bg: #FFF4D6;
  --color-info: #1A4AB5;      --color-info-bg: #EAF1FF;
  --color-success: #1E7A4C;   --color-success-bg: #E3F4EA;
  --color-danger: #B31E23;    --color-danger-bg: #FCE8E8;
  --color-neutral: #4A5568;   --color-neutral-bg: #EEF1F5;
  --radius-card: 16px;        --radius-control: 12px;          --radius-pill: 999px;
  --shadow-card: 0 4px 16px rgba(31, 91, 216, 0.08);
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
}
```

Konfigurasi Tailwind (`@theme` / `theme.extend.colors`) merujuk ke variabel di atas (mis. `primary: 'var(--color-primary)'`), dan komponen shadcn/ui memakai token yang sama.

## 8. Copywriting
- Bahasa Indonesia santai-sopan: "kamu", bukan "Anda"; hindari slang berlebihan.
- Pesan galat menjelaskan solusi: "Foto KTM kurang jelas. Coba foto ulang di tempat terang."
- Hindari jargon: tidak memakai kata "escrow"; gunakan "Dana ditahan aman di SewaMates sampai barang kembali".
- Tombol berupa kata kerja: "Ajukan sewa", "Unggah bukti", "Konfirmasi serah terima".
- Nominal selalu dengan format `Rp160.347` (titik pemisah ribuan); waktu dalam WIB, mis. "Sen, 12 Okt · 14.00".

## 9. Aksesibilitas & Kinerja
- Target sentuh ≥ 44 px; fokus keyboard terlihat; semua input berlabel; teks minimal 14 px (12 px hanya untuk keterangan sekunder).
- Alt text foto listing dari judul listing.
- Gambar WebP, lazy load, ukuran thumbnail terpisah; uji dengan throttling "Fast 4G" di Chrome DevTools.

## 10. Notifikasi
Daftar kejadian dan kanal ada di [02](02-prd-fitur-mvp.md) fitur F15. Di UI: lonceng dengan jumlah belum dibaca; tap notifikasi membuka halaman terkait.
