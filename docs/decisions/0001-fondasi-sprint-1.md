# ADR 0001 — Fondasi Sprint 1

Tanggal: 21 Oktober 2026. Status: diterapkan pada kode, menunggu validasi layanan staging.

## Konteks

Repo awal hanya berisi dokumen PM. Sprint pertama harus membangun fondasi sesuai dokumen 01–05 tanpa mempercepat fitur marketplace atau transaksi. Kredensial layanan eksternal tidak tersedia di workspace.

## Keputusan

- Memakai Next.js App Router, PostgreSQL/Supabase, Drizzle, Tailwind, komponen mengikuti pola shadcn/ui, dan grammY sesuai stack PM. Panduan skill Sites dipakai untuk implementasi dan QA web lokal. Hosting tetap Vercel sesuai keputusan PM.
- Pada Next.js 16, penjagaan navigasi awal memakai `proxy.ts`; pemeriksaan sesi dan role yang otoritatif tetap di server. Browser tidak diberi akses langsung ke tabel sensitif.
- Token login/sesi dan nonce browser disimpan sebagai SHA-256. Rate limit login memakai baris `login_requests` dan advisory lock PostgreSQL agar konsisten antar instance. IP hanya dipercaya dari header yang ditimpa Vercel; pengembangan lokal memakai satu kelompok IP `local`.
- Kontak Telegram harus mempunyai `contact.user_id` yang sama dengan pengirim. Relink nomor menunggu angka yang benar sebelum memindahkan tautan dan mencabut sesi lama. Login diminta ke tepat satu akun Telegram per token.
- Rekening dan payload konfirmasinya menyimpan nomor terenkripsi AES-256-GCM. Konfirmasi dikirim ke Telegram terbaru setelah user dikunci; tidak ada plaintext nomor rekening pada API profil.
- Menambah `terms_accepted_at` dan `terms_version` untuk acceptance criteria registrasi; `ip_hash` untuk rate limit; `upload_tickets` untuk memvalidasi kepemilikan dan pemakaian foto; `idempotency_keys` agar replay mutasi tidak menggandakan keputusan, audit, atau konfirmasi.
- Mengubah nama yang sudah terverifikasi mengembalikan status ke `belum`. Nama yang sedang diperiksa tidak dapat diubah. Ini menjaga kesesuaian nama kartu dan profil; aturan lebih spesifik dapat disahkan PM nanti.
- Super admin pertama dinaikkan melalui seed terhadap akun Telegram yang sudah benar-benar login. Seed tidak mengarang identitas admin atau membuat password bersama. Kenaikan role mencabut sesi dan masuk audit log.
- Migrasi SQL adalah sumber constraint, RLS, dan trigger. Runner memeriksa hash dan mengunci migrasi. Jangan mencampur riwayat runner npm dengan Supabase CLI pada database yang sama.
- Tes lokal memakai PGlite; CI memakai PostgreSQL 17 melalui driver runtime asli. Storage dan Telegram dimock untuk tes deterministik, sementara otorisasi, SQL, constraint, transaksi, dan RLS dijalankan sesungguhnya. Browser memakai Chromium/WebKit.

## Konsekuensi

Tidak ada login dummy atau fallback database dalam aplikasi. Beranda dapat ditinjau tanpa integrasi, sedangkan fitur akun memerlukan konfigurasi nyata. Deployment, webhook, storage, cron, Sentry, serta uji perangkat tetap merupakan pekerjaan penyelesaian Sprint 1. Halaman marketplace/transaksi saat ini hanya penanda ketersediaan, tanpa data atau transaksi palsu.

Ketentuan dan privasi masih berupa draf uji coba dengan versi tersimpan pada persetujuan pengguna. Dokumen final dan logo tetap menunggu pemilik bisnis sesuai persiapan roadmap. Antrean notifikasi Telegram dan pesan grup admin mengikuti Sprint 3.
