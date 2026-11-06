# Rencana Apply — Migrasi GankStore ke Supabase

> Status: **PAKET SIAP, BELUM DI-APPLY.** Tidak ada project Supabase
> yang dibuat, tidak ada SQL yang dijalankan, tidak ada kode yang
> di-push. Semua langkah di bawah menunggu project baru + keputusan
> Tuan di langkah yang ditandai.

## 0. Yang sudah selesai (paket ini)

- [x] Audit lengkap (`AUDIT.md`)
- [x] SQL skema + RLS + fungsi (`sql/01–04`) — lolos parser Postgres
- [x] Adapter frontend (`frontend/supabase-client.js`,
      `frontend/supabase-api.js`) + patch docs
- [x] Edge Function Midtrans (`edge-functions/midtrans/`)
- [ ] Project Supabase baru — **BELUM ADA, menunggu Tuan**
- [ ] Apply SQL, Auth Google, Edge Function, patch frontend — menunggu
      project baru

## Fase 0 — Buat project BARU khusus GankStore (dashboard, ~5 menit)

1. Buka https://supabase.com/dashboard → **New project**.
2. Nama: `GankStore`. Region: **Singapore (ap-southeast-1)** (paling
   dekat dengan pembeli Indonesia). Database password: simpan di
   tempat aman (dipakai bila perlu akses Postgres langsung).
3. **JANGAN** memakai project Supabase mana pun yang sudah ada —
   khususnya **JANGAN** project RekberSTORE (`jltrufzlcouwymerqank`)
   atau project UMKM / barokahtelur / Nexora Film.
4. Setelah jadi, catat dari **Settings → API**:
   - Project URL → `https://<PROJECT-REF>.supabase.co`
   - `anon public` key → isi `SUPABASE_ANON_KEY` di config.js
   - `service_role` key → HANYA untuk keadaan darurat / Edge Function
     (JANGAN masukkan ke repo atau frontend).

## Fase 1 — Jalankan SQL (SQL Editor, urutan wajib)

Di dashboard project baru → **SQL Editor → New query**, jalankan
berurutan (tunggu tiap file selesai tanpa error):

1. `sql/01_schema.sql` — tabel, trigger, sequence
2. `sql/02_rls.sql` — RLS + grants
3. `sql/03_functions.sql` — fungsi RPC
4. `sql/04_settings_seed.sql` — seed settings

Verifikasi cepat di SQL Editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by 1;
-- Harus ada: activity, order_creds, orders, product_creds, products,
-- profiles, settings, support_messages, topup_packages

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname like '%order%';
-- Harus ada: confirm_order, cancel_order, create_account_order,
-- create_topup_order, reveal_order_credentials

select * from public.settings;
-- topup_maintenance harus 'true'
```

## Fase 2 — Auth: Google + email (dashboard)

1. **Authentication → Providers → Email**: matikan **Confirm email**
   (supaya daftar langsung bisa masuk, seperti sekarang). Bila tetap
   aktif, adapter menampilkan "cek email untuk konfirmasi" — alur
   tetap jalan, tapi pengalaman pembeli lebih ribet.
2. **Authentication → Providers → Google → Enable**:
   - Client ID: `308078866758-2qdr6ep644jpkm0e5jtu15vatgno14u0.apps.googleusercontent.com`
     (sama seperti di `config.js` — identifier publik).
   - Client Secret: ambil dari **Google Cloud Console** → project
     **GankStore** → APIs & Services → Credentials → "GankStore Web"
     → Client Secret. Tempel di dashboard Supabase — **JANGAN tulis
     nilainya di file/chat/repo**.
   - Pastikan di Google Cloud Console, **Authorized redirect URIs**
     sudah berisi `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
     (URL callback Supabase Auth — wajib, kalau tidak Google menolak).
3. **Authentication → URL Configuration**:
   - Site URL: `https://gankstore.my.id`
   - Redirect URLs: tambahkan `https://gankstore.my.id/` dan
     `https://www.gankstore.my.id/`.
4. **Buat akun demo** (pembeli, BUKAN admin): Authentication → Users →
   Add user → `demo@gankstore.my.id` + password baru. JANGAN centang
   apa pun yang menjadikannya admin (tidak ada opsi itu — admin hanya
   lewat SQL di bawah).
5. **Tetapkan admin toko** (setelah Tuan daftar/login dengan email
   aslinya — JANGAN pakai demo sebagai admin):

   ```sql
   update public.profiles set is_admin = true where email = '<EMAIL-ASLI-TUAN>';
   select email, is_admin from public.profiles;
   ```

   Satu baris harus `is_admin = true` untuk email Tuan, dan `false`
   untuk demo. Ini SATU-SATUNYA cara jadi admin — tidak ada jalur
   dari browser.

## Fase 3 — Edge Function Midtrans (CLI)

```bash
cd ~/workspace/gankstore-fullstack/supabase-migration
supabase link --project-ref <PROJECT-REF-BARU>
supabase secrets set MIDTRANS_SERVER_KEY='<SERVER-KEY>'
supabase secrets set MIDTRANS_CLIENT_KEY='<CLIENT-KEY>'
supabase secrets set MIDTRANS_IS_PRODUCTION=0
supabase functions deploy midtrans --project-ref <PROJECT-REF-BARU>
```

Tes:

```bash
curl -s https://<PROJECT-REF-BARU>.supabase.co/functions/v1/midtrans/config \
  -H "apikey: <ANON-KEY>" -H "Authorization: Bearer <ANON-KEY>"
# {"configured":true,"is_production":false,"client_key":"<CLIENT-KEY>"}
```

Lalu di **dashboard Midtrans** (Settings → Configuration), ubah
**Payment Notification URL** (Production dan Sandbox) menjadi:

```
https://<PROJECT-REF-BARU>.supabase.co/functions/v1/midtrans/webhook
```

URL lama (`https://calfycwinpjkxxokirbr.supabase.co/functions/v1/midtrans-webhook`)
JANGAN dipakai lagi — itu project Supabase lain, bukan GankStore.
Finish Redirect URL tetap `https://gankstore.my.id` (tanpa trailing
slash — sudah benar).

## Fase 4 — Frontend (patch + push + tes HP)

1. Salin `frontend/supabase-client.js` → `public/js/supabase-client.js`.
2. Terapkan `frontend/config.patch.md`, `frontend/index.html.patch.md`,
   `frontend/app.js.patch.md` ke `public/js/config.js`,
   `public/index.html`, `public/js/app.js`.
3. Verifikasi:

   ```bash
   node --check public/js/config.js
   node --check public/js/supabase-client.js
   node --check public/js/app.js
   node --check public/js/topup.js
   node --check public/js/payments.js
   ```

4. Push ke GitHub (repo `panglimaa09-a11y/gankstore`, tanpa force-push)
   → Vercel redeploy otomatis.
5. **Tes di HP Tuan** (https://gankstore.my.id, tutup tab + buka baru):
   - [ ] Beranda/Katalog tampil, mode server (bukan lokal)
   - [ ] Daftar email+password → masuk → Pesanan Saya tampil
   - [ ] Login Google → pemilih akun → masuk sebagai pembeli
   - [ ] Beli akun sebagai TAMU (tanpa login) → invoice terbit, akun DIPESAN
   - [ ] Login admin → Panel Admin tampil → Tambah Akun → stok tersimpan
         (reload halaman: stok MASIH ada — ini yang dulu gagal karena ngrok)
   - [ ] Konfirmasi Lunas → akun TERJUAL → buka halaman sukses sebagai
         pembeli → kredensial tampil SEKALI → refresh → sudah tidak ada
   - [ ] Batalkan pesanan → akun kembali Tersedia, kredensial tetap di stok
   - [ ] Kirim pesan support (tanpa login) → masuk ke Pesan Support admin
   - [ ] Top Up: halaman maintenance tampil, tombol order tidak bisa diklik
   - [ ] Invoice: tombol Midtrans tampil hanya bila Edge Function
         `configured: true` (sebelum key dipasang: tombol nonaktif + pesan jujur)

## Fase 5 — Cutover & rollback

- **Cutover**: setelah semua tes Fase 4 lolos, backend FastAPI di VM
  (`gankstore-backend` :8773) dan route ngrok `/gankstore-api` TIDAK
  lagi dipakai frontend. Biarkan service jalan **7 hari** sebagai
  cadangan, lalu matikan (`systemctl stop/disable gankstore-backend`)
  dan hapus route `/gankstore-api` dari `revproxy2.py` (+ backup).
  Route sementara `/paste-tk7x9q/` (tempel token Cloudflare — sudah
  tidak relevan karena jalur Cloudflare DIBATALKAN) hapus juga.
- **Rollback** (bila Supabase bermasalah): revert commit frontend
  (atau redeploy deployment Vercel sebelumnya dari dashboard Vercel)
  — frontend kembali memanggil FastAPI via ngrok. Backend lama tetap
  jalan selama 7 hari masa cadangan, jadi rollback hanya soal
  frontend. Setelah masa cadangan habis dan backend dimatikan,
  rollback butuh `bash ~/workspace/gankstore-fullstack/deploy/install.sh`.

## Dampak migrasi user lama (jujur)

- **Password TIDAK BISA dipindah.** Hash PBKDF2 SQLite tidak dikenal
  Supabase Auth. User lama (saat ini praktis hanya akun demo, karena
  toko belum dibuka umum) wajib **reset password** lewat email
  ("Lupa password" — perlu ditambahkan ke halaman #/akun bila belum
  ada; adapter saat ini belum punya alur reset — dicatat sebagai
  kekurangan di bawah) ATAU **login dengan Google** memakai email yang
  sama — Supabase otomatis menautkan identitas Google ke akun email
  yang sama.
- **Semua user harus login ulang sekali** (sesi/token lama tidak berlaku).
- **Data browser lokal** (localStorage mode lokal) tidak tersentuh —
  bila Supabase tidak terjangkau, toko jatuh ke mode lokal seperti biasa.
- **Katalog & pesanan lama**: saat ini 0 — tidak ada yang hilang.

## Kekurangan yang diketahui (belum dikerjakan di paket ini)

1. **Alur "Lupa password" belum ada** di frontend (backend lama juga
   tidak punya). Setelah migrasi, tambahkan: `supabase.auth.resetPasswordForEmail(email)`
   di halaman #/akun — kalau tidak, user lama yang lupa password tidak
   bisa masuk kecuali lewat Google.
2. **Upload foto produk** masih data URL base64 di kolom `photo`
   (seperti lama). Supabase Storage belum dipakai — di luar cakupan.
3. **Statistik admin** (`/api/stats`) dihitung client-side dari
   products+orders (`Supa.getStats()`) — cukup untuk katalog kecil;
   bila katalog membesar, ganti dengan RPC agregasi.
4. **Realtime** Supabase (live update tanpa refresh) belum dipakai —
   frontend tetap polling lewat `refreshServerData()` seperti lama.

## Risiko terbesar

1. **RLS salah konfigurasi → kredensial bocor.** Mitigasi: kredensial
   TIDAK ADA di tabel yang bisa dibaca pembeli (tabel terpisah +
   `order_creds` tanpa policy). WAJIB dites sebelum dibuka umum:
   login sebagai pembeli biasa → `select * from order_creds` dan
   `select * from product_creds` via API harus DITOLAK; kredensial
   hanya muncul lewat RPC reveal setelah lunas.
2. **Google OAuth redirect salah** → login Google gagal. Mitigasi:
   cek Site URL + Redirect URLs + callback di Google Console (Fase 2).
3. **Email confirmation menyala** → daftar tidak langsung masuk.
   Mitigasi: matikan di Fase 2.
4. **Webhook Midtrans masih mengarah ke URL lama** → pembayaran lunas
   tidak otomatis terkonfirmasi. Mitigasi: ubah Notification URL di
   Fase 3; Konfirmasi Lunas manual tetap tersedia sebagai cadangan.
5. **Free tier Supabase**: 500 MB database, 50.000 MAU/bulan, 500 ribu
   Edge Function invocations/bulan — cukup untuk toko baru; pantau di
   dashboard bila transaksi naik.

## Langkah yang harus dilakukan Tuan (ringkas)

1. Buat project Supabase baru "GankStore" (Fase 0) → kirim Project URL +
   anon key (atau isi langsung ke config.js saat apply).
2. Isi Client Secret Google di dashboard Supabase (Fase 2) — dari
   Google Cloud Console project GankStore.
3. Tentukan email admin toko (untuk SQL `is_admin`) + password akun
   demo baru.
4. Pasang secret Midtrans di Edge Function (Fase 3) + ubah Notification
   URL di dashboard Midtrans.
5. Tes di HP (Fase 4) — beri tahu hasil tiap poin checklist.
