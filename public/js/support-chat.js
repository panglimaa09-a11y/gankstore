/* GankStore — Live chat support (Jarvis AI).
   Gelembung chat di semua halaman. Jawaban AI lewat backend /pb-ai/support
   (FastAPI :8765 -> 9Router, pola async job + polling seperti /ask).
   Bila AI gagal/tidak terjangkau: tampilkan pesan gangguan + arahkan ke
   WhatsApp admin. Riwayat tersimpan di localStorage; tombol "Minta admin
   balas" mengirim transkrip ke inbox Pesan Support (#/admin/support). */
(function () {
  "use strict";
  var AI_BASE = (window.GS_CONFIG && window.GS_CONFIG.SUPPORT_AI_URL) || "https://curvature-reunite-perfected.ngrok-free.dev/pb-ai";
  var WA_NUMBER = "6289681992892";
  var LS_KEY = "gs_chat_history";
  var MAX_MSGS = 50;
  var GREETING = "Halo! Aku Jarvis, support GankStore. Ada yang bisa dibantu? Tanya soal cara beli, cara bayar, atau status pesanan — kalau ada nomor invoice, ketik saja nomornya.";
  var FALLBACK = "Maaf, AI support lagi gangguan. Silakan chat admin langsung via WhatsApp, atau ketuk \"Minta admin balas\" di bawah — nanti admin balas.";

  var fab, panel, body, form, input, chips, escForm, escName, escContact;
  var messages = [];
  var sending = false;
  var pollTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtIDR(n) {
    if (typeof window.formatIDR === "function") return window.formatIDR(n);
    return "Rp" + Number(n || 0).toLocaleString("id-ID");
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) messages = arr.slice(-MAX_MSGS); }
    } catch (e) { messages = []; }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(messages.slice(-MAX_MSGS))); } catch (e) {}
  }
  function push(role, text) {
    messages.push({ role: role, text: String(text), ts: Date.now() });
    if (messages.length > MAX_MSGS) messages = messages.slice(-MAX_MSGS);
    save();
  }
  function render() {
    if (!body) return;
    var html = "";
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === "sys") html += '<div class="chat-sys">' + esc(m.text) + "</div>";
      else html += '<div class="chat-msg ' + (m.role === "user" ? "me" : "ai") + '">' + esc(m.text).replace(/\n/g, "<br>") + "</div>";
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }
  function setTyping(on) {
    var t = document.getElementById("chatTyping");
    if (t) t.hidden = !on;
    if (body) body.scrollTop = body.scrollHeight;
  }
  function setBusy(b) {
    sending = b;
    if (input) input.disabled = b;
    var btn = form ? form.querySelector(".chat-send") : null;
    if (btn) btn.disabled = b;
  }
  function toast(msg) {
    if (typeof window.showToast === "function") { window.showToast(msg); return; }
    push("sys", msg); render();
  }

  function invoiceContext(text) {
    var m = String(text || "").match(/INV-[0-9][0-9A-Za-z-]*/i);
    if (!m) return Promise.resolve("");
    var inv = m[0].toUpperCase();
    if (typeof window.api !== "function") return Promise.resolve("Nomor invoice " + inv + " disebut pembeli, tapi statusnya tidak bisa dicek saat ini.");
    return window.api("/api/orders/" + encodeURIComponent(inv)).then(function (o) {
      if (!o || !o.invoiceNo) return "Nomor invoice " + inv + " tidak ditemukan di sistem.";
      var status = o.status === "lunas" ? "Lunas" : o.status === "dibatalkan" ? "Dibatalkan" : "Menunggu Pembayaran";
      var proof = o.proofImage ? "bukti pembayaran SUDAH diunggah" : "bukti pembayaran BELUM diunggah";
      return "Pesanan " + inv + ": produk " + (o.title || "-") + ", status " + status + ", total " + fmtIDR(o.total) + ", " + proof + ".";
    }).catch(function () {
      return "Nomor invoice " + inv + " tidak ditemukan di sistem.";
    });
  }

  function askAI(question, context) {
    var history = messages.filter(function (m) { return m.role === "user" || m.role === "ai"; })
      .slice(-6).map(function (m) { return { role: m.role, content: m.text }; });
    return fetch(AI_BASE + "/support", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify({ question: question, history: history, context: context || "" })
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.job_id) throw new Error("no job");
      return pollJob(d.job_id);
    });
  }
  function pollJob(jobId) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      function tick() {
        tries++;
        fetch(AI_BASE + "/support/" + encodeURIComponent(jobId), {
          headers: { "ngrok-skip-browser-warning": "true" }
        }).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        }).then(function (d) {
          if (d && d.status === "done" && d.answer) return resolve(String(d.answer));
          if (d && d.status === "error") return reject(new Error("ai error"));
          if (tries >= 30) return reject(new Error("timeout"));
          pollTimer = setTimeout(tick, 2000);
        }).catch(reject);
      }
      tick();
    });
  }

  function send(text) {
    text = String(text || "").trim();
    if (!text || sending) return;
    push("user", text);
    render();
    setBusy(true);
    setTyping(true);
    invoiceContext(text).then(function (ctx) {
      return askAI(text, ctx);
    }).then(function (answer) {
      setTyping(false);
      push("ai", answer);
      render();
    }).catch(function () {
      setTyping(false);
      push("sys", FALLBACK);
      render();
    }).then(function () {
      setBusy(false);
      if (input) input.focus();
    });
  }

  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    if (fab) fab.setAttribute("aria-expanded", "true");
    if (!messages.length) { push("ai", GREETING); render(); }
    render();
    if (input) input.focus();
  }
  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    if (fab) fab.setAttribute("aria-expanded", "false");
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function escalate() {
    var name = escName ? escName.value.trim() : "";
    var contact = escContact ? escContact.value.trim() : "";
    if (name.length < 2) { toast("Isi namamu dulu ya."); return; }
    if (contact.length < 5) { toast("Isi WhatsApp / email untuk dibalas admin."); return; }
    var lines = messages.map(function (m) {
      return (m.role === "user" ? "Pembeli" : m.role === "ai" ? "Jarvis" : "Sistem") + ": " + m.text;
    }).join("\n");
    if (typeof window.api !== "function") { toast("Gagal mengirim ke admin. Coba lagi atau hubungi via WhatsApp."); return; }
    window.api("/api/support", { method: "POST", body: { name: name, contact: contact, topic: "Live Chat", message: lines.slice(0, 4000) } })
      .then(function () {
        if (escForm) escForm.hidden = true;
        push("sys", "Sudah diteruskan ke admin. Nanti dibalas via " + contact + ".");
        render();
        toast("Obrolan terkirim ke admin.");
      })
      .catch(function () { toast("Gagal mengirim ke admin. Coba lagi atau hubungi via WhatsApp."); });
  }

  function init() {
    fab = document.getElementById("chatFab");
    panel = document.getElementById("chatPanel");
    body = document.getElementById("chatBody");
    form = document.getElementById("chatForm");
    input = document.getElementById("chatInput");
    chips = document.getElementById("chatChips");
    escForm = document.getElementById("chatEscalateForm");
    escName = document.getElementById("escName");
    escContact = document.getElementById("escContact");
    if (!fab || !panel || !body) return;
    load();
    render();
    fab.addEventListener("click", function () {
      if (panel.hidden) openPanel(); else closePanel();
    });
    var closeBtn = document.getElementById("chatClose");
    if (closeBtn) closeBtn.addEventListener("click", closePanel);
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = input.value;
      input.value = "";
      send(v);
    });
    if (chips) chips.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-q]") : null;
      if (b) send(b.getAttribute("data-q"));
    });
    var escBtn = document.getElementById("chatEscalate");
    if (escBtn) escBtn.addEventListener("click", function () {
      if (escForm) { escForm.hidden = !escForm.hidden; if (!escForm.hidden && escName) escName.focus(); }
    });
    var escSend = document.getElementById("escSend");
    if (escSend) escSend.addEventListener("click", escalate);
    var escCancel = document.getElementById("escCancel");
    if (escCancel) escCancel.addEventListener("click", function () { if (escForm) escForm.hidden = true; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
