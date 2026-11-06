/* GankStore — pengganti blok api()/auth/Google di public/js/app.js
   ================================================================
   ISI FILE INI MENGGANTIKAN blok-blok berikut di app.js (bukan file
   yang dimuat terpisah — lihat frontend/app.js.patch.md untuk nomor
   baris & cara tempel yang tepat):
     - apiToken() / setToken()
     - api(path, opts)              -> penerjemah REST lama -> Supa.*
     - healthOnce()                 -> probe Supabase (bukan /api/health)
     - initServer(attempt)          -> sama, tapi flag Top Up dibaca dari
                                       settings Supabase
     - handleGoogleCredential()     -> DIHAPUS (GIS tidak dipakai lagi)
     - googleNonce()                -> DIHAPUS (nonce diurus Supabase Auth)
     - initGoogleSignIn()           -> tombol "Lanjutkan dengan Google"
                                       (Supabase Auth OAuth)
   Yang TIDAK berubah: semua pemanggil api() di app.js / topup.js /
   payments.js, mapper serverProductToLocal / serverOrderToLocal /
   serverPackageToLocal, currentUser() / isAdminUser() / renderAuth() /
   afterLogin(), dan seluruh alur lokal (mode tanpa server).
   File ini berdiri sendiri secara sintaks (node --check lolos) — tapi
   ia memakai global dari app.js (Server, Supa, showToast, ...) dan
   HANYA benar bila ditempel ke app.js sesuai patch doc.
*/
"use strict";

/* ---------- token (kompatibilitas: Supabase yang menyimpan sesi) ---------- */
function apiToken(){ try { return (window.Supa && Supa.getAccessToken()) || localStorage.getItem("gankstore_token"); } catch (e) { return window.Supa ? Supa.getAccessToken() : null; } }
function setToken(t){ try { if (t) localStorage.setItem("gankstore_token", t); else localStorage.removeItem("gankstore_token"); } catch (e) {} }

/* ---------- api(): REST lama -> Supabase ----------
   Bentuk kembalian dipertahankan sama seperti backend FastAPI lama
   (snake_case, invoice_no, buyer_email, cred_email, ...) supaya
   mapper & pemanggil di app.js/topup.js/payments.js tidak berubah.
   Error dilempar sebagai Error(message); pesan RPC Postgres berisi
   kode singkat (mis. 'forbidden', 'topup_maintenance',
   'already_revealed', 'product_not_available'). */
function api(path, opts){
  /* Supa.* bisa throw sinkron bila klien belum ada (CDN gagal dimuat).
     Semua pemanggil memakai .catch() — kembalikan rejected promise,
     jangan throw sinkron. */
  try { return apiImpl(path, opts); }
  catch (e) { return Promise.reject(e); }
}
function apiImpl(path, opts){
  opts = opts || {};
  var method = opts.method || "GET";
  var body = opts.body || null;
  var qi = path.indexOf("?");
  var base = qi >= 0 ? path.slice(0, qi) : path;
  var query = qi >= 0 ? path.slice(qi + 1) : "";
  function qparam(name){
    var m = query.match(new RegExp("(?:^|&)" + name + "=([^&]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function seg(i){ var p = base.split("/"); return p[i] || ""; }
  function isAdmin(){ return !!(typeof Server !== "undefined" && Server.user && Server.user.is_admin); }

  /* --- health & config --- */
  if (base === "/api/health" && method === "GET") return Supa.getHealth();
  if (base === "/api/payments/config" && method === "GET") return Supa.getPaymentsConfig();
  if (base === "/api/topup/games" && method === "GET") return Promise.resolve(window.GS_CONFIG.TOPUP_GAMES || []);
  if (base === "/api/stats" && method === "GET") return Supa.getStats();

  /* --- produk --- */
  if (base === "/api/products" && method === "GET") return Supa.listProducts(isAdmin());
  if (base === "/api/products" && method === "POST") return Supa.createProduct(body);
  if (seg(1) === "api" && seg(2) === "products" && seg(4) === "relist" && method === "POST") return Supa.relistProduct(Number(seg(3)));
  if (seg(1) === "api" && seg(2) === "products" && seg(3) && method === "DELETE") return Supa.deleteProduct(Number(seg(3)));

  /* --- pesanan --- */
  if (base === "/api/orders" && method === "GET") return Supa.listOrders(qparam("kind") || null);
  if (base === "/api/orders" && method === "POST") return Supa.createAccountOrder(body.product_id);
  if (seg(1) === "api" && seg(2) === "orders" && seg(4) === "confirm" && method === "POST") return Supa.confirmOrder(decodeURIComponent(seg(3)));
  if (seg(1) === "api" && seg(2) === "orders" && seg(4) === "cancel" && method === "POST") return Supa.cancelOrder(decodeURIComponent(seg(3)));
  if (seg(1) === "api" && seg(2) === "orders" && seg(4) === "credentials" && method === "GET") return Supa.revealCredentials(decodeURIComponent(seg(3)));

  /* --- top up --- */
  if (base === "/api/topup/packages" && method === "GET") return Supa.listPackages(qparam("game") || null);
  if (base === "/api/topup/packages" && method === "POST") return Supa.savePackage(body, null);
  if (seg(1) === "api" && seg(2) === "topup" && seg(3) === "packages" && seg(4) && method === "PUT") return Supa.savePackage(body, Number(seg(4)));
  if (seg(1) === "api" && seg(2) === "topup" && seg(3) === "packages" && seg(4) && method === "DELETE") return Supa.deletePackage(Number(seg(4)));
  if (base === "/api/topup/orders" && method === "POST") return Supa.createTopupOrder(body.package_id, body.user_id, body.server_id || "");

  /* --- aktivitas & support --- */
  if (base === "/api/activity" && method === "GET") return Supa.listActivity();
  if (base === "/api/support" && method === "POST") return Supa.sendSupport(body);
  if (base === "/api/support" && method === "GET") return Supa.listSupport();
  if (seg(1) === "api" && seg(2) === "support" && seg(4) === "replied" && method === "POST") return Supa.markSupportReplied(seg(3));

  /* --- auth --- */
  if (base === "/api/auth/register" && method === "POST") {
    return Supa.register(body.name, body.email, body.password).then(function(r){
      if (r.needsConfirmation) throw new Error("needs_confirmation");
      return r;
    });
  }
  if (base === "/api/auth/login" && method === "POST") return Supa.login(body.email, body.password);
  if (base === "/api/auth/google" && method === "POST") return Promise.reject(new Error("Gunakan tombol Google (Supabase Auth)."));
  if (base === "/api/auth/logout" && method === "POST") return Supa.signOut();
  if (base === "/api/auth/me" && method === "GET") return Supa.me();

  /* --- Midtrans --- */
  if (base === "/api/payments/snap-token" && method === "POST") return Supa.requestSnapToken(body.invoice_no);

  return Promise.reject(new Error("HTTP 404"));
}

/* ---------- probe Supabase (pengganti healthOnce) ----------
   Timeout 5 detik per percobaan, seperti healthOnce lama. */
function healthOnce(){
  var timeout = new Promise(function(_, reject){
    setTimeout(function(){ reject(new Error("timeout")); }, 5000);
  });
  /* Supa.getHealth() bisa throw SINKRON bila klien Supabase belum ada
     (CDN gagal dimuat) — tanpa try/catch ini, initServer() ikut throw
     sinkron dan rantai boot putus (mode lokal tidak tercapai). */
  var probe;
  try { probe = Supa.getHealth(); }
  catch (e) { probe = Promise.reject(e); }
  return Promise.race([probe, timeout]);
}

/* ---------- initServer: sama seperti lama, tapi flag Top Up dibaca
   dari settings Supabase (bukan config.js saja). ---------- */
function initServer(attempt){
  attempt = attempt || 1;
  return healthOnce().then(function(health){
    Server.enabled = true;
    if (health && typeof health.topup_maintenance === "boolean") {
      window.GS_CONFIG.TOPUP_MAINTENANCE = health.topup_maintenance;
    }
    return Promise.all([
      api("/api/products").catch(function(){ return []; }),
      api("/api/orders").catch(function(){ return []; }),
      api("/api/topup/packages").catch(function(){ return []; }),
      api("/api/activity").catch(function(){ return []; }),
      api("/api/auth/me").catch(function(){ return null; }),
      api("/api/payments/config").catch(function(){ return null; })
    ]).then(function(res){
      state.products = (res[0] || []).map(serverProductToLocal);
      state.seq = (res[0] || []).reduce(function(m, p){ return Math.max(m, p.id || 0); }, 0);
      analytics.orders = (res[1] || []).map(serverOrderToLocal);
      analytics.invoiceSeq = analytics.orders.length;
      if (window.TopUp && TopUp.setPackages) TopUp.setPackages((res[2] || []).map(serverPackageToLocal));
      var acts = res[3] || [];
      if (acts.length) { analytics.activity = acts.map(function(a){ return { time: a.time, tag: a.tag, text: a.text }; }); }
      if (res[4] && res[4].email) { Server.user = { name: res[4].name, email: res[4].email, is_admin: !!res[4].is_admin }; }
      if (res[5]) { Server.payments = res[5]; }
    });
  }).catch(function(){
    if (attempt < 3) { return new Promise(function(res){ setTimeout(res, 1000); }).then(function(){ return initServer(attempt + 1); }); }
    Server.enabled = false;
  });
}

/* ---------- login Google via Supabase Auth (menggantikan GIS) ----------
   - Tidak ada lagi script accounts.google.com, tidak ada nonce, tidak
     ada endpoint /api/auth/google, tidak ada verifikasi JWKS offline.
   - Klik tombol -> Supabase redirect ke Google (provider yang sama,
     Client ID "GankStore Web" yang sama — Client Secret diisi di
     dashboard Supabase, BUKAN di kode) -> kembali ke https://gankstore.my.id/
     -> sesi terdeteksi otomatis -> initServer mengambil /api/auth/me.
   - Halaman sebelum login disimpan & dikembalikan (lihat Supa.me). */
var _googleTries = 0;
var _googleServerRetried = false;
function initGoogleSignIn(){
  var wrap = document.getElementById("googleBtnWrap"); if (!wrap) return;
  if (!Server.enabled) {
    if (!_googleServerRetried) {
      _googleServerRetried = true;
      setTimeout(function(){ initServer().then(function(){ _googleTries = 0; initGoogleSignIn(); }); }, 1000);
      return;
    }
    wrap.style.display = "none";
    googleMsgShow("Login Google butuh koneksi ke server toko — pakai email + password di bawah.", true);
    return;
  }
  _googleServerRetried = false;
  googleMsgHide();
  wrap.style.display = "";
  wrap.innerHTML = "";
  if (!window.Supa || !Supa.ready) {
    wrap.style.display = "none";
    googleMsgShow("Login Google belum terhubung — pakai email + password di bawah.", true);
    return;
  }
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost";
  btn.style.width = "100%";
  btn.style.justifyContent = "center";
  btn.style.marginTop = "10px";
  btn.textContent = "Lanjutkan dengan Google";
  btn.addEventListener("click", function(){
    btn.disabled = true;
    btn.textContent = "Membuka Google…";
    Supa.signInWithGoogle().catch(function(){
      btn.disabled = false;
      btn.textContent = "Lanjutkan dengan Google";
      googleMsgShow("Login Google gagal dibuka — pakai email + password di bawah.", true);
    });
  });
  wrap.appendChild(btn);
}
