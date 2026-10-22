# Pengujian manual Sprint 3

Gunakan lingkungan dev/staging. Prasyarat dan migrasi ada di [status Sprint 3](03-transaksi-i.md). Uji akun penyewa, pemilik, dan admin pada browser/profil terpisah. Jangan memakai dana nyata untuk bukti pengujian.

| Area | Langkah | Hasil yang diharapkan |
| --- | --- | --- |
| Rekening platform | Super admin tambah bank dan GoPay/OVO; ubah, nonaktifkan, hapus rekening belum dipakai | Nomor berawalan 0 tetap utuh; rekening aktif muncul di halaman bayar; admin biasa ditolak |
| Kelayakan | Coba akun belum terverifikasi, belum konfirmasi rekening/e-wallet, dan menyewa barang sendiri | Pengajuan ditolak dengan alasan yang jelas |
| Akun baru | Gunakan penyewa terverifikasi dengan rekening/e-wallet terkonfirmasi dan 0 transaksi selesai; ajukan barang Rp1 juta atau Rp10 juta lalu setujui sebagai pemilik | Form pengajuan tersedia; pengajuan dan persetujuan berhasil untuk jadwal valid tanpa batas nilai barang berdasarkan riwayat transaksi |
| Jadwal | Pilih mulai <12 jam, >60 hari, durasi di luar batas listing, titik tutup, titik lain, tanggal diblokir | Pengajuan ditolak; jadwal valid menampilkan biaya dan jatuh tempo WIB yang benar |
| Pengajuan | Penyewa isi waktu, durasi, titik, pesan; buka transaksi dari kedua akun | Snapshot biaya dan profil peserta tampil; kode transaksi dan hitung mundur tanggapan sama; pesan sistem muncul di chat |
| Penolakan | Pemilik menolak pengajuan dan memberi catatan | Status ditolak, timeline dan notifikasi penyewa masuk, tidak ada hold |
| Hold | Dua pengajuan pada waktu sama, setujui satu; coba setujui yang kedua | Hanya satu disetujui; yang kedua mendapat bentrok; kalender/filter tanggal ikut menutup periode sampai jatuh tempo +3 jam |
| Arsip/blok | Saat rental belum final, coba arsip barang; saat hold aktif, coba blok tanggal bertabrakan | Ditolak; pembatalan pengajuan/hold yang dibolehkan melepaskan jadwal |
| Snapshot | Ubah harga listing setelah pengajuan; ubah settings setelah persetujuan | Transaksi memakai harga saat pengajuan dan aturan saat persetujuan |
| Halaman bayar | Penyewa pilih rekening aktif, salin rekening/tagihan/kode transaksi | Total = sewa + deposit + kode unik, kode unik bagian deposit; instruksi berita transfer, jam admin dan batas bayar jelas |
| Unggah | Coba gambar/PDF valid ≤5 MB, file palsu, file >5 MB, file milik akun lain | Hanya bukti valid milik penyewa diterima; tautan privat tanpa token ditolak |
| Verifikasi | Admin buka bukti dan mutasi uji; terima dengan nominal aktual | Nominal aktual masuk, bukan nilai klaim. Bukti tidak diproses dua kali; audit dan jurnal tercatat |
| Kurang bayar | Terima bukti pertama di bawah tagihan, lalu tambah bukti pelunasan | Kembali menunggu pembayaran dengan sisa dan batas baru; setelah semua bukti diproses menjadi siap serah terima |
| Banyak bukti | Kirim dua bukti, terima satu yang sudah mencukupi total, biarkan satu tertunda | Tetap menunggu verifikasi sampai bukti terakhir diputuskan |
| Bukti ditolak | Tolak bukti dengan alasan, coba tanpa alasan, lalu kirim bukti baru | Alasan wajib; bukti ditolak tidak menambah dana; penyewa bisa mengunggah ulang sebelum batas baru |
| Versi dan role | Dua admin memutuskan bukti yang sama; admin peserta mencoba memverifikasi sendiri | Satu keputusan berhasil; keputusan ganda/versi lama ditolak; admin peserta meminta admin lain |
| Lewat waktu | Biarkan pengajuan atau pembayaran melewati batas; panggil job terotorisasi/cron | Menjadi kedaluwarsa, hold dilepas; `MENUNGGU_VERIFIKASI` tetap menunggu admin |
| Refund parsial | Bayar sebagian, terima bukti, kemudian batalkan/kedaluwarsakan sebelum lunas | Kewajiban refund dibuat sekali, dana ditahan menjadi nol; transfer refund dikerjakan pada Sprint 4 |
| Chat | Mulai dari detail barang; ulangi pada barang/pasangan sama; kirim teks/gambar | Percakapan sama, pesan tampil tanpa refresh; terkirim/dibaca, urutan dan jumlah unread sesuai |
| Filter chat | Kirim `081234567890`, nomor dengan spasi/tanda hubung, dan tautan | Keluaran disamarkan dengan peringatan; kode transaksi pada pesan sistem tetap terbaca |
| Laporan/blokir | Laporkan pesan; blokir dan coba pesan/pengajuan dari lawan, lalu buka blokir | Laporan tersimpan; blokir berlaku dua arah; hanya pemblokir dapat mencabut blokir miliknya |
| Privasi | Coba URL/API chat sebagai pengguna ketiga dan sebagai admin tanpa laporan | Ditolak. Admin dapat membaca lewat endpoint admin setelah ada laporan; akses tercatat |
| Rate limit | Kirim >30 pesan dalam satu menit | Pesan berikutnya ditolak sementara, pesan sebelumnya tetap ada |
| Telegram pribadi | Uji pengajuan baru, disetujui/ditolak/kedaluwarsa, hasil pembayaran, keputusan identitas/listing | Pemilik/penyewa/pengaju menerima ringkasan dan tombol yang menuju halaman terkait melalui akun Telegram yang tertaut; chat biasa tidak mengirim Telegram; `/transaksi` menampilkan transaksi aktif |
| Telegram admin | Gunakan dua admin aktif; ajukan identitas/listing/bukti bayar | Satu pesan per tugas masuk grup admin; semua admin menerima in-app; tidak ada DM tugas admin. ID grup kosong/tidak valid tidak mengirim pesan pribadi |
| Waktu notifikasi | Buka halaman notifikasi pada akun penerima; lakukan aksi dari browser lain, lalu tutup browser pengirim | Pengiriman Telegram dipicu setelah aksi tersimpan tanpa menunggu pergantian menit; notifikasi dan lonceng penerima diperbarui dalam sekitar 2 detik ditambah latensi jaringan |
| Cadangan pengiriman | Simulasikan kegagalan pengiriman pada dev, lalu pulihkan dan jalankan cron | Aksi transaksi tetap berhasil; outbox belum terkirim diproses ulang dengan backoff/lease; 429 mengikuti `retry_after` |
| Gangguan bot | Blokir bot, jalankan worker, buka bot/Start lagi | Penanda Telegram mati tampil; in-app tetap ada; 403 berhenti retry, 429 mengikuti `retry_after` |
| Responsif | Coba 360/390, 768 dan 1440 px, termasuk nama/catatan panjang | Tidak perlu zoom out; kolom dan tombol dapat diakses, tidak ada overflow horizontal |

Catat hasil, perangkat, versi browser, waktu, kode transaksi uji, dan screenshot tanpa data pribadi. Periksa audit, `rental_events`, `notification_deliveries`, log job, dan Sentry. Jangan menandai cron/Telegram/Storage nyata lulus berdasarkan tes dengan tiruan lokal.
