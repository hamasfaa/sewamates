# UAT manual Sprint 5

Gunakan staging dan dana dummy. Siapkan pemilik A, penyewa B, admin C yang bukan peserta, dan super admin D. A/B terverifikasi dan rekening/e-wallet terkonfirmasi. Buka sesi browser terpisah. Ulangi layar utama pada HP 360/390 px, tablet, dan desktop. Pastikan satu tindakan berhasil tidak menghasilkan tugas/notifikasi ganda.

## 1. Tanggapan dan putusan sengketa

1. Buat transaksi sampai `BERJALAN`; A melapor masalah dengan deskripsi minimal 20 karakter. B menerima notifikasi, status menjadi **Dalam mediasi**, dana tetap ditahan.
2. B membuka transaksi, mengisi tanggapan dan bukti. A serta C melihat pembaruan tanpa reload; C mendapat tugas di grup admin. C bisa membandingkan foto, chat, timeline, dana, komisi dan saran denda.
3. C mencoba bagian dana dengan total salah: harus ditolak dan tidak ada jurnal/tugas baru. Masukkan pembagian yang tepat: pemilik + penyewa + komisi = dana diterima. Isi alasan dan opsional strike. Hasil **Dana diproses**, dua pihak menerima putusan, bagian nol tidak membuat tugas.
4. Coba admin A/B memutuskan transaksinya sendiri: harus ditolak. Coba keputusan kedua pada sengketa yang sama: harus ditolak. Tanggapan terlambat, tanggapan ganda, dan unggahan bukti melampaui batas harus ditolak.
5. Transaksi lain dari `DIBAYAR`: kedua pihak tandai hadir, lalu B memilih **Barang tidak sesuai**. Putusan **batal** membagi seluruh dana tanpa komisi; tugas refund/pencairan sesuai bagian. Putusan bagi dana pada tahap ini tidak tersedia.
6. Transaksi lain dari `DIBAYAR` dengan sengketa: pilih **lanjutkan**. Jadwal baru wajib berbeda; jadwal di luar jam titik/bentrok atau batas jadwal ulang yang sudah tercapai ditolak. Setelah disetujui, status kembali **Siap serah terima**, kedua kehadiran kosong, kode lama tidak berlaku, foto lama menjadi arsip. Dua pihak harus hadir dan menambah foto baru sebelum menyelesaikan serah terima.
7. Lanjutkan sengketa dari `BERJALAN`: status kembali **Sedang disewa**, jatuh tempo tetap. Sengketa dari `DIKEMBALIKAN` hanya menawarkan bagi dana. Cek kedua pihak dapat membaca alasan/nominal putusan di transaksi.

## 2. Ulasan dan publikasi

1. Selesaikan cek kondisi atau putusan bagi dana sampai **Dana diproses**. B mengisi bintang, tag dan komentar. B boleh memperbaruinya selama belum terlihat.
2. Sebelum A mengisi, A/pengunjung tidak boleh melihat skor, tag atau komentar B; rating pengguna/barang belum bertambah.
3. A mengisi ulasan. Keduanya menjadi publik: ulasan B menambah rating A dan barang; ulasan A menambah rating B. Ulasan yang sudah terlihat tidak dapat diubah.
4. Di transaksi uji lain, hanya satu pihak mengisi. Sesudah masa penilaian snapshot berakhir dan `reveal-reviews` berjalan, ulasan menjadi publik. Di staging boleh memendekkan `rating_window_days` untuk transaksi baru; jangan mengubah data produksi untuk mempercepat tes.
5. Pengajuan yang batal/kedaluwarsa/ditolak dan pengguna lain tidak dapat menilai. Setelah batas waktu, form tidak menerima ulasan baru.

## 3. Laporan dan blokir

1. B melaporkan listing A dari detail barang, pengguna A dari profil, pesan dalam chat, dan ulasan publik. Pilih alasan dan isi penjelasan. C melihat antrean laporan.
2. C mengabaikan satu laporan dengan alasan; pelapor menerima hasil in-app. Tangani laporan lain dengan sembunyikan konten: listing perlu moderasi ulang, pesan menjadi placeholder, ulasan hilang dari publik dan agregat rating dihitung ulang. Bukti asli tetap tersedia dalam akses admin yang diaudit.
3. C memberi strike pada laporan terbukti; percobaan menangani laporan yang sama tidak menambah strike lagi. Pelapor/pemilik konten yang berperan admin tidak dapat memutuskan laporan itu sendiri.
4. B memblokir A. Chat dan pengajuan baru antara keduanya ditolak. Cek daftar blokir di **Profil → Privasi akun**, lalu buka blokir dan coba lagi. Kewajiban transaksi yang sudah disetujui tetap harus diselesaikan.

## 4. Pengguna, strike, dan role

1. C mencari nama, nomor HP, dan kode transaksi di **Admin → Pengguna**, lalu membuka riwayat/strike. Akses dan tindakan tercatat di audit.
2. Tangguhkan A dengan alasan: listing tidak tampil di pencarian; pengajuan `DIAJUKAN` sebagai pemilik menjadi ditolak. Tangguhkan B pada pengajuan lain: pengajuannya dibatalkan. Pihak lawan mendapat notifikasi. Transaksi yang telah disetujui masih dapat membayar, serah terima, mengembalikan dan menerima pencairan.
3. Berikan tiga strike aktif pada akun uji; setelah `auto-suspend` berjalan, akun ditangguhkan dan masuk peninjauan admin. Strike kedaluwarsa tidak dihitung. Mengulang job tidak mengirim notifikasi ganda.
4. C mengaktifkan kembali akun dengan alasan. Strike sebelum peninjauan tetap di riwayat tetapi tidak menangguhkan ulang pada menit berikutnya; strike baru dihitung sejak peninjauan.
5. D mengubah role akun uji lain; sesi target terputus dan perlu login ulang. Admin biasa tidak bisa mengubah role; super admin tidak bisa mengubah role sendiri. Admin C tidak bisa menangguhkan dirinya sendiri.

## 5. Rekonsiliasi, komisi, penyesuaian, dan audit

1. C membuka **Rekonsiliasi**, memilih rekening dan tanggal WIB, mengisi saldo aktual. Saldo sama boleh tanpa catatan; selisih wajib catatan. Tanggal mendatang dan entri ulang rekening/tanggal yang sama ditolak. Riwayat menampilkan actual, ledger, dan selisih.
2. D mencatat penarikan komisi dengan rekening sumber, nominal dan bukti. Nominal melebihi saldo komisi ditolak; admin biasa ditolak. Cek kas berkurang dan saldo komisi tetap nonnegatif. Pemindahan antar rekening lama tetap bekerja.
3. D membuat tugas penyesuaian dari tugas asli yang sudah selesai: pilih nominal dan alasan. Dana dicadangkan dari komisi; penerima/rekening snapshot mengikuti tugas asli. Tugas asli/bukti tidak berubah. D yang menjadi peserta tidak dapat membuat penyesuaian untuk transaksi itu.
4. C mengklaim dan menyelesaikan tugas penyesuaian melalui alur pencairan biasa. Penerima mendapat notifikasi dan bukti; biaya transfer tidak mengurangi haknya.
5. Buka **Rekap**, cocokkan jumlah per status, nilai sewa, dana diterima, dana ditahan, komisi tersedia dan tugas tertunda. Unduh CSV. Filter **Audit log** per admin dan aksi; putusan, laporan, role, penarikan, penyesuaian dan rekonsiliasi ditemukan.

## 6. Telegram dan notifikasi in-app

1. Pastikan migrasi, webhook Vault, dan deployment HTTPS aktif. Lakukan event penting dari akun lawan: pengajuan, pembayaran, tiba, pengembalian, putusan sengketa, dan pencairan. Periksa in-app dan Telegram sesuai matriks F15.
2. Tugas admin hanya dikirim ke grup Telegram admin; admin sebagai peserta tetap menerima notifikasi pribadinya. Pesan chat tersimpan in-app tanpa dikirim ke Telegram.
3. Blokir bot pada akun uji: banner pemulihan muncul dan notifikasi in-app tetap tersedia. Buka bot dan tekan Start untuk memulihkan pengiriman berikutnya.
4. Mengulang callback tidak mengirim ulang delivery sukses. Gangguan endpoint tidak menghilangkan notifikasi in-app; periksa outbox dan lakukan redispatch operasional bila anggaran callback habis.

## 7. Hapus akun dan retensi

1. B mencoba hapus akun saat masih punya transaksi/sengketa/pencairan: ditolak. Setelah semua kewajiban selesai, centang persetujuan dan minta hapus; aplikasi mengirim tombol konfirmasi Telegram.
2. Tolak di bot: akun dan sesi tetap aktif. Ulangi permintaan dan biarkan kedaluwarsa: tombol lama tidak menghapus akun. Buat kewajiban baru setelah permintaan; konfirmasi harus ditolak oleh pemeriksaan ulang.
3. Pada akun uji tanpa kewajiban, konfirmasi hapus. Seluruh sesi terputus, profil dianonimkan, nomor/Telegram terlepas. Daftar ulang dengan nomor yang sama menghasilkan akun baru. Riwayat transaksi/ledger/bukti tetap ada dengan identitas pengguna yang telah dianonimkan.
4. Verifikasi `purge-identity` di database uji yang waktu penghapusannya sudah melewati 30 hari: foto identitas di Storage benar-benar hilang dan `purged_at` terisi; job ulang aman. Sebelum 30 hari belum dihapus. Jika Storage gagal, path dipertahankan dan hasil job `failed` bertambah agar dapat dicoba kembali.

Centang lulus UAT hanya setelah hasil sesuai di lingkungan yang dipakai. Tes otomatis lokal belum membuktikan Telegram fisik, transfer bank, atau cron hosted telah bekerja.
