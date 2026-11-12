/* GankStore — konfigurasi frontend.
   Satu-satunya tempat daftar game, tarif biaya admin, dan alamat API.
   JANGAN taruh API key / Server Key / password di file ini — kunci Midtrans
   hanya ada di environment variable server (lihat .env.example). */
window.GS_CONFIG = {
  /* Game untuk katalog akun (tetap Point Blank saja). */
  GAMES: ["Point Blank"],

  /* Biaya admin DEFAULT: 10% dari harga, berlaku untuk akun dan top up.
     Admin bisa mengubahnya lewat Pengaturan Toko — nilai di tabel
     settings (admin_fee_rate) yang dipakai server dan aplikasi. */
  ADMIN_FEE_RATE: 0.10,

  /* Top Up sedang MAINTENANCE (perintah Tuan, 6 Nov 2026): pembeli tidak
     bisa order top up sampai flag ini dimatikan — halaman #/topup dan
     #/topup/<game> menampilkan halaman maintenance, tombol order
     dinonaktifkan. Akun Point Blank tetap bisa dibeli normal.
     Untuk mengaktifkan lagi: ubah jadi false di sini DAN set
     GS_TOPUP_MAINTENANCE=0 di server, lalu restart service
     gankstore-backend. */
  TOPUP_MAINTENANCE: true,

  /* Backend Supabase (project BARU khusus GankStore — JANGAN pakai
     project RekberSTORE atau project lain yang sudah ada).
     Anon key BOLEH tampil di browser (kunci publik, dibatasi RLS).
     service_role key JANGAN PERNAH ditulis di file ini. */
  SUPABASE_URL: "https://fbncsifwelllkpvoxmfe.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmNzaWZ3ZWxsbGtwdm94bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NjY0MjQsImV4cCI6MjEwOTU0MjQyNH0.SdIgeFhxhYtCfaCY8kpA8e-DxdIqVC0dGjizLuEgrrM",

  /* GOOGLE_CLIENT_ID — dipakai login Google LANGSUNG (GIS, seperti
     RekberSTORE): tombol Google di #/akun dirender GIS dari
     gankstore.my.id, token ID diteruskan ke Supabase lewat
     signInWithIdToken — TANPA redirect hosted-OAuth Supabase, jadi
     layar pilih akun Google tertulis "Lanjutkan ke gankstore.my.id".
     Client ID adalah identifier publik (bukan secret). Client Secret
     hanya ada di dashboard Supabase (provider Google), bukan di
     file ini. */
  GOOGLE_CLIENT_ID: "308078866758-2qdr6ep644jpkm0e5jtu15vatgno14u0.apps.googleusercontent.com",

  /* Daftar game tetap untuk Top Up (all game). Kalau user mengubah daftar,
     edit di sini DAN di backend/main.py (TOPUP_GAMES) supaya sama.
     idLabel/idPlaceholder: label kolom identitas di form order per
     kategori (User ID untuk game, nomor HP untuk pulsa, dst). */
  TOPUP_GAMES: [
    { name: "Mobile Legends",     currency: "Diamond",         needsServer: true,  serverLabel: "Server / Zone ID", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "Free Fire",          currency: "Diamond",         needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "PUBG Mobile",        currency: "UC",              needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 5123456789" },
    { name: "Honor of Kings",     currency: "Token",           needsServer: true,  serverLabel: "Server ID", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "Genshin Impact",     currency: "Genesis Crystal", needsServer: true,  serverLabel: "Server", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 800123456" },
    { name: "Roblox",             currency: "Robux",           needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. nama_roblox" },
    { name: "Point Blank",        currency: "PB Cash",         needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "Valorant",           currency: "Points",          needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. nama#1234" },
    { name: "Call of Duty: Mobile", currency: "CP",            needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "EA Sports FC Mobile", currency: "FC Points",      needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },

    /* Produk digital lain (dari banner promo). Kategori KOSONG yang bisa
       diisi admin seperti paket top up game — JANGAN isi harga/paket palsu.
       Pulsa/PPOB/e-wallet masih diproses MANUAL dan butuh supplier PPOB
       (belum ada); jangan klaim otomatis. */
    { name: "Voucher Digital",       currency: "Voucher", needsServer: false, serverLabel: "", idLabel: "ID / Email penerima", idPlaceholder: "cth. nama@email.com" },
    { name: "Pulsa & Paket Data",    currency: "Pulsa",   needsServer: false, serverLabel: "", idLabel: "Nomor HP", idPlaceholder: "cth. 081234567890" },
    { name: "E-Wallet & PPOB",       currency: "Saldo",   needsServer: false, serverLabel: "", idLabel: "Nomor akun / ID pelanggan", idPlaceholder: "cth. 081234567890" },
    { name: "Item Game",             currency: "Item",    needsServer: false, serverLabel: "", idLabel: "User ID / ID Akun Game", idPlaceholder: "cth. 12345678" },
    { name: "Produk Digital Lainnya", currency: "Produk", needsServer: false, serverLabel: "", idLabel: "ID / keterangan penerima", idPlaceholder: "cth. ID atau email penerima" }
  ],

  /* Kunci publik VAPID untuk Web Push (bukan secret — kunci publik memang
     dibagikan ke browser supaya bisa berlangganan push). Kunci privatnya
     hanya ada di tabel push_settings Supabase (service_role saja) dan
     dibuat oleh Edge Function setup-push-keys. Diisi setelah setup. */
  VAPID_PUBLIC_KEY: "BGZnapxzxYRSQpUGn9y0zeILjx5GZ6jNN1TokvzEtX8dwDB_yLVFUGaQw0QTP5hQU3gsoWGbMbHRJKmFsj9-4m8",

  /* Alamat backend AI untuk live chat support (pb-ai, via tunnel ngrok).
     BUKAN secret — hanya URL publik. Dipakai support-chat.js untuk
     POST /support + polling GET /support/<job_id>. */
  SUPPORT_AI_URL: "https://curvature-reunite-perfected.ngrok-free.dev/pb-ai",

  /* Akun demo pembeli untuk review Midtrans (dibuat di server bila
     GS_SEED_DEMO=1). Bukan akun admin. Password-nya hanya ada di env
     server (GS_DEMO_PASSWORD), bukan di file ini. */
  DEMO_ACCOUNT_EMAIL: "demo@gankstore.my.id",

  /* Email admin toko — dipakai mode lokal (statis, tanpa backend) untuk
     menentukan siapa yang boleh melihat Panel Admin. HARUS sama dengan
     GS_ADMIN_EMAIL di server (bila env itu kosong, server memakai
     demo@gankstore.my.id sebagai admin SEMENTARA — lihat README).
     Kalau GS_ADMIN_EMAIL diganti ke email Tuan, ubah juga nilai di sini. */
  ADMIN_EMAIL: "demo@gankstore.my.id"
};
