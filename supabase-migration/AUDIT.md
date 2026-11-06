# Audit — Backend GankStore lama (FastAPI + SQLite) → Supabase

Sumber: `backend/store.py` (837 baris), `backend/main.py` (709 baris),
`backend/midtrans.py` (104 baris), `backend/google_auth.py` (98 baris),
`public/js/app.js` (855 baris), `public/js/topup.js` (408 baris),
`public/js/payments.js` (74 baris), `public/js/config.js` (73 baris).
Head repo: `ae5c4cce` (+ perbaikan retry Google, belum push).

## 1. Tabel SQLite lama → tabel Postgres baru

| SQLite (`store.py`) | Postgres baru (`sql/01_schema.sql`) | Perubahan |
|---|---|---|
| `users` (id, name, email, pass_hash, salt, is_admin, google_sub, created_at) | `auth.users` (dikelola Supabase Auth) + `profiles` (id uuid FK auth.users, email, name, is_admin, created_at) | **Password PBKDF2 TIDAK bisa dipindah.** `pass_hash`/`salt` dibuang. `google_sub` dibuang (identitas Google tinggal di `auth.identities`). `sessions` dibuang (sesi diurus Supabase Auth). `is_admin` tetap, tapi hanya diisi lewat SQL pemilik toko. |
| `sessions` (token_hash, user_id, created_at) | — (dihapus) | Sesi Supabase Auth (JWT, refresh otomatis). |
| `products` (id, game, title, rank, level, server, price, specs TEXT-JSON, description, photo, status, cred_email, cred_pass, cred_wiped, created_at) | `products` (sama, minus kredensial; `specs` jsonb; `description` tetap) + `product_creds` (product_id PK, cred_email, cred_pass) | **Kredensial dipisah ke tabel sendiri** (RLS admin saja). `cred_wiped` tidak perlu disimpan — ketiadaan baris `product_creds` = sudah terhapus. |
| `orders` (id, invoice_no, kind, product_id, package_id, title, game, rank, price, fee, total, photo, buyer_name, buyer_email, user_id_game, server_id, package_name, amount, currency, status, cred_pending, cred_email, cred_pass, cred_revealed, created_at, updated_at) | `orders` (sama, minus cred_email/cred_pass; tambah `buyer_id` uuid FK auth.users, null untuk tamu) + `order_creds` (invoice_no PK, cred_email, cred_pass — TANPA policy baca) | `cred_pending`/`cred_revealed` dipertahankan sebagai penanda boolean (bukan rahasia). |
| `topup_packages` (id, game, name, amount, currency, price, created_at) | `topup_packages` (sama persis) | — |
| `activity` (id, time, tag, text, created_at) | `activity` (sama persis) | — |
| `counters` (name, value) | sequence `invoice_seq` (mulai 1000) | Nomor invoice tetap `INV-YYYYMMDD-HHMMSS-<seq>`. |
| `support_messages` (id, name, contact, topic, message, status, created_at) | `support_messages` (sama persis) | — |
| — (baru) | `settings` (key PK, value, updated_at) | Saklar toko: `topup_maintenance`, `topup_games` (JSON 15 game), `midtrans_configured`, `midtrans_production`, `midtrans_client_key`. |

Data lama saat ini (6 Nov 2026): **0 produk, 0 order, 0 paket, 1 user
(demo)** — praktis tidak ada data toko yang perlu dipindah. Lihat
`sql/05_data_migration_notes.sql` untuk prosedur bila ada data nanti.

## 2. Endpoint FastAPI lama → padanan Supabase

| Endpoint lama | Auth lama | Padanan Supabase | Catatan |
|---|---|---|---|
| `GET /api/health` | publik | `Supa.getHealth()` (settings + Edge Function /config) | Mode jadi `"supabase"`. Dipakai probe boot. |
| `GET /api/payments/config` | publik | Edge Function `GET /config` | — |
| `GET /api/stats` | admin | `Supa.getStats()` (hitung dari products+orders) | **Tidak dipakai frontend** — tidak ada `api("/api/stats")` di JS. Disediakan untuk kelengkapan. |
| `GET /api/activity` | opsional login | `select activity` (RLS: baca publik) | — |
| `POST /api/support` | publik | `insert support_messages` (RLS: insert publik) | Topik divalidasi CHECK di DB. |
| `GET /api/support` | admin | `select support_messages` (RLS: admin) | — |
| `POST /api/support/:id/replied` | admin | `update support_messages set status='dibalas'` (RLS: admin) | — |
| `POST /api/auth/register` | publik | `supabase.auth.signUp` + trigger `handle_new_user()` | Password diurus Supabase Auth. Perhatian: konfirmasi email harus dimatikan (PLAN.md). |
| `POST /api/auth/login` | publik | `supabase.auth.signInWithPassword` | — |
| `POST /api/auth/google` | publik (GIS credential) | **DIHAPUS** — `supabase.auth.signInWithOAuth({provider:'google'})` | JWKS offline + `google_auth.py` tidak dipakai lagi. Client ID sama, Secret di dashboard Supabase. |
| `POST /api/auth/logout` | login | `supabase.auth.signOut()` | — |
| `GET /api/auth/me` | login | `supabase.auth.getSession()` + `select profiles` | — |
| `GET /api/products` | opsional (kredensial hanya admin) | `select products` (+ `product_creds` bila admin) | RLS: produk baca publik; kredensial admin saja. |
| `POST /api/products` | admin | `insert products` + `insert product_creds` (RLS: admin) | Validasi email/password kredensial tetap di frontend + CHECK DB. |
| `DELETE /api/products/:id` | admin | RPC `delete_product` | Tolak bila ada order `dipesan` (409 lama). |
| `POST /api/products/:id/relist` | admin | RPC `relist_product` | Peringatan kredensial kosong tetap di frontend. |
| `GET /api/orders[?kind=]` | login | `select orders` (RLS: pemilik atau admin) | — |
| `POST /api/orders` | opsional (tamu boleh) | RPC `create_account_order` | Atomik + fee 10% + invoice. Tamu: buyer_id null. |
| `POST /api/orders/:inv/confirm` | admin | RPC `confirm_order` | Pindah kredensial produk → order_creds, hapus dari stok. |
| `POST /api/orders/:inv/cancel` | admin | RPC `cancel_order` | Produk kembali tersedia, kredensial tetap di stok. |
| `GET /api/orders/:inv/credentials` | login (pemilik/admin) | RPC `reveal_order_credentials` | Tampil SEKALI (baca + hapus satu transaksi); sudah tampil → `already_revealed` (410 lama). |
| `GET /api/topup/games` | publik | `GS_CONFIG.TOPUP_GAMES` (statis) | **Tidak dipakai frontend** — daftar game sudah di config.js. |
| `GET /api/topup/packages[?game=]` | publik | `select topup_packages` (RLS: baca publik) | — |
| `POST /api/topup/packages` | admin | `insert topup_packages` (RLS: admin) | Currency dari daftar game (validasi di adapter via settings). |
| `PUT /api/topup/packages/:id` | admin | `update topup_packages` (RLS: admin) | — |
| `DELETE /api/topup/packages/:id` | admin | `Supa.deletePackage` (cek order aktif dulu) | Tolak bila ada order topup `dipesan` (409 lama). |
| `POST /api/topup/orders` | opsional (tamu boleh) | RPC `create_topup_order` | Tolak bila `topup_maintenance` (503 lama); cek `needsServer` dari settings. |
| `POST /api/payments/snap-token` | opsional | Edge Function `POST /snap-token` | Cek pemilik/admin via JWT; payload Midtrans sama persis. |
| `POST /api/payments/midtrans-webhook` | signature Midtrans | Edge Function `POST /webhook` | Verifikasi SHA512; logika lunas/batal sama persis. |

## 3. Pemakaian `api()` di frontend (semua call site tetap — hanya `api()` yang diganti)

| Halaman / modul | Endpoint yang dipakai |
|---|---|
| Boot `initServer()` (app.js) | health, products, orders, topup/packages, activity, auth/me, payments/config |
| `refreshServerData()` (app.js) | products, orders, topup/packages |
| Beli akun `trackBuy()` (app.js) | POST orders |
| Halaman sukses — ambil kredensial (app.js) | GET orders/:inv/credentials |
| Tambah Akun (app.js) | POST products |
| Daftar Stok — Lunas / Batal / Pajang lagi / Hapus (app.js) | POST orders/:inv/confirm, POST orders/:inv/cancel, POST products/:id/relist, DELETE products/:id |
| Masuk / Daftar / Keluar (app.js) | POST auth/login, POST auth/register, POST auth/logout |
| Login Google (app.js) | POST auth/google → **diganti OAuth Supabase** |
| Hubungi Support (app.js) | POST support |
| Pesan Support admin (app.js) | GET support, POST support/:id/replied |
| Top Up — buat order (topup.js) | POST topup/orders |
| Top Up — admin paket (topup.js) | DELETE topup/packages/:id, PUT/POST topup/packages; proses pesanan: POST orders/:inv/confirm, POST orders/:inv/cancel |
| Pembayaran (payments.js) | GET payments/config, POST payments/snap-token |

## 4. Aturan bisnis yang dipertahankan (dicek terhadap kode lama)

- **Biaya admin 10%**: `adminFee = Math.round(price * 0.10)` (app.js:149)
  → `round(price * 0.10)::integer` di fungsi RPC. Satu catatan:
  Postgres membulatkan 0.5 ke atas, Python membulatkan ke genap —
  untuk harga kelipatan Rp1.000 hasilnya identik.
- **Kredensial tampil sekali**: `reveal_order_credentials()` baca +
  hapus dalam satu transaksi (dulu `reveal_order_credentials()` di
  `store.py` + endpoint `/credentials`).
- **Admin vs user tegas**: `profiles.is_admin` (SQL) menggantikan
  `GS_ADMIN_EMAIL` + fallback demo. Fallback "demo = admin" DIHAPUS.
- **Top Up maintenance**: `settings.topup_maintenance = 'true'`
  (dulu `GS_TOPUP_MAINTENANCE=1` + `TOPUP_MAINTENANCE: true`).
- **Tamu boleh beli** (tanpa login): RPC create_* mengizinkan `anon`.
- **Katalog mulai kosong, paket top up mulai kosong**: tidak ada seed
  produk/paket palsu (prinsip lama).
- **Daftar game top up**: 15 game, sama persis dengan `TOPUP_GAMES`
  (config.js) — disalin ke `settings.topup_games`.

---

## 5. Model stok unit (perintah Tuan 6 Nov 2026 23:08 WIB — `sql/06_stock_units.sql`, desain: `PLAN-stock-units.md`)

Model lama (01–03): 1 baris `products` = 1 akun, 1 kredensial di
`product_creds` (1:1). Listing mati setelah terjual — admin harus
bikin listing baru. Model baru: `products` = LISTING, stok = banyak
unit di `stock_units`.

### 5.1 Tabel baru / berubah

| Baru / berubah | Isi | Perubahan |
|---|---|---|
| `stock_units` (baru) | id, product_id FK products (cascade), cred_user (USERNAME PB, bukan email), cred_pass, status ('tersedia'/'dipesan'/'terjual'), order_invoice FK orders (set null), created_at | RLS aktif + policy admin saja (pola `product_creds` dulu). Pembeli tidak bisa baca lewat API. |
| `products.status` | CHECK diperluas: 'tersedia', 'dipesan', 'terjual', **'habis'** (baru: 0 unit sama sekali) | Status jadi cerminan jumlah unit — dihitung ulang trigger `stock_units_status_sync` → `refresh_product_status()` setiap unit berubah. RPC beli/lunas/batal TIDAK lagi mengubah status produk manual. |
| `order_creds.cred_email` | diganti nama → `cred_user` | Rename kolom (data tetap). |
| `product_creds` | DEPRECATED | Isinya dipindah ke `stock_units` saat apply 06 (cred_email lama menjadi cred_user unit — mis. produk live Rp800.000 mendapat unit username `986qqrb@gmail.com`), lalu barisnya dihapus. Tabel dibiarkan kosong. |

### 5.2 Fungsi RPC — ganti / baru (06, `CREATE OR REPLACE`)

| Fungsi | Perubahan dari 03 |
|---|---|
| `get_stock_counts()` (baru) | Jumlah unit per produk (angka saja, tanpa kredensial). Boleh anon — dipakai badge "Stok: N" di katalog. |
| `add_stock_units(product_id, units jsonb)` (baru) | Admin menambah N unit `[{username, password}]` ke listing yang ada. Satu transaksi; trigger mengembalikan status listing ke 'tersedia'. |
| `delete_stock_unit(unit_id)` (baru) | Admin menghapus 1 unit yang masih 'tersedia' saja. |
| `create_account_order(product_id)` | Klaim 1 unit 'tersedia' (`FOR UPDATE SKIP LOCKED`, atomik) → unit 'dipesan' + `order_invoice`. Listing tetap bisa dibeli selama sisa unit > 0. |
| `confirm_order(invoice)` | Unit yang terikat invoice jadi 'terjual'; username+password-nya pindah ke `order_creds`. |
| `cancel_order(invoice)` | Unit kembali 'tersedia', `order_invoice` dikosongkan; kredensial tetap di stok. |
| `delete_product(product_id)` | Tolak bila ada unit 'dipesan' ATAU order 'dipesan'. |
| `relist_product(product_id)` | Tidak lagi "pajang lagi" — hanya menghitung ulang status dari unit (kompatibilitas; tombolnya dihapus dari UI). |
| `reveal_order_credentials(invoice)` | Kunci kembalian 'username' (bukan 'email'). Tampil sekali (baca + hapus satu transaksi) — tidak berubah. |

### 5.3 Frontend (live) — perubahan

| Area | Perubahan |
|---|---|
| `supabase-client.js` | `listProducts()` menggabungkan jumlah stok via `get_stock_counts()` (bukan lagi `product_creds`); baru: `listStockUnits()`, `addStockUnits()`, `deleteStockUnit()`; `createProduct()` memakai `p.units`; `getStats()` pendapatan akun dari order terjual + hitung unit. |
| `app.js` | `pStatus()` diturunkan dari jumlah unit; `trackBuy()` klaim unit; kartu katalog + detail menampilkan "Stok: N" dan tombol Beli nonaktif bila stok 0 ("Stok habis"/"Dipesan"/"Terjual"); form Tambah Akun memakai **Username** (bukan email); Daftar Stok baru per listing: ringkasan stok, pesanan aktif per invoice (Lunas/Batal), daftar unit (username terlihat, password tertutup + Lihat, hapus bila tersedia), form Tambah Stok N baris; halaman sukses/invoice memakai label "Username"; `totalRevenue()` dari order terjual. |
| `index.html` | `fCredEmail` → `fCredUser` (type text, placeholder username); teks hint + intro Daftar Stok menyebut username & Tambah Stok; filter status tambah opsi "Stok habis". |
| `style.css` | Kelas baru `.stock-line`, `.stock-sec-title`, `.stock-order-row`, `.unit-row`, `.unit-chip`, `.add-stock*`, `.dlg-stock` — kartu tumpuk vertikal (perbaikan bug huruf-per-baris 23:04 WIB). |
| Edge Function Midtrans | `confirmOrderPaid`/`cancelOrderPaid` memakai `stock_units` + `order_creds.cred_user`; TIDAK lagi mengubah `products.status` langsung (trigger yang mengurus). WAJIB deploy bersamaan dengan apply SQL 06. |

### 5.4 Aturan bisnis yang tetap

Biaya admin 10%, kredensial tampil sekali, admin/user tegas,
Top Up maintenance, tamu boleh beli, login Google GIS +
`signInWithIdToken` — semuanya tidak berubah.
