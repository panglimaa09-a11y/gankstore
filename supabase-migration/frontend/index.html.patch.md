# Patch `public/index.html` — Supabase

> Berlaku saat apply (PLAN.md Fase 4).

## 1. Hapus script Google Identity Services (baris ~16)

Hapus:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

Login Google kini lewat Supabase Auth — tidak ada lagi GIS, tidak ada
lagi tombol Google yang dirender script Google.

## 2. Tambah script Supabase (sebelum `js/config.js`, sekitar baris 750)

Ubah blok:

```html
<script src="js/config.js"></script>
<script src="js/app.js"></script>
<script src="js/topup.js"></script>
<script src="js/payments.js"></script>
```

Menjadi:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/config.js"></script>
<script src="js/supabase-client.js"></script>
<script src="js/app.js"></script>
<script src="js/topup.js"></script>
<script src="js/payments.js"></script>
```

Catatan:
- `supabase-client.js` = salinan `frontend/supabase-client.js` dari
  paket migrasi ini (ditaruh di `public/js/`).
- `supabase-api.js` TIDAK dimuat terpisah — isinya ditempel ke `app.js`
  sesuai `app.js.patch.md`.
- Bila CDN supabase-js gagal dimuat (offline), `Supa.ready = false`,
  probe gagal, dan toko jatuh ke mode lokal seperti biasa — tidak ada
  halaman rusak.

## 3. Yang TIDAK berubah

- `#googleBtnWrap`, `#googleMsg`, `#googleRetryBtn` (dipakai ulang oleh
  tombol Google baru dari adapter).
- `#midtransStatus` (diisi `loadPaymentsConfig()` seperti biasa).
- Semua id/halaman lain.
