# SewaMates

Web sewa barang antar mahasiswa, dibangun dengan Next.js App Router, TypeScript, Tailwind CSS, komponen pola shadcn/ui, Drizzle, PostgreSQL/Supabase, dan grammY. Spesifikasi PM ada di [docs](docs/README.md).

**Lingkup saat ini: Sprint 4 — Transaksi II.** Selain pengajuan, pembayaran manual, chat, dan notifikasi Telegram dari [Sprint 3](docs/sprints/03-transaksi-i.md), tersedia serah terima dan pengembalian dari HP (kamera, kode/QR), masa cek, denda telat, pembatalan sesuai tabel A-3.6, jadwal ulang, laporan tidak hadir, pembukaan sengketa, strike, serta antrean pencairan dan kas admin. Lihat [Sprint 4](docs/sprints/04-transaksi-ii.md) untuk migrasi sampai `0009`, 10 job terjadwal, dan hasil tes. Putusan sengketa dan rating mengikuti Sprint 5.

## Menjalankan aplikasi

Prasyarat: Node.js 24 LTS dan npm. Dari direktori repo:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Buka <http://localhost:3000>. Beranda dan halaman login dapat dibuka sebelum integrasi dikonfigurasi. Login akan menjelaskan bahwa layanan belum aktif jika konfigurasi bot belum tersedia. Tidak ada bypass login atau akun demo yang bisa membuka admin.

Untuk memperbarui dependency atau meregenerasi `package-lock.json`, gunakan **npm 11.21.1**, yang dipakai untuk menyinkronkan lockfile ini. npm 11.6.2 dapat melewatkan metadata peer dependency WASM `@emnapi/core` dan `@emnapi/runtime`, sehingga validasi npm yang lebih baru di CI gagal. Masalah dependency lintas platform juga dibahas pada [issue upstream napi-rs](https://github.com/napi-rs/napi-rs/issues/3174).

Jika perlu menyinkronkan ulang, jalankan `npx --yes npm@11.21.1 install --package-lock-only --ignore-scripts`, lalu periksa dengan `npx --yes npm@11.21.1 ci`. Commit perubahan lockfile bersama perubahan dependency.

Isi `.env.local` sesuai [panduan lingkungan](docs/setup-sprint-1.md), lalu siapkan database Supabase hosted yang masih kosong:

```powershell
npm run db:migrate
npm run db:seed
```

Jika memakai Supabase CLI lokal, `npx supabase start` menerapkan migrasi. Sesudahnya jalankan `npm run db:seed` saja, tanpa runner migrasi npm. Detail kedua alur tersedia pada panduan lingkungan.

`db:migrate` menjalankan SQL berurutan dan memeriksa hash migrasi yang sudah diterapkan. Jangan mengedit migrasi yang sudah dipakai bersama tim; tambahkan file migrasi baru. `db:seed` idempoten dan tidak menimpa pengaturan yang sudah diubah admin. Schema Drizzle merepresentasikan tabel, sedangkan constraint, trigger, dan RLS didefinisikan di SQL.

Seed juga mengisi 12 kategori awal bila tabel kategori masih kosong. Titik serah terima tidak di-seed: super admin menambahkannya per kampus di **Admin → Pengaturan → Titik serah terima**, karena wizard listing hanya menawarkan titik aktif di kampus pemilik. Foto listing memakai bucket publik `items-public` yang dibuat migrasi `0004`; langkah penyiapan lain ada di [Sprint 2](docs/sprints/02-marketplace.md).

Registrasi/profil mendukung pilihan dan pencarian **197 kampus Indonesia**. Seed memuat snapshot [Hipo](https://github.com/Hipo/university-domains-list) dari repo, sehingga tidak memerlukan API key tambahan. Untuk database yang sudah ada, sesudah migrasi jalankan `npm run db:campuses`; perintah ini hanya mengimpor referensi kampus. ID profil lama tetap tersimpan. Lihat [sumber dan pemeliharaan data](data/campuses/README.md); dataset komunitas ini belum mencakup seluruh perguruan tinggi Indonesia.

## Pemeriksaan

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Tes lokal memakai PostgreSQL WASM (PGlite) tanpa Docker. CI menjalankan tes yang sama terhadap PostgreSQL 17, termasuk pengajuan konkuren, transaksi, constraint, dan RLS. Untuk menguji PostgreSQL sendiri, set `TEST_DATABASE_URL` ke database **khusus tes** bernama `sewamates_test`. Helper tes mengosongkan schema database tersebut. Jangan gunakan database aplikasi.

Tes browser memakai build production dan menjalankan server sementara. Ukuran layar: 360, 390, 768, dan 1440 px; Chromium serta WebKit. Integrasi Telegram/Supabase nyata tetap perlu diuji di staging.

`npm run test:e2e:transactions` menguji tiga sesi pengguna dengan API dan PostgreSQL nyata serta tiruan Storage lokal. Wajib `E2E_DATABASE_URL` ke database loopback **sewamates_e2e** yang boleh dikosongkan; build dan port terpisah dijelaskan di [panduan Sprint 3](docs/sprints/03-transaksi-i.md). Tidak ada login bypass di aplikasi.

## Struktur

```text
app/                    halaman publik, pengguna, admin, dan Route Handler API
src/components/         UI responsif dan formulir
src/domain/             aturan murni (settings, deposit/komisi, status listing, tanggal WIB, pencarian)
src/services/           auth, profil, bot, verifikasi, admin, listing, katalog, moderasi, pencarian
src/db/                 schema Drizzle dan transaksi idempoten
src/lib/                auth guard, validasi, kriptografi, storage, HTTP
src/jobs/               job kedaluwarsa login/sewa/pembayaran dan delivery notifikasi
data/campuses/          snapshot Indonesia, provenance, dan lisensi Hipo
supabase/migrations/    SQL schema, constraint, RLS, dan bucket
supabase/jobs.sql       pemasangan cron lewat Vault Supabase
scripts/                migrasi, seed, dan pendaftaran webhook
tests/                  unit, integrasi PostgreSQL, dan browser
docs/                   spesifikasi PM, setup, ADR, dan status sprint
```

API Sprint 1–4 mengikuti URL dokumen 04. Dispatch Route Handler mengarahkan request ke service lewat `marketplace-routes.ts` dan `transaction-routes.ts`; otorisasi dilakukan lagi di server. Semua mutasi browser wajib `Origin` yang sama dengan `NEXT_PUBLIC_APP_URL`. Mutasi profil, rekening, verifikasi, listing, blokir tanggal, keputusan admin, katalog, settings, pengajuan, pembayaran dan pengiriman chat mendukung `Idempotency-Key`; pemakaian ulang key dengan isi berbeda mendapat HTTP 409.

CI berjalan saat pull request dan push ke `main`. Deployment staging mengikuti CI berhasil apabila GitHub environment `staging` memiliki secret Vercel. Database dimigrasikan secara terpisah sebelum deployment pertama; lihat panduan setup. Tidak ada deployment production pada Sprint 1.
