/* GankStore — klien Supabase (pengganti backend FastAPI + ngrok).
   ================================================================
   CARA PAKAI (lihat frontend/app.js.patch.md untuk langkah lengkap):
     1. Isi SUPABASE_URL + SUPABASE_ANON_KEY di public/js/config.js
        (dari project Supabase BARU khusus GankStore — JANGAN pakai
        project RekberSTORE atau project lain yang sudah ada).
     2. Muat supabase-js dari CDN di index.html SEBELUM file ini.
     3. Muat file ini SEBELUM js/app.js.
   File ini TIDAK mendefinisikan nama yang bentrok dengan app.js
   (api, initServer, Server, ...). Semua akses Supabase lewat objek
   window.Supa. Blok api()/auth/Google di app.js diganti dengan isi
   frontend/supabase-api.js (penerjemah path REST lama -> Supa.*).

   Aturan keamanan:
   - ANON KEY boleh tampil di browser (kunci publik, dibatasi RLS).
   - JANGAN taruh service_role key / Server Key Midtrans di file ini.
   - Kredensial akun game TIDAK PERNAH dibaca lewat tabel products /
     orders langsung — hanya lewat fungsi RPC (reveal) dan tabel
     stock_units yang RLS-nya admin saja.
*/
(function(){
  "use strict";
  var cfg = window.GS_CONFIG || {};
  var URL = cfg.SUPABASE_URL || "";
  var ANON = cfg.SUPABASE_ANON_KEY || "";
  var FN_BASE = URL ? URL.replace(/\/$/, "") + "/functions/v1/midtrans" : "";

  var client = null;
  if (URL && ANON && window.supabase && window.supabase.createClient) {
    try {
      client = window.supabase.createClient(URL, ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) { client = null; }
  }

  var _session = null;          /* sesi Supabase Auth terakhir */
  var _accessToken = null;      /* access token (cache, untuk Edge Function) */
  var _settingsCache = null;    /* {at, data} — cache settings 60 detik */
  var _meCache = null;          /* profil pemakai saat ini */

  function setSessionCache(session){
    _session = session || null;
    _accessToken = (session && session.access_token) || null;
    if (!session) _meCache = null;
  }
  function errText(err){
    if (!err) return "Terjadi kesalahan.";
    if (typeof err === "string") return err;
    return err.message || "Terjadi kesalahan.";
  }
  function fail(err){ throw new Error(errText(err)); }
  function needClient(){
    if (!client) throw new Error("Supabase belum terhubung. Cek SUPABASE_URL / SUPABASE_ANON_KEY di config.js.");
  }
  /* Ambil data dari hasil query supabase-js ({data, error}). */
  function take(res){
    if (res.error) fail(res.error);
    return res.data;
  }
  /* Panggil RPC; error Postgres (RAISE EXCEPTION di fungsi) muncul
     sebagai error.message berisi kode singkat (mis. 'forbidden'). */
  function rpc(name, params){
    needClient();
    return client.rpc(name, params || {}).then(function(res){
      if (res.error) fail(res.error);
      return res.data;
    });
  }
  function edgeFetch(path, opts){
    opts = opts || {};
    var headers = { "apikey": ANON, "Content-Type": "application/json" };
    if (_accessToken) headers["Authorization"] = "Bearer " + _accessToken;
    else headers["Authorization"] = "Bearer " + ANON;
    return fetch(FN_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  var Supa = {
    client: client,
    ready: !!client,
    fnBase: FN_BASE,

    /* ---------- sesi ---------- */
    refreshSession: function(){
      needClient();
      return client.auth.getSession().then(function(res){
        if (res.error) fail(res.error);
        setSessionCache(res.data.session);
        return _session;
      });
    },
    onAuthStateChange: function(cb){
      if (!client) return;
      client.auth.onAuthStateChange(function(event, session){
        setSessionCache(session);
        cb(event, session);
      });
    },
    getAccessToken: function(){ return _accessToken; },

    /* ---------- auth (menggantikan /api/auth/*) ---------- */
    register: function(name, email, password){
      needClient();
      return client.auth.signUp({
        email: email, password: password,
        options: { data: { name: name }, emailRedirectTo: location.origin + "/" }
      }).then(function(res){
        if (res.error) fail(res.error);
        var user = res.data.user;
        var session = res.data.session;
        /* Bila konfirmasi email AKTIF di project, signUp tidak langsung
           memberi sesi — pemanggil menampilkan "cek email" (lihat
           PLAN.md: matikan konfirmasi email untuk toko ini). */
        if (!session) return { needsConfirmation: true, email: email };
        setSessionCache(session);
        return Supa.me().then(function(me){
          return { token: session.access_token, id: user.id, name: me.name, email: me.email, is_admin: me.is_admin };
        });
      });
    },
    login: function(email, password){
      needClient();
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function(res){
          if (res.error) fail(res.error);
          setSessionCache(res.data.session);
          return Supa.me().then(function(me){
            return { token: res.data.session.access_token, id: res.data.user.id, name: me.name, email: me.email, is_admin: me.is_admin };
          });
        });
    },
    /* Login Google LANGSUNG (GIS, seperti RekberSTORE) — BUKAN
       hosted-OAuth: GIS dirender dari gankstore.my.id, token ID
       diteruskan ke Supabase. Layar pilih akun Google tertulis
       "Lanjutkan ke gankstore.my.id" (bukan URL Supabase).
       Nonce: kirim RAW nonce ke sini; ke Google dikirim SHA-256
       dari nonce itu (lihat app.js: googleNonceRaw/sha256Hex).
       Supabase me-hash nonce ini sendiri lalu membandingkan dengan
       claim nonce di token — bila keduanya tidak cocok, GoTrue
       menolak ("Nonces mismatch"). */
    signInWithIdToken: function(token, nonce){
      needClient();
      return client.auth.signInWithIdToken({ provider: "google", token: token, nonce: nonce })
        .then(function(res){
          if (res.error) fail(res.error);
          setSessionCache(res.data.session);
          return Supa.me().then(function(me){
            return { token: res.data.session.access_token, id: res.data.user.id, name: me.name, email: me.email, is_admin: me.is_admin };
          });
        });
    },
    signOut: function(){
      if (!client) return Promise.resolve({ ok: true });
      return client.auth.signOut().then(function(){
        setSessionCache(null);
        return { ok: true };
      });
    },
    /* Profil pemakai saat ini (dari tabel profiles). Dipakai /api/auth/me.
       Sekaligus mengembalikan hash halaman yang disimpan sebelum login
       Google, supaya pemakai kembali ke halaman semula. */
    me: function(){
      needClient();
      return Supa.refreshSession().then(function(session){
        if (!session || !session.user) throw new Error("HTTP 401");
        var uid = session.user.id;
        if (_meCache && _meCache.id === uid) return _meCache;
        return client.from("profiles").select("id,name,email,is_admin")
          .eq("id", uid).single().then(function(res){
            if (res.error) fail(res.error);
            _meCache = { id: res.data.id, name: res.data.name, email: res.data.email, is_admin: !!res.data.is_admin };
            /* Kembali ke halaman sebelum login Google (disimpan saat login). */
            try {
              var back = sessionStorage.getItem("gs_after_oauth");
              if (back) { sessionStorage.removeItem("gs_after_oauth"); location.hash = back; }
            } catch (e) {}
            return _meCache;
          });
      });
    },

    /* ---------- settings (saklar toko) ---------- */
    getSettings: function(force){
      needClient();
      if (!force && _settingsCache && (Date.now() - _settingsCache.at) < 60000) {
        return Promise.resolve(_settingsCache.data);
      }
      return client.from("settings").select("key,value").then(function(res){
        if (res.error) fail(res.error);
        var map = {};
        (res.data || []).forEach(function(r){ map[r.key] = r.value; });
        _settingsCache = { at: Date.now(), data: map };
        return map;
      });
    },
    isTopupMaintenance: function(){
      return Supa.getSettings().then(function(s){
        return (s.topup_maintenance || "true") === "true";
      }).catch(function(){ return true; /* gagal baca = tetap maintenance (aman) */ });
    },
    /* Simpan satu setting (admin saja, ditegakkan RLS
       settings_write_admin). Pakai upsert supaya key baru maupun lama
       sama-sama bisa ditulis. Cache settings dibersihkan supaya baca
       berikutnya langsung melihat nilai baru. */
    updateSetting: function(key, value){
      needClient();
      _settingsCache = null;
      return client.from("settings")
        .upsert({ key: String(key), value: String(value == null ? "" : value) }, { onConflict: "key" })
        .select("key,value")
        .then(function(res){
          if (res.error) fail(res.error);
          return (res.data && res.data[0]) || { key: key, value: String(value == null ? "" : value) };
        });
    },

    /* ---------- produk (menggantikan /api/products) ----------
       products = LISTING; stok = stock_units (1 baris = 1 akun).
       listProducts menggabungkan jumlah stok per produk (angka saja,
       tanpa kredensial) lewat RPC get_stock_counts(). Kredensial unit
       TIDAK dimuat di sini — hanya admin lewat listStockUnits(). */
    getStockCounts: function(){
      needClient();
      return rpc("get_stock_counts", {}).then(function(data){ return data || []; });
    },
    listProducts: function(isAdmin){
      needClient();
      return client.from("products").select("*").order("id", { ascending: false })
        .then(function(res){
          var rows = take(res);
          return Supa.getStockCounts().then(function(counts){
            var map = {};
            (counts || []).forEach(function(c){ map[c.product_id] = c; });
            rows.forEach(function(p){
              var c = map[p.id] || { available: 0, dipesan: 0, terjual: 0, total: 0 };
              p.stock_available = Number(c.available || 0);
              p.stock_dipesan = Number(c.dipesan || 0);
              p.stock_terjual = Number(c.terjual || 0);
              p.stock_total = Number(c.total || 0);
            });
            return rows;
          });
        });
    },
    /* Unit stok — ADMIN saja (RLS stock_units_all_admin). Dipakai
       halaman Daftar Stok. Tanpa productId = semua unit (admin). */
    listStockUnits: function(productId){
      needClient();
      var q = client.from("stock_units").select("*").order("id", { ascending: true });
      if (productId) q = q.eq("product_id", productId);
      return q.then(function(res){ return take(res); });
    },
    addStockUnits: function(productId, units){
      needClient();
      return rpc("add_stock_units", { p_product_id: productId, p_units: units });
    },
    deleteStockUnit: function(id){ return rpc("delete_stock_unit", { p_unit_id: id }).then(function(){ return { ok: true }; }); },
    createProduct: function(p){
      needClient();
      /* Stok awal listing: p.units = [{username, password}, ...].
         Minimal 1 unit (form Tambah Akun wajib isi username+password). */
      var units = p.units || [];
      if (!units.length && (p.credUser || p.credPass)) {
        units = [{ username: p.credUser, password: p.credPass }];
      }
      return client.from("products").insert({
        game: p.game, title: p.title, rank: p.rank || "", level: String(p.level || ""),
        server: p.server || "", price: p.price, specs: p.specs || [],
        description: p.desc || "", photo: p.photo || "", status: "tersedia"
      }).select("*").single().then(function(res){
        var row = take(res);
        row.stock_available = 0; row.stock_dipesan = 0; row.stock_terjual = 0; row.stock_total = 0;
        if (!units.length) return row;
        return client.from("stock_units").insert(units.map(function(u){
          return { product_id: row.id, cred_user: u.username, cred_pass: u.password, status: "tersedia" };
        })).then(function(ir){
          if (ir.error) {
            /* Unit gagal tersimpan — hapus produknya supaya tidak
               ada listing tanpa stok. */
            return client.from("products").delete().eq("id", row.id).then(function(){ fail(ir.error); });
          }
          row.stock_available = units.length; row.stock_total = units.length;
          return row;
        });
      });
    },
    deleteProduct: function(id){ return rpc("delete_product", { p_product_id: id }).then(function(){ return { ok: true }; }); },
    relistProduct: function(id){ return rpc("relist_product", { p_product_id: id }); },

    /* ---------- pesanan (menggantikan /api/orders) ---------- */
    listOrders: function(kind){
      needClient();
      var q = client.from("orders").select("*").order("id", { ascending: false });
      if (kind) q = q.eq("kind", kind);
      return q.then(function(res){ return take(res); });
    },
    createAccountOrder: function(productId){ return rpc("create_account_order", { p_product_id: productId }); },
    createTopupOrder: function(packageId, userId, serverId){
      return rpc("create_topup_order", { p_package_id: packageId, p_user_id_game: userId, p_server_id: serverId || "" });
    },
    confirmOrder: function(invoiceNo){ return rpc("confirm_order", { p_invoice: invoiceNo }); },
    cancelOrder: function(invoiceNo){ return rpc("cancel_order", { p_invoice: invoiceNo }); },
    submitProof: function(invoiceNo, proofImage){ return rpc("submit_payment_proof", { p_invoice: invoiceNo, p_proof_image: proofImage }); },
    /* Tampilkan kredensial SATU KALI — fungsi RPC menghapusnya.
       Kembalian: {username, password} (username PB, bukan email). */
    revealCredentials: function(invoiceNo){ return rpc("reveal_order_credentials", { p_invoice: invoiceNo }); },

    /* ---------- paket top up (menggantikan /api/topup/packages) ---------- */
    listPackages: function(game){
      needClient();
      var q = client.from("topup_packages").select("*").order("price", { ascending: true });
      if (game) q = q.eq("game", game);
      return q.then(function(res){ return take(res); });
    },
    savePackage: function(pkg, id){
      needClient();
      /* Currency TIDAK dikirim form (body hanya game/name/amount/price)
         — diturunkan dari daftar game, sama seperti backend lama
         (TOPUP_GAME_MAP di main.py). */
      var currency = "";
      (window.GS_CONFIG.TOPUP_GAMES || []).forEach(function(g){ if (g.name === pkg.game) currency = g.currency; });
      if (!currency) throw new Error("Game tidak ada di daftar top up.");
      var row = { game: pkg.game, name: pkg.name, amount: pkg.amount, currency: currency, price: pkg.price };
      if (id) {
        return client.from("topup_packages").update(row).eq("id", id).select("*").single()
          .then(function(res){ return take(res); });
      }
      return client.from("topup_packages").insert(row).select("*").single()
        .then(function(res){ return take(res); });
    },
    deletePackage: function(id){
      needClient();
      /* Tolak bila ada pesanan top up aktif untuk paket ini (HTTP 409 lama). */
      return client.from("orders").select("id").eq("package_id", id)
        .eq("kind", "topup").eq("status", "dipesan").limit(1)
        .then(function(res){
          if (res.error) fail(res.error);
          if ((res.data || []).length) throw new Error("package_has_active_order");
          return client.from("topup_packages").delete().eq("id", id).then(function(dr){
            if (dr.error) fail(dr.error);
            return { ok: true };
          });
        });
    },

    /* ---------- aktivitas & support ---------- */
    listActivity: function(){
      needClient();
      return client.from("activity").select("time,tag,text")
        .order("id", { ascending: false }).limit(40)
        .then(function(res){ return take(res); });
    },
    sendSupport: function(msg){
      needClient();
      return client.from("support_messages").insert({
        name: msg.name, contact: msg.contact, topic: msg.topic, message: msg.message
      }).select("*").single().then(function(res){ return take(res); });
    },
    listSupport: function(){
      needClient();
      return client.from("support_messages").select("*").order("id", { ascending: false })
        .then(function(res){ return take(res); });
    },
    markSupportReplied: function(id){
      needClient();
      return client.from("support_messages").update({ status: "dibalas" }).eq("id", id)
        .select("*").single().then(function(res){ return take(res); });
    },

    /* ---------- live chat tanpa AI (buyer <-> admin) ---------- */
    createChat: function(id){
      needClient();
      /* INSERT biasa (bukan upsert): upsert butuh hak UPDATE yang anon
         tidak punya (PostgREST menolak 42501). Kalau baris sudah ada
         (pembeli kembali / dua tab bersamaan), abaikan error duplicate
         key — barisnya memang sudah ada. */
      return client.from("live_chats").insert({ id: id })
        .select("*").single().then(function(res){ return take(res); })
        .catch(function(e){
          if (/duplicate key/i.test(String(e && e.message))) return { id: id };
          throw e;
        });
    },
    listChats: function(){
      needClient();
      return client.from("live_chats").select("*").order("updated_at", { ascending: false }).limit(50)
        .then(function(res){ return take(res); });
    },
    listChatMessages: function(chatId){
      needClient();
      return client.from("live_chat_messages").select("*").eq("chat_id", chatId).order("id", { ascending: true }).limit(200)
        .then(function(res){ return take(res); });
    },
    sendChatMessage: function(chatId, sender, text){
      needClient();
      return client.from("live_chat_messages").insert({ chat_id: chatId, sender: sender, text: text })
        .select("*").single().then(function(res){ return take(res); });
    },
    setChatStatus: function(chatId, status){
      needClient();
      return client.from("live_chats").update({ status: status }).eq("id", chatId)
        .select("*").single().then(function(res){ return take(res); });
    },

    /* ---------- langganan Web Push perangkat admin ---------- */
    savePushSubscription: function(sub){
      needClient();
      return client.from("push_subscriptions").upsert(sub, { onConflict: "endpoint" })
        .select("*").single().then(function(res){ return take(res); });
    },
    listPushSubscriptions: function(){
      needClient();
      return client.from("push_subscriptions").select("id,endpoint,label,created_at").order("created_at", { ascending: false })
        .then(function(res){ return take(res); });
    },
    deletePushSubscription: function(endpoint){
      needClient();
      return client.from("push_subscriptions").delete().eq("endpoint", endpoint)
        .then(function(res){ return take(res); });
    },

    /* ---------- statistik (dulu /api/stats — tidak dipakai frontend,
       tapi disediakan supaya endpoint lama tetap ada padanannya) ---------- */
    getStats: function(){
      needClient();
      /* Hitung dari list (katalog masih kecil) — cukup untuk dasbor admin.
         Pendapatan akun dihitung dari ORDER terjual (1 order = 1 unit),
         bukan dari status produk — listing yang masih tersedia pun bisa
         sudah menjual beberapa unit. */
      return Promise.all([Supa.listProducts(false), Supa.listOrders()]).then(function(res){
        var products = res[0] || [], orders = res[1] || [];
        function count(arr, fn){ return arr.filter(fn).length; }
        return {
          products_total: products.length,
          products_tersedia: count(products, function(p){ return p.status === "tersedia"; }),
          products_dipesan: count(products, function(p){ return p.status === "dipesan"; }),
          products_terjual: count(products, function(p){ return p.status === "terjual"; }),
          products_habis: count(products, function(p){ return p.status === "habis"; }),
          units_total: products.reduce(function(s, p){ return s + Number(p.stock_total || 0); }, 0),
          units_tersedia: products.reduce(function(s, p){ return s + Number(p.stock_available || 0); }, 0),
          orders_total: orders.length,
          orders_dipesan: count(orders, function(o){ return o.status === "dipesan"; }),
          orders_terjual: count(orders, function(o){ return o.status === "terjual"; }),
          topup_terjual: count(orders, function(o){ return o.kind === "topup" && o.status === "terjual"; }),
          revenue_akun: orders.filter(function(o){ return o.kind === "akun" && o.status === "terjual"; })
            .reduce(function(s, o){ return s + Number(o.price || 0); }, 0),
          revenue_topup: orders.filter(function(o){ return o.kind === "topup" && o.status === "terjual"; })
            .reduce(function(s, o){ return s + Number(o.price || 0); }, 0)
        };
      });
    },

    /* ---------- Midtrans (Edge Function; dulu /api/payments/*) ---------- */
    getPaymentsConfig: function(){
      if (!FN_BASE) return Promise.resolve({ configured: false, is_production: false, client_key: null });
      return edgeFetch("/config").catch(function(){
        return { configured: false, is_production: false, client_key: null };
      });
    },
    requestSnapToken: function(invoiceNo){
      if (!FN_BASE) throw new Error("Edge Function Midtrans belum dikonfigurasi.");
      return Supa.refreshSession().catch(function(){ return null; }).then(function(){
        return edgeFetch("/snap-token", { method: "POST", body: { invoice_no: invoiceNo } });
      });
    },
    getHealth: function(){
      return Promise.all([
        Supa.getSettings().catch(function(){ return {}; }),
        Supa.getPaymentsConfig()
      ]).then(function(res){
        var settings = res[0] || {}, pay = res[1] || {};
        return {
          ok: true,
          mode: "supabase",
          midtrans_configured: !!pay.configured,
          midtrans_production: !!pay.is_production,
          topup_maintenance: (settings.topup_maintenance || "true") === "true"
        };
      });
    }
  };

  window.Supa = Supa;
})();
