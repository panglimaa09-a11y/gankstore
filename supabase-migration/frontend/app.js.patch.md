# Patch `public/js/app.js` — Supabase

> Berlaku saat apply (PLAN.md Fase 4). Nomor baris mengacu pada
> `app.js` per 6 Nov 2026 (head `ae5c4cce` + perbaikan retry Google).
> Cari berdasarkan nama fungsi, bukan nomor baris buta — nomor bisa
> bergeser bila ada commit lain sebelum apply.

## Langkah 1 — Ganti blok `apiToken` / `setToken` / `api()`

Lokasi: sekitar baris 18–29 (`function apiToken(){...}` sampai akhir
`function api(path,opts){...}`).

Ganti SELURUH blok itu dengan bagian 1–2 dari
`frontend/supabase-api.js` (dari `function apiToken()` sampai akhir
`function api(path, opts){...}`).

## Langkah 2 — Ganti `healthOnce()` dan `initServer()`

Lokasi: sekitar baris 46–100 (`function healthOnce(){...}` dan
`function initServer(attempt){...}`).

Ganti SELURUH kedua fungsi itu dengan bagian 3–4 dari
`frontend/supabase-api.js` (`function healthOnce()` dan
`function initServer(attempt)`).

Catatan: blok komentar ngrok di `healthOnce` lama ikut terhapus —
sudah tidak relevan (ngrok ditinggalkan total).

## Langkah 3 — Ganti blok login Google

Lokasi: sekitar baris 669–737 — dari komentar
`/* ---------- login Google (GIS + backend) ---------- */` sampai
akhir IIFE tombol `googleRetryBtn`.

Hapus fungsi-fungsi ini (tidak dipakai lagi):
- `googleNonce()`
- `handleGoogleCredential(resp)`

Ganti `initGoogleSignIn()` dengan bagian 5 dari
`frontend/supabase-api.js` (termasuk deklarasi
`var _googleTries` / `var _googleServerRetried` di atasnya).

BIARKAN IIFE tombol `googleRetryBtn` apa adanya — ia memanggil
`initServer()` + `initGoogleSignIn()` yang baru, dan memakai variabel
`_googleTries` / `_googleServerRetried` yang ikut disalin.

## Langkah 4 — Satu perubahan kecil di handler Daftar

Lokasi: `registerForm` submit → `.catch(function(){ formError("registerError", "Email ini sudah terdaftar, ...") })`.

Ubah menjadi:

```js
}).catch(function(e){ formError("registerError", e && e.message === "needs_confirmation" ? "Akun dibuat — cek email kamu untuk konfirmasi, lalu masuk." : "Email ini sudah terdaftar, atau server tidak bisa dihubungi."); });
```

Alasan: bila "Confirm email" masih AKTIF di project Supabase (seharusnya
dimatikan — lihat PLAN.md), daftar berhasil tapi belum bisa langsung
masuk. Pesan ini yang tampil, bukan pesan "sudah terdaftar" yang salah.

## Langkah 5 — Yang TIDAK disentuh

- `var Server = {...}`, `var API_BASE = ...` → HAPUS baris `API_BASE`
  (tidak dipakai lagi; `api()` baru tidak membacanya).
- `serverProductToLocal` / `serverOrderToLocal` / `serverPackageToLocal`
- `currentUser()` / `isAdminUser()` / `renderAuth()` / `afterLogin()`
- Semua `api("/api/...")` di app.js, topup.js, payments.js
- Seluruh alur lokal (localStorage) — tetap jalan bila Supabase tidak
  terjangkau (`Server.enabled = false`).
- Blok boot di akhir file (`initServer().then(...)`) — tidak berubah.

## Verifikasi setelah patch

```bash
node --check public/js/app.js
node --check public/js/supabase-client.js
node --check public/js/config.js
node --check public/js/topup.js
node --check public/js/payments.js
```

Lalu tes di HP (PLAN.md Fase 4): login Google, login email, beli
akun (tamu + login), Konfirmasi Lunas, tampil kredensial sekali,
tambah/hapus stok admin, kirim pesan support, Top Up tetap maintenance.
