/* GankStore service worker — cache aset statis, HTML selalu network-first.
   API Supabase (cross-origin) dan request non-GET tidak pernah di-cache,
   jadi data pesanan/stok selalu segar. */
var CACHE = "gankstore-v2";
var CORE = [
  "/", "/index.html", "/manifest.json",
  "/css/style.css", "/css/hero.css",
  "/js/config.js", "/js/app.js", "/js/payments.js", "/js/topup.js",
  "/js/supabase-client.js", "/js/lamp.js",
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
