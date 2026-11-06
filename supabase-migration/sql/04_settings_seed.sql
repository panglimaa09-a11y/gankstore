-- =====================================================================
-- GankStore — migrasi backend ke Supabase (project BARU khusus GankStore)
-- File 04: seed tabel settings
-- Jalankan SETELAH 03_functions.sql. Aman diulang (ON CONFLICT DO NOTHING).
--
-- topup_maintenance = 'true'  → Top Up MASIH maintenance (perintah Tuan
--                                6 Nov 2026). Matikan dengan:
--   update public.settings set value = 'false'
--   where key = 'topup_maintenance';
--   (hanya admin; frontend membaca flag ini saat boot)
-- topup_games = daftar game top up, disamakan dengan GS_CONFIG.TOPUP_GAMES
--               di public/js/config.js (dipakai validasi needsServer di
--               fungsi create_topup_order).
-- midtrans_*  = penanda status Midtrans. Client key BOLEH tampil di
--               browser. Server Key TIDAK PERNAH di sini — hanya secret
--               Edge Function (lihat edge-functions/midtrans/README.md).
-- =====================================================================

insert into public.settings (key, value) values
  ('topup_maintenance', 'true'),
  ('midtrans_configured', 'false'),
  ('midtrans_production', 'false'),
  ('midtrans_client_key', ''),
  ('topup_games', '[
    {"name":"Mobile Legends","currency":"Diamond","needsServer":true,"serverLabel":"Server / Zone ID","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"Free Fire","currency":"Diamond","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"PUBG Mobile","currency":"UC","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 5123456789"},
    {"name":"Honor of Kings","currency":"Token","needsServer":true,"serverLabel":"Server ID","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"Genshin Impact","currency":"Genesis Crystal","needsServer":true,"serverLabel":"Server","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 800123456"},
    {"name":"Roblox","currency":"Robux","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. nama_roblox"},
    {"name":"Point Blank","currency":"PB Cash","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"Valorant","currency":"Points","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. nama#1234"},
    {"name":"Call of Duty: Mobile","currency":"CP","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"EA Sports FC Mobile","currency":"FC Points","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"Voucher Digital","currency":"Voucher","needsServer":false,"serverLabel":"","idLabel":"ID / Email penerima","idPlaceholder":"cth. nama@email.com"},
    {"name":"Pulsa & Paket Data","currency":"Pulsa","needsServer":false,"serverLabel":"","idLabel":"Nomor HP","idPlaceholder":"cth. 081234567890"},
    {"name":"E-Wallet & PPOB","currency":"Saldo","needsServer":false,"serverLabel":"","idLabel":"Nomor akun / ID pelanggan","idPlaceholder":"cth. 081234567890"},
    {"name":"Item Game","currency":"Item","needsServer":false,"serverLabel":"","idLabel":"User ID / ID Akun Game","idPlaceholder":"cth. 12345678"},
    {"name":"Produk Digital Lainnya","currency":"Produk","needsServer":false,"serverLabel":"","idLabel":"ID / keterangan penerima","idPlaceholder":"cth. ID atau email penerima"}
  ]')
on conflict (key) do nothing;
