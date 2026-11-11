/* GankStore — pembayaran Midtrans Snap (server-side).
   Client Key boleh tampil di browser (kunci publik). Server Key TIDAK PERNAH
   ada di file ini — hanya di environment variable server (.env).
   Status: Sandbox dulu; Production menunggu KYC Midtrans disetujui
   (Business review masih In progress). */
function loadPaymentsConfig(){
  var el = document.getElementById("midtransStatus");
  function setText(t){ if (el) el.textContent = t; }
  if (!Server.enabled) { setText("Pembayaran online belum terhubung."); return; }
  api("/api/payments/config").catch(function(){ return null; }).then(function(c){
    if (c) {
      Server.payments = c;
      setText(c.configured
        ? (c.is_production ? "Terhubung — Production (live)" : "Terhubung — Sandbox (mode tes)")
        : "Pembayaran online belum terhubung.");
    } else {
      setText("Pembayaran online belum bisa dicek.");
    }
  });
}

/* QRIS DINAMIS (nominal terisi otomatis) — tanpa gateway.
   Payload dasar = isi QR statis NEXORA TEAM (NMID ID1026480200280),
   di-decode dari qris.jpg 11 Nov 2026. Untuk tiap invoice: ubah tag 01
   11->12 (dinamis), sisipkan tag 54 (jumlah total), hitung ulang CRC16
   (tag 63). Hasilnya QR yang sama seperti QRIS dinamis gateway: pembeli
   scan, nominal sudah terisi, tinggal konfirmasi. Konfirmasi lunas TETAP
   manual (upload bukti + admin) sampai gateway live — QR ini TIDAK
   mendeteksi pembayaran masuk. Payload dasar ini info publik (tertera
   di gambar QR yang memang dipajang), bukan rahasia. */
var QRIS_STATIC_PAYLOAD = "00020101021126570011ID.DANA.WWW011893600915300072707102090007270710303UMI51440014ID.CO.QRIS.WWW0215ID10264802002800303UMI5204581253033605802ID5911NEXORA TEAM6015Kabupaten Gresi6105611776304D216";
function qrisCrc16(str){
  var crc = 0xffff;
  for (var i = 0; i < str.length; i++){
    crc ^= str.charCodeAt(i) << 8;
    for (var j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return ("0000" + crc.toString(16).toUpperCase()).slice(-4);
}
function buildDynamicQrisPayload(amount){
  var amt = String(Math.round(amount || 0));
  var p = QRIS_STATIC_PAYLOAD;
  p = p.slice(0, 10) + "12" + p.slice(12); /* tag 01: nilai "11" statis -> "12" dinamis */
  var i53 = p.indexOf("5303360");
  var at = i53 + 7;
  var tag54 = "54" + ("0" + amt.length).slice(-2) + amt;
  p = p.slice(0, at) + tag54 + p.slice(at);
  p = p.slice(0, -4); /* buang CRC lama, sisa berakhir "6304" */
  return p + qrisCrc16(p);
}
/* Gambar QR dinamis ke #qrisCode + tombol Refresh. Dipanggil renderInvoice
   setelah innerHTML dipasang. Bila pustaka QR gagal dimuat, tampilkan QR
   statis lama sebagai cadangan. */
function renderQrisCode(amount){
  var box = document.getElementById("qrisCode");
  if (!box) return;
  function draw(){
    var payload = buildDynamicQrisPayload(amount);
    box.innerHTML = "";
    if (window.qrcode) {
      try {
        var qr = qrcode(0, "M");
        qr.addData(payload);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
        return;
      } catch (e) {}
    }
    box.innerHTML = '<img class="qris-img" src="qris.jpg" alt="Kode QRIS NEXORA TEAM">';
  }
  draw();
  var btn = document.getElementById("btnRefreshQris");
  if (btn) btn.addEventListener("click", function(){ draw(); if (typeof showToast === "function") showToast("Kode QR diperbarui."); });
}

/* Blok QRIS manual (NEXORA TEAM) di halaman invoice — metode yang JALAN
   sekarang. Pembeli scan, bayar tepat sebesar total invoice, lalu kirim
   bukti ke WhatsApp toko; admin konfirmasi lunas manual dari Daftar Stok. */
function manualQrisBlock(o){
  var total = (typeof formatIDR === "function") ? formatIDR(o.total) : ("Rp" + o.total);
  var waText = encodeURIComponent("Invoice bukti pembayaran " + o.invoiceNo + " — total " + total + ". Foto bukti terlampir.");
  return '<div class="pay-method qris-manual"><b>Bayar manual via QRIS</b>' +
    '<p>Scan kode QRIS di bawah dengan aplikasi apa saja (DANA, GoPay, OVO, m-banking) — nominal <strong>' + total + '</strong> sudah terisi otomatis, tinggal periksa lalu konfirmasi. Atas nama NEXORA TEAM.</p>' +
    '<div class="qris-code" id="qrisCode"></div>' +
    '<button class="qris-refresh" type="button" id="btnRefreshQris"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>Refresh QRIS</button>' +
    '<p class="qris-total">Total bayar: <b>' + total + '</b></p>' +
    '<p>Setelah bayar, kirim bukti pembayaran ke WhatsApp toko (089681992892). Begitu dikonfirmasi lunas, data akun langsung diserahkan ke kamu.</p>' +
    '<a class="btn-pay" id="btnWaProof" href="https://wa.me/6289681992892?text=' + waText + '" target="_blank" rel="noopener">Kirim Bukti via WhatsApp</a></div>';
}

/* Blok tombol bayar di halaman invoice (dipanggil dari renderInvoice). */
function midtransPayBlock(o){
  var note = "QRIS, e-wallet, atau virtual account bank — total yang dibayar adalah total invoice di atas (harga + biaya admin 10%).";
  var manual = manualQrisBlock(o);
  if (!Server.enabled) {
    return manual + '<div class="pay-method"><b>Metode pembayaran: Midtrans</b><p>' + note + '</p></div>' +
      '<button class="btn-pay" type="button" disabled>Bayar via Midtrans</button>' +
      '<p class="pay-note">Pembayaran online masih disiapkan. Invoice ini tetap sah — pembayaran dikonfirmasi dan statusnya berubah jadi Lunas.</p>';
  }
  if (!Server.payments.configured) {
    return manual + '<div class="pay-method"><b>Metode pembayaran: Midtrans</b><p>' + note + '</p></div>' +
      '<button class="btn-pay" type="button" disabled>Bayar via Midtrans</button>' +
      '<p class="pay-note">Pembayaran online masih disiapkan. Setelah aktif, tombol bayar di sini bisa dipakai — untuk sekarang pembayaran dikonfirmasi secara manual.</p>';
  }
  var mode = Server.payments.is_production ? "Production (live)" : "Sandbox (mode tes — bukan pembayaran asli)";
  return manual + '<div class="pay-method"><b>Metode pembayaran: Midtrans (' + mode + ')</b><p>' + note + '</p></div>' +
    '<button class="btn-pay" type="button" id="btnSnapPay">Bayar via Midtrans</button>' +
    '<p class="pay-note">Checkout Midtrans Snap akan terbuka. Setelah bayar, status invoice berubah otomatis begitu webhook Midtrans diterima server — atau dikonfirmasi manual oleh toko.</p>';
}

function loadSnapJs(cb){
  if (window.snap) { cb(); return; }
  var host = Server.payments.is_production ? "https://app.midtrans.com/snap/snap.js" : "https://app.sandbox.midtrans.com/snap/snap.js";
  var s = document.createElement("script");
  s.src = host;
  s.setAttribute("data-client-key", Server.payments.client_key || "");
  s.onload = cb;
  s.onerror = function(){ showToast("Gagal memuat Midtrans Snap. Cek koneksi lalu coba lagi."); };
  document.head.appendChild(s);
}

function requestSnapPay(invoiceNo){
  if (!Server.enabled || !Server.payments.configured) { showToast("Midtrans belum terhubung di server."); return; }
  api("/api/payments/snap-token", { method: "POST", body: { invoice_no: invoiceNo } }).then(function(r){
    if (!r || !r.token) { showToast("Gagal membuat pembayaran Midtrans."); return; }
    loadSnapJs(function(){
      window.snap.pay(r.token, {
        onSuccess: function(){
          showToast("Pembayaran berhasil — menunggu konfirmasi Midtrans.");
          setTimeout(function(){ refreshServerData().then(function(){ renderInvoice(invoiceNo); }); }, 1500);
        },
        onPending: function(){
          showToast("Pembayaran masih pending — cek status di invoice ini.");
          refreshServerData();
        },
        onError: function(){ showToast("Pembayaran gagal. Coba lagi."); },
        onClose: function(){ showToast("Checkout Midtrans ditutup sebelum selesai."); }
      });
    });
  }).catch(function(){ showToast("Gagal membuat pembayaran Midtrans. Coba lagi."); });
}

/* Isi status Midtrans di halaman Pengaturan begitu halaman siap. */
loadPaymentsConfig();
