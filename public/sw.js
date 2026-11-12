/* GankStore service worker — cache aset statis, HTML selalu network-first.
   API Supabase (cross-origin) dan request non-GET tidak pernah di-cache,
   jadi data pesanan/stok selalu segar.
   ATURAN CACHE: tiap kali js/app.js atau css/style.css berubah, naikkan
   ?v= di index.html DAN di CORE bawah ini — kalau tidak, HP yang sudah
   pasang PWA tetap pakai file lama (cache-first) dan fitur baru tidak
   jalan (kejadian 11 Nov 2026: slider tidak bergerak). */
var CACHE = "gankstore-v7";
var CORE = [
  "/", "/index.html", "/manifest.json",
  "/css/style.css?v=10", "/css/hero.css",
  "/js/config.js?v=10", "/js/app.js?v=12", "/js/payments.js?v=8", "/js/topup.js", "/js/qrcode.js?v=7", "/js/support-chat.js?v=11",
  "/js/supabase-client.js?v=12", "/js/lamp.js",
  "/icon.png", "/logo.png", "/banner.png", "/qris.jpg",
  "/brand/gankstore-banner.png",
  "/brand/gankstore-banner-pb.jpg",
  "/brand/gankstore-banner-pb-rank.jpg",
  "/brand/gankstore-banner-pb-exp.jpg",
  "/brand/gankstore-banner-pb-murah.jpg",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"
];
self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(CORE); }).catch(function(){}));
  self.skipWaiting();
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  e.respondWith(
    caches.match(e.request).then(function(cached){
      var network = fetch(e.request).then(function(res){
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){ return cached; });
      var isPage = e.request.mode === "navigate" || url.pathname === "/" || url.pathname.slice(-5) === ".html";
      if (isPage) return network;
      return cached || network;
    })
  );
});

/* Web Push (12 Nov 2026): Edge Function send-push mengirim pesan ke
   perangkat admin yang berlangganan. Handler ini yang menampilkan
   notifikasi di HP walau aplikasi tidak dibuka, dan membukakan halaman
   admin yang benar saat notifikasi diketuk. */
self.addEventListener("push", function (e) {
  var data = {};
  try { if (e.data) data = e.data.json(); } catch (err) { data = {}; }
  var title = data.title || "GankStore";
  var body = data.body || "";
  var url = data.url || "/#/admin/chat";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: url },
      tag: "gankstore-admin",
      renotify: true
    })
  );
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/#/admin/chat";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.location.origin) === 0) {
          list[i].focus();
          list[i].navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
