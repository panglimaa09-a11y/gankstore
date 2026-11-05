# GankStore

Toko akun game Point Blank, stok sendiri.

## Isi repo

- `index.html` — seluruh toko dalam satu file statis (Beranda, Katalog, Detail Akun, Cara Beli, Akun/Login, Panel Admin, Invoice).
- Stok ditambah lewat Panel Admin (judul, rank, level, server, isi akun, harga, foto, plus email + password akun game).
- Checkout: invoice in-app, biaya admin 10% (contoh: harga Rp1.000 → admin Rp100 → total Rp1.100).
- Login masih lokal dulu (email + password, tersimpan per-browser). Tombol Google tampil tapi nonaktif sampai ada versi server.

## Deploy

- Static hosting apa pun / Vercel: deploy `index.html` sebagai root.
- Domain: https://gankstore.my.id (sudah dibeli 6 Nov 2026, IDwebhost).
- Target website https bisa diakses untuk Midtrans: 13/11/2026.

## Pembayaran

- Midtrans dipilih sebagai gateway pengganti Pakasir (Pakasir tutup 25 Nov 2026).
- **Status: pembayaran Midtrans masih menunggu KYC approve.** Akun Midtrans sudah ada, tapi KYC sudah 4+ bulan masih proses review dan belum di-approve — pembayaran asli belum bisa jalan, hanya Sandbox.
- Sampai KYC approve, checkout memakai invoice in-app; konfirmasi lunas dilakukan admin, lalu kredensial akun game ditampilkan sekali ke pembeli dan otomatis terhapus dari stok.
