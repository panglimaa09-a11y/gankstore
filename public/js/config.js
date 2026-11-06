/* GankStore — konfigurasi frontend.
   Satu-satunya tempat daftar game, tarif biaya admin, dan alamat API.
   JANGAN taruh API key / Server Key / password di file ini — kunci Midtrans
   hanya ada di environment variable server (lihat .env.example). */
window.GS_CONFIG = {
  /* Game untuk katalog akun (tetap Point Blank saja). */
  GAMES: ["Point Blank"],

  /* Biaya admin: 10% dari harga, berlaku untuk akun dan top up. */
  ADMIN_FEE_RATE: 0.10,

  /* Alamat API backend. "" = origin yang sama (saat disajikan backend
     Python). Saat dibuka sebagai file statis, fetch ke /api/* gagal dan
     toko otomatis jalan dalam mode lokal (localStorage + memori).
     Backend GankStore jalan di VM ini dan dipublikasikan lewat tunnel
     ngrok yang sama seperti /pb-ai dan /onerouter (route /gankstore-api
     di revproxy2.py). URL ini yang dipakai frontend Vercel. */
  API_BASE: "https://curvature-reunite-perfected.ngrok-free.dev/gankstore-api",

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
