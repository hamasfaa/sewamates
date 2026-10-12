# 03 – Panduan UX/UI

Tujuan: cepat, visual, dan ramah seperti aplikasi yang biasa dipakai mahasiswa, tetapi selalu memperlihatkan **rasa aman** (verifikasi, dana ditahan, bukti).

## 1. Prinsip Desain

1. **Mobile-first**: dirancang untuk lebar 360–414 px dan dipakai dengan satu tangan.
2. **Visual-first**: foto barang dominan; teks seperlunya.
3. **Kepercayaan terlihat**: badge terverifikasi, rating, "dana ditahan aman", foto kondisi, bukti transfer.
4. **Satu aksi utama per layar**: di detail transaksi selalu ada satu tombol utama untuk langkah berikutnya.
5. **Biaya transparan**: rincian biaya sama di detail barang, pengajuan, pembayaran, dan riwayat.
6. **Ramah dan santai**: nada seperti teman, tetap jelas dan sopan.

## 2. Arsitektur Informasi

**Navigasi bawah (5 tab):** Beranda · Cari · **+ Sewakan** (tombol tengah menonjol) · Transaksi · Profil
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

## 3. Layar Pengguna

| Layar | Elemen penting |
|-------|----------------|
| Onboarding | Maks 3 slide: sewa hemat, dana aman (ditahan sampai barang kembali), dekat (COD di kampus); tombol Lewati |
| Login | Tombol "Masuk dengan Telegram" (warna biru Telegram), angka pencocokan 2 digit besar, langkah singkat "1 Buka bot → 2 Bagikan nomor (sekali saja) → 3 Pilih angka ini", status menunggu, tautan unduh Telegram |
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

| Langkah stepper | Status internal | Chip | Warna |
|-----------------|-----------------|------|-------|
| 1 Diajukan | `DIAJUKAN` | Menunggu persetujuan | Abu |
| 2 Pembayaran | `DISETUJUI` | Menunggu pembayaran | Kuning |
| | `MENUNGGU_VERIFIKASI` | Menunggu verifikasi | Kuning |
| 3 Serah terima | `DIBAYAR` | Siap serah terima | Biru |
| 4 Disewa | `BERJALAN` | Sedang disewa (merah "Terlambat" bila lewat jatuh tempo) | Biru |
| 5 Pengembalian | `DIKEMBALIKAN` | Cek kondisi | Biru |
| 6 Selesai | `PENCAIRAN_DIPROSES` | Dana diproses | Hijau muda |
| | `SELESAI` | Selesai | Hijau |
| (di luar stepper) | `SENGKETA` | Dalam mediasi | Merah |
| | `DITOLAK` / `KADALUARSA` / `DIBATALKAN` | Ditolak / Kedaluwarsa / Dibatalkan (+ "Refund diproses/selesai" bila ada dana) | Abu gelap |

## 5. Panel Admin (desktop-first, ≥ 1280 px)

- Sidebar: Ringkasan · Verifikasi identitas · Moderasi listing · Laporan · **Pembayaran** · **Pencairan** · Sengketa · Pengguna · Kas & rekonsiliasi · Rekap & audit · Pengaturan (super admin).
- Setiap antrean berupa tabel dengan kolom umur tugas, penanda terlambat (merah), dan filter. Badge jumlah di sidebar.
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

## 7. Gaya Visual
- **Warna**: satu warna utama (teal) untuk aksi utama, netral untuk latar dan teks, warna semantik (hijau/kuning/merah/biru) hanya untuk status. Semua didefinisikan sebagai token (`--color-primary`, dst.) agar mode gelap bisa ditambahkan nanti. Kontras teks ≥ 4.5:1.
- **Tipografi**: Plus Jakarta Sans; skala 12 / 14 / 16 (body) / 20 / 24 px.
- **Bentuk**: radius 12 px (kartu), 999 px (chip); bayangan lembut; spasi kelipatan 4 px.
- **Ikon**: satu set (Lucide), ukuran 20/24 px.
- **Gerak**: transisi 150–250 ms; tidak ada animasi dekoratif yang memperlambat aksi.

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
Daftar kejadian dan kanal ada di [02](02-prd-fitur-mvp.md) fitur F15. Di UI: lonceng dengan jumlah belum dibaca; tap notifikasi membuka halaman terkait; pengaturan untuk mematikan push chat.
