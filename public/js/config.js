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
     toko otomatis jalan dalam mode lokal (localStorage + memori). */
  API_BASE: "",

  /* Daftar game tetap untuk Top Up (all game). Kalau user mengubah daftar,
     edit di sini DAN di backend/main.py (TOPUP_GAMES) supaya sama. */
  TOPUP_GAMES: [
    { name: "Mobile Legends",     currency: "Diamond",         needsServer: true,  serverLabel: "Server / Zone ID" },
    { name: "Free Fire",          currency: "Diamond",         needsServer: false, serverLabel: "" },
    { name: "PUBG Mobile",        currency: "UC",              needsServer: false, serverLabel: "" },
    { name: "Honor of Kings",     currency: "Token",           needsServer: true,  serverLabel: "Server ID" },
    { name: "Genshin Impact",     currency: "Genesis Crystal", needsServer: true,  serverLabel: "Server" },
    { name: "Roblox",             currency: "Robux",           needsServer: false, serverLabel: "" },
    { name: "Point Blank",        currency: "PB Cash",         needsServer: false, serverLabel: "" },
    { name: "Valorant",           currency: "Points",          needsServer: false, serverLabel: "" },
    { name: "Call of Duty: Mobile", currency: "CP",            needsServer: false, serverLabel: "" },
    { name: "EA Sports FC Mobile", currency: "FC Points",      needsServer: false, serverLabel: "" }
  ],

  /* Akun demo pembeli untuk review Midtrans (dibuat di server bila
     GS_SEED_DEMO=1). Bukan akun admin. Password-nya hanya ada di env
     server (GS_DEMO_PASSWORD), bukan di file ini. */
  DEMO_ACCOUNT_EMAIL: "demo@gankstore.my.id"
};
