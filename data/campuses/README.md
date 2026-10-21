# Referensi kampus Indonesia

Snapshot berisi **197 kampus Indonesia**, difilter dengan `country = Indonesia` dan `alpha_two_code = ID` dari [Hipo/university-domains-list](https://github.com/Hipo/university-domains-list). Commit sumber dan URL yang dipatok tersedia di [source.json](source.json). Lisensi MIT asli disertakan dalam [LICENSE.hipo](LICENSE.hipo).

Ini adalah data komunitas, bukan daftar resmi atau lengkap PDDikti. Nama, domain, dan cakupannya perlu ditinjau bila ada perubahan institusi. Snapshot sengaja disimpan di repo agar seed dan aplikasi tidak bergantung pada ketersediaan API eksternal.

Jalankan `npm run db:migrate`, lalu `npm run db:campuses` untuk mengimpor ke database yang sudah ada. Instalasi baru cukup menjalankan `npm run db:seed`, yang juga mengimpor snapshot ini. Tidak ada API key tambahan.

Untuk memperbarui snapshot, unduh JSON pada commit upstream yang ditinjau, filter kedua penanda Indonesia, lalu perbarui `indonesia.json`, `source.json`, serta lisensi bila berubah. Jalankan tes sebelum impor. Domain pertama menjadi `source_key` dengan awalan `hipo:`: pertahankan domain pertama bila institusinya sama agar ID tidak berubah. Perubahan domain utama, merger, dan institusi dengan domain sama memerlukan rekonsiliasi manual sebelum impor.

Impor menambah kampus baru dan memperbarui nama/domain untuk `source_key` yang sama. ID, pengguna terkait, kampus manual, dan status arsip tidak ditimpa. Kampus yang hilang dari snapshot tidak otomatis dihapus atau diarsipkan. Placeholder lama `Kampus Surabaya` diarsipkan hanya jika ID dan namanya masih persis seperti seed awal; profil lama tetap dapat mempertahankannya atau memilih kampus baru.
