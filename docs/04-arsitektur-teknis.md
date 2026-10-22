# 04 – Arsitektur Teknis

Aturan bisnis yang diimplementasikan di sini didefinisikan di [01](01-alur-dan-aturan-sistem.md) (disingkat "A-x.y").

## 1. Keputusan Platform

**MVP berupa web responsif (mobile-first) yang bisa dipasang sebagai PWA di HP maupun PC**, ditambah panel admin di aplikasi yang sama (`/admin`, desktop-first). Satu basis kode melayani HP, tablet, dan desktop; tata letak per ukuran layar ada di [03](03-panduan-ux-ui.md) bagian 2.1.

Alasan: satu basis kode, rilis tanpa proses toko aplikasi, tautan mudah dibagikan. Batasan yang diterima:
- Web push di iOS hanya berjalan bila PWA dipasang ke Home Screen (iOS 16.4+). Karena itu **Telegram bot adalah kanal utama** untuk notifikasi kritis.
- Bot Telegram tidak bisa mengirim pesan duluan; pengguna harus menekan Start. Ini dijamin karena login wajib lewat bot (A-3.1).
- Kamera dalam browser (`getUserMedia`) tidak bisa sepenuhnya mencegah unggahan dari galeri; foto dari fallback galeri ditandai untuk admin.
- Bila kelak butuh native: bungkus dengan Capacitor (P2).

## 2. Stack

| Lapisan | Pilihan | Catatan |
|---------|---------|---------|
| Framework | **Next.js (App Router) + TypeScript** | Satu repo untuk UI, API (Route Handlers), dan panel admin |
| UI | Tailwind CSS + shadcn/ui | Design token sesuai [03](03-panduan-ux-ui.md) |
| PWA | Web App Manifest + service worker (Serwist) | Cache aset statis; tidak ada mode offline untuk transaksi |
| Database | **PostgreSQL (Supabase)** | Exclusion constraint butuh ekstensi `btree_gist` |
| ORM / migrasi | Drizzle ORM + migrasi SQL | Constraint khusus (exclusion, partial unique) ditulis manual di SQL |
| Auth | **Login via Telegram bot** (A-3.1) + sesi milik sendiri (tabel `sessions`, cookie httpOnly) | Supabase Auth tidak dipakai. Untuk Realtime, server menerbitkan JWT berumur 1 jam (`sub` = user id, `role` = authenticated) yang ditandatangani JWT secret Supabase agar RLS berlaku; jika tidak memungkinkan, chat memakai polling |
| Storage | Supabase Storage | Bucket publik dan privat, lihat 6.2 |
| Real-time | Sprint 3 menggunakan polling terotorisasi | Ruang chat 1,5 detik, daftar 5 detik; spike dan keputusan Realtime ada di ADR 0004 |
| Job terjadwal | `pg_cron` + `pg_net` memanggil endpoint internal tiap menit | Cron Vercel paket gratis hanya sekali per hari, jadi tidak dipakai |
| Telegram bot | **Telegram Bot API** (bot dibuat lewat BotFather), library grammY | Gratis, tanpa persetujuan templat. Mode **webhook** ke `/api/telegram/webhook` dengan `secret_token`. Batas kirim ±30 pesan/detik total dan ±1 pesan/detik per chat, ditangani antrean `notification_deliveries` |
| Web push | Standar Web Push (VAPID), library `web-push` | – |
| Hosting | Vercel (app) + Supabase (DB, storage, realtime, pg_cron) | Region Singapura untuk keduanya |
| Monitoring | Sentry (FE & BE), PostHog (event produk) | – |
| Tes | Vitest (unit/integrasi), Playwright (e2e) | DB tes dari Supabase CLI lokal |

Akses data: **semua penulisan lewat server** (Route Handlers / Server Actions) memakai koneksi server. Row Level Security tetap diaktifkan sebagai lapis kedua: tabel sensitif menolak semua akses dari klien, dan tabel chat/notifikasi hanya bisa dibaca peserta (dibutuhkan oleh Realtime).

Implementasi Sprint 3 memakai server untuk pembacaan chat juga, sehingga tabel chat menolak akses langsung `anon`/`authenticated`. JWT Realtime belum diterbitkan; peserta diperiksa dari sesi aplikasi pada setiap request. Lihat [ADR 0004](decisions/0004-transaksi-sprint-3.md). Model berikut mencakup target sprint selanjutnya; kolom serah terima/sengketa/pencairan lengkap belum tersedia pada `0005`.

## 3. Struktur Repo

```
/app
  /(public)            beranda, cari, detail barang, profil publik
  /(user)              transaksi, chat, sewakan, profil saya, notifikasi
  /admin               panel admin (role guard)
  /api                 route handlers (lihat bagian 5)
/src
  /domain              logika murni: rental-state-machine.ts, pricing.ts, availability.ts, payout.ts
  /services            RentalService, PaymentService (PaymentProvider), PayoutService, DisputeService,
                       NotificationService, ChatService
  /db                  schema Drizzle, query
  /lib                 auth, storage, validasi (zod), rate-limit
  /jobs                handler job terjadwal
/supabase/migrations   SQL migrasi
/tests                 unit, integrasi, e2e
/docs                  dokumen ini + /docs/decisions (ADR)
```

Logika uang dan status ada di `/src/domain` sebagai fungsi murni agar mudah diuji. Endpoint hanya memanggil service.

## 4. Model Data

Tipe: uang = `bigint` rupiah; waktu = `timestamptz`; id = `uuid`. Semua tabel memiliki `created_at`, dan `updated_at` bila dapat diubah.

### 4.1 Pengguna & referensi
```
campuses(id, name, source_key UNIQUE NULL, domains jsonb, is_active boolean)
users(id, phone UNIQUE, name, avatar_url, role[user|admin|super_admin],
      telegram_user_id UNIQUE, telegram_chat_id, telegram_linked_at, telegram_blocked_at,
      account_status[aktif|ditangguhkan|dihapus], verification_status[belum|menunggu|terverifikasi|ditolak],
      campus_id, rating_avg, rating_count, completed_count, deleted_at)
identity_verifications(id, user_id, card_type[ktm|ktp], card_photo_path, selfie_path,
      status[menunggu|diterima|ditolak], reject_reason, reviewed_by, reviewed_at)
payout_accounts(id, user_id UNIQUE, type[bank|ewallet], provider, account_no_enc, account_name)
user_blocks(blocker_id, blocked_id, PRIMARY KEY(blocker_id, blocked_id))
strikes(id, user_id, reason, rental_id NULL, given_by NULL, expires_at)
categories(id, name, active)                          -- nama unik tanpa membedakan kapital
pickup_points(id, campus_id, name, description, hours_json, active)
  -- hours_json: 7 entri Senin–Minggu, null (tutup) atau {"open":"HH:MM","close":"HH:MM"} WIB
  -- nama unik per kampus; campus_id tidak dapat diubah setelah dibuat
```

### 4.2 Listing
```
items(id, owner_id, campus_id, category_id, title, description, item_value, price_per_day, deposit,
      min_days, max_days, status[menunggu_review|aktif|ditolak|dijeda|diarsipkan], reject_reason,
      reviewed_by, reviewed_at, submitted_at, published_at, version,
      rating_avg, rating_count, completed_count, search_tsv tsvector GENERATED)
  CHECK (deposit > 0 AND min_days >= 1 AND max_days >= min_days)
  -- rentang deposit terhadap item_value divalidasi di service (nilainya dari settings)
  -- campus_id = kampus pemilik saat listing dibuat, tidak dapat dipindahkan
  -- submitted_at: masuk antrean review; published_at: persetujuan pertama (urutan "terbaru")
  -- version naik setiap perubahan pemilik; keputusan admin wajib membawa versi yang dilihat
  -- search_tsv = to_tsvector('simple', title) bobot A + to_tsvector('simple', description) bobot B
item_photos(id, item_id, path, thumb_path, sort)    -- bucket items-public, 1600 px + 480 px
item_pickup_points(item_id, pickup_point_id)        -- trigger: titik harus sekampus dengan listing
availability_blocks(id, item_id, period tstzrange, reason)   -- [mulai, akhir) dari tanggal WIB
```
Keputusan implementasi Sprint 2 (pencarian, foto, review ulang, kampus) dicatat di [ADR 0003](decisions/0003-marketplace-sprint-2.md).

### 4.3 Transaksi
```
rentals(id, public_code UNIQUE,                 -- mis. SM-2610-00123, tampil di UI & mutasi
        item_id, owner_id, renter_id, conversation_id, pickup_point_id,
        start_at, due_at, days, block_period tstzrange,   -- [start_at, due_at + jeda)
        price_per_day, rent_total, deposit,              -- snapshot dari listing
        commission_rate_bp, commission_amount,           -- basis poin, 1000 = 10%
        unique_code, amount_due,                         -- amount_due = rent_total + deposit + unique_code
        amount_received,                                 -- jumlah bukti bayar yang diterima
        rules_snapshot jsonb,                            -- settings yang berlaku saat disetujui (denda, toleransi, biaya batal, dll)
        listing_snapshot jsonb,                          -- judul, kondisi/deskripsi, foto dan titik saat pengajuan
        late_fee, status, status_before_dispute, respond_by, pay_by, review_ends_at, returned_at,
        handover_code_hash, return_code_hash, code_failed_attempts, code_locked_until,
        reschedule_count, cancelled_by, cancel_reason, version)

  -- tidak boleh ada dua hold/sewa aktif yang tumpang tindih pada barang yang sama
  EXCLUDE USING gist (item_id WITH =, block_period WITH &&)
    WHERE (status IN ('DISETUJUI','MENUNGGU_VERIFIKASI','DIBAYAR','BERJALAN'))
  -- kode unik tidak boleh dipakai dua transaksi yang sedang menunggu bayar
  UNIQUE (unique_code) WHERE (status IN ('DISETUJUI','MENUNGGU_VERIFIKASI'))

rental_events(id, rental_id, from_status, to_status, actor_id NULL, actor_type[user|admin|system], meta jsonb)
reschedule_requests(id, rental_id, proposed_by, new_start_at, status[menunggu|disetujui|ditolak], responded_at)
handover_records(id, rental_id, type[start|end], owner_arrived_at, renter_arrived_at,
                 owner_location, renter_location, completed_at)
handover_photos(id, handover_id, uploaded_by, path, source[camera|gallery], received_at)
no_show_reports(id, rental_id, reported_by, reported_party, status[menunggu|diterima|dibantah], respond_by)
```
Bentrok dengan `availability_blocks` dicek di service dalam transaksi DB yang mengunci baris `items` (`SELECT … FOR UPDATE`), karena exclusion constraint tidak bisa lintas tabel.

Migrasi `0005` mengisi kolom sampai kebutuhan Sprint 3: jadwal, snapshot, angka uang, status, `respond_by`/`pay_by`, pembatalan gratis dan versi. Kolom serah terima, denda, jadwal ulang, sengketa dan masa cek ditambahkan pada Sprint 4. Pembuatan kode publik memakai sequence dan bulan WIB.

### 4.4 Uang
```
platform_accounts(id, type[bank|ewallet], provider, account_no, account_name, active)
payments(id, rental_id, platform_account_id, proof_path, sender_name, transferred_at, claimed_amount,
         status[menunggu|diterima|ditolak], verified_amount, reject_reason, verified_by, verified_at)
         -- satu baris per bukti; amount_received = SUM(verified_amount) yang diterima
         -- Sprint 3 juga menyimpan platform_snapshot, proof_sha256, target_at, UNIQUE(proof_path), UNIQUE(rental_id,proof_sha256)
payout_tasks(id, rental_id, recipient_id, kind[pencairan_pemilik|refund_penyewa|penyesuaian],
             amount CHECK (amount > 0), account_snapshot jsonb,
             status[menunggu|diklaim|selesai], claimed_by, claimed_until,
             source_account_id, transferred_amount, transfer_fee, proof_path,
             transferred_at, completed_by, target_at)
cash_movements(id, type[antar_rekening|penarikan_komisi], from_account_id, to_account_id NULL,
               amount, fee, proof_path, note, created_by)
ledger_entries(id, journal_id, rental_id NULL, account, debit, credit, memo)
reconciliations(id, date, platform_account_id, actual_balance, ledger_balance, note, entered_by,
                UNIQUE(date, platform_account_id))
```

**Ledger entri ganda**: setiap peristiwa uang membuat satu `journal_id` dengan total debit = total kredit (dicek di service dan oleh trigger). Kas dicatat **per rekening platform** (`kas:<platform_account_id>`). Akun dan jurnal:

| Peristiwa | Debit | Kredit |
|-----------|-------|--------|
| Bukti bayar diterima | `kas:<rek. tujuan>` | `dana_ditahan` |
| Penyelesaian (normal / putusan / pembatalan / kedaluwarsa) | `dana_ditahan` | `hutang_pemilik`, `hutang_penyewa`, `pendapatan_komisi` |
| Tugas pencairan selesai | `hutang_pemilik` / `hutang_penyewa` (+ `biaya_transfer`) | `kas:<rek. sumber>` |
| Pemindahan antar rekening | `kas:<tujuan>` (+ `biaya_transfer`) | `kas:<asal>` |
| Penarikan komisi | `pendapatan_komisi` | `kas:<rek. sumber>` |

Saldo = jumlah entri; tidak ada kolom saldo yang diubah langsung. `ledger_balance` rekonsiliasi = saldo akun `kas:<rekening>`. Invarian yang diuji: saldo `dana_ditahan` per transaksi final = 0; saldo `hutang_*` per tugas selesai = 0; `pendapatan_komisi` tidak pernah negatif.

Fondasi `payout_tasks` pada Sprint 3 berisi kewajiban refund, `source_payment_id UNIQUE`, snapshot rekening terenkripsi dan target waktu. Klaim, sumber transfer, biaya, dan bukti penyelesaian baru pada Sprint 4. `ledger_entries` menambahkan referensi `payment_id`; keseimbangan jurnal diperiksa oleh deferred trigger dan entri tidak dapat di-update/delete.

### 4.5 Sengketa, chat, sosial
```
disputes(id, rental_id, opened_by NULL, category, description, opened_from_status,
         status[dibuka|diputuskan], respond_by, decide_by,
         outcome[lanjutkan|batal|bagi_dana], owner_amount, renter_amount, commission_amount,
         new_start_at NULL, decision_note, decided_by, decided_at)
  UNIQUE (rental_id) WHERE (status = 'dibuka')     -- satu sengketa terbuka per transaksi
dispute_evidence(id, dispute_id, uploaded_by, path, note)
conversations(id, item_id, renter_id, owner_id, last_message_at,
              renter_last_read_at, owner_last_read_at, UNIQUE(item_id, renter_id))
  -- rentals.conversation_id menunjuk ke sini; satu percakapan bisa dipakai beberapa transaksi
messages(id, conversation_id, sender_id NULL, rental_id NULL, type[text|image|system], body, image_path)
reviews(id, rental_id, reviewer_id, reviewee_id, score CHECK (score BETWEEN 1 AND 5),
        tags text[], comment, visible_at, UNIQUE(rental_id, reviewer_id))
reports(id, reporter_id, target_type[user|item|message|review], target_id, reason, note,
        status[menunggu|ditangani], action_taken, handled_by)
```

### 4.6 Sistem
```
notifications(id, user_id, type, title, body, link, read_at)
notification_deliveries(id, notification_id, channel[telegram|push], status[antre|terkirim|gagal], attempts, last_error, next_attempt_at)
login_requests(id, token_hash UNIQUE, browser_nonce_hash, match_code, telegram_user_id NULL, user_id NULL,
               status[menunggu|disetujui|dipakai|kedaluwarsa], expires_at)
action_confirmations(id, user_id, action[ubah_rekening|hapus_akun], payload jsonb,
                     status[menunggu|dikonfirmasi|ditolak|kedaluwarsa], expires_at)
sessions(id, user_id, token_hash UNIQUE, user_agent, ip, last_seen_at, expires_at, revoked_at)
telegram_updates(update_id PRIMARY KEY, received_at)   -- dedup webhook (Telegram bisa mengirim ulang)
push_subscriptions(id, user_id, endpoint UNIQUE, p256dh, auth)
settings(key PRIMARY KEY, value jsonb, updated_by)
admin_audit_logs(id, admin_id, action, target_type, target_id, meta jsonb)
```

## 5. API (Route Handlers)

Semua input divalidasi dengan zod. Respons galat: `{ error: { code, message } }` dengan kode HTTP yang sesuai. Endpoint yang mengubah status menerima header `Idempotency-Key`.

```
# Auth & profil
POST   /api/auth/telegram/start         (buat login_request → token, angka pencocokan, deep link)
GET    /api/auth/telegram/status/:id    (polling; saat disetujui menerbitkan cookie sesi)
POST   /api/auth/logout                 GET /api/me/sessions     DELETE /api/me/sessions/:id
GET    /api/me/confirmations/:id        (polling status konfirmasi aksi sensitif)
GET    /api/me                          PATCH /api/me
POST   /api/me/verification             (unggah KTM/KTP + selfie)
PUT    /api/me/payout-account           (membuat action_confirmation; berlaku setelah dikonfirmasi di bot)
DELETE /api/me                          (hapus akun, fitur F17 di dokumen 02)
POST   /api/me/push-subscriptions
POST   /api/uploads/sign                (signed upload URL per bucket & tujuan)

# Listing & pencarian
GET    /api/items?q=&category=&campus=&min=&max=&point=&from=&to=&sort=&cursor=
       (sort = relevan | terbaru | termurah | rating; 20 item per halaman)
GET    /api/categories                  GET /api/pickup-points?campus=   (aktif saja)
POST   /api/items                       GET/PATCH /api/items/:id
GET    /api/items/:id/edit              GET /api/me/listing-options      GET /api/me/items
POST   /api/items/:id/pause | resume | archive
GET    /api/items/:id/availability?month=
GET    /api/items/:id/blocks            (pemilik; blokir mendatang)
POST   /api/items/:id/blocks            DELETE /api/items/:id/blocks/:blockId
GET    /api/users/:id                   GET /api/users/:id/reviews

# Transaksi
POST   /api/rentals                     GET /api/rentals?role=renter|owner&state=
GET    /api/items/:id/rental-options    (detail, aturan dan kelayakan form pengajuan)
GET    /api/rentals/:id                 (detail + timeline + bukti)
POST   /api/rentals/:id/approve | reject | cancel
POST   /api/rentals/:id/payments        (unggah bukti transfer)
POST   /api/rentals/:id/arrive          (Saya sudah sampai)
POST   /api/rentals/:id/handover/photos
POST   /api/rentals/:id/handover/confirm   (kode serah terima / pengembalian)
POST   /api/rentals/:id/check           (Sesuai / Ada masalah pada masa cek)
POST   /api/rentals/:id/reschedule      POST /api/rentals/:id/reschedule/:reqId/respond
POST   /api/rentals/:id/no-show         POST /api/rentals/:id/no-show/:reportId/dispute
POST   /api/rentals/:id/disputes        POST /api/disputes/:id/evidence
POST   /api/rentals/:id/reviews

# Chat, notifikasi, laporan
GET    /api/conversations               POST /api/conversations {itemId}
GET    /api/conversations/:id/messages?cursor=   POST /api/conversations/:id/messages
POST   /api/conversations/:id/read      {lastMessageId}; cursor pesan berupa UUID
POST   /api/users/:id/block             DELETE /api/users/:id/block
GET    /api/notifications               POST /api/notifications/read
POST   /api/reports

# Admin (role admin, kecuali ditandai SA = super_admin)
GET    /api/admin/verifications         POST /api/admin/verifications/:id/decision
GET    /api/admin/items/pending         GET /api/admin/items/:id
POST   /api/admin/items/:id/decision    (disetujui / ditolak + alasan; wajib version)
GET    /api/admin/reports               POST /api/admin/reports/:id/action
GET    /api/admin/payments              POST /api/admin/payments/:proofId/decision   (per bukti: terima + nominal / tolak + alasan)
GET    /api/admin/payments/:proofId     (bukti privat dan snapshot tagihan, akses diaudit)
GET    /api/admin/payout-tasks          POST /api/admin/payout-tasks/:id/claim
POST   /api/admin/payout-tasks/:id/complete
GET    /api/admin/disputes              GET /api/admin/disputes/:id
POST   /api/admin/disputes/:id/decision
GET    /api/admin/conversations/:id     (hanya bila terkait sengketa/laporan; dicatat di audit log)
GET    /api/admin/users?q=              POST /api/admin/users/:id/suspend | reactivate | strike
GET/POST /api/admin/reconciliations
POST   /api/admin/cash-movements        (antar rekening: admin; penarikan komisi: SA)
GET    /api/admin/summary               GET /api/admin/audit-logs
POST   /api/admin/payout-tasks/adjustments                 (SA, tugas penyesuaian)
GET/PUT  /api/admin/settings                         (SA)
CRUD   /api/admin/platform-accounts | categories | pickup-points           (SA)
PUT    /api/admin/users/:id/role                                            (SA)

# Internal
POST   /api/internal/jobs/:name         (dipanggil pg_cron, diautentikasi secret header)
POST   /api/telegram/webhook            (update dari Telegram; wajib header X-Telegram-Bot-Api-Secret-Token)
```

Rute Sprint 3 dijalankan oleh `transaction-routes.ts`. `state` daftar rental menerima `aktif|selesai|dibatalkan`; aksi rental/keputusan pembayaran wajib `version`. Keputusan bukti memakai `decision: diterima|ditolak` disertai `verifiedAmount` atau `reason`. POST `/api/reports` pada Sprint 3 menerima `{messageId,reason}`; pengelolaan laporan umum mengikuti Sprint 5. Rute serah terima/pencairan/sengketa pada daftar target di atas belum diimplementasikan pada Sprint 3.

### Alur Telegram bot

```
/start <token>          → cari login_request; jika akun Telegram belum tertaut, kirim tombol "Bagikan nomor HP"
pesan contact           → terima hanya jika contact.user_id == from.id; normalisasi nomor (+62…);
                          cari/buat user berdasarkan nomor; simpan telegram_user_id & chat_id
                          → kirim 3 tombol angka (1 benar = match_code)
callback angka          → benar: login_request = disetujui (user_id diisi); salah: kedaluwarsa
callback konfirmasi     → action_confirmation = dikonfirmasi/ditolak
/transaksi, /bantuan    → balasan informasi + tombol URL ke aplikasi
my_chat_member (blocked)→ isi telegram_blocked_at; /start berikutnya mengosongkannya
```
Setiap update dicatat di `telegram_updates` sebelum diproses agar update yang dikirim ulang tidak diproses dua kali. Pengiriman notifikasi yang mendapat HTTP 403 (bot diblokir) → `telegram_blocked_at` diisi dan tidak dicoba ulang; HTTP 429 → tunggu sesuai `retry_after`.

## 6. Keamanan

### 6.1 Otorisasi
- Role: `user`; `admin` (semua antrean, **termasuk memegang dana**); `super_admin` (admin + pengaturan, rekening platform, kategori, titik, kelola admin).
- Setiap endpoint transaksi memeriksa bahwa pemanggil adalah pemilik/penyewa transaksi tersebut dan bahwa transisinya sah (A-2.2).
- Setiap aksi admin menulis `admin_audit_logs` dalam transaksi DB yang sama dengan aksinya.
- Sesi pengguna ber-role admin berlaku 12 jam ⚙; perubahan role mencabut semua sesi pengguna tersebut.

### 6.2 Data & file
| Bucket | Akses | Isi |
|--------|-------|-----|
| `items-public` | Baca publik | Foto listing & thumbnail |
| `identity-private` | Hanya admin, signed URL 5 menit | KTM/KTP, selfie |
| `evidence-private` | Peserta transaksi + admin, signed URL 5 menit | Foto serah terima, bukti bayar, bukti pencairan, bukti sengketa, gambar chat |

- File di `evidence-private` tidak bisa dihapus lewat aplikasi (hanya tambah).
- Nomor rekening pengguna dienkripsi di level aplikasi (AES-256-GCM, kunci di environment variable); tampil utuh hanya di layar pencairan admin.
- Metadata EXIF dihapus dari foto publik; waktu foto bukti memakai waktu server.
- Foto identitas dihapus oleh job 30 hari setelah akun dihapus.

### 6.3 Uang
- Status pembayaran dan pencairan hanya bisa diubah lewat endpoint admin.
- Verifikasi pembayaran dan penyelesaian tugas memakai optimistic locking (`rentals.version`) dan transaksi DB; dua admin yang menekan bersamaan → salah satu ditolak.
- Klaim tugas pencairan: `UPDATE … SET claimed_by = :admin, claimed_until = now() + 30 menit WHERE status = 'menunggu' OR claimed_until < now()`; hanya pengklaim yang dapat menyelesaikan.
- Layar penyelesaian tugas menampilkan ulang nama & nomor rekening tujuan serta nominal sebelum konfirmasi.

### 6.4 Lain-lain
- Login Telegram: token login acak 32 byte (disimpan sebagai hash), terikat ke cookie nonce browser pemulai, sekali pakai; angka pencocokan mencegah orang lain menyetujui login dari tautan yang dikirimkan. Token bot Telegram dan `secret_token` webhook hanya di environment variable.
- Rate limit (per IP & per pengguna): login, unggahan, pembuatan pengajuan, chat (F9 di dokumen 02).
- Kode serah terima disimpan sebagai hash; kunci 15 menit setelah 5 kali salah.
- Header keamanan (CSP, HSTS, X-Frame-Options), cookie `SameSite=Lax`, proteksi CSRF untuk Server Actions bawaan Next.js.
- Backup harian Supabase + uji pemulihan sebelum rilis.
- Secret hanya di environment variable; tidak ada secret di repo.

## 7. Job Terjadwal

Dipanggil tiap menit oleh `pg_cron`. Semua job **idempoten** (aman dijalankan ulang) dan memakai transisi lewat `RentalService`.

| Job | Aksi |
|-----|------|
| `expire-requests` | `DIAJUKAN` lewat `respond_by` → `KADALUARSA` |
| `expire-payments` | `DISETUJUI` lewat `pay_by` → `KADALUARSA` |
| `stale-start` | 24 jam setelah `start_at`: `MENUNGGU_VERIFIKASI` → `DIBATALKAN` + refund; `DIBAYAR` tanpa serah terima & tanpa laporan tidak hadir → `DIBATALKAN` + refund penuh |
| `close-review-window` | `DIKEMBALIKAN` lewat `review_ends_at` → `PENCAIRAN_DIPROSES` + buat tugas |
| `overdue-returns` | Kirim notifikasi telat; > 72 jam setelah jatuh tempo → `SENGKETA` (hilang), kecuali ada laporan "pemilik tidak datang" saat pengembalian yang diterima → hitung 72 jam dari laporan, kategori `tidak_hadir` (A-3.5, A-3.7) |
| `no-show-timeouts` | Laporan tidak hadir tanpa bantahan 12 jam → terapkan A-3.5 |
| `release-claims` | Tugas `diklaim` lewat `claimed_until` → `menunggu` |
| `sla-flags` | Tandai & beri tahu admin untuk antrean yang lewat target |
| `reminders` | Pengingat bayar, serah terima, jatuh tempo, masa cek |
| `reveal-reviews` | Buka rating yang sudah 7 hari |
| `expire-strikes` / `auto-suspend` | Hitung strike 90 hari, tangguhkan bila ≥ 3 |
| `deliver-notifications` | Kirim antrean Telegram/push dengan retry (maks 5, backoff; hormati `retry_after`) |
| `expire-login-requests` | Login request & konfirmasi aksi lewat `expires_at` → kedaluwarsa; hapus yang > 7 hari |
| `purge-identity` | Hapus foto identitas akun yang sudah dihapus > 30 hari |

## 8. Lingkungan, CI & Tes
- Lingkungan: `local` (Supabase CLI + Next dev), `staging`, `production`; database dan bucket terpisah per lingkungan. Setiap lingkungan memakai **bot Telegram terpisah** (mis. `@SewaMatesDevBot`, `@SewaMatesStagingBot`, `@SewaMatesBot`); di `local`, webhook diarahkan lewat tunnel (mis. cloudflared) atau bot dijalankan mode long polling.
- CI (GitHub Actions): lint, typecheck, unit/integrasi (DB lokal), build; merge ke `main` → deploy staging; tag rilis → deploy production.
- **Tes wajib** (harus ada sebelum fitur dianggap selesai):
  - State machine: setiap transisi sah lolos, setiap transisi tidak sah ditolak.
  - `pricing.ts`: rentang deposit (termasuk batas Rp1.000.000), komisi & pembulatan, kode unik, denda telat (batas deposit, waktu kembali saat pemilik tidak hadir), biaya batal, kelebihan bayar; contoh angka di A-3.6 dan A-3.8 dijadikan test case.
  - Ketersediaan: bentrok tanggal, jeda, blok kalender, jadwal ulang, pengajuan bersamaan (tes konkuren).
  - Pembayaran: bukti yang sama tidak bisa diproses dua kali, bukti bertahap terjumlah benar, kurang bayar kembali ke `DISETUJUI`, bukti untuk transaksi final menjadi refund.
  - Pencairan: klaim bersamaan, tugas tidak bisa diselesaikan oleh non-pengklaim, invarian pembagian (A-3.8) untuk semua baris tabel A-3.6 dan semua jenis putusan sengketa.
  - Ledger: setiap jurnal seimbang; invarian di bagian 4.4.
  - Settings: perubahan nilai tidak memengaruhi transaksi yang sudah punya `rules_snapshot`.
  - Otorisasi: pengguna tidak bisa mengakses transaksi/percakapan orang lain.
  - E2E (Playwright): alur lengkap ajukan → bayar → verifikasi → serah terima → kembali → pencairan → rating, dijalankan di dua viewport: HP (390 × 844, emulasi iPhone/Android) dan desktop (1440 × 900).
- Seed Sprint 1: snapshot kampus Indonesia (Hipo, 197 entri, sumber/lisensi di `data/campuses`), settings default, bootstrap super admin dari akun yang sudah login. Impor kampus memakai `source_key` tanpa mengganti ID; kampus yang diarsipkan tidak ditawarkan untuk pilihan baru. Lihat [ADR 0002](decisions/0002-pilihan-multi-kampus.md).
- Seed Sprint 2: 12 kategori awal hanya bila tabel `categories` kosong. Titik serah terima tidak di-seed karena merupakan lokasi nyata; super admin menambahkannya per kampus dari panel. Lihat [ADR 0003](decisions/0003-marketplace-sprint-2.md).

## 9. Observability
- Sentry untuk galat FE/BE; log terstruktur dengan `rental_id`, `user_id`, `request_id`.
- Alert: job gagal 3 kali berturut-turut, antrean admin lewat target, pengiriman Telegram gagal > 10% dalam 1 jam (di luar pengguna yang memblokir bot), webhook Telegram tidak menerima update > 1 jam saat jam operasional, saldo `dana_ditahan` negatif.
- Event produk (PostHog): `signup`, `verification_submitted`, `verification_approved`, `listing_created`, `search`, `item_viewed`, `chat_started`, `rental_requested`, `rental_approved`, `payment_proof_uploaded`, `payment_verified`, `payment_rejected`, `handover_completed`, `return_completed`, `payout_completed`, `dispute_opened`, `review_submitted`.
- Metrik operasional di panel admin: median waktu verifikasi pembayaran, median waktu pencairan, jumlah tugas terlambat, rasio bukti ditolak.

## 10. Risiko Teknis
| Risiko | Mitigasi |
|--------|----------|
| Admin menjadi bottleneck pembayaran/pencairan | Antrean + target + notifikasi admin; `PaymentProvider` siap diganti gateway (F43) |
| Bukti transfer palsu | Wajib cocokkan dengan mutasi asli; kode unik; `verified_by` tercatat |
| Transfer ganda / salah rekening | Klaim tugas, optimistic locking, snapshot rekening, layar konfirmasi ulang |
| Pemesanan bentrok | Exclusion constraint + kunci baris item |
| Sebagian mahasiswa tidak memakai Telegram | Halaman login menautkan unduhan Telegram; pantau rasio pengunjung yang batal di halaman login; cadangan login via email OTP bisa ditambahkan bila perlu |
| Pengguna memblokir bot sehingga notifikasi tidak sampai | Deteksi 403/`my_chat_member`, banner di aplikasi, notifikasi in-app tetap ada |
| Telegram tidak bisa diakses (gangguan/pemblokiran) | Notifikasi in-app & web push tetap jalan; sesi aktif 30 hari tidak bergantung pada Telegram |
| Push iOS tidak sampai | Telegram untuk semua kejadian kritis |
| Foto besar di jaringan lemah | Kompres di klien, unggahan bisa diulang |
| Job terjadwal berhenti | Alert kegagalan; job idempoten; endpoint bisa dipanggil manual oleh admin |
