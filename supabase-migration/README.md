# Migrasi GankStore → Supabase

Perintah Tuan 6 Nov 2026 20:13 WIB: backend pindah dari VM+ngrok ke
Supabase. Jalur **Cloudflare Tunnel DIBATALKAN**, jalur **ngrok
DITINGGALKAN TOTAL**. Paket ini berisi SEMUA yang dibutuhkan untuk
apply — tapi **BELUM DI-APPLY**: tidak ada project yang dibuat, tidak
ada SQL yang dijalankan, tidak ada kode yang di-push.

## Isi paket

| File | Isi |
|---|---|
| `AUDIT.md` | Audit lengkap: semua tabel, semua endpoint, pemakaian `api()` per halaman, aturan bisnis yang dipertahankan |
| `PLAN.md` | **Baca ini dulu saat apply.** Urutan Fase 0–5, checklist tes HP, rollback, dampak user lama, risiko, langkah Tuan |
| `sql/01_schema.sql` | Tabel: profiles, products, product_creds, orders, order_creds, topup_packages, activity, support_messages, settings + sequence invoice + trigger user baru |
| `sql/02_rls.sql` | Row Level Security + grants. Kredensial akun game TIDAK PERNAH bisa dibaca pembeli |
| `sql/03_functions.sql` | Fungsi RPC: buat order akun/top up, konfirmasi lunas, batalkan, hapus/pajang ulang stok, tampil kredensial SEKALI |
| `sql/04_settings_seed.sql` | Seed settings (Top Up maintenance = true, daftar 15 game, status Midtrans) |
| `sql/05_data_migration_notes.sql` | Catatan migrasi data SQLite (saat ini: 0 produk/order/paket — praktis tidak ada yang dipindah) |
| `frontend/supabase-client.js` | Klien Supabase + helper `Supa.*` (auth, produk, pesanan, paket, support, Midtrans) |
| `frontend/supabase-api.js` | Pengganti blok `api()`/auth/Google di `app.js` (penerjemah REST lama → Supabase, call site tidak berubah) |
| `frontend/config.patch.md` | Perubahan `config.js` (SUPABASE_URL + ANON KEY placeholder, hapus API_BASE ngrok) |
| `frontend/index.html.patch.md` | Tambah CDN supabase-js, hapus script GIS, urutan script |
| `frontend/app.js.patch.md` | Blok app.js yang diganti + satu perubahan kecil handler Daftar |
| `edge-functions/midtrans/index.ts` | Edge Function: Snap token + webhook + config (pengganti `midtrans.py`) |
| `edge-functions/midtrans/README.md` | Deploy + secrets + Notification URL Midtrans |

## Keputusan desain utama

1. **Kredensial akun game dipisah dari tabel utama** (`product_creds`,
   `order_creds`). RLS saja tidak cukup — RLS itu per-baris, bukan
   per-kolom; pembeli yang membaca baris pesanannya sendiri akan ikut
   melihat kolom kredensial. Dengan tabel terpisah + `order_creds`
   tanpa policy baca sama sekali, satu-satunya jalan adalah fungsi
   `reveal_order_credentials()` yang membaca + menghapus dalam satu
   transaksi (tampil sekali, seperti backend lama).
2. **Login Google lewat Supabase Auth OAuth** (provider Google, Client
   ID "GankStore Web" yang sama). GIS + verifikasi JWKS offline +
   `/api/auth/google` dihapus total. Client Secret hanya di dashboard
   Supabase — tidak pernah di file.
3. **Semua call site `api()` tidak berubah.** Yang diganti hanya
   implementasi `api()` + boot + tombol Google. Risiko regresi paling
   kecil.
4. **Mode lokal tetap ada.** Bila Supabase tidak terjangkau, toko jatuh
   ke localStorage seperti biasa.
5. **Biaya admin 10% dipertahankan** (`round(harga * 0.10)`), Top Up
   tetap **maintenance**, admin vs user tetap dipisah tegas
   (`profiles.is_admin` via SQL — fallback "demo = admin" DIHAPUS).

## Yang masih menunggu project baru

- Project Supabase baru "GankStore" (Fase 0) — **BELUM ADA**.
  Dilarang memakai project RekberSTORE atau project lain yang ada.
- Setelah project ada: jalankan SQL 01–04 → Auth Google → Edge
  Function → patch frontend → tes HP (checklist di PLAN.md Fase 4).

## Verifikasi yang sudah dilakukan di paket ini

- SQL 01–04 lolos parser Postgres asli (`pglast` / libpg_query).
- `supabase-client.js` dan `supabase-api.js` lolos `node --check`.
- TIDAK ada yang di-apply ke project mana pun (tidak ada projectnya),
  TIDAK ada push ke GitHub.
