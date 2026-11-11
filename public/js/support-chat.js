/* GankStore — Live chat support AI Jarvis + admin (12 Nov 2026).
   AI menjawab dulu (Jarvis, via backend /support -> 9Router/Groq).
   Setiap pesan pembeli TETAP tersimpan di Supabase (live_chats +
   live_chat_messages) dan jawaban AI juga disimpan sebagai pesan admin,
   jadi admin melihat percakapan lengkap di #/admin/chat, dapat push
   notification untuk pesan pembeli, dan bisa ikut membalas kapan saja.
   Kalau AI gangguan, pembeli tidak mentok: pesan sys jujur + admin
   sudah menerima pesan itu. Riwayat tersimpan di localStorage + server.
   Polling balasan tiap 3 detik selama panel terbuka. */
(function () {
  "use strict";
  var LS_CHAT = "gs_live_chat_id";
  var LS_CACHE = "gs_live_chat_cache";
  var POLL_MS = 3000;
  var MAX_MSGS = 100;
  var AI_URL = (window.GS_CONFIG && window.GS_CONFIG.SUPPORT_AI_URL) || "";
  var GREETING = "Halo! Aku Jarvis, support AI GankStore. Tanya soal cara beli, bayar QRIS, atau status pesanan — kalau aku tidak bisa jawab, admin akan membalas di sini juga.";
  var AI_FALLBACK = "Maaf, AI support lagi gangguan. Pesanmu sudah diteruskan ke admin — admin akan membalas di sini, atau chat admin via WhatsApp.";

  var fab, panel, body, form, input, chips;
  var chatId = null;
  var messages = [];
  var pollTimer = null;
  var sending = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function getChatId() {
    try {
      chatId = localStorage.getItem(LS_CHAT);
      if (!chatId) {
        chatId = uuid();
        localStorage.setItem(LS_CHAT, chatId);
      }
    } catch (e) {
      chatId = chatId || uuid();
    }
    return chatId;
  }
  function loadCache() {
    try {
      var raw = localStorage.getItem(LS_CACHE);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) messages = arr.filter(function (m) { return !m.temp; }).slice(-MAX_MSGS);
      }
    } catch (e) { messages = []; }
  }
  function saveCache() {
    try { localStorage.setItem(LS_CACHE, JSON.stringify(messages.filter(function (m) { return !m.temp; }).slice(-MAX_MSGS))); } catch (e) {}
  }
  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function render() {
    if (!body) return;
    var html = "";
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === "sys") {
        html += '<div class="chat-sys">' + esc(m.text) + "</div>";
      } else {
        html += '<div class="chat-msg ' + (m.role === "user" ? "me" : "ai") + '">' +
          esc(m.text).replace(/\n/g, "<br>") +
          '<span class="chat-time">' + esc(fmtTime(m.ts)) + "</span></div>";
      }
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }
  function push(role, text, ts) {
    var m = { role: role, text: String(text), ts: ts || Date.now() };
    messages.push(m);
    if (messages.length > MAX_MSGS) messages = messages.slice(-MAX_MSGS);
    saveCache();
    return m;
  }
  function removeMsg(m) {
    var i = messages.indexOf(m);
    if (i >= 0) messages.splice(i, 1);
    saveCache();
  }
  function toast(msg) {
    if (typeof window.showToast === "function") { window.showToast(msg); return; }
    push("sys", msg); render();
  }
  function mergeServer(list) {
    // Gabungkan pesan server (sumber kebenaran) dengan cache lokal.
    var byKey = {};
    var merged = [];
    function keyOf(m) { return (m.role || "") + "|" + (m.text || "") + "|" + Math.floor((m.ts || 0) / 5000); }
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].temp) continue;
      var k = keyOf(messages[i]);
      if (!byKey[k]) { byKey[k] = true; merged.push(messages[i]); }
    }
    for (var j = 0; j < list.length; j++) {
      var sm = list[j];
      var nm = {
        role: sm.sender === "admin" ? "ai" : "user",
        text: String(sm.text || ""),
        ts: new Date(sm.created_at || Date.now()).getTime(),
      };
      var k2 = keyOf(nm);
      if (!byKey[k2]) { byKey[k2] = true; merged.push(nm); }
    }
    merged.sort(function (a, b) { return a.ts - b.ts; });
    // Pertahankan placeholder "sedang mengetik" yang masih aktif.
    for (var t = 0; t < messages.length; t++) {
      if (messages[t].temp) merged.push(messages[t]);
    }
    messages = merged.slice(-MAX_MSGS);
    saveCache();
  }
  function fetchMessages() {
    if (typeof window.api !== "function") return Promise.resolve(false);
    return window.api("/api/live-chats/" + encodeURIComponent(getChatId()) + "/messages")
      .then(function (list) {
        if (!Array.isArray(list)) return false;
        var before = messages.length;
        mergeServer(list);
        render();
        return messages.length !== before;
      })
      .catch(function () { return false; });
  }
  function startPoll() {
    stopPoll();
    fetchMessages();
    pollTimer = setInterval(fetchMessages, POLL_MS);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function ensureChat() {
    if (typeof window.api !== "function") return Promise.resolve(false);
    return window.api("/api/live-chats", { method: "POST", body: { id: getChatId() } })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  function historyForAI() {
    var h = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.temp || m.role === "sys") continue;
      h.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
    }
    return h.slice(-6);
  }
  function orderContext(text) {
    var m = String(text || "").match(/INV-[0-9-]+/i);
    if (!m || typeof window.api !== "function") return Promise.resolve("");
    return window.api("/api/orders/" + encodeURIComponent(m[0].toUpperCase()))
      .then(function (o) {
        if (!o) return "";
        return "Invoice " + m[0].toUpperCase() + ": produk " + (o.title || o.product || "?") +
          ", total Rp" + (o.total != null ? o.total : "?") + ", status " + (o.status || "?") + ".";
      })
      .catch(function () { return ""; });
  }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function askAI(question, typingMsg) {
    if (!AI_URL) { removeMsg(typingMsg); render(); return Promise.resolve(); }
    var ctx = "";
    return orderContext(question).then(function (c) {
      ctx = c || "";
      var payload = { question: question, history: historyForAI(), context: ctx };
      var tries = 0;
      function postOnce() {
        tries++;
        return fetch(AI_URL.replace(/\/$/, "") + "/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        }).catch(function (err) {
          // Tunnel ngrok free kadang memutus koneksi sesaat — coba lagi.
          if (tries < 3) return sleep(1500).then(postOnce);
          throw err;
        });
      }
      function trySync(attempt) {
        // Jalur utama (12 Nov 2026): SATU request tunggu jawaban (maks 25 dtk
        // di server). Polling GET dari browser terbukti tidak pernah sampai
        // ke backend saat tes live, jadi jangan andalkan polling saja.
        // Tunnel ngrok kadang memutus koneksi di awal — coba sync sampai 3x.
        attempt = attempt || 1;
        return fetch(AI_URL.replace(/\/$/, "") + "/support-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        }).then(function (res) {
          if (res && res.status === "done" && res.answer) return res;
          if (res && res.status === "error") throw new Error("ai error");
          if (res && res.status === "pending" && res.job_id) return res;
          throw new Error("bad sync");
        }).catch(function (err) {
          if (attempt < 3 && err && err.message !== "ai error") {
            return sleep(1500).then(function () { return trySync(attempt + 1); });
          }
          // Sync gagal (tunnel memutus dsb) — jatuh ke jalur async + polling.
          return postOnce();
        });
      }
      return trySync(1);
    }).then(function (job) {
      if (job && job.status === "done" && job.answer) return job.answer;
      var jobId = job && job.job_id;
      if (!jobId) throw new Error("no job");
      var n = 0;
      function poll() {
        n++;
        return fetch(AI_URL.replace(/\/$/, "") + "/support/" + encodeURIComponent(jobId))
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.status === "done" && res.answer) return res.answer;
            if (res && res.status === "error") throw new Error("ai error");
            if (n >= 36) throw new Error("ai timeout");
            return sleep(2500).then(poll);
          })
          .catch(function (err) {
            // Gangguan jaringan sesaat saat polling: jangan langsung
            // menyerah, coba lagi selama masih dalam batas.
            if (n < 36 && err && err.message !== "ai error" && err.message !== "ai timeout") {
              return sleep(2500).then(poll);
            }
            throw err;
          });
      }
      return poll();
    }).then(function (answer) {
      removeMsg(typingMsg);
      // Simpan jawaban AI sebagai pesan admin: admin melihat transkrip
      // lengkap di #/admin/chat; pembeli menerima via polling server.
      if (typeof window.api === "function") {
        return window.api("/api/live-chats/" + encodeURIComponent(getChatId()) + "/messages", {
          method: "POST",
          body: { sender: "admin", text: String(answer).slice(0, 2000) },
        }).then(function () { return fetchMessages(); })
          .catch(function () { push("ai", answer); render(); });
      }
      push("ai", answer);
      render();
    }).catch(function () {
      removeMsg(typingMsg);
      push("sys", AI_FALLBACK);
      render();
    });
  }
  function send(text) {
    text = String(text || "").trim();
    if (!text || sending) return;
    if (text.length > 1000) text = text.slice(0, 1000);
    sending = true;
    if (input) input.disabled = true;
    var btn = form ? form.querySelector(".chat-send") : null;
    if (btn) btn.disabled = true;
    ensureChat().then(function (ok) {
      if (!ok || typeof window.api !== "function") throw new Error("no api");
      return window.api("/api/live-chats/" + encodeURIComponent(getChatId()) + "/messages", {
        method: "POST",
        body: { sender: "buyer", text: text },
      });
    }).then(function () {
      push("user", text);
      render();
      // AI menjawab dulu; admin sudah menerima pesan ini di panelnya.
      var typing = push("ai", "Jarvis sedang mengetik…");
      typing.temp = true;
      render();
      askAI(text, typing);
      return fetchMessages();
    }).catch(function () {
      push("user", text);
      push("sys", "Pesan belum terkirim (server tidak terjangkau). Coba lagi, atau hubungi admin via WhatsApp.");
      render();
    }).then(function () {
      sending = false;
      if (input) { input.disabled = false; input.focus(); }
      if (btn) btn.disabled = false;
    });
  }
  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    if (fab) fab.setAttribute("aria-expanded", "true");
    if (!messages.length) { push("ai", GREETING); render(); }
    render();
    startPoll();
    if (input) input.focus();
  }
  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    if (fab) fab.setAttribute("aria-expanded", "false");
    stopPoll();
  }
  function init() {
    fab = document.getElementById("chatFab");
    panel = document.getElementById("chatPanel");
    body = document.getElementById("chatBody");
    form = document.getElementById("chatForm");
    input = document.getElementById("chatInput");
    chips = document.getElementById("chatChips");
    if (!fab || !panel || !body) return;
    getChatId();
    loadCache();
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
