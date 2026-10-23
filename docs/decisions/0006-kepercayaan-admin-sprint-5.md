# ADR 0006 — Kepercayaan dan admin Sprint 5

Status: diterapkan di kode; aktivasi lingkungan bersama mengikuti checklist sprint.

## Sengketa dan uang

Putusan memegang kunci barang/transaksi dan sengketa, memeriksa `version`, tahap asal, serta larangan admin menjadi peserta. Pembagian memakai dana bukti diterima yang belum diselesaikan. Batal sebelum serah terima tidak mengambil komisi; bagi dana sesudah serah terima mengambil komisi snapshot terlebih dahulu. Jurnal, tugas, putusan, audit, strike opsional, dan notifikasi dibuat dalam satu transaksi. Bukti yang sudah diselesaikan tidak dihitung ulang.

Lanjutkan dari `DIBAYAR` membutuhkan jadwal baru dalam jam operasional, pemeriksaan ketersediaan, dan epoch foto baru. Kehadiran, konfirmasi foto, kode, dan penghitung kode salah dibersihkan. Lanjutkan dari `BERJALAN` tidak memperpanjang jatuh tempo dan tetap memeriksa konflik hold. Foto lama menjadi arsip. Tanggapan tertulis dan bukti tambahan dibatasi `respond_by`; tidak ada keputusan otomatis hanya karena pihak lawan diam.

Tugas penyesuaian adalah pembayaran tambahan ke penerima tugas asli yang sudah selesai, memakai snapshot rekening asli. Untuk mencegah kewajiban tanpa sumber dana, nominal dicadangkan dari saldo komisi menjadi hutang penerima saat tugas dibuat. Tugas asli dan settlement tidak ditulis ulang. Penarikan komisi dan penyesuaian berbagi advisory lock agar saldo komisi tidak negatif. Pengembalian dana dari penerima akibat salah transfer tidak dimodelkan sebagai nominal pencairan negatif; perlu penanganan operasional terpisah.

## Ulasan dan moderasi

Masa penilaian dihitung dari `rentals.settled_at`, saat pengembalian final masuk pencairan, menggunakan `rating_window_days` snapshot. API tidak membocorkan skor, tag, komentar, atau keberadaan ulasan pihak lain sebelum publikasi. Pemilik menilai penyewa; penyewa menilai pemilik sekaligus barang. Ulasan dapat diperbarui sebelum terlihat. Service dan trigger melarang perubahan isi setelah terlihat.

Menyembunyikan ulasan menghapus kontribusinya dari agregat pengguna/barang. Pesan tersembunyi ditampilkan sebagai placeholder; teks/lampiran asli tetap tersedia bagi admin dalam akses sengketa/laporan yang diaudit. Listing yang disembunyikan menjadi `ditolak` dengan alasan sehingga perlu perbaikan dan moderasi ulang sebelum dapat tayang.

## Penangguhan dan penghapusan

`auto-suspend` memeriksa strike aktif setiap menit, maksimal 100 akun yang memenuhi ambang per panggilan. Strike kedaluwarsa tidak dihitung, tanpa perlu menghapus riwayat. Aktivasi ulang oleh admin menetapkan `strike_reviewed_at`: strike sebelum peninjauan tetap terlihat dalam riwayat tetapi tidak langsung menangguhkan akun kembali. Strike sesudah peninjauan membangun ambang baru.

Advisory lock akun diperoleh sebelum kunci barang untuk pembuatan pengajuan/listing, persetujuan, penangguhan, dan penghapusan. Pengajuan `DIAJUKAN` ditolak jika pemilik ditangguhkan, dibatalkan jika penyewa ditangguhkan. Transaksi yang sudah disetujui tetap berjalan. Sesi pengguna dipertahankan untuk menyelesaikan kewajiban; akses admin tetap memerlukan akun aktif. Perubahan role mencabut seluruh sesi.

Hapus akun diperiksa ulang saat tombol Telegram dikonfirmasi. Bukti pembayaran yang masih menunggu pemeriksaan juga menahan penghapusan, termasuk pada transaksi final, karena bukti yang kelak diterima memerlukan refund. Riwayat finansial dan bukti dipertahankan; profil, rekening aktif, payload konfirmasi rekening, sesi, dan tautan Telegram dibersihkan. Nomor diganti `deleted:<uuid>` sehingga nomor asli dapat dipakai akun baru. Job `purge-identity` menghapus avatar pada panggilan berikutnya dan foto identitas setelah 30 hari. Kegagalan Storage mempertahankan path agar dapat dicoba kembali; hasil job menyertakan `failed`. Super admin terakhir perlu menunjuk pengganti sebelum menghapus akun.

## Notifikasi Telegram tanpa cron pengiriman

Kejadian transaksi penting masuk in-app dan outbox Telegram. Callback database berjalan setelah commit; satu delivery dimiliki satu callback. Telegram memakai allowlist dan grup admin, sedangkan chat hanya tersedia in-app. Batas percobaan tetap lima; kegagalan setelah anggaran callback memerlukan redispatch operasional.

Migration `0012` membersihkan tabel, preferensi, dan antrean kanal browser dari migration `0011`. Riwayat migration `0011` dipertahankan agar database yang sudah menerapkannya tetap dapat diperbarui. Tidak ada dependensi, API, service worker, atau konfigurasi kunci browser pada aplikasi. Manifest dan penyempurnaan PWA tetap dalam backlog Sprint 6.
