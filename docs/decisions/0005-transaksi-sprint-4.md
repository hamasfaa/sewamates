# ADR 0005 — Serah terima, penyelesaian dana, dan pencairan Sprint 4

Tanggal: 23 Oktober 2026. Status: diterapkan pada implementasi lokal.

## Konteks

Sprint 3 hanya membuat kewajiban refund per bukti saat transaksi berakhir sebelum lunas. Sprint 4 menambah jalur yang membagi dana ke dua penerima (normal, biaya batal, tidak hadir), serah terima tatap muka dengan kode, masa cek, sengketa, dan transfer manual oleh admin. Dana tidak boleh dibagi dua kali, dan bukti yang diverifikasi setelah transaksi final tetap harus kembali ke penyewa.

## Keputusan

- **Penyelesaian sekali per transaksi.** `settleRental` mengambil bukti diterima yang belum diselesaikan (`payments.settled_at IS NULL`, dikunci `FOR UPDATE`), memeriksa invarian A-3.8, lalu membuat satu jurnal: debit `dana_ditahan`, kredit `hutang_pemilik`/`hutang_penyewa`/`pendapatan_komisi`, serta satu tugas per penerima bernilai > 0. Hasilnya disimpan di `rentals.settlement` dan `settled_at`. Bukti yang diverifikasi setelah itu menjadi refund per bukti dengan `source_payment_id`. Migrasi `0008` menandai bukti yang sudah punya tugas refund Sprint 3.
- Jalur yang memakai penyelesaian: `KADALUARSA`, semua `DIBATALKAN` (pengguna, `stale-start`, tidak hadir), dan `PENCAIRAN_DIPROSES` (keduanya "Sesuai" atau masa cek habis). Putusan sengketa memakai jalur yang sama pada Sprint 5 (`reason = putusan`).
- **Pembulatan.** Komisi, biaya batal, dan denda telat dibulatkan setengah ke atas dari total, bukan per periode. Denda dibatasi deposit tanpa kode unik. Komisi biaya batal memakai tarif komisi snapshot transaksi.
- **Ledger.** `postEntries` menulis jurnal multi-baris dan menolak baris ganda/nol/tidak seimbang sebelum trigger database. Penyelesaian tugas mendebit hutang penerima dan `biaya_transfer`, lalu mengkredit `kas:<rekening sumber>`. `ledger_entries` menyimpan `payout_task_id` atau `cash_movement_id` agar jurnal dapat ditelusuri. Saldo kas tidak memblokir pencairan karena biaya ditanggung platform dan setoran modal belum tercatat; saldo ditampilkan di formulir dan halaman kas.
- **Kode serah terima** disimpan di `handover_records` per tahap (`start`/`end`), bukan sebagai `handover_code_hash`/`return_code_hash` di `rentals` seperti draf dokumen 04. Hash memakai ID transaksi dan tahap. Endpoint kode tidak memakai cache idempotensi agar kode asli tidak tersimpan. Kode salah dicatat dalam transaksi yang berhasil, lalu galat dikirim; setelah 5 kali, input dikunci 15 menit dan penghitung diulang.
- **Langkah lokasi.** Kedua pihak harus "Saya sudah sampai" sebelum foto dan kode. Tombol untuk serah terima aktif 60 menit sebelum jadwal; pengembalian boleh kapan saja. Foto maksimal 8 per tahap; pemilik mengonfirmasi foto awal bersama kode. "HP saja" ditentukan tata letak: langkah tampil di bawah 1024 px, panel QR "Lanjutkan di HP" tampil mulai 1024 px. QR kode berisi URL dengan fragmen `#kode=`, sehingga kode tidak dikirim ke server lewat URL.
- **Tidak hadir.** Laporan yang masih menunggu menahan `stale-start` dan pembatalan. Laporan menjadi `gugur` bila serah terima selesai, jadwal ulang disetujui, atau transaksi pindah status. Penyewa absen saat pengembalian tidak langsung diberi strike; strike `terlambat` diberikan saat barang kembali melewati toleransi. Pemilik absen saat pengembalian mengisi `rentals.late_until` dengan kedatangan penyewa, dan sengketa otomatis memakai 72 jam sejak laporan.
- **Jadwal ulang** minimal 60 menit dari sekarang dan maksimal `booking_max_days`. Validasi dijalankan saat usulan dan saat persetujuan. Kedatangan pada pertemuan lama dihapus dari record dan disimpan di meta event.
- **Sengketa Sprint 4** hanya pembukaan, bukti, dan tampilan admin. `status_before_dispute` wajib untuk `SENGKETA`. Sesuai A-3.3, `SENGKETA` bukan status hold; putusan "lanjutkan" Sprint 5 harus memeriksa ketersediaan lagi.
- **Klaim pencairan** memakai satu `UPDATE` bersyarat; pengklaim dapat memperpanjang atau melepas klaim, hanya pengklaim dengan klaim aktif yang dapat menyelesaikan, dan peserta transaksi tidak boleh mengklaim. Tugas `selesai` dikunci trigger. Nomor rekening lengkap hanya didekripsi di detail tugas admin dan setiap akses diaudit.
- **Pengingat dan SLA** dikirim sekali melalui `sent_alerts(kind, target_id)`. Kunci pengingat menyertakan jadwal sehingga jadwal ulang mendapat pengingat baru. Status lewat target dihitung dari `target_at`/`decide_by`; job hanya memberi tahu grup admin sekali per tugas.

## Konsekuensi

Tidak ada env baru. Sebelum uji bersama perlu migrasi `0008`, jadwal 10 job dari `supabase/jobs.sql`, HTTPS untuk kamera, dan admin non-peserta untuk pencairan. Strike tercatat tanpa penangguhan otomatis sampai Sprint 5. Koreksi tugas yang sudah selesai menunggu tugas penyesuaian super admin pada Sprint 5.
