# SewaMates

Web sewa barang antar mahasiswa, dibangun dengan Next.js App Router, TypeScript, Tailwind CSS, komponen pola shadcn/ui, Drizzle, PostgreSQL/Supabase, dan grammY. Spesifikasi PM ada di [docs](docs/README.md).

**Lingkup saat ini: Sprint 1 — Fondasi.** Marketplace dan transaksi belum diimplementasikan. Lihat [status sprint](docs/sprints/01-fondasi.md) untuk hasil verifikasi dan dependensi eksternal yang belum selesai.

## Menjalankan aplikasi

Prasyarat: Node.js 24 LTS dan npm. Dari direktori repo:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Buka <http://localhost:3000>. Beranda dan halaman login dapat dibuka sebelum integrasi dikonfigurasi. Login akan menjelaskan bahwa layanan belum aktif jika konfigurasi bot belum tersedia. Tidak ada bypass login atau akun demo yang bisa membuka admin.

Isi `.env.local` sesuai [panduan lingkungan](docs/setup-sprint-1.md), lalu siapkan database Supabase hosted yang masih kosong:

```powershell
npm run db:migrate
npm run db:seed
```

Jika memakai Supabase CLI lokal, `npx supabase start` menerapkan migrasi. Sesudahnya jalankan `npm run db:seed` saja, tanpa runner migrasi npm. Detail kedua alur tersedia pada panduan lingkungan.

`db:migrate` menjalankan SQL berurutan dan memeriksa hash migrasi yang sudah diterapkan. Jangan mengedit migrasi yang sudah dipakai bersama tim; tambahkan file migrasi baru. `db:seed` idempoten dan tidak menimpa pengaturan yang sudah diubah admin. Schema Drizzle merepresentasikan tabel, sedangkan constraint, trigger, dan RLS didefinisikan di SQL.

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

## Struktur

```text
app/                    halaman publik, pengguna, admin, dan Route Handler API
src/components/         UI responsif dan formulir
src/domain/             aturan murni (settings awal)
src/services/           auth, profil, bot, verifikasi, admin
src/db/                 schema Drizzle dan transaksi idempoten
src/lib/                auth guard, validasi, kriptografi, storage, HTTP
src/jobs/               job kedaluwarsa login dan konfirmasi
data/campuses/          snapshot Indonesia, provenance, dan lisensi Hipo
supabase/migrations/    SQL schema, constraint, RLS, dan bucket
supabase/jobs.sql       pemasangan cron lewat Vault Supabase
scripts/                migrasi, seed, dan pendaftaran webhook
tests/                  unit, integrasi PostgreSQL, dan browser
docs/                   spesifikasi PM, setup, ADR, dan status sprint
```

API Sprint 1 mengikuti URL dokumen 04. Dispatch Route Handler mengarahkan request ke service; otorisasi dilakukan lagi di server. Semua mutasi browser wajib `Origin` yang sama dengan `NEXT_PUBLIC_APP_URL`. Mutasi profil, rekening, verifikasi, keputusan admin, dan settings mendukung `Idempotency-Key`; pemakaian ulang key dengan isi berbeda mendapat HTTP 409.

CI berjalan saat pull request dan push ke `main`. Deployment staging mengikuti CI berhasil apabila GitHub environment `staging` memiliki secret Vercel. Database dimigrasikan secara terpisah sebelum deployment pertama; lihat panduan setup. Tidak ada deployment production pada Sprint 1.
