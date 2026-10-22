# 02 – PRD & Fitur MVP

**Lingkup MVP:** alur transaksi sewa end-to-end (registrasi → listing → sewa → bayar manual → serah terima → pengembalian → pencairan manual → rating), plus panel admin. Sesuai permintaan pemilik aplikasi pada 21 Oktober 2026, pilihan banyak kampus Indonesia di registrasi/profil masuk Sprint 1; listing dan titik serah terima per kampus mengikuti Sprint 2. Lihat [ADR 0002](decisions/0002-pilihan-multi-kampus.md).

**Prioritas:** P0 = wajib MVP, P1 = setelah MVP stabil, P2 = nanti.
Semua aturan dan angka merujuk ke [01 – Alur & Aturan Sistem](01-alur-dan-aturan-sistem.md) (disingkat "A-x.y").

## 1. Daftar Fitur

### Aplikasi pengguna
| ID | Fitur | Prioritas | Aturan |
|----|-------|-----------|--------|
| F1 | Login & registrasi lewat Telegram bot | P0 | A-3.1 |
| F2 | Verifikasi identitas (KTM/KTP + selfie) | P0 | A-3.1 |
| F3 | Profil & rekening pencairan | P0 | A-3.1 |
| F4 | Buat/ubah listing + kalender blok | P0 | A-3.2 |
| F5 | Beranda, pencarian, filter | P0 | – |
| F6 | Detail barang | P0 | – |
| F7 | Ajukan sewa & persetujuan pemilik | P0 | A-3.3 |
| F8 | Pembayaran manual (transfer + unggah bukti) | P0 | A-3.4 |
| F9 | Chat | P0 | – |
| F10 | Serah terima & pengembalian | P0 | A-3.5, A-3.7 |
| F11 | Pembatalan, jadwal ulang, laporan tidak hadir | P0 | A-3.5, A-3.6 |
| F12 | Pelacak & riwayat transaksi (termasuk bukti pencairan) | P0 | A-2 |
| F13 | Sengketa | P0 | A-3.10 |
| F14 | Rating & review | P0 | A-3.12 |
| F15 | Notifikasi (in-app + Telegram bot + web push) | P0 | – |
| F16 | Laporan konten/pengguna | P0 | – |
| F17 | Hapus akun | P0 | – |
| F18 | Telegram bot (login, notifikasi, konfirmasi aksi, perintah dasar) | P0 | A-3.1 |

### Panel admin
| ID | Fitur | Prioritas | Aturan |
|----|-------|-----------|--------|
| F20 | Antrean verifikasi identitas | P0 | A-3.1 |
| F21 | Antrean moderasi listing & laporan | P0 | A-3.2 |
| F22 | Antrean verifikasi pembayaran | P0 | A-3.4 |
| F23 | Antrean pencairan/refund (klaim + unggah bukti) | P0 | A-3.9 |
| F24 | Antrean sengketa & putusan | P0 | A-3.10 |
| F25 | Rekonsiliasi harian | P0 | A-3.9 |
| F26 | Manajemen pengguna (cari, tangguhkan, strike) | P0 | A-3.11 |
| F27 | Pengaturan (super admin): settings, rekening platform, kategori, titik serah terima, akun admin | P0 | – |
| F28 | Rekap transaksi & audit log | P0 | – |

### Setelah MVP
| ID | Fitur | Prioritas |
|----|-------|-----------|
| F40 | Wishlist/simpan barang | P1 |
| F41 | Bagikan listing ke WhatsApp/IG | P1 |
| F42 | Perpanjangan sewa saat berjalan | P1 |
| F43 | Payment gateway (menggantikan verifikasi & pencairan manual) | P1 |
| F44 | Permintaan barang ("dicari: lensa 50mm") | P2 |
| F45 | Promo/voucher | P2 |
| F46 | Operasional multi-kampus lanjutan dan tema per kampus; referensi/pilihan profil sudah masuk Sprint 1 | P2 |
| F47 | Aplikasi native (Capacitor/Flutter) | P2 |

## 2. User Story & Acceptance Criteria

### F1 Login & registrasi
**Sebagai** mahasiswa, **saya ingin** masuk tanpa password **agar** cepat dan langsung terhubung ke notifikasi.
- Halaman login: satu tombol "Masuk dengan Telegram" + angka pencocokan 2 digit + keterangan "Belum punya Telegram? Unduh di sini". Di PC juga tampil QR code deep link agar login bisa diselesaikan dari Telegram di HP.
- Tombol membuka Telegram (aplikasi di HP, atau Telegram Web di desktop) ke bot SewaMates dengan token login (alur A-3.1).
- Pertama kali: bot meminta "Bagikan nomor HP" (tombol kontak); setelah itu pengguna memilih angka pencocokan.
- Web memantau status login (polling 2 detik) dan langsung masuk setelah disetujui; tampil pesan bila token kedaluwarsa dengan tombol "Coba lagi".
- Pengguna baru diminta nama lengkap dan persetujuan S&K + kebijakan privasi (checkbox wajib).
- Sesi disimpan di cookie httpOnly, berlaku 30 hari; logout menghapus sesi di server. Daftar sesi aktif dapat dilihat dan dicabut di profil.

### F18 Telegram bot
- Dibuat lewat BotFather (mis. `@SewaMatesBot`); nama, foto, dan deskripsi bot sesuai brand.
- Perintah: `/start` (login & tautkan akun), `/transaksi` (daftar transaksi aktif + tautan ke aplikasi), `/bantuan`.
- Setiap notifikasi berisi ringkasan + tombol "Buka di SewaMates" yang mengarah ke halaman terkait. Bot **tidak** dipakai untuk chat antar pengguna dan tidak menerima aksi transaksi (semua aksi tetap di aplikasi), kecuali konfirmasi aksi sensitif (A-3.1).
- Pesan bebas yang dikirim pengguna ke bot dibalas dengan arahan `/bantuan`.
- Admin juga menerima notifikasi antrean di **grup Telegram admin** (tugas baru, tugas lewat target).

### F2 Verifikasi identitas
**Sebagai** pengguna, **saya ingin** diverifikasi **agar** bisa menyewa dan menyewakan.
- Stepper: pilih jenis kartu (KTM/KTP) → foto kartu → selfie memegang kartu → kirim.
- Foto diambil lewat kamera atau galeri; dikompres di klien (sisi terpanjang 1600 px).
- Status tampil di profil: `belum`, `menunggu`, `terverifikasi`, `ditolak (alasan)`. Jika ditolak, tombol "Ajukan ulang".
- Selama belum terverifikasi, tombol Ajukan Sewa, Sewakan, dan Chat menampilkan ajakan verifikasi.
- File identitas hanya dapat diakses admin (signed URL berumur 5 menit).

### F3 Profil & rekening pencairan
- Profil publik: foto, nama, badge terverifikasi, rating rata-rata + jumlah ulasan, jumlah transaksi selesai, tanggal bergabung. Nomor HP **tidak pernah** tampil ke pengguna lain.
- Rekening pencairan: pilih bank/e-wallet dari daftar (Mandiri, BCA, BRI, BNI, OVO, GoPay, DANA, ShopeePay, dll), nomor, nama pemilik rekening.
- Mengubah rekening membutuhkan konfirmasi lewat tombol di Telegram bot. Perubahan tidak memengaruhi tugas pencairan yang sudah dibuat (memakai snapshot).

### F4 Listing
**Sebagai** pemilik, **saya ingin** memasang barang dengan cepat.
- Wizard 4 langkah: (1) foto, (2) detail (judul, kategori, deskripsi kondisi, nilai barang), (3) harga (harga/hari, deposit, durasi min/maks), (4) titik serah terima → pratinjau → kirim.
- Validasi sesuai A-3.2 (jumlah foto, rentang deposit dari nilai barang, dll); pesan kesalahan di samping field.
- Menampilkan perkiraan pendapatan bersih: harga/hari × durasi min − komisi.
- Setelah dikirim: status `menunggu_review`; pemilik diberi notifikasi saat disetujui/ditolak.
- Pemilik dapat menjeda/mengaktifkan, mengarsipkan (jika tidak ada transaksi aktif), dan memblokir tanggal di kalender.

### F5 Beranda & pencarian
- Beranda: chip kategori, "Baru ditambahkan", "Paling sering disewa" (berdasarkan jumlah transaksi selesai).
- Pencarian teks pada judul dan deskripsi; filter kategori, rentang harga/hari, titik serah terima, dan **tanggal** (menyembunyikan barang yang tidak tersedia di rentang itu).
- Urutan: relevansi (default saat ada kata kunci), terbaru, harga termurah, rating barang tertinggi (A-3.12).
- Pagination cursor, 20 item per halaman (infinite scroll). Respons API p95 < 500 ms untuk 10.000 listing.
- Hanya listing `aktif` milik akun `aktif` yang muncul.

### F6 Detail barang
- Galeri foto (geser), judul, harga/hari, deposit, nilai barang, durasi min/maks, deskripsi kondisi, titik serah terima, kalender ketersediaan (tanggal terpakai tidak bisa dipilih), kartu pemilik (badge, rating, jumlah transaksi), ulasan terbaru.
- Tombol menempel di bawah: "Ajukan sewa" dan ikon chat.
- Pemilik melihat tombol "Ubah" alih-alih "Ajukan sewa".

### F7 Ajukan sewa & persetujuan
**Sebagai** penyewa, **saya ingin** mengajukan sewa dan tahu biayanya sejak awal.
- Pilih jadwal mulai (tanggal + jam sesuai jam operasional titik), durasi, titik serah terima, pesan opsional ke pemilik.
- Ringkasan biaya: harga × hari, deposit, total (kode unik ditambahkan setelah disetujui), jatuh tempo.
- Validasi sesuai A-3.3 (jarak waktu minimal, bentrok, identitas terverifikasi, rekening/e-wallet terkonfirmasi). Akun baru boleh menyewa barang dengan nilai berapa pun di katalog tanpa syarat jumlah transaksi selesai.
- Pemilik melihat profil penyewa (badge, rating, jumlah transaksi) lalu Terima/Tolak. Tombol Terima nonaktif bila bentrok dengan hold lain.
- Hitung mundur batas tanggapan tampil di kedua sisi.

### F8 Pembayaran manual
- Halaman bayar: tagihan (dengan kode unik disorot dan keterangan "termasuk deposit, akan dikembalikan"), pilihan rekening platform aktif (tombol salin nomor dan nominal), jam operasional admin, hitung mundur batas bayar.
- Unggah bukti (JPEG/PNG/PDF, maks 5 MB) + rekening tujuan yang dipakai + nama pengirim + waktu transfer + nominal yang ditransfer; boleh menambah bukti berikutnya.
- Halaman bayar menampilkan **kode transaksi** dengan tombol salin dan ajakan menuliskannya di berita transfer (A-3.4).
- Status `Menunggu verifikasi` dengan estimasi: "Diverifikasi maks 2 jam" atau "Diverifikasi paling lambat 10.00" di luar jam operasional. Tombol batal disembunyikan selama menunggu verifikasi (A-2.2).
- Hasil verifikasi per bukti tampil di halaman bayar: diterima (nominal) / ditolak (alasan).
- Kurang bayar → kembali ke `Menunggu pembayaran` dengan **sisa kekurangan** dan batas bayar baru; lunas → status `Siap serah terima`, pemilik menerima notifikasi "Pembayaran sudah diterima platform".

### F9 Chat
**Sebagai** penyewa, **saya ingin** bertanya ke pemilik sebelum dan selama sewa **agar** koordinasi COD mudah.
- Percakapan dibuat **per pasangan penyewa–pemilik per barang**, bisa dimulai dari halaman detail barang sebelum mengajukan sewa. Saat sewa diajukan, transaksi menyimpan referensi ke percakapan itu; bila barang yang sama disewa lagi oleh penyewa yang sama, percakapan yang sama dipakai dan pesan sistem menandai transaksi baru.
- Hanya pengguna terverifikasi yang bisa memulai chat; pemilik tidak bisa chat dengan dirinya sendiri.
- Jenis pesan: teks (maks 2.000 karakter), gambar (maks 5 MB), dan **pesan sistem** (perubahan status transaksi, jadwal ulang, dll).
- Real-time: pesan baru muncul < 2 detik tanpa refresh; fallback polling bila koneksi real-time gagal. Indikator terkirim dan dibaca.
- **Filter keamanan**: nomor HP, nomor rekening (deret ≥ 8 digit), dan tautan disamarkan saat tampil dengan peringatan "Demi keamanan, lakukan transaksi lewat SewaMates". Teks asli tetap tersimpan untuk bukti sengketa.
- Pengguna dapat melaporkan pesan atau memblokir pengguna lain (blokir mencegah chat dan pengajuan sewa baru di antara keduanya).
- Admin hanya bisa membaca percakapan yang terkait sengketa atau laporan; setiap akses tercatat di audit log.
- Batas laju: 30 pesan per menit per pengguna.
- Daftar percakapan: diurutkan berdasarkan pesan terakhir, jumlah belum dibaca, foto barang.

### F10 Serah terima & pengembalian
- Layar dipandu langkah demi langkah sesuai A-3.5: "Saya sudah sampai" → foto → kode/QR → selesai.
- Hanya tersedia di HP. Di PC (≥ 1024 px) tombol langkah ini diganti panel "Lanjutkan di HP" berisi QR code ke halaman transaksi yang sama.
- Kamera dalam app (`getUserMedia`) untuk foto kondisi; jika tidak didukung, fallback ke pemilih file dan foto diberi tanda "dari galeri" untuk admin.
- Waktu foto memakai waktu server saat diunggah.
- Kode 6 digit berlaku hanya untuk transaksi tersebut; salah 5 kali → dikunci 15 menit.
- Setelah pengembalian: tampil denda telat (bila ada) dan rincian pencairan yang akan dibuat; tombol "Sesuai" / "Ada masalah" dengan hitung mundur masa cek.

### F11 Pembatalan, jadwal ulang, tidak hadir
- Tombol "Batalkan" menampilkan konsekuensi sebelum konfirmasi (refund, biaya batal, strike) sesuai A-3.6; tidak tersedia saat `MENUNGGU_VERIFIKASI` dan setelah `BERJALAN`.
- Jadwal ulang serah terima: usulkan tanggal/jam → pihak lain setuju/tolak; status, batas jumlah, dan pergeseran jatuh tempo sesuai A-3.5. Usulan yang bentrok atau di luar jam operasional titik ditolak saat diajukan.
- "Pihak lain tidak datang" muncul 30 menit setelah jadwal (serah terima maupun pengembalian) hanya bagi pihak yang sudah menekan "Saya sudah sampai". Pihak yang dilaporkan melihat tombol "Bantah" dengan hitung mundur 12 jam; konsekuensi tanpa bantahan sesuai A-3.5.

### F12 Pelacak & riwayat transaksi
- Tab "Menyewa" dan "Disewakan"; filter aktif/selesai/dibatalkan.
- Detail transaksi: timeline status (dari `rental_events`), rincian biaya, jadwal & titik, foto kondisi awal/akhir, bukti bayar penyewa, **bukti transfer pencairan/refund** dari admin, tombol aksi berikutnya (satu aksi utama).

### F13 Sengketa
- Buka sengketa: pilih kategori, deskripsi (min 20 karakter), unggah bukti (maks 10 file).
- Pihak lawan diberi notifikasi dan 24 jam untuk menanggapi + bukti.
- Kedua pihak melihat status sengketa dan putusan (lanjutkan / batal / bagi dana, rincian nominal, alasan). Putusan "lanjutkan" mengembalikan transaksi ke langkah sebelumnya dengan tombol aksi yang sesuai.

### F14 Rating & review
- Form: bintang 1–5, tag cepat ("tepat waktu", "barang sesuai deskripsi", "merawat barang", "komunikatif"), komentar opsional.
- Aturan waktu dan visibilitas sesuai A-3.12. Review dapat dilaporkan.

### F15 Notifikasi
- Semua notifikasi tersimpan in-app (ikon lonceng + jumlah belum dibaca).
- Kanal per kejadian:

| Kejadian | Penerima | In-app | Telegram | Push |
|----------|----------|:-:|:-:|:-:|
| Verifikasi identitas diterima/ditolak | Pengguna | ✓ | ✓ | ✓ |
| Listing disetujui/ditolak | Pemilik | ✓ | – | ✓ |
| Pengajuan sewa baru | Pemilik | ✓ | ✓ | ✓ |
| Pengajuan disetujui/ditolak/kedaluwarsa | Penyewa | ✓ | ✓ | ✓ |
| Batas bayar tinggal 1 jam | Penyewa | ✓ | ✓ | ✓ |
| Pembayaran lunas / kurang / bukti ditolak | Penyewa (+ pemilik saat lunas) | ✓ | ✓ | ✓ |
| Pengingat serah terima (H-1 & 1 jam sebelum) | Keduanya | ✓ | ✓ | ✓ |
| Pengingat jatuh tempo (H-1 & 2 jam sebelum) | Penyewa | ✓ | ✓ | ✓ |
| Terlambat mengembalikan | Keduanya | ✓ | ✓ | ✓ |
| Jadwal ulang / pembatalan / laporan tidak hadir | Pihak lain | ✓ | ✓ | ✓ |
| Masa cek akan habis | Keduanya | ✓ | – | ✓ |
| Pencairan/refund selesai (dengan bukti) | Penerima | ✓ | ✓ | ✓ |
| Sengketa dibuka/ditanggapi/diputuskan | Keduanya | ✓ | ✓ | ✓ |
| Pesan chat baru | Penerima | ✓ | – | ✓ |
| Strike diberikan / akun ditangguhkan atau diaktifkan lagi | Pengguna | ✓ | ✓ | – |
| Pengajuan otomatis ditolak/dibatalkan karena penangguhan akun lawan | Pihak lain | ✓ | ✓ | ✓ |
| Laporan yang dikirim sudah ditangani | Pelapor | ✓ | – | – |
| Tugas admin baru / lewat target | Semua admin | ✓ | ✓ (grup admin) | – |

- Pengguna dapat mematikan push untuk chat; notifikasi transaksi tidak bisa dimatikan.

### F16 Laporan konten/pengguna
- Pengguna dapat melaporkan listing, pengguna, pesan, atau review dengan alasan (pilihan + teks).
- Laporan masuk antrean admin (F21); pelapor diberi notifikasi saat laporan ditangani.

### F17 Hapus akun
- Tidak bisa dilakukan selama ada transaksi non-final, sengketa terbuka, atau tugas pencairan tertunda.
- Wajib dikonfirmasi lewat tombol di Telegram bot (A-3.1). Setelah dihapus, tautan Telegram dilepas dan nomor HP yang sama boleh mendaftar ulang sebagai akun baru.
- Data pribadi dianonimkan; riwayat transaksi, ledger, dan bukti dipertahankan untuk audit; foto identitas dihapus 30 hari setelahnya.

### F20–F28 Panel admin
- **Umum**: desktop-first, akses hanya untuk role `admin`/`super_admin`; setiap aksi masuk audit log.
- **F20 Verifikasi identitas**: daftar `menunggu` (urut terlama), tampilan kartu + selfie + nama profil berdampingan, terima/tolak dengan alasan dari templat. Target 24 jam.
- **F21 Moderasi & laporan**: listing `menunggu_review` (setujui/tolak dengan alasan), laporan masuk (tindakan: abaikan, sembunyikan konten, beri strike, tangguhkan). Target moderasi listing 24 jam ⚙ (`listing_sla_hours`); listing yang diubah pemilik saat sedang dibuka admin wajib dimuat ulang sebelum diputuskan.
- **F22 Verifikasi pembayaran**: daftar bukti `menunggu` (termasuk bukti untuk transaksi yang sudah final) dengan tagihan, kode unik, total sudah diterima, rekening tujuan, nama pengirim, nominal yang diklaim penyewa. Per bukti: **Terima** (isi nominal yang benar-benar masuk) atau **Tolak** (alasan dari templat). Penanda terlambat sesuai target A-3.4.
- **F23 Pencairan**: daftar tugas (penerima, jenis, nominal, rekening snapshot ditampilkan besar), tombol "Klaim" → form selesai (rekening platform sumber, nominal ditransfer, biaya transfer, waktu, unggah bukti). Tugas yang diklaim admin lain tampil terkunci beserta nama admin dan sisa waktu klaim.
- **F24 Sengketa**: halaman satu layar berisi foto awal–akhir berdampingan, chat, timeline, bukti kedua pihak, dana diterima, komisi, dan saran perhitungan otomatis (denda telat); form putusan (lanjutkan / batal / bagi dana sesuai A-3.10) dengan validasi total + alasan + strike opsional.
- **F25 Rekonsiliasi & kas**: input saldo aktual per rekening platform per hari, dibandingkan saldo menurut ledger; pencatatan pemindahan dana antar rekening platform dan penarikan komisi (super admin), masing-masing dengan bukti.
- **F26 Pengguna**: cari berdasarkan nama/HP/ID transaksi, lihat riwayat, strike, tangguhkan/aktifkan.
- **F27 Pengaturan (super admin)**: nilai `settings` (dengan validasi tipe dan rentang), rekening platform (aktif/nonaktif; rekening yang pernah dipakai tidak bisa dihapus), kategori, titik serah terima + jam operasional, naikkan/turunkan role pengguna terdaftar menjadi admin. Perubahan settings tidak memengaruhi transaksi yang sudah dibuat (nilai di-snapshot).
- **F28 Rekap**: jumlah transaksi per status, nilai transaksi, komisi, dana ditahan, pencairan tertunda; ekspor CSV. Audit log dapat difilter per admin dan jenis aksi.

## 3. Persyaratan Non-Fungsional
- **Performa**: LCP < 2,5 detik di perangkat Android menengah dengan 4G; gambar WebP + lazy load; bundle JS halaman awal < 200 KB gzip.
- **Ketersediaan**: target 99% bulanan; job terjadwal idempoten dan dipantau.
- **Keamanan & privasi**: lihat [04](04-arsitektur-teknis.md) bagian Keamanan.
- **Aksesibilitas**: kontras teks WCAG AA, target sentuh ≥ 44 px, semua input berlabel.
- **Bahasa**: Bahasa Indonesia santai-sopan ([03](03-panduan-ux-ui.md)).
- **Perangkat & browser**: aplikasi pengguna responsif dari 360 px sampai desktop (tata letak di [03](03-panduan-ux-ui.md) bagian 2.1). HP: Chrome Android dan Safari iOS 16.4+ (web push iOS butuh PWA terpasang). PC: Chrome, Edge, Firefox, Safari macOS (2 versi terakhir). Panel admin: Chrome/Edge desktop ≥ 1280 px.
- **Serah terima & pengembalian** (F10) hanya dari HP; di PC tampil QR code "Lanjutkan di HP". Semua fitur pengguna lain tersedia penuh di PC.
- **Jaringan buruk**: unggahan foto bisa diulang tanpa mengulang langkah; formulir panjang (listing) menyimpan draf lokal.
