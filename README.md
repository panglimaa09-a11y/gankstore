# GankStore — Toko Akun Point Blank & Top Up All Game

Toko online stok milik sendiri: jual **akun Point Blank** dan **top up all game**
(10 game). Pembeli pilih item → invoice terbit di dalam toko → bayar via
**Midtrans Snap** → admin konfirmasi lunas → akun diserahkan satu kali /
top up diproses manual.

> **Status Midtrans (6 Nov 2026): Sandbox dulu.** Akun Midtrans (FINORA)
> masih `Business review — In progress` (sudah 4+ bulan). Pembayaran
> Production **belum bisa jalan** sampai KYC disetujui. Website terdaftar
> sudah diubah ke `https://gankstore.my.id`, nama di halaman bayar sudah
> `GankStore`, redirect sukses/gagal sudah `https://gankstore.my.id/`.
> Lihat `docs` di bawah untuk cara eskalasi KYC.

## Bahasa yang dipakai

| Bahasa / teknologi | Dipakai untuk |
|---|---|
| **Python 3.10+ (FastAPI + Uvicorn)** — bahasa utama backend | API server: katalog, stok, order/invoice, auth, Midtrans Snap + webhook |
| **HTML** (`public/index.html`) | Struktur semua halaman (Beranda, Katalog, Detail, Cara Beli, Top Up, Akun, Panel Admin) |
| **CSS** (`public/css/style.css`, `public/css/hero.css`) | Semua styling; `hero.css` berisi gambar hero (optimasi 1600px) |
| **JavaScript** (`public/js/config.js`, `app.js`, `topup.js`, `payments.js`) | Routing hash, katalog, login, invoice, live tracking, top up, Snap |
| **SQL (SQLite)** (`backend/gankstore.db`) | Penyimpanan server pertama: user, stok, order, paket top up, aktivitas |
| **JSON** | Format API + konfigurasi |

Tidak ada framework frontend (React/Next.js) dan tidak ada server Node/PHP —
sengaja, supaya ringan dan gampang dibaca.

## Struktur repo

```
gankstore/
├── README.md
├── requirements.txt        # FastAPI + Uvicorn
├── .env.example            # contoh konfigurasi (JANGAN isi kunci asli di repo)
├── .gitignore
├── public/                 # frontend statis (juga disajikan backend di /)
│   ├── index.html          # struktur HTML saja — tanpa CSS/JS inline besar
│   ├── css/
│   │   ├── style.css       # semua CSS toko + top up
│   │   └── hero.css        # gambar hero (base64, file terpisah, di-cache)
│   └── js/
│       ├── config.js       # daftar game, tarif admin 10%, alamat API
│       ├── app.js          # toko akun: katalog, login, invoice, admin, live tracking
│       ├── topup.js        # top up all game: game, paket, order, admin paket
│       └── payments.js     # Midtrans Snap (Client Key saja; Server Key di server)
└── backend/
    ├── main.py             # aplikasi FastAPI + semua endpoint /api/*
    ├── store.py            # SQLite: user, produk, order, paket, aktivitas
    ├── midtrans.py         # Snap token + verifikasi signature webhook
    └── __init__.py
```

## Cara jalanin lokal

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # isi MIDTRANS_SERVER_KEY bila mau tes Snap asli
uvicorn backend.main:app --host 127.0.0.1 --port 8000
# buka http://127.0.0.1:8000
```

Tanpa `.env` pun server jalan (mode lokal + Midtrans belum terhubung).
Data tersimpan di `backend/gankstore.db` (di-ignore git).

**Mode statis:** `public/` bisa dibuka langsung sebagai file statis
(Vercel / hosting statis). Tanpa backend, toko jalan dalam mode lokal
(localStorage + memori, seperti versi `index.html` lama) — semua fitur
tampil, tapi data tidak tersimpan permanen dan pembayaran Midtrans mati.

## Fitur

- **Katalog akun Point Blank** — stok milik sendiri, cari/urut/filter status.
- **Login email + password** — daftar/masuk; Panel Admin terkunci di balik
  login. Versi pertama: semua user yang login bisa membuka Panel Admin
  (sama seperti versi statis) — peran admin khusus belum ada.
- **Order + invoice in-app** — klik Beli Sekarang → akun otomatis DIPESAN →
  invoice `INV-…` dengan **biaya admin 10%** (Rp1.000 → admin Rp100 →
  total Rp1.100). Admin **Konfirmasi Lunas** → TERJUAL; **Batalkan Pesanan**
  → akun tersedia lagi.
- **Serah terima kredensial satu kali** — admin wajib isi email + password
  akun game saat restok. Saat lunas, kredensial dipindah ke invoice pembeli,
  ditampilkan **satu kali** di halaman sukses, lalu otomatis terhapus dari
  stok maupun order.
- **Live tracking** — ticker berjalan, pop-up penjualan, Statistik & Live
  (kunjungan, lihat detail, klik Beli, funnel, feed aktivitas).
- **Top Up All Game** — halaman terpisah dari katalog akun. Game tetap:
  Mobile Legends, Free Fire, PUBG Mobile, Honor of Kings, Genshin Impact,
  Roblox, Point Blank, Valorant, Call of Duty: Mobile, EA Sports FC Mobile.
  Pilih paket → isi User ID (+ Server/Zone ID bila gamenya butuh) → invoice
  dengan biaya admin 10% yang sama → admin Konfirmasi Lunas → Selesai.
  Admin tambah / edit / hapus paket per game dari Panel Admin → Top Up.
  **Katalog top up mulai KOSONG** — paket asli diisi admin, jangan isi
  harga/paket palsu.
- **Midtrans Snap** — token Snap dibuat di server (`POST /api/payments/snap-token`),
  webhook diverifikasi signature SHA512 (`POST /api/payments/midtrans-webhook`).
  Server Key hanya dari environment variable, tidak pernah ada di repo/frontend.

## Jujur soal top up & pembayaran

- **Top up sungguhan (diamond/UC terkirim ke akun pembeli) belum otomatis.**
  Belum ada supplier/provider top up. Untuk sekarang alurnya: order → bayar
  (Midtrans Sandbox dulu) → **admin proses manual** ke User ID pembeli →
  tandai Selesai. Tulisan ini juga ada di halaman Top Up & Cara Beli.
- **Pembayaran asli belum bisa** sampai KYC Midtrans disetujui. Yang jalan
  sekarang: Sandbox (tes) + konfirmasi lunas manual oleh admin.
- **Akun demo untuk review Midtrans:** `demo@gankstore.my.id` — dibuat
  otomatis di server bila `GS_SEED_DEMO=1` (default). Ini akun **pembeli**,
  bukan admin. Password dari env `GS_DEMO_PASSWORD` (contoh: `Demo1234`).
  Ganti password itu sebelum toko dibuka untuk umum, atau set `GS_SEED_DEMO=0`.

## Deploy

- **Backend (utama):** jalankan di VPS dengan `uvicorn backend.main:app`
  (atau systemd). Arahkan domain `gankstore.my.id` ke server itu (HTTPS).
  Target Midtrans: website `https://gankstore.my.id` bisa diakses **13/11/2026**.
- **Frontend statis saja:** deploy isi `public/` ke Vercel (folder `public/`
  otomatis disajikan di root) — tapi tanpa backend, mode lokal saja.
- **Midtrans di dashboard:** website `https://gankstore.my.id`, redirect
  sukses/gagal `https://gankstore.my.id/`, Notification URL menunjuk ke
  webhook server ini (`/api/payments/midtrans-webhook`) setelah server live.

## Endpoint API (ringkas)

| Method & path | Keterangan |
|---|---|
| `GET /api/health` | Status server + Midtrans |
| `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me` | Akun pengguna (token Bearer) |
| `GET /api/products`, `POST /api/products`, `DELETE /api/products/{id}`, `POST /api/products/{id}/relist` | Stok akun |
| `GET /api/orders`, `POST /api/orders`, `POST /api/orders/{inv}/confirm`, `POST /api/orders/{inv}/cancel`, `GET /api/orders/{inv}/credentials` | Pesanan & invoice |
| `GET /api/topup/games`, `GET /api/topup/packages`, `POST/PUT/DELETE /api/topup/packages`, `POST /api/topup/orders` | Top up |
| `GET /api/stats`, `GET /api/activity` | Laporan & live tracking |
| `GET /api/payments/config`, `POST /api/payments/snap-token`, `POST /api/payments/midtrans-webhook` | Midtrans |
