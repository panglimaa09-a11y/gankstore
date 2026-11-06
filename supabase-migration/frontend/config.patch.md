# Patch `public/js/config.js` — Supabase

> Berlaku saat apply (PLAN.md Fase 4). JANGAN ubah config.js sekarang —
> file ini hanya instruksi + nilai yang harus diisi SETELAH project
> Supabase baru dibuat. Nilai `SUPABASE_URL` / `SUPABASE_ANON_KEY`
> diambil dari dashboard project baru (Settings → API). Anon key BOLEH
> tampil di browser (kunci publik, dibatasi RLS) — service_role key
> JANGAN PERNAH ditulis di sini.

## 1. Hapus blok `API_BASE` (ngrok — DITINGGALKAN TOTAL)

Hapus seluruh blok ini:

```js
  /* Alamat API backend. "" = origin yang sama ... */
  API_BASE: "https://curvature-reunite-perfected.ngrok-free.dev/gankstore-api",
```

Ganti dengan:

```js
  /* Backend Supabase (project BARU khusus GankStore — JANGAN pakai
     project RekberSTORE atau project lain yang sudah ada).
     Isi dari dashboard project baru: Settings → API → Project URL
     dan anon public key. Anon key BOLEH tampil di browser (kunci
     publik, dibatasi RLS). service_role key JANGAN PERNAH di sini. */
  SUPABASE_URL: "https://<PROJECT-REF>.supabase.co",
  SUPABASE_ANON_KEY: "<ANON-KEY-DARI-PROJECT-BARU>",
```

## 2. `TOPUP_MAINTENANCE` — tetap ada, tapi bukan lagi sumber utama

Nilai di config.js tetap `true` (default aman). Saat boot, adapter
(`supabase-api.js` → `initServer`) menimpa nilai ini dari tabel
`settings` Supabase (`topup_maintenance`). Mematikan maintenance:
ubah nilai di tabel settings (SQL / dashboard), BUKAN hanya di file ini.

## 3. `GOOGLE_CLIENT_ID` — tidak lagi dipakai frontend

Login Google kini lewat Supabase Auth (provider Google di dashboard),
bukan GIS. Blok `GOOGLE_CLIENT_ID` boleh DIHAPUS, atau dibiarkan dengan
komentar ini:

```js
  /* GOOGLE_CLIENT_ID di bawah ini peninggalan login GIS lama — TIDAK
     LAGI dipakai frontend. Client ID yang sama dipakai di dashboard
     Supabase (Authentication → Providers → Google). Client Secret
     hanya ada di dashboard Supabase, bukan di file ini. */
```

## 4. Yang TIDAK berubah

- `GAMES`, `ADMIN_FEE_RATE: 0.10`, `TOPUP_GAMES` (15 game), `DEMO_ACCOUNT_EMAIL`
- `ADMIN_EMAIL`: tetap dipakai mode lokal saja. Di mode Supabase, admin
  ditentukan `profiles.is_admin` (SQL, lihat PLAN.md) — bukan dari sini.
