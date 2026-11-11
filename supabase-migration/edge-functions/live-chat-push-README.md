# Live chat tanpa AI + push notification PWA

Perintah Tuan 12 Nov 2026 ~00:38 WIB: chat support **tidak pakai AI** —
pembeli chat langsung dengan admin, dan PWA harus bisa memberi
**notifikasi di HP walau aplikasi tidak dibuka**.

## Cara kerja

1. **Widget chat** (`public/js/support-chat.js`): pembeli kirim pesan →
   tersimpan di `live_chats` + `live_chat_messages`. Widget mengecek
   balasan admin tiap 3 detik selama panel terbuka. Riwayat tersimpan di
   localStorage (id chat UUID) + server.
2. **Halaman admin `#/admin/chat`**: daftar percakapan (urut aktivitas
   terbaru) + balas langsung + tandai selesai. Di halaman yang sama ada
   panel **Notifikasi HP**: tombol "Aktifkan notifikasi" (langganan Web
   Push perangkat ini), "Kirim notifikasi tes", "Matikan".
3. **Edge Function `send-push`**: menerima Database Webhook, lalu
   mengirim Web Push (paket `npm:web-push`) ke semua perangkat admin
   yang berlangganan:
   - INSERT `live_chat_messages` (sender=buyer) → "Pesan baru — Live Chat"
   - INSERT `orders` → "Pesanan baru INV-..."
   - Invoke langsung `{test:true}` → notifikasi tes.
   Langganan yang kedaluwarsa (HTTP 410/404) dihapus otomatis.
4. **Edge Function `setup-push-keys`**: membuat kunci VAPID sekali saja
   (ECDH P-256 lewat WebCrypto). Public key dikembalikan (masuk ke
   `js/config.js` sebagai `VAPID_PUBLIC_KEY` — bukan secret). Private key
   HANYA tersimpan di tabel `push_settings` (tidak ada policy untuk
   anon/authenticated — hanya service_role yang bisa baca) dan **tidak
   pernah ditampilkan** di chat, file, atau memory.
5. **Service worker** (`public/sw.js`): handler `push` menampilkan
   notifikasi; `notificationclick` membuka halaman admin yang benar
   (`#/admin/chat` atau `#/admin/stok`).

## Yang dibutuhkan (sekali saja)

1. **Terapkan migrasi** `supabase-migration/sql/09_live_chat_push.sql`
   (tabel live_chats, live_chat_messages, push_subscriptions,
   push_settings + RLS + trigger).
2. **Deploy `setup-push-keys`** (dashboard → Edge Functions → Create,
   paste `index.ts`), invoke sekali, salin `public_key` yang
   dikembalikan → isi `VAPID_PUBLIC_KEY` di `public/js/config.js`.
3. **Deploy `send-push`** (nama `send-push`, paste `index.ts`).
4. **Buat 2 webhook** (dashboard → Database → Webhooks → Create,
   tipe "Supabase Edge Functions"):
   - Tabel `live_chat_messages`, event `INSERT` →
     `https://fbncsifwelllkpvoxmfe.supabase.co/functions/v1/send-push`
   - Tabel `orders`, event `INSERT` → URL yang sama.
   Header Authorization **biarkan default** (service-role) — fungsi ini
   butuh baca tabel push_settings/push_subscriptions.
5. **Tuan, di HP (Chrome asli, bukan dari aplikasi chat)**: login admin →
   buka `#/admin/chat` → ketuk "Aktifkan notifikasi" → izinkan.
   Lalu ketuk "Kirim notifikasi tes" — HP harus bergetar walau aplikasi
   ditutup. Kalau izin pernah ditolak: aktifkan di pengaturan browser
   (ikon gembok → Site settings → Notifications).

## Catatan

- Tanpa langganan aktif, `send-push` mengembalikan `{sent: 0}` — bukan
  error. Notifikasi pesanan juga masuk email (fungsi send-order-email)
  sebagai cadangan.
- Chat pembeli anonim (UUID tidak bisa ditebak). Admin tidak bisa
  menghubungi pembeli yang sudah menutup tab — tautan WhatsApp tetap ada
  di footer widget sebagai jalan keluar.
