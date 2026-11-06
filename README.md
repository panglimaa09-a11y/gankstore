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
│   ├── icon.png            # IKON APLIKASI (kotak, neon cyan-ungu) — favicon + PWA
│   ├── logo.png            # alias logo utama (horizontal)
│   ├── banner.png          # alias banner promo (hero Beranda)
│   ├── manifest.json       # manifest PWA (name GankStore, standalone)
│   ├── brand/
│   │   ├── gankstore-logo.png    # LOGO UTAMA (horizontal, tagline Marketplace Digital & Top Up Game)
│   │   └── gankstore-banner.png  # BANNER PROMOSI (hero Beranda, 1774x887)
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

## Aset brand (logo, ikon, banner)

| Aset | File di repo | Dipakai di |
|---|---|---|
| **Logo utama** (horizontal, G + mahkota + keranjang, tagline "Marketplace Digital & Top Up Game") | `public/brand/gankstore-logo.png` (+ alias `public/logo.png`) | Header (tinggi 40px desktop / 32px HP — dibatasi di CSS, jangan tampil ukuran asli), hero, halaman login, footer |
| **Ikon aplikasi** (kotak, neon cyan-ungu) | `public/icon.png` | Favicon, `apple-touch-icon`, manifest PWA |
| **Banner promosi** ("Top Up Game & Produk Digital — Lebih Murah, Cepat, dan Aman!") | `public/brand/gankstore-banner.png` (+ alias `public/banner.png`) | Hero banner Beranda (lebar penuh, tinggi mengikuti lebar, tidak terpotong di HP) |

> **Catatan pengiriman file PNG:** file `*.png` di atas adalah biner dan
> TIDAK bisa dikirim lewat `push-files` (hanya menerima UTF-8). Kalau di
> remote belum ada, upload lewat **GitHub web UI** (Add file → Upload files)
> — jangan klaim sudah ter-push sebelum ukurannya terverifikasi sama dengan
> file aslinya. File teks (HTML/CSS/JS/manifest) tetap bisa lewat push-files.

## Kategori Top Up & Produk Digital

Selain 10 game (Mobile Legends, Free Fire, PUBG Mobile, Honor of Kings,
Genshin Impact, Roblox, Point Blank, Valorant, Call of Duty: Mobile,
EA Sports FC Mobile), ada 5 kategori produk digital lain: **Voucher
Digital, Pulsa & Paket Data, E-Wallet & PPOB, Item Game, Produk Digital
Lainnya**. Semuanya **mulai KOSONG** dan bisa diisi admin lewat Panel Admin
→ Paket Top Up (pilih kategorinya di form yang sama).

> **Jujur:** pulsa/PPOB/e-wallet **belum bisa diproses otomatis** — butuh
> supplier PPOB dan belum ada. Sampai ada supplier, semua pesanan kategori
> ini diproses **manual oleh admin** setelah pembayaran lunas, sama seperti
> top up game. Jangan klaim otomatis di mana pun.

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
- **Login email + password** — daftar/masuk; Panel Admin **disembunyikan
  dari user biasa**: tombol "Buka Panel Admin" di halaman Akun hanya
  tampil bila yang login adalah admin, route `#/admin*` mengarahkan
  non-admin (dan yang belum login) ke `#/akun`, dan endpoint admin di
  server menolak non-admin dengan 403. Admin ditentukan dari env
  `GS_ADMIN_EMAIL`; bila env kosong, admin **sementara** adalah akun
  demo `demo@gankstore.my.id` — ganti ke email Tuan + ganti password
  demo sebelum toko dibuka untuk umum (lihat "Peran admin" di bawah).
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
  otomatis di server bila `GS_SEED_DEMO=1` (default). Password dari env
  `GS_DEMO_PASSWORD` (contoh: `Demo1234`). Ganti password itu sebelum
  toko dibuka untuk umum, atau set `GS_SEED_DEMO=0`.

## Support Service (Jarvis — Support GankStore)

- Halaman Bantuan terpisah (`#/bantuan`): cara beli singkat, cara cek
  pesanan/invoice, cara klaim data akun yang sudah lunas, kebijakan
  (admin fee 10%, kredensial tampil sekali lalu terhapus, top up manual),
  FAQ, dan form Hubungi Support.
- Agen support: **Jarvis — Support GankStore**. Layanan pelanggan
  dibantu Jarvis; admin toko yang menindaklanjuti pesanan dan
  pembayaran. Kontak langsung tercepat: WhatsApp
  **089681992892** (`wa.me/6289681992892`) dan Telegram admin toko.
- Form Hubungi Support (nama, kontak email/WA, topik, pesan) tersimpan
  ke database server (tabel `support_messages`, endpoint
  `POST /api/support` — tanpa login) dan dibaca admin di Panel Admin →
  Pesan Support (`GET /api/support`, admin saja), lalu ditandai sudah
  dibalas (`POST /api/support/{id}/replied`). **Tidak dikirim ke pihak
  ketiga dan tidak ada balasan otomatis instan.** Bila backend tidak
  terhubung (mode lokal/statis), pesan tersimpan di perangkat dan
  halaman Bantuan menuliskannya dengan jujur.
- FAQ di halaman Bantuan jujur soal Midtrans: pembayaran Production
  masih menunggu aktivasi KYC — yang jalan Sandbox + Konfirmasi Lunas
  manual admin.

## Peran admin (Panel Admin disembunyikan dari user biasa)

- Admin toko ditentukan dari env **`GS_ADMIN_EMAIL`** (lihat
  `.env.example`). Bila env itu **kosong**, server memakai
  `demo@gankstore.my.id` sebagai admin **SEMENTARA** supaya toko tetap
  bisa dikelola — ini sengaja, bukan lupa: akun demo itu juga dipakai
  reviewer Midtrans. **Sebelum toko dibuka untuk umum: isi
  `GS_ADMIN_EMAIL` dengan email Tuan, ganti password demo, lalu restart
  server** (`systemctl restart gankstore-backend`). Begitu env diisi
  email lain, akun demo otomatis kehilangan peran admin. Samakan juga
  `ADMIN_EMAIL` di `public/js/config.js` supaya mode lokal/statis ikut
  aturan yang sama.
- Yang dijaga: tombol "Buka Panel Admin" di halaman Akun hanya tampil
  untuk admin; route `#/admin*` mengarahkan non-admin ke `#/akun`;
  endpoint admin (`POST/DELETE /api/products`, `relist`, konfirmasi
  lunas, batalkan, `POST/PUT/DELETE /api/topup/packages`, `/api/stats`)
  menolak non-admin dengan **403**; daftar produk untuk non-admin tidak
  menyertakan kredensial akun game; daftar pesanan non-admin hanya
  pesanannya sendiri (tanpa kredensial); kredensial sekali pakai hanya
  boleh diambil admin atau pembeli pesanan itu sendiri.

## Deploy

- **Backend (live):** FastAPI jalan sebagai service systemd `gankstore-backend`
  di VM ini, port 127.0.0.1:8773, database SQLite di `backend/gankstore.db`
  (di `~/workspace`, selamat dari restart VM). Pasang ulang setelah VM
  replacement dengan `bash deploy/install.sh` (sebagai root — `/etc` itu
  ephemeral, unit systemd hilang tiap replacement). Publik lewat tunnel
  ngrok yang sama seperti `/pb-ai`: route `/gankstore-api` di `revproxy2.py`
  → `https://curvature-reunite-perfected.ngrok-free.dev/gankstore-api`.
  Frontend Vercel (`config.js` → `API_BASE`) memanggil alamat itu; CORS
  hanya mengizinkan origin `gankstore.my.id`, `www.gankstore.my.id`,
  `gankstore.vercel.app`, dan domain ngrok di atas.
- **Frontend:** isi `public/` di-deploy ke Vercel (Output Directory `public`),
  custom domain `gankstore.my.id` (DNS IDwebhost: A `@` → `76.76.21.21`,
  CNAME `www` → `8a79a59656f45113.vercel-dns-017.com`). Vercel auto-deploy
  setiap push ke `main`.
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
| `POST /api/support`, `GET /api/support`, `POST /api/support/{id}/replied` | Pesan support (kirim tanpa login; baca/tandai admin saja) |
| `GET /api/payments/config`, `POST /api/payments/snap-token`, `POST /api/payments/midtrans-webhook` | Midtrans |
