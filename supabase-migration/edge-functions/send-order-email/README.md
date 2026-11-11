# Email otomatis pesanan GankStore

Setiap ada pesanan baru, dan setiap bukti pembayaran diunggah, email otomatis
terkirim ke **panglimaa09@gmail.com** berisi rincian invoice — dan foto bukti
sebagai lampiran bila sudah diunggah.

## Cara kerja

1. **Edge Function** `send-order-email` (file `index.ts` ini) menerima webhook
   dari database, lalu mengirim email lewat **Resend**.
2. **Database Webhook** di Supabase: tabel `orders`, event `INSERT` + `UPDATE`,
   POST ke URL function dengan header `Authorization: Bearer <anon key>`.

## Yang dibutuhkan (sekali saja)

1. **Akun Resend gratis** — daftar di https://resend.com (akun saat ini
   terdaftar atas `panglimaa09@gmail.com`, jadi tanpa domain terverifikasi
   email hanya bisa dikirim ke alamat itu). Lalu **API Keys → Create API Key**,
   permission **Sending access**. Simpan key-nya (cuma tampil sekali).
2. **Deploy function** ke Supabase (dashboard → Edge Functions → Create,
   nama `send-order-email`, paste isi `index.ts`), lalu set secret
   `RESEND_API_KEY` (dashboard → Edge Functions → Secrets).
3. **Buat webhook**: dashboard → Database → Webhooks → Create webhook.
   - Tabel: `orders`, event: `INSERT` dan `UPDATE`
   - URL: `https://fbncsifwelllkpvoxmfe.supabase.co/functions/v1/send-order-email`
   - Header: `Authorization: Bearer <anon key project GankStore>`
4. **Tes**: panggil function dengan payload webhook tiruan (lihat di bawah),
   atau buat pesanan baru dari katalog → cek inbox `panglimaa09@gmail.com`
   (dan folder Spam). Lalu unggah bukti di invoice → email kedua masuk
   dengan foto terlampir.

## Tes function langsung (tanpa pesanan sungguhan)

POST ke URL function dengan header `Authorization: Bearer <anon key>` dan
body JSON seperti ini:

```json
{"type": "INSERT", "record": {"invoice_no": "INV-TEST-001", "kind": "akun", "title": "D1 polos", "game": "Point Blank", "rank": "Diamond 1", "price": 25000, "fee": 2500, "total": 27500, "buyer_name": "Pembeli Tes", "buyer_email": "tes@example.com", "status": "dipesan", "created_at": "2026-11-11T12:00:00Z"}}
```

Harus mengembalikan HTTP 200 dan email tes masuk ke `panglimaa09@gmail.com`.

## Catatan

- Pengirim bawaan Resend: `onboarding@resend.dev` (tanpa domain sendiri).
  Tanpa domain terverifikasi, Resend hanya boleh mengirim ke email yang
  dipakai saat daftar — di sini penerimanya memang `nexorateam44@gmail.com`,
  jadi aman. Kalau nanti mau pengirim `noreply@gankstore.my.id`, verifikasi
  domain di Resend (tambah TXT DNS) dan ubah `FROM` di `index.ts`.
- Kuota gratis Resend: 100 email/hari, 3.000/bulan — jauh di atas volume toko.
- Webhook hanya bereaksi pada `INSERT` (pesanan baru) dan `UPDATE` yang
  mengubah `proof_image`. Konfirmasi lunas / batal tidak mengirim email.
