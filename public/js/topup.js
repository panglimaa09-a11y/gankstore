/* GankStore — Top Up all game.
   Halaman terpisah dari katalog akun: pilih game -> pilih paket -> isi
   User ID (+ Server/Zone ID bila gamenya butuh) -> invoice in-app.
   Alur order SAMA seperti akun: Dipesan -> admin Konfirmasi Lunas ->
   Terjual/Selesai, masuk Laporan + Live Tracking + pop-up.
   JUJUR: top up diproses MANUAL oleh admin setelah lunas — belum ada
   pengiriman diamond/UC otomatis (belum ada supplier/provider). */
var TopUp = (function(){
  "use strict";
  var LS_PKGS = "gankstore_topup_packages";
  var packages = [];
  var selectedPkg = null;
  var currentGame = null;

  function gameCfg(name){
    var list = window.GS_CONFIG.TOPUP_GAMES || [];
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) return list[i]; }
    return { name: name, currency: "", needsServer: false, serverLabel: "" };
  }
  function loadLocal(){
    try { var p = JSON.parse(localStorage.getItem(LS_PKGS) || "[]"); return Array.isArray(p) ? p : []; }
    catch (e) { return []; }
  }
  function saveLocal(){ try { localStorage.setItem(LS_PKGS, JSON.stringify(packages)); } catch (e) {} }
  function setPackages(list){
    packages = list || [];
    if (!Server.enabled) saveLocal();
  }
  function getPackages(){ return packages; }
  function packagesFor(game){
    return packages.filter(function(p){ return p.game === game; });
  }
  function nextLocalId(){
    var m = 0;
    packages.forEach(function(p){ if (p.id > m) m = p.id; });
    return m + 1;
  }

  /* Top Up MAINTENANCE (perintah Tuan, 6 Nov 2026): selama flag
     GS_CONFIG.TOPUP_MAINTENANCE true, pembeli tidak bisa melihat paket
     atau membuat order top up — halaman menampilkan pemberitahuan
     maintenance. Admin tetap bisa kelola paket di Panel Admin. */
  function isMaint(){
    return !!(window.GS_CONFIG && window.GS_CONFIG.TOPUP_MAINTENANCE);
  }
  function showMaint(){
    var m = document.getElementById("topupMaint");
    var g = document.getElementById("topupGrid");
    var e = document.getElementById("topupEmpty");
    var b = document.getElementById("topupInfoBox");
    if (m) m.hidden = false;
    if (g) g.innerHTML = "";
    if (e) e.hidden = true;
    if (b) b.hidden = true;
  }
  function hideMaint(){
    var m = document.getElementById("topupMaint");
    var b = document.getElementById("topupInfoBox");
    if (m) m.hidden = true;
    if (b) b.hidden = false;
  }

  /* ---------- halaman daftar game ---------- */
  function renderTopup(){
    if (isMaint()) { showMaint(); return; }
    hideMaint();
    var grid = document.getElementById("topupGrid");
    if (!grid) return;
    var games = window.GS_CONFIG.TOPUP_GAMES || [];
    grid.innerHTML = "";
    games.forEach(function(g){
      var pkgs = packagesFor(g.name);
      var el = document.createElement("article");
      el.className = "card";
      el.innerHTML = '<div class="card-body"><div class="card-title">' + esc(g.name) + '</div>' +
        '<div class="card-specs"><span>' + esc(g.currency) + '</span><span>' + (pkgs.length ? pkgs.length + " paket tersedia" : "Belum ada paket") + '</span></div>' +
        '<div class="card-foot">' +
        '<div class="card-actions"><a class="btn-detail" href="#/topup/' + encodeURIComponent(g.name) + '">Lihat Paket</a></div></div></div>';
      grid.appendChild(el);
    });
    var empty = document.getElementById("topupEmpty");
    if (empty) empty.hidden = packages.length !== 0;
  }

  /* ---------- halaman paket per game + form order ---------- */
  function renderTopupGame(game){
    var gm = document.getElementById("topupGameMaint");
    var gbox = document.getElementById("topupPackages");
    var gem = document.getElementById("topupPkgEmpty");
    var gform = document.getElementById("topupFormWrap");
    if (isMaint()) {
      if (gm) gm.hidden = false;
      if (gbox) gbox.innerHTML = "";
      if (gem) gem.hidden = true;
      if (gform) gform.hidden = true;
      var t = document.getElementById("topupGameTitle");
      if (t) t.textContent = "Top Up " + game;
      var d = document.getElementById("topupGameDesc");
      if (d) d.textContent = "Top Up sedang maintenance — kembali lagi nanti.";
      return;
    }
    if (gm) gm.hidden = true;
    if (gform) gform.hidden = false;
    currentGame = game;
    selectedPkg = null;
    var cfg = gameCfg(game);
    var t = document.getElementById("topupGameTitle");
    if (t) t.textContent = "Top Up " + game;
    var d = document.getElementById("topupGameDesc");
    if (d) d.textContent = "Paket " + cfg.currency + " untuk " + game + ". Pilih paket, isi " + (cfg.idLabel || "User ID") + (cfg.needsServer ? " dan " + cfg.serverLabel : "") + ", lalu buat pesanan — invoice terbit di toko ini.";
    var idLbl = document.querySelector('label[for="tuUserId"]');
    if (idLbl) idLbl.textContent = cfg.idLabel || "User ID / ID Akun Game";
    var idInp = document.getElementById("tuUserId");
    if (idInp && cfg.idPlaceholder) idInp.placeholder = cfg.idPlaceholder;
    var box = document.getElementById("topupPackages");
    var pkgs = packagesFor(game);
    if (box) {
      box.innerHTML = "";
      pkgs.forEach(function(p){
        var el = document.createElement("article");
        el.className = "card pkg-card";
        el.setAttribute("data-pkg", p.id);
        el.innerHTML = '<div class="card-body"><div class="card-title">' + esc(p.name) + '</div>' +
          '<div class="card-specs"><span>' + esc(String(p.amount)) + " " + esc(p.currency) + '</span><span>' + esc(p.game) + '</span></div>' +
          '<div class="card-foot"><div class="pkg-price">' + formatIDR(p.price) + '</div>' +
          '<div style="font-size:13px;color:var(--ink-faint);font-weight:600">+ biaya admin ' + feePct() + ' · total ' + formatIDR(Number(p.price || 0) + adminFee(p.price)) + '</div>' +
          '<div class="card-actions"><button class="btn-buy" type="button" data-pick="' + p.id + '">Pilih Paket</button></div></div></div>';
        box.appendChild(el);
      });
      box.querySelectorAll("[data-pick]").forEach(function(b){
        b.addEventListener("click", function(){ selectPackage(Number(b.getAttribute("data-pick"))); });
      });
    }
    var em = document.getElementById("topupPkgEmpty");
    if (em) em.hidden = pkgs.length !== 0;
    var sf = document.getElementById("tuServerField");
    if (sf) {
      sf.hidden = !cfg.needsServer;
      var lbl = sf.querySelector("label");
      if (lbl) lbl.textContent = cfg.serverLabel || "Server / Zone ID";
      var inp = document.getElementById("tuServerId");
      if (inp) inp.required = !!cfg.needsServer;
    }
    updateTopupPrice();
  }
  function selectPackage(id){
    selectedPkg = null;
    packages.forEach(function(p){ if (p.id === id) selectedPkg = p; });
    document.querySelectorAll(".pkg-card").forEach(function(el){
      el.classList.toggle("selected", Number(el.getAttribute("data-pkg")) === id);
    });
    updateTopupPrice();
  }
  function updateTopupPrice(){
    var sel = document.getElementById("topupSelected");
    var box = document.getElementById("topupPriceBox");
    if (!sel || !box) return;
    if (!selectedPkg) {
      sel.innerHTML = "<span>Belum ada paket dipilih — klik salah satu paket di atas.</span>";
      box.innerHTML = "";
      return;
    }
    var fee = adminFee(selectedPkg.price);
    sel.innerHTML = "<b>" + esc(selectedPkg.name) + "</b> — " + esc(selectedPkg.game) + " (" + esc(String(selectedPkg.amount)) + " " + esc(selectedPkg.currency) + ")";
    box.innerHTML = '<div class="inv-row"><span>Harga paket</span><b>' + formatIDR(selectedPkg.price) + '</b></div>' +
      '<div class="inv-row"><span>Biaya admin (' + feePct() + ')</span><b>' + formatIDR(fee) + '</b></div>' +
      '<div class="inv-row total"><span>Total bayar</span><b>' + formatIDR(Number(selectedPkg.price || 0) + fee) + '</b></div>';
  }

  /* ---------- buat order top up (alur sama seperti akun) ---------- */
  function trackTopupBuy(pkg, userId, serverId){
    if (isMaint()) {
      showToast("Top Up sedang maintenance — kembali lagi nanti.");
      return Promise.resolve(null);
    }
    if (Server.enabled) {
      return api("/api/topup/orders", { method: "POST", body: { package_id: pkg.id, user_id: userId, server_id: serverId || "" } }).then(function(o){
        if (!o) return null;
        var order = serverOrderToLocal(o);
        analytics.buyClicks++;
        analytics.orders.unshift(order);
        logActivity("pesan", 'Top up "' + order.title + '" dipesan — invoice ' + order.invoiceNo + " terbit (" + formatIDR(order.total) + " termasuk biaya admin " + formatIDR(order.fee) + "). Menunggu pembayaran via QRIS manual.");
        showEventPopup({ title: order.title, price: order.price, photo: "", game: order.game }, "pesan");
        showToast("Pesanan top up dibuat! Invoice " + order.invoiceNo);
        render();
        return order;
      }).catch(function(){ showToast("Gagal membuat pesanan top up di server. Coba lagi."); return null; });
    }
    var u = currentUser();
    var fee = adminFee(pkg.price);
    var order = {
      id: "tu-" + Date.now(), kind: "topup", invoiceNo: makeInvoiceNo(),
      title: "Top Up " + pkg.amount + " " + pkg.currency + " — " + pkg.game,
      price: pkg.price, fee: fee, total: Number(pkg.price || 0) + fee,
      photo: "", game: pkg.game, rank: "", time: timeStr(), status: "dipesan",
      buyerName: u ? u.name : "Pembeli", buyerEmail: u ? u.email : "",
      userId: userId, serverId: serverId || "", packageName: pkg.name,
      amount: String(pkg.amount), currency: pkg.currency
    };
    analytics.buyClicks++;
    analytics.orders.unshift(order);
    logActivity("pesan", 'Top up "' + order.title + '" dipesan — invoice ' + order.invoiceNo + " terbit (" + formatIDR(order.total) + " termasuk biaya admin " + formatIDR(fee) + "). Menunggu pembayaran via QRIS manual.");
    showEventPopup({ title: order.title, price: order.price, photo: "", game: order.game }, "pesan");
    showToast("Pesanan top up dibuat! Invoice " + order.invoiceNo);
    render();
    return Promise.resolve(order);
  }

  /* ---------- admin: kelola paket + proses pesanan top up ---------- */
  function renderTopupAdmin(){
    var sel = document.getElementById("tpGame");
    if (sel && !sel.options.length) {
      (window.GS_CONFIG.TOPUP_GAMES || []).forEach(function(g){
        var o = document.createElement("option"); o.value = g.name; o.textContent = g.name; sel.appendChild(o);
      });
      sel.addEventListener("change", updateCurrencyHint);
      updateCurrencyHint();
    }
    var list = document.getElementById("topupPkgList");
    if (list) {
      list.innerHTML = "";
      if (!packages.length) {
        list.innerHTML = '<p class="stock-empty">Belum ada paket top up. Tambahkan paket pertama lewat form di atas — katalog top up mulai kosong dan hanya diisi admin.</p>';
      }
      packages.slice().sort(function(a, b){ return (b.id || 0) - (a.id || 0); }).forEach(function(p){
        var item = document.createElement("div");
        item.className = "stock-item";
        item.innerHTML = '<div class="thumb"><img src="icon.png" alt="GankStore" /></div>' +
          '<div class="meta"><b>' + esc(p.name) + '</b><span>' + esc(p.game) + " · " + esc(String(p.amount)) + " " + esc(p.currency) + " · " + formatIDR(p.price) + '</span></div>' +
          '<div class="acts"><button class="mini" type="button" data-tp-edit="' + p.id + '">Edit</button>' +
          '<button class="mini danger" type="button" data-tp-del="' + p.id + '">Hapus</button></div>';
        list.appendChild(item);
      });
      list.querySelectorAll("[data-tp-del]").forEach(function(b){
        b.addEventListener("click", function(){ deletePackage(Number(b.getAttribute("data-tp-del"))); });
      });
      list.querySelectorAll("[data-tp-edit]").forEach(function(b){
        b.addEventListener("click", function(){ startEditPackage(Number(b.getAttribute("data-tp-edit"))); });
      });
    }
    var olist = document.getElementById("topupOrderList");
    if (olist) {
      var torders = analytics.orders.filter(function(o){ return o.kind === "topup"; });
      if (!torders.length) {
        olist.innerHTML = '<p class="stock-empty">Belum ada pesanan top up. Pesanan masuk otomatis begitu pembeli buat order top up.</p>';
      } else {
        olist.innerHTML = "";
        torders.forEach(function(o){
          var row = document.createElement("div");
          row.className = "sales-row";
          var acts = "";
          if (o.status === "dipesan") acts = '<button class="mini lunas" type="button" data-tu-lunas="' + esc(o.invoiceNo) + '">Konfirmasi Lunas</button><button class="mini" type="button" data-tu-batal="' + esc(o.invoiceNo) + '">Batalkan</button>';
          row.innerHTML = '<div class="sr-thumb"><img src="icon.png" alt="GankStore" /></div>' +
            '<div class="sr-body"><b>' + esc(o.title) + '</b><span>' + esc(o.invoiceNo) + " · " + orderStatusLabel(o) + " · User ID " + esc(o.userId || "-") + (o.serverId ? " · Server " + esc(o.serverId) : "") + '</span></div>' +
            '<div class="sr-price">' + formatIDR(o.total != null ? o.total : o.price) + '</div>' +
            (acts ? '<div class="acts">' + acts + '</div>' : '');
          olist.appendChild(row);
        });
        olist.querySelectorAll("[data-tu-lunas]").forEach(function(b){
          b.addEventListener("click", function(){ confirmTopup(b.getAttribute("data-tu-lunas")); });
        });
        olist.querySelectorAll("[data-tu-batal]").forEach(function(b){
          b.addEventListener("click", function(){ cancelTopup(b.getAttribute("data-tu-batal")); });
        });
      }
    }
  }
  function updateCurrencyHint(){
    var sel = document.getElementById("tpGame");
    var hint = document.getElementById("tpCurrencyHint");
    if (!sel || !hint) return;
    var cfg = gameCfg(sel.value);
    hint.textContent = "Mata uang untuk " + cfg.name + ": " + cfg.currency + (cfg.needsServer ? " — pembeli wajib isi " + cfg.serverLabel + "." : ".");
  }
  function startEditPackage(id){
    var p = null;
    packages.forEach(function(x){ if (x.id === id) p = x; });
    if (!p) return;
    document.getElementById("tpGame").value = p.game;
    document.getElementById("tpName").value = p.name;
    document.getElementById("tpAmount").value = p.amount;
    document.getElementById("tpPrice").value = p.price;
    document.getElementById("tpEditId").value = p.id;
    document.getElementById("topupPkgFormTitle").textContent = "Edit Paket Top Up";
    document.getElementById("tpSubmitBtn").textContent = "Simpan Perubahan";
    document.getElementById("tpCancelEdit").hidden = false;
    updateCurrencyHint();
    window.scrollTo(0, 0);
  }
  function cancelEditPackage(){
    document.getElementById("tpEditId").value = "";
    document.getElementById("topupPkgForm").reset();
    document.getElementById("topupPkgFormTitle").textContent = "Tambah Paket Top Up";
    document.getElementById("tpSubmitBtn").textContent = "+ Simpan Paket";
    document.getElementById("tpCancelEdit").hidden = true;
    updateCurrencyHint();
  }
  function deletePackage(id){
    if (Server.enabled) {
      api("/api/topup/packages/" + id, { method: "DELETE" }).then(function(){
        packages = packages.filter(function(x){ return x.id !== id; });
        renderTopupAdmin(); renderTopup(); showToast("Paket top up dihapus.");
      }).catch(function(){ showToast("Gagal menghapus paket di server."); });
      return;
    }
    packages = packages.filter(function(x){ return x.id !== id; });
    saveLocal();
    renderTopupAdmin(); renderTopup(); showToast("Paket top up dihapus.");
  }
  function confirmTopup(invoiceNo){
    var o = findOrder(invoiceNo);
    if (!o || o.status !== "dipesan") return;
    if (Server.enabled) {
      api("/api/orders/" + encodeURIComponent(invoiceNo) + "/confirm", { method: "POST" }).then(function(u){
        o.status = "terjual"; o.time = (u.created_at || "").slice(11, 19) || o.time;
        logActivity("lunas", 'Top up "' + o.title + '" lunas & selesai diproses (' + formatIDR(o.price) + ').');
        showEventPopup({ title: o.title, price: o.price, photo: "", game: o.game }, "lunas");
        render(); showToast('Top up "' + o.title + '" selesai diproses.');
      }).catch(function(){ showToast("Gagal konfirmasi lunas di server."); });
      return;
    }
    o.status = "terjual"; o.time = timeStr();
    logActivity("lunas", 'Top up "' + o.title + '" lunas & selesai diproses (' + formatIDR(o.price) + ').');
    showEventPopup({ title: o.title, price: o.price, photo: "", game: o.game }, "lunas");
    render(); showToast('Top up "' + o.title + '" selesai diproses.');
  }
  function cancelTopup(invoiceNo){
    var o = findOrder(invoiceNo);
    if (!o || o.status !== "dipesan") return;
    if (Server.enabled) {
      api("/api/orders/" + encodeURIComponent(invoiceNo) + "/cancel", { method: "POST" }).then(function(){
        o.status = "dibatalkan";
        logActivity("batal", 'Pesanan top up "' + o.title + '" dibatalkan admin.');
        render(); showToast('Pesanan top up "' + o.title + '" dibatalkan.');
      }).catch(function(){ showToast("Gagal membatalkan pesanan di server."); });
      return;
    }
    o.status = "dibatalkan"; o.time = timeStr();
    logActivity("batal", 'Pesanan top up "' + o.title + '" dibatalkan admin.');
    render(); showToast('Pesanan top up "' + o.title + '" dibatalkan.');
  }

  /* ---------- binding form (jalan saat file dimuat, DOM sudah siap) ---------- */
  var tuForm = document.getElementById("topupForm");
  if (tuForm) tuForm.addEventListener("submit", function(ev){
    ev.preventDefault();
    if (isMaint()) { showToast("Top Up sedang maintenance — kembali lagi nanti."); return; }
    if (!selectedPkg) { showToast("Pilih dulu paket top up-nya."); return; }
    var userId = document.getElementById("tuUserId").value.trim();
    var cfg = gameCfg(currentGame);
    var serverId = document.getElementById("tuServerId").value.trim();
    if (!userId) { showToast((cfg.idLabel || "User ID") + " wajib diisi."); return; }
    if (cfg.needsServer && !serverId) { showToast(cfg.serverLabel + " wajib diisi untuk " + cfg.name + "."); return; }
    trackTopupBuy(selectedPkg, userId, serverId).then(function(o){
      if (o) { ev.target.reset(); selectedPkg = null; updateTopupPrice(); location.hash = "#/invoice/" + encodeURIComponent(o.invoiceNo); }
    });
  });
  var pkgForm = document.getElementById("topupPkgForm");
  if (pkgForm) pkgForm.addEventListener("submit", function(ev){
    ev.preventDefault();
    var game = document.getElementById("tpGame").value;
    var name = document.getElementById("tpName").value.trim();
    var amount = parseInt(document.getElementById("tpAmount").value, 10);
    var price = parseInt(document.getElementById("tpPrice").value, 10);
    var editId = document.getElementById("tpEditId").value;
    if (!name || isNaN(amount) || amount <= 0 || isNaN(price) || price < 0) { showToast("Nama paket, jumlah, dan harga wajib diisi dengan benar."); return; }
    var cfg = gameCfg(game);
    if (Server.enabled) {
      var body = { game: game, name: name, amount: amount, price: price };
      var req = editId
        ? api("/api/topup/packages/" + editId, { method: "PUT", body: body })
        : api("/api/topup/packages", { method: "POST", body: body });
      req.then(function(saved){
        var sp = serverPackageToLocal(saved);
        var found = false;
        packages.forEach(function(x, i){ if (x.id === sp.id) { packages[i] = sp; found = true; } });
        if (!found) packages.push(sp);
        cancelEditPackage(); renderTopupAdmin(); renderTopup();
        showToast('Paket "' + name + '" tersimpan.');
      }).catch(function(){ showToast("Gagal menyimpan paket di server."); });
      return;
    }
    if (editId) {
      packages.forEach(function(x){ if (x.id === Number(editId)) { x.game = game; x.name = name; x.amount = amount; x.currency = cfg.currency; x.price = price; } });
    } else {
      packages.push({ id: nextLocalId(), game: game, name: name, amount: amount, currency: cfg.currency, price: price });
    }
    saveLocal();
    cancelEditPackage(); renderTopupAdmin(); renderTopup();
    showToast('Paket "' + name + '" tersimpan.');
  });
  var cancelBtn = document.getElementById("tpCancelEdit");
  if (cancelBtn) cancelBtn.addEventListener("click", cancelEditPackage);

  /* Mode lokal: muat paket dari localStorage saat file dimuat. Mode server:
     initServer() di app.js menimpa dengan data dari API. */
  packages = loadLocal();

  return {
    setPackages: setPackages,
    getPackages: getPackages,
    renderTopup: renderTopup,
    renderTopupGame: renderTopupGame,
    renderTopupAdmin: renderTopupAdmin,
    trackTopupBuy: trackTopupBuy,
    gameCfg: gameCfg
  };
})();
