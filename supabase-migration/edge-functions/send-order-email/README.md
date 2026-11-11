# Email otomatis pesanan GankStore

Setiap ada pesanan baru, dan setiap bukti pembayaran diunggah, email otomatis
terkirim ke **nexorateam44@gmail.com** berisi rincian invoice — dan foto bukti
sebagai lampiran bila sudah diunggah.

## Cara kerja

1. **Edge Function** `send-order-email` (file `index.ts` ini) menerima webhook
   dari database, lalu mengirim email lewat **Resend**.
2. **Database Webhook** di Supabase: tabel `orders`, event `INSERT` + `UPDATE`,
   POST ke URL function dengan header `Authorization: Bearer <anon key>`.

## Yang dibutuhkan (sekali saja)

1. **Akun Resend gratis** — daftar di https://resend.com pakai email
   `nexorateam44@gmail.com` (tanpa kartu). Lalu **API Keys → Create API Key**,
   permission **Sending access**. Simpan key-nya (cuma tampil sekali).
2. **Deploy function** ke Supabase (dashboard → Edge Functions → Create,
   nama `send-order-email`, paste isi `index.ts`), lalu set secret
   `RESEND_API_KEY` (dashboard → Edge Functions → Secrets).
3. **Buat webhook**: dashboard → Database → Webhooks → Create webhook.
   - Tabel: `orders`, event: `INSERT` dan `UPDATE`
   - URL: `https://fbncsifwelllkpvoxmfe.supabase.co/functions/v1/send-order-email`
   - Header: `Authorization: Bearer <anon key project GankStore>`
4. **Tes**: buat pesanan baru dari katalog → cek inbox
   `nexorateam44@gmail.com` (dan folder Spam). Lalu unggah bukti di invoice
   → email kedua masuk dengan foto terlampir.

## Catatan

- Pengirim bawaan Resend: `onboarding@resend.dev` (tanpa domain sendiri).
  Tanpa domain terverifikasi, Resend hanya boleh mengirim ke email yang
  dipakai saat daftar — di sini penerimanya memang `nexorateam44@gmail.com`,
  jadi aman. Kalau nanti mau pengirim `noreply@gankstore.my.id`, verifikasi
  domain di Resend (tambah TXT DNS) dan ubah `FROM` di `index.ts`.
- Kuota gratis Resend: 100 email/hari, 3.000/bulan — jauh di atas volume toko.
- Webhook hanya bereaksi pada `INSERT` (pesanan baru) dan `UPDATE` yang
  mengubah `proof_image`. Konfirmasi lunas / batal tidak mengirim email.
