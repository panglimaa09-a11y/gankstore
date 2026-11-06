# Edge Function Midtrans — GankStore

Menggantikan `POST /api/payments/snap-token`, `POST /api/payments/midtrans-webhook`,
dan `GET /api/payments/config` dari backend FastAPI lama.

## Prasyarat

- Project Supabase BARU khusus GankStore sudah dibuat (PLAN.md Fase 0)
  dan SQL 01–04 sudah dijalankan.
- Supabase CLI terpasang (`npm i -g supabase` — atau pakai npx), lalu:

```bash
cd ~/workspace/gankstore-fullstack/supabase-migration
supabase link --project-ref <PROJECT-REF-BARU>
```

## Pasang secret (JANGAN tulis nilai key di file / chat)

Nilai diambil dari dashboard Midtrans (Settings → Access Keys) dan
dashboard project — ketik langsung di perintah di bawah (nilai TIDAK
akan tersimpan di repo):

```bash
supabase secrets set MIDTRANS_SERVER_KEY='<SERVER-KEY>'
supabase secrets set MIDTRANS_CLIENT_KEY='<CLIENT-KEY>'
supabase secrets set MIDTRANS_IS_PRODUCTION=0
```

- `MIDTRANS_IS_PRODUCTION=0` = Sandbox (saat ini — KYC masih review).
  Ubah ke `1` HANYA bila KYC Midtrans sudah disetujui.
- Server Key RAHASIA — hanya sebagai secret Edge Function. Client Key
  boleh tampil di browser.

## Deploy

```bash
supabase functions deploy midtrans --project-ref <PROJECT-REF-BARU>
```

URL function:

```
https://<PROJECT-REF-BARU>.supabase.co/functions/v1/midtrans
```

Tes (ganti `<ANON-KEY>` dengan anon key project baru):

```bash
curl -s https://<PROJECT-REF-BARU>.supabase.co/functions/v1/midtrans/config \
  -H "apikey: <ANON-KEY>" -H "Authorization: Bearer <ANON-KEY>"
# Harusnya: {"configured":true,"is_production":false,"client_key":"<CLIENT-KEY>"}
```

## Arahkan webhook Midtrans ke function ini

Di dashboard Midtrans (Settings → Configuration):

- **Payment Notification URL (Production dan Sandbox)** →

  ```
  https://<PROJECT-REF-BARU>.supabase.co/functions/v1/midtrans/webhook
  ```

  URL lama (`https://calfycwinpjkxxokirbr.supabase.co/functions/v1/midtrans-webhook`,
  project Supabase lain) JANGAN dipakai lagi — itu bukan project GankStore.
- **Finish Redirect URL** tetap `https://gankstore.my.id` (tanpa trailing
  slash — sudah benar sejak 6 Nov 2026).

## Catatan

- Rute di `index.ts` dicocokkan dengan `endsWith` supaya tetap jalan
  baik saat path membawa prefix `/functions/v1/midtrans` maupun tidak.
- Snap token hanya diberikan ke pemilik pesanan atau admin (dicek dari
  JWT Supabase). Pesanan tamu (tanpa login) tetap boleh — sama seperti
  backend lama.
- Webhook memverifikasi `signature_key` SHA512 dengan Server Key
  sebelum mengubah apa pun; signature salah → 401, tidak ada efek.
- Logika konfirmasi webhook di sini DUPLIKASI `confirm_order()` SQL —
  bila salah satu diubah, ubah juga yang lain.
