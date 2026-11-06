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

/* Blok tombol bayar di halaman invoice (dipanggil dari renderInvoice). */
function midtransPayBlock(o){
  var note = "QRIS, e-wallet, atau virtual account bank — total yang dibayar adalah total invoice di atas (harga + biaya admin 10%).";
  if (!Server.enabled) {
    return '<div class="pay-method"><b>Metode pembayaran: Midtrans</b><p>' + note + '</p></div>' +
      '<button class="btn-pay" type="button" disabled>Bayar via Midtrans</button>' +
      '<p class="pay-note">Pembayaran online masih disiapkan. Invoice ini tetap sah — admin mengonfirmasi pembayaran dan statusnya berubah jadi Lunas.</p>';
  }
  if (!Server.payments.configured) {
    return '<div class="pay-method"><b>Metode pembayaran: Midtrans</b><p>' + note + '</p></div>' +
      '<button class="btn-pay" type="button" disabled>Bayar via Midtrans</button>' +
      '<p class="pay-note">Pembayaran online masih disiapkan. Setelah aktif, tombol bayar di sini bisa dipakai — untuk sekarang admin mengonfirmasi pembayaran secara manual.</p>';
  }
  var mode = Server.payments.is_production ? "Production (live)" : "Sandbox (mode tes — bukan pembayaran asli)";
  return '<div class="pay-method"><b>Metode pembayaran: Midtrans (' + mode + ')</b><p>' + note + '</p></div>' +
    '<button class="btn-pay" type="button" id="btnSnapPay">Bayar via Midtrans</button>' +
    '<p class="pay-note">Checkout Midtrans Snap akan terbuka. Setelah bayar, status invoice berubah otomatis begitu webhook Midtrans diterima server — atau admin mengonfirmasi manual dari Panel Admin.</p>';
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
