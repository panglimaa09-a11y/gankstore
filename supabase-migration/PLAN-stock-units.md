# Desain — Stok GankStore jadi stok barang beneran (unit stok)

Perintah Tuan 6 Nov 2026 23:08 WIB: *"Harusnya buat stoknya itu bisa
ditambah jangan ngandalin cuma 1 aja lalu bikin baru jadi metodenya
seperti stok order/barang. Kalau point blank itu bukan email tapi
username+password."*

Dokumen ini menjelaskan model baru. Implementasi: `sql/06_stock_units.sql`
(apply setelah 01–04; file 05 hanya catatan migrasi data, bukan file
apply). Frontend: `public/js/app.js`, `public/js/supabase-client.js`,
`public/css/style.css`, `public/index.html` (+ salinan paket di
`supabase-migration/frontend/`). Edge Function Midtrans ikut diperbarui
(`edge-functions/midtrans/index.ts`).

## 1. Masalah model lama

Satu baris `products` = satu akun, satu kredensial di `product_creds`
(1:1). Beli → produk `dipesan`; lunas → produk `terjual` + kredensial
dihapus. Listing mati. Mau jual akun sejenis lagi → admin harus bikin
listing BARU dari nol (judul, harga, foto, deskripsi diulang). Itu yang
Tuan tolak: stok harus bisa **ditambah** ke listing yang sudah ada,
seperti stok barang/order biasa.

Masalah kedua: kredensial disimpan sebagai **email** + password, padahal
login Point Blank memakai **username** + password.

## 2. Model baru

```
products        = LISTING (judul, game, rank, level, server, harga,
                  foto, deskripsi, specs). TIDAK lagi mewakili 1 akun.
stock_units     = UNIT STOK (1 baris = 1 akun PB yang dijual)
  id, product_id FK -> products (cascade),
  cred_user  (username PB — BUKAN email),
  cred_pass  (password),
  status     ('tersedia' | 'dipesan' | 'terjual'),
  order_invoice (invoice yang mengklaim unit ini, null bila bebas),
  created_at
orders          = tidak berubah bentuk (invoice, kind, product_id,
                  status dipesan/terjual/dibatalkan, cred_pending,
                  cred_revealed). Satu order akun = 1 unit.
order_creds     = kredensial menunggu diambil pembeli (1:1 dengan
                  orders). Kolom cred_email DIGANTI NAMA jadi cred_user
                  (data dipertahankan — rename kolom, bukan hapus).
product_creds   = DITINGGALKAN (deprecated). Isinya dipindah ke
                  stock_units saat apply 06, lalu barisnya dihapus.
                  Tabelnya dibiarkan kosong untuk jaga-jaga; boleh
                  di-DROP pada migrasi berikutnya.
```

### Status listing (`products.status`) — cerminan jumlah unit

Status TIDAK lagi diubah manual oleh RPC beli/lunas/batal. Sebuah
trigger (`stock_units_status_sync`) menghitung ulang status listing
setiap kali unit berubah:

| Kondisi unit | `products.status` |
|---|---|
| ada unit `tersedia` | `tersedia` |
| 0 tersedia, ada unit `dipesan` | `dipesan` |
| 0 tersedia/dipesan, ada unit `terjual` | `terjual` |
| 0 unit sama sekali | `habis` (nilai baru — CHECK constraint diperluas) |

Listing **tetap hidup** selama stok > 0. Habis terjual semua → status
`terjual`; admin tambah stok → trigger mengembalikan ke `tersedia`.

### Keamanan (dipertahankan dari migrasi 01–03)

- `stock_units`: RLS aktif + policy **admin saja** (pola sama seperti
  `product_creds` dulu). Pembeli tidak bisa SELECT/INSERT/UPDATE/
  DELETE lewat API. Admin membaca unit lewat REST (Daftar Stok).
- `order_creds`: tetap TANPA policy baca sama sekali — hanya RPC
  `reveal_order_credentials()` (baca + hapus satu transaksi).
- Klaim unit saat beli HARUS atomik: `create_account_order` mengunci
  satu unit `tersedia` (`FOR UPDATE SKIP LOCKED`) — dua pembeli yang
  klik bersamaan tidak bisa dapat unit yang sama.
- Jumlah stok publik (berapa unit tersedia) BOLEH tampil — itu bukan
  rahasia. Disediakan RPC `get_stock_counts()` (SECURITY DEFINER, hanya
  angka per produk, tanpa kredensial) yang boleh dipanggil anon.
- Admin = `profiles.is_admin` (tidak berubah). Biaya admin 10%
  (tidak berubah). Login Google GIS + `signInWithIdToken` (tidak
  berubah).

## 3. Alur baru

### Tambah listing baru (admin, `#/admin/tambah`)
Form sama seperti dulu, tapi field kredensial jadi **Username** +
Password (validasi: username wajib diisi, BUKAN format email).
Listing dibuat dengan **1 unit stok awal** (username+password itu).
Kalau admin mau langsung 3 unit, buat listing dulu lalu tambah 2 unit
lewat Daftar Stok.

### Tambah stok ke listing yang ada (admin, `#/admin/stok`)
Per kartu listing ada form "Tambah Stok": N baris, tiap baris
Username + Password, tombol "+ Tambah baris", submit "Tambah Stok".
Satu submit = N unit `tersedia` baru (RPC `add_stock_units`, admin
saja). Listing yang tadinya `terjual`/`habis` otomatis kembali
`tersedia` begitu ada unit baru (trigger).

### Beli (pembeli)
Klik Beli → `create_account_order` mengklaim 1 unit `tersedia`
(termurah = id terkecil) → unit jadi `dipesan` + `order_invoice`
terisi, invoice terbit. Listing tetap `tersedia` dan **tetap bisa
dibeli** selama sisa unit > 0. Kalau unit tersedia 0 → tombol Beli
nonaktif: "Stok habis" (belum pernah ada stok / semua terjual) atau
"Dipesan" (semua unit sedang dipesan orang lain).

### Konfirmasi Lunas (admin, per invoice — bukan per produk)
Di Daftar Stok, tiap listing menampilkan **pesanan aktif**-nya
(invoice `dipesan` untuk listing itu) masing-masing dengan tombol
Konfirmasi Lunas / Batalkan. Lunas → `confirm_order`: unit yang
terikat invoice itu jadi `terjual`, kredensialnya (username+password)
pindah ke `order_creds`, `orders.cred_pending = true`. Pembeli
membuka halaman sukses → `reveal_order_credentials` menampilkan
username+password **satu kali** lalu menghapusnya (sama seperti dulu,
hanya labelnya berubah dari "Email akun" jadi "Username").
Batalkan → `cancel_order`: unit kembali `tersedia`, `order_invoice`
dikosongkan, kredensial tetap di stok.

### Hapus
- Hapus unit: admin boleh menghapus unit yang masih `tersedia` saja
  (RPC `delete_stock_unit`). Unit `dipesan`/`terjual` tidak bisa
  dihapus (terikat pesanan).
- Hapus listing: ditolak bila ada unit `dipesan` atau order `dipesan`
  (sama seperti dulu). Unit ikut terhapus (cascade).

## 4. Migrasi data lama (saat apply 06)

Katalog live saat ini berisi **1 produk** (Rp800.000, status
`tersedia`, kredensial email `986qqrb@gmail.com`). Migrasi di dalam
file 06 (satu transaksi — gagal di satu langkah = semua batal):

1. Untuk tiap baris `product_creds` yang kredensialnya tidak kosong:
   buat 1 baris `stock_units` dengan `cred_user = cred_email` lama,
   `cred_pass` sama, `status` mengikuti status produk (`tersedia` →
   `tersedia`; `dipesan` → `dipesan` + `order_invoice` = invoice aktif
   produk itu; `terjual` → tidak ada kredensial yang tersisa untuk
   dipindah — sudah pindah ke `order_creds` saat lunas dulu).
   **Nilai email lama menjadi username unit** — Tuan perlu tahu:
   username unit hasil migrasi ini adalah `986qqrb@gmail.com` (apa
   adanya dari data lama). Kalau username PB aslinya berbeda, admin
   bisa hapus unit itu dan tambah unit baru dengan username yang benar.
2. Verifikasi di dalam transaksi: jumlah unit yang dibuat HARUS sama
   dengan jumlah baris `product_creds` yang dimigrasi — bila tidak,
   `RAISE EXCEPTION` (rollback).
3. Hapus baris `product_creds` yang sudah dipindah.
4. Hitung ulang `products.status` semua listing dari unitnya.

Tidak ada data order lama yang berubah bentuk; `order_creds` yang
sudah ada hanya ganti nama kolom (isinya tetap).

## 5. Tampilan

- Katalog & Beranda: kartu menampilkan **"Stok: N"** (unit tersedia).
  Tombol Beli nonaktif bila stok 0 ("Stok habis" / "Dipesan" /
  "Terjual").
- Detail akun: baris "Stok tersedia: N unit" + tombol Beli dengan
  aturan yang sama. Teks penyerahan kredensial: "username &
  password" (bukan "email & password").
- Daftar Stok (admin, kartu vertikal — perbaikan bug layout screenshot
  23:04 WIB dipertahankan: kartu tumpuk, kredensial baris sendiri
  lebar penuh, tanpa `word-break:break-all`):
  - Header: foto, judul, harga, ringkasan "Stok: A tersedia ·
    B dipesan · C terjual".
  - Pesanan aktif (bila ada): tiap invoice + tombol Konfirmasi Lunas /
    Batalkan.
  - Daftar unit: tiap unit = username (terlihat), password (tertutup
    `••••••` + tombol "Lihat"), chip status, tombol Hapus (hanya bila
    `tersedia`).
  - Form Tambah Stok (N baris username+password).
  - Hapus listing.
- Dasbor admin: "Total listing", "Total unit stok", "Stok tersedia",
  "Dipesan", "Terjual" — dihitung dari unit, bukan dari status produk.

## 6. Mode lokal (tanpa server)

Bila Supabase tidak terjangkau, frontend tetap jalan dengan unit di
memori: tiap produk membawa `units: [{username, password,
status}]`; beli/lunas/batal/tambah-stok memakai logika yang sama
(klaim unit pertama yang tersedia, kembalikan bila batal). Perilaku
UI identik dengan mode server; data lokal hilang saat reload (seperti
dulu — mode lokal memang tidak persisten).

## 7. Cara apply (dilakukan parent, SETELAH persetujuan Tuan)

1. Buka SQL Editor project Supabase **GankStore**
   (`fbncsifwelllkpvoxmfe`) sebagai postgres, jalankan
   `supabase-migration/sql/06_stock_units.sql` SEKALI. File ini
   idempotent sebisa mungkin (`IF NOT EXISTS`, `CREATE OR REPLACE`,
   guard `DO` untuk rename kolom & migrasi data) — aman dijalankan
   ulang bila gagal di tengah jalan, kecuali langkah migrasi data
   yang sudah menghapus `product_creds` (langkah itu hanya jalan
   bila masih ada baris untuk dipindah).
2. Verifikasi di SQL Editor:
   ```sql
   select * from public.stock_units order by id;
   select id, title, status from public.products;
   select * from public.order_creds;
   ```
   Harus terlihat: 1 unit (`cred_user = '986qqrb@gmail.com'`,
   status `tersedia`) untuk produk Rp800.000, produk tetap
   `tersedia`.
3. Deploy Edge Function Midtrans yang diperbarui
   (`supabase-migration/edge-functions/midtrans/index.ts`) — wajib
   BERSAMAAN dengan apply SQL, karena versi lama masih membaca
   `product_creds` dan menulis `order_creds.cred_email` (kolom itu
   sudah diganti nama). Sampai Edge Function baru ter-deploy,
   webhook Midtrans akan error — tapi pembayaran lunas manual
   (Konfirmasi Lunas admin) tetap jalan karena itu memakai RPC SQL.
4. Push frontend (commit baru) → Vercel redeploy otomatis.
5. Tes HP Tuan: tambah stok ke listing → "Stok: N" naik; beli 1
   unit → stok berkurang 1, listing tetap bisa dibeli; lunas →
   username+password tampil sekali di halaman sukses.

## 8. Yang TIDAK berubah

Login (GIS + `signInWithIdToken`), biaya admin 10%, Top Up
maintenance, aturan admin/user tegas, teks publik lain, format nomor
invoice, nama tabel `products`/`orders`/`order_creds` (kecuali rename
kolom `cred_email` → `cred_user` di `order_creds`), dan keamanan
tampil-sekali kredensial.
