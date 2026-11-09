      "use strict";
      var GAMES=window.GS_CONFIG.GAMES;
      var state={products:[],filterGame:"Semua",query:"",sort:"baru",status:"semua",photoData:"",seq:0,unitSeq:0};
      var grid=document.getElementById("grid"), homeGrid=document.getElementById("homeGrid"), emptyState=document.getElementById("emptyState"), emptyTitle=document.getElementById("emptyTitle"), emptyText=document.getElementById("emptyText"), catalogCount=document.getElementById("catalogCount"), chipsBox=document.getElementById("gameChips"), toastEl=document.getElementById("toast");
      var toastTimer=null, currentDetail=null;
      /* ---------- mode server (Supabase) vs lokal ---------- */
      /* Backend GankStore adalah Supabase (project baru khusus GankStore).
         Stok/pesanan/akun tersimpan di Postgres Supabase. Kalau Supabase
         tidak terjangkau, semua fungsi lama (localStorage + memori) tetap
         jalan (mode lokal). Tidak ada lagi backend Python. */
      var Server={enabled:false,token:null,user:null,payments:{configured:false,is_production:false,client_key:null}};
function apiToken(){ try { return (window.Supa && Supa.getAccessToken()) || localStorage.getItem("gankstore_token"); } catch (e) { return window.Supa ? Supa.getAccessToken() : null; } }
function setToken(t){ try { if (t) localStorage.setItem("gankstore_token", t); else localStorage.removeItem("gankstore_token"); } catch (e) {} }

/* ---------- api(): REST lama -> Supabase ----------
   Bentuk kembalian dipertahankan sama seperti backend FastAPI lama
   (snake_case, invoice_no, buyer_email, cred_user, ...) supaya
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

  /* --- produk (listing; stok = stock_units) --- */
  if (base === "/api/products" && method === "GET") return Supa.listProducts(isAdmin());
  if (base === "/api/products" && method === "POST") return Supa.createProduct(body);
  if (seg(1) === "api" && seg(2) === "products" && seg(4) === "relist" && method === "POST") return Supa.relistProduct(Number(seg(3)));
  if (seg(1) === "api" && seg(2) === "products" && seg(3) && method === "DELETE") return Supa.deleteProduct(Number(seg(3)));
  /* --- unit stok --- */
  if (base === "/api/stock-units" && method === "GET") return Supa.listStockUnits(null);
  if (seg(1) === "api" && seg(2) === "products" && seg(4) === "stock" && method === "GET") return Supa.listStockUnits(Number(seg(3)));
  if (seg(1) === "api" && seg(2) === "products" && seg(4) === "stock" && method === "POST") return Supa.addStockUnits(Number(seg(3)), body.units || []);
  if (seg(1) === "api" && seg(2) === "stock-units" && seg(3) && method === "DELETE") return Supa.deleteStockUnit(Number(seg(3)));

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
  if (base === "/api/auth/google" && method === "POST") return Promise.reject(new Error("Gunakan tombol Google."));
  if (base === "/api/auth/logout" && method === "POST") return Supa.signOut();
  if (base === "/api/auth/me" && method === "GET") return Supa.me();

  /* --- Midtrans --- */
  if (base === "/api/payments/snap-token" && method === "POST") return Supa.requestSnapToken(body.invoice_no);

  return Promise.reject(new Error("HTTP 404"));
}
      function serverProductToLocal(p){return{id:p.id,game:p.game,title:p.title,rank:p.rank||"",level:p.level||"",server:p.server||"",price:p.price,specs:p.specs||[],desc:p.desc||"",photo:p.photo||"",sold:p.status==="terjual",status:p.status,stockAvailable:Number(p.stock_available||0),stockDipesan:Number(p.stock_dipesan||0),stockTerjual:Number(p.stock_terjual||0),stockTotal:Number(p.stock_total||0),units:[]};}
      function serverOrderToLocal(o){return{id:o.product_id||o.package_id,kind:o.kind||"akun",invoiceNo:o.invoice_no,title:o.title,price:o.price,fee:o.fee,total:o.total,photo:o.photo||"",game:o.game,rank:o.rank||"",time:(o.created_at||"").slice(11,19),status:o.status,buyerName:o.buyer_name||"",buyerEmail:o.buyer_email||"",userId:o.user_id_game||"",serverId:o.server_id||"",packageName:o.package_name||"",amount:o.amount||"",currency:o.currency||"",credPending:!!o.cred_pending,credRevealed:!!o.cred_revealed,credUser:"",credPass:""};}
      function serverPackageToLocal(p){return{id:p.id,game:p.game,name:p.name,amount:p.amount,currency:p.currency,price:p.price};}
      /* Unit stok admin: tempel ke produk (dikelompokkan per product_id).
         Dipakai halaman Daftar Stok. Non-admin tidak pernah memuat unit. */
      function attachUnits(units){
        var map={};
        (units||[]).forEach(function(u){
          var k=u.product_id;if(!map[k])map[k]=[];
          map[k].push({id:u.id,username:u.cred_user||"",password:u.cred_pass||"",status:u.status,invoiceNo:u.order_invoice||""});
        });
        state.products.forEach(function(p){p.units=map[p.id]||[];});
      }
      function loadUnitsForAdmin(){
        if(!Server.enabled||!isAdminUser())return Promise.resolve();
        return api("/api/stock-units").then(function(units){attachUnits(units||[]);}).catch(function(){});
      }
      function refreshServerData(){
        if(!Server.enabled)return Promise.resolve();
        return Promise.all([api("/api/products").catch(function(){return[];}),api("/api/orders").catch(function(){return[];}),api("/api/topup/packages").catch(function(){return[];})]).then(function(res){
          state.products=(res[0]||[]).map(serverProductToLocal);
          state.seq=(res[0]||[]).reduce(function(m,p){return Math.max(m,p.id||0);},0);
          analytics.orders=(res[1]||[]).map(serverOrderToLocal);
          if(window.TopUp&&TopUp.setPackages)TopUp.setPackages((res[2]||[]).map(serverPackageToLocal));
          return loadUnitsForAdmin().then(function(){render();});
        }).catch(function(){});
      }
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
      if (Server.user && Server.user.is_admin) {
        return loadUnitsForAdmin();
      }
    });
  }).catch(function(){
    if (attempt < 3) { return new Promise(function(res){ setTimeout(res, 1000); }).then(function(){ return initServer(attempt + 1); }); }
    Server.enabled = false;
  });
}
      function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
      function formatIDR(n){return "Rp"+Number(n||0).toLocaleString("id-ID");}
      function showToast(msg){toastEl.textContent=msg;toastEl.classList.add("show");if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.classList.remove("show");},2600);}

      /* ---------- statistik, live tracking, pesanan otomatis ---------- */
      var analytics={pageViews:0,detailViews:0,buyClicks:0,activity:[],orders:[],lastRoute:"",lastRouteAt:0,invoiceSeq:0};
      function timeStr(d){return (d||new Date()).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});}
      /* ---------- stok unit (model baru 6 Nov 2026) ----------
         products = LISTING; 1 listing punya banyak unit stok.
         pStatus diturunkan dari jumlah unit bila tersedia:
           tersedia > 0            -> 'tersedia' (masih bisa dibeli)
           0 tersedia, dipesan > 0 -> 'dipesan'
           0 tersedia/dipesan, terjual > 0 -> 'terjual'
           0 unit sama sekali      -> 'habis' */
      function stockCounts(p){return{av:Number(p.stockAvailable||0),di:Number(p.stockDipesan||0),te:Number(p.stockTerjual||0),total:Number(p.stockTotal||0)};}
      function sumStock(kind){return state.products.reduce(function(s,p){var c=stockCounts(p);return s+(kind==="av"?c.av:kind==="di"?c.di:kind==="te"?c.te:c.total);},0);}
      function pStatus(p){
        if(p.stockTotal!=null){
          var c=stockCounts(p);
          if(c.av>0)return"tersedia";
          if(c.di>0)return"dipesan";
          if(c.total>0)return"terjual";
          return"habis";
        }
        return p.status||(p.sold?"terjual":"tersedia");
      }
      /* Mode lokal: hitung ulang jumlah + status dari p.units. */
      function syncLocalStock(p){
        var u=p.units||[];
        p.stockTotal=u.length;
        p.stockAvailable=u.filter(function(x){return x.status==="tersedia";}).length;
        p.stockDipesan=u.filter(function(x){return x.status==="dipesan";}).length;
        p.stockTerjual=u.filter(function(x){return x.status==="terjual";}).length;
        p.status=pStatus(p);
        p.sold=(p.status==="terjual");
      }
      function setStatus(p,st){p.status=st;p.sold=(st==="terjual");}
      function countBy(st){return state.products.filter(function(p){return pStatus(p)===st;}).length;}
      /* Pendapatan akun = dari ORDER terjual (1 order = 1 unit), bukan
         dari status listing — listing yang masih tersedia pun bisa
         sudah menjual beberapa unit. */
      function totalRevenue(){var a=analytics.orders.filter(function(o){return o.kind==="akun"&&o.status==="terjual";}).reduce(function(s,o){return s+Number(o.price||0);},0);var b=analytics.orders.filter(function(o){return o.kind==="topup"&&o.status==="terjual";}).reduce(function(s,o){return s+Number(o.price||0);},0);return a+b;}
      function logActivity(tag,text){
        analytics.activity.unshift({time:timeStr(),tag:tag,text:text});
        if(analytics.activity.length>40)analytics.activity.length=40;
        renderFeed();renderTicker();
      }
      function renderFeed(){
        var box=document.getElementById("activityFeed");if(!box)return;
        if(!analytics.activity.length){box.innerHTML='<li><span class="feed-time">—</span><span>Belum ada aktivitas.</span></li>';return;}
        var tagLabel={kunjung:"Kunjungan",lihat:"Lihat",beli:"Klik Beli",pesan:"Dipesan",lunas:"Terjual",stok:"Stok",batal:"Batal"};
        box.innerHTML=analytics.activity.map(function(a){
          var cls=a.tag==="lunas"?"sale":(a.tag==="beli"||a.tag==="pesan")?"buy":"";
          return '<li><span class="feed-time">'+a.time+'</span><span class="feed-tag '+cls+'">'+(tagLabel[a.tag]||"Info")+'</span><span>'+esc(a.text)+"</span></li>";
        }).join("");
      }
      function tickerText(){
        var parts=[];
        analytics.orders.slice(0,3).forEach(function(o){
          parts.push(o.status==="terjual"?("<b>TERJUAL:</b> "+esc(o.title)+" — "+formatIDR(o.price)):("<b>DIPESAN:</b> "+esc(o.title)+" — "+formatIDR(o.price)));
        });
        parts.push("Stok tersedia: <b>"+sumStock("av")+" akun</b>");
        if(sumStock("te")>0)parts.push("Terjual: <b>"+sumStock("te")+" akun</b>");
        if(totalRevenue()>0)parts.push("Total penjualan: <b>"+formatIDR(totalRevenue())+"</b>");
        return parts.join(" &nbsp;◆&nbsp; ");
      }
      function renderTicker(){
        var bar=document.querySelector(".livebar");if(!bar)return;
        var t=document.getElementById("tickerTrack");if(!t)return;
        /* Ticker SELALU tampil. Saat stok/pesanan/penjualan masih kosong,
           tampilkan teks bermakna tanpa angka palsu — jangan deretan nol. */
        var empty=!analytics.orders.length&&!state.products.length&&totalRevenue()===0;
        t.innerHTML=empty?"<span>Toko buka — akun Point Blank siap main &nbsp;◆&nbsp; Pembayaran aman via Midtrans &nbsp;◆&nbsp; Butuh bantuan? Hubungi Support</span>":"<span>"+tickerText()+"</span>";
      }
      function showEventPopup(p,kind){
        var box=document.getElementById("salePopups");if(!box)return;
        while(box.children.length>=2)box.removeChild(box.firstChild);
        var el=document.createElement("div");el.className="sale-popup";
        var isSale=kind==="lunas";
        el.innerHTML='<div class="sp-thumb">'+(p.photo?'<img src="'+p.photo+'" alt="" />':'<img src="icon.png" alt="GankStore" />')+'</div><div class="sp-body"><div class="sp-tag">'+(isSale?"Baru saja terjual":"Baru saja dipesan")+'</div><div class="sp-title">'+esc(p.title)+'</div><div class="sp-meta">'+formatIDR(p.price)+" · "+timeStr()+"</div></div><button class=\"sp-close\" type=\"button\" aria-label=\"Tutup pop-up\">×</button>";
        box.appendChild(el);
        var kill=function(){el.classList.add("hide");setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},320);};
        el.querySelector(".sp-close").addEventListener("click",kill);
        setTimeout(kill,6000);
      }
      function adminFee(price){return Math.round(Number(price||0)*0.10);}
      function makeInvoiceNo(){analytics.invoiceSeq++;var d=new Date();function p2(n){return (n<10?"0":"")+n;}return "INV-"+d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+"-"+p2(d.getHours())+p2(d.getMinutes())+p2(d.getSeconds())+"-"+analytics.invoiceSeq;}
      function findOrder(inv){for(var i=0;i<analytics.orders.length;i++){if(analytics.orders[i].invoiceNo===inv)return analytics.orders[i];}return null;}
      function trackBuy(p){
        /* Beli = klaim 1 unit stok yang tersedia. Listing tetap bisa
           dibeli selama sisa unit > 0 (server mengklaim atomik). */
        if(stockCounts(p).av<=0)return Promise.resolve(null);
        if(Server.enabled){
          return api("/api/orders",{method:"POST",body:{product_id:p.id}}).then(function(o){
            if(!o)return null;
            var order=serverOrderToLocal(o);
            analytics.buyClicks++;
            p.stockAvailable=Math.max(0,p.stockAvailable-1);p.stockDipesan++;
            p.status=pStatus(p);p.sold=(p.status==="terjual");
            analytics.orders.unshift(order);
            /* Tandai unit yang diklaim server di memori lokal juga:
               server mengklaim unit 'tersedia' dengan id terkecil —
               sama seperti urutan lokal (listStockUnits order id asc).
               Tanpa ini chip unit di Daftar Stok ketinggalan 'Tersedia'
               padahal hitungan stok sudah berkurang. */
            var claimed=false;
            (p.units||[]).forEach(function(u){if(!claimed&&u.status==="tersedia"){u.status="dipesan";u.invoiceNo=order.invoiceNo;claimed=true;}});
            logActivity("pesan",'Akun "'+p.title+'" dipesan — invoice '+order.invoiceNo+" terbit ("+formatIDR(order.total)+" termasuk biaya admin "+formatIDR(order.fee)+"). Menunggu pembayaran via Midtrans.");
            showEventPopup(p,"pesan");
            showToast('Pesanan dibuat! Invoice '+order.invoiceNo+" — 1 unit stok otomatis ditandai DIPESAN.");
            render();
            return order;
          }).catch(function(){showToast("Gagal membuat pesanan di server. Coba lagi.");return null;});
        }
        /* Mode lokal: klaim unit pertama yang tersedia di memori. */
        var unit=null;(p.units||[]).forEach(function(u){if(!unit&&u.status==="tersedia")unit=u;});
        if(!unit)return Promise.resolve(null);
        analytics.buyClicks++;
        unit.status="dipesan";
        var u=currentUser();
        var fee=adminFee(p.price);
        var order={id:p.id,invoiceNo:makeInvoiceNo(),title:p.title,price:p.price,fee:fee,total:Number(p.price||0)+fee,photo:p.photo,game:p.game,rank:p.rank||"",time:timeStr(),status:"dipesan",buyerName:u?u.name:"Pembeli",buyerEmail:u?u.email:"",credPending:false,credRevealed:false,credUser:"",credPass:""};
        unit.invoiceNo=order.invoiceNo;
        syncLocalStock(p);
        analytics.orders.unshift(order);
        logActivity("pesan",'Akun "'+p.title+'" dipesan — invoice '+order.invoiceNo+" terbit ("+formatIDR(order.total)+" termasuk biaya admin "+formatIDR(fee)+"). Menunggu pembayaran via Midtrans.");
        showEventPopup(p,"pesan");
        showToast('Pesanan dibuat! Invoice '+order.invoiceNo+" — 1 unit stok otomatis ditandai DIPESAN.");
        render();
        return Promise.resolve(order);
      }
      function orderStatusLabel(o){return o.status==="terjual"?"Terjual · Lunas":o.status==="dibatalkan"?"Dibatalkan":"Dipesan · menunggu pembayaran";}
      function salesRowsHTML(){
        if(!analytics.orders.length)return '<p class="stock-empty">Belum ada pesanan atau penjualan.</p>';
        return analytics.orders.map(function(o){
          return '<div class="sales-row"><div class="sr-thumb">'+(o.photo?'<img src="'+o.photo+'" alt="" />':'<img src="icon.png" alt="GankStore" />')+'</div><div class="sr-body"><b>'+esc(o.title)+'</b><span>'+esc(o.invoiceNo)+" · "+orderStatusLabel(o)+" · "+o.time+'</span></div><div class="sr-price">'+formatIDR(o.total!=null?o.total:o.price)+"</div></div>";
        }).join("");
      }
      function renderMyOrders(){
        var box=document.getElementById("myOrders");if(!box)return;
        var myOrders=(Server.enabled&&currentUser())?analytics.orders.filter(function(o){return o.buyerEmail===currentUser().email;}):analytics.orders;
        if(!myOrders.length){box.innerHTML='<p class="stock-empty">Belum ada pesanan. Klik Beli Sekarang di akun yang kamu mau.</p>';return;}
        box.innerHTML=myOrders.map(function(o){
          return '<a class="order-row" href="#/invoice/'+esc(o.invoiceNo)+'"><div class="sr-thumb" style="width:52px;height:40px;border-radius:6px;flex:none;overflow:hidden;background:var(--hero-bg);display:flex;align-items:center;justify-content:center;color:#a3e635;font-family:\'Chakra Petch\',sans-serif;font-weight:700;font-size:12px">'+(o.photo?'<img src="'+o.photo+'" alt="" style="width:100%;height:100%;object-fit:cover" />':'<img src="icon.png" alt="GankStore" style="width:100%;height:100%;object-fit:cover" />')+'</div><div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px">'+esc(o.title)+'</b><span style="font-size:13px;color:var(--ink-faint);font-weight:600">'+esc(o.invoiceNo)+" · "+orderStatusLabel(o)+'</span></div><div class="sr-price" style="font-family:\'Chakra Petch\',sans-serif;font-weight:700;color:var(--accent-strong);flex:none">'+formatIDR(o.total!=null?o.total:o.price)+"</div></a>";
        }).join("");
      }
      function renderInvoice(invNo){
        var wrap=document.getElementById("invoiceWrap");if(!wrap)return;
        var o=findOrder(invNo);
        if(!o){wrap.innerHTML='<div class="empty"><h3>Invoice tidak ditemukan</h3><p>Buat pesanan baru dari katalog.</p><a class="btn-dark" href="#/katalog">Kembali ke Katalog</a></div>';return;}
        var st=o.status;
        var statusChip=st==="terjual"?'<span class="inv-status lunas">Lunas</span>':st==="dibatalkan"?'<span class="inv-status batal">Dibatalkan</span>':'<span class="inv-status">Menunggu Pembayaran</span>';
        var payBlock="";
        if(st==="terjual"){
          if(o.kind==="topup"){
            payBlock='<div class="pay-method"><b>Top up selesai ✔</b><p>Pembayaran sudah dikonfirmasi dan top up ini sudah diproses. Cek '+esc(o.amount||"")+' '+esc(o.currency||"")+' untuk '+esc(o.game)+' di User ID <strong>'+esc(o.userId||"-")+'</strong>'+(o.serverId?" (Server / Zone ID "+esc(o.serverId)+")":"")+'.</p></div>';
          }else if(o.credPending){
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔ — data akunmu siap</b><p>Username &amp; password akun ini ditampilkan <strong>satu kali</strong> di halaman sukses. Siapkan tempat menyimpannya sebelum membuka — setelah ditampilkan, data otomatis dihapus dari toko dan tidak bisa dilihat lagi.</p></div><a class="btn-pay" href="#/sukses/'+esc(o.invoiceNo)+'" style="display:block;text-align:center;text-decoration:none">Lihat Data Akun (satu kali)</a>';
          }else if(o.credRevealed){
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔</b><p>Data login akun ini <strong>sudah ditampilkan satu kali</strong> di halaman sukses dan sudah dihapus dari data toko, jadi tidak bisa ditampilkan lagi. Segera amankan akun dengan password barumu.</p></div>';
          }else{
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔</b><p>Pembayaranmu sudah dikonfirmasi lunas. Akun ini tidak menyimpan username &amp; password di toko, jadi data login diserahkan toko secara terpisah.</p></div>';
          }
        }else if(st==="dibatalkan"){
          payBlock='<div class="pay-method"><b>Pesanan dibatalkan</b><p>Pesanan ini dibatalkan dan akunnya sudah tersedia lagi di katalog. Kamu bisa membuat pesanan baru dari halaman Katalog.</p></div>';
        }else{
          payBlock=(typeof midtransPayBlock==="function")?midtransPayBlock(o):'<div class="pay-method"><b>Metode pembayaran: Midtrans</b><p>QRIS, e-wallet, atau virtual account bank — total yang dibayar adalah total invoice di atas (harga + biaya admin 10%).</p></div><button class="btn-pay" type="button" disabled>Bayar via Midtrans</button><p class="pay-note">Pembayaran online masih disiapkan. Invoice ini tetap sah sebagai catatan pesananmu — pembayaran dikonfirmasi dan statusnya berubah jadi Lunas.</p>';
        }
        wrap.innerHTML='<div class="invoice-box"><div class="invoice-head"><div><div class="invoice-no">'+esc(o.invoiceNo)+'</div><div style="color:var(--ink-faint);font-weight:600;font-size:14px">Dibuat '+o.time+" · "+esc(o.game)+'</div></div>'+statusChip+'</div><div class="inv-rows"><div class="inv-row"><span>Pembeli</span><b>'+esc(o.buyerName)+(o.buyerEmail?" ("+esc(o.buyerEmail)+")":"")+'</b></div><div class="inv-row"><span>'+(o.kind==="topup"?"Top Up":"Akun")+'</span><b>'+esc(o.title)+'</b></div>'+(o.kind==="topup"?'<div class="inv-row"><span>User ID</span><b>'+esc(o.userId||"-")+'</b></div>'+(o.serverId?'<div class="inv-row"><span>Server / Zone ID</span><b>'+esc(o.serverId)+'</b></div>':""):"")+(o.rank?'<div class="inv-row"><span>Rank</span><b>'+esc(o.rank)+'</b></div>':"")+'<div class="inv-row"><span>'+(o.kind==="topup"?"Harga paket":"Harga akun")+'</span><b>'+formatIDR(o.price)+'</b></div><div class="inv-row"><span>Biaya admin (10%)</span><b>'+formatIDR(o.fee)+'</b></div><div class="inv-row total"><span>Total bayar</span><b>'+formatIDR(o.total)+"</b></div></div>"+payBlock+'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a class="btn-detail" href="#/katalog" style="flex:1">Lihat Katalog</a><a class="btn-detail" href="#/akun" style="flex:1">Pesanan Saya</a></div></div>';
        var sp=document.getElementById("btnSnapPay");
        if(sp)sp.addEventListener("click",function(){if(typeof requestSnapPay==="function")requestSnapPay(o.invoiceNo);});
      }
      function renderSukses(invNo){
        var wrap=document.getElementById("successWrap");if(!wrap)return;
        var o=findOrder(invNo);
        if(!o){wrap.innerHTML='<div class="empty"><h3>Pesanan tidak ditemukan</h3><p>Cek daftar pesananmu di halaman Akun.</p><a class="btn-dark" href="#/akun">Ke Pesanan Saya</a></div>';return;}
        if(o.status!=="terjual"){
          wrap.innerHTML='<div class="empty"><h3>Pembayaran belum lunas</h3><p>Data akun baru diserahkan setelah pembayaran invoice '+esc(o.invoiceNo)+' dikonfirmasi lunas. Status pesananmu sekarang: <strong>'+orderStatusLabel(o)+'.</strong></p><a class="btn-dark" href="#/invoice/'+esc(o.invoiceNo)+'">Buka Invoice</a></div>';return;
        }
        if(o.kind==="topup"){
          wrap.innerHTML='<div class="invoice-box"><div class="invoice-head"><div><div class="invoice-no">'+esc(o.title)+'</div><div style="color:var(--ink-faint);font-weight:600;font-size:14px">Invoice '+esc(o.invoiceNo)+' · Lunas · '+esc(o.game)+'</div></div><span class="inv-status lunas">Selesai</span></div><div class="cred-box"><p style="margin:0 0 10px"><b>Top up selesai diproses.</b></p><p style="margin:0">Cek '+esc(o.amount||"")+' '+esc(o.currency||"")+' untuk '+esc(o.game)+' di User ID <strong>'+esc(o.userId||"-")+'</strong>'+(o.serverId?" (Server / Zone ID "+esc(o.serverId)+")":"")+'. Kalau belum masuk, hubungi kami dengan nomor invoice '+esc(o.invoiceNo)+'.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn-detail" href="#/topup" style="flex:1">Top Up Lagi</a><a class="btn-detail" href="#/invoice/'+esc(o.invoiceNo)+'" style="flex:1">Kembali ke Invoice</a></div></div>';
          return;
        }
        if(Server.enabled&&o.credPending&&!o.credUser){
          wrap.innerHTML='<div class="empty"><h3>Memuat data akun…</h3><p>Mengambil data login satu kali dari server.</p></div>';
          api("/api/orders/"+encodeURIComponent(invNo)+"/credentials").then(function(c){if(c&&(c.username||c.email)){o.credUser=c.username||c.email;o.credPass=c.password;renderSukses(invNo);}else{wrap.innerHTML='<div class="empty"><h3>Data akun tidak tersedia</h3><p>Server tidak mengembalikan data login untuk invoice ini. Hubungi kami dengan nomor invoice '+esc(invNo)+'.</p></div>';}});
          return;
        }
        if(o.credPending&&o.credUser){
          /* TAMPIL SATU KALI: tangkap nilainya, lalu hapus permanen dari data order saat itu juga */
          var ce=o.credUser, cpw=o.credPass;
          o.credUser="";o.credPass="";o.credPending=false;o.credRevealed=true;
          logActivity("lunas",'Data login "'+o.title+'" ditampilkan satu kali ke pembeli di halaman sukses lalu dihapus dari data stok.');
          wrap.innerHTML='<div class="invoice-box"><div class="invoice-head"><div><div class="invoice-no">'+esc(o.title)+'</div><div style="color:var(--ink-faint);font-weight:600;font-size:14px">Invoice '+esc(o.invoiceNo)+' · Lunas · '+esc(o.game)+'</div></div><span class="inv-status lunas">Data Akun</span></div><div class="cred-box"><div class="cred-row"><span>Username</span><code>'+esc(ce)+'</code></div><div class="cred-row"><span>Password akun</span><code>'+esc(cpw)+'</code></div><button class="btn-pay" type="button" id="btnCopyCred" style="margin-top:14px">Salin Username &amp; Password</button><p class="cred-warn">⚠ Ini satu-satunya penampilan data ini. Data sudah dihapus dari toko — kalau halaman ini ditutup atau dimuat ulang, username &amp; password di atas <strong>tidak bisa ditampilkan lagi</strong>. Salin sekarang, lalu login dan ganti password akunnya.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn-detail" href="#/katalog" style="flex:1">Lihat Katalog</a><a class="btn-detail" href="#/invoice/'+esc(o.invoiceNo)+'" style="flex:1">Kembali ke Invoice</a></div></div>';
          var bc=document.getElementById("btnCopyCred");
          if(bc)bc.addEventListener("click",function(){
            var text="Akun: "+o.title+"\nUsername: "+ce+"\nPassword: "+cpw;
            function done(){showToast("Username & password tersalin. Simpan di tempat aman!");}
            if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,function(){fallbackCopy(text);done();});}else{fallbackCopy(text);done();}
          });
          return;
        }
        if(o.credRevealed){
          wrap.innerHTML='<div class="empty"><h3>Data akun sudah pernah ditampilkan</h3><p>Username &amp; password akun ini sudah ditampilkan satu kali dan otomatis dihapus dari data toko, jadi tidak bisa ditampilkan atau dipakai lagi dari sini. Kalau kamu belum sempat menyimpannya, hubungi kami dengan nomor invoice '+esc(o.invoiceNo)+'.</p><a class="btn-dark" href="#/invoice/'+esc(o.invoiceNo)+'">Kembali ke Invoice</a></div>';return;
        }
        wrap.innerHTML='<div class="empty"><h3>Pembayaran lunas</h3><p>Akun ini tidak menyimpan username &amp; password di toko, jadi data login diserahkan toko secara terpisah. Tunjukkan nomor invoice '+esc(o.invoiceNo)+' ke toko.</p><a class="btn-dark" href="#/invoice/'+esc(o.invoiceNo)+'">Kembali ke Invoice</a></div>';
      }
      function renderReport(){
        renderTicker();renderFeed();
        var rs=document.getElementById("reportStats");
        if(rs){
          rs.innerHTML=
            '<div class="stat"><b>'+analytics.pageViews+'</b><span>Kunjungan halaman</span></div>'+
            '<div class="stat"><b>'+analytics.detailViews+'</b><span>Kali lihat detail akun</span></div>'+
            '<div class="stat"><b>'+analytics.buyClicks+'</b><span>Klik Beli Sekarang (pesanan dibuat)</span></div>'+
            '<div class="stat"><b>'+sumStock("di")+'</b><span>Unit sedang dipesan</span></div>'+
            '<div class="stat"><b>'+state.products.length+'</b><span>Total listing</span></div>'+
            '<div class="stat"><b>'+sumStock("av")+'</b><span>Unit tersedia</span></div>'+
            '<div class="stat"><b>'+sumStock("te")+'</b><span>Unit terjual (lunas)</span></div>'+
            '<div class="stat"><b>'+formatIDR(totalRevenue())+'</b><span>Total penjualan</span></div>'+
            '<div class="stat"><b>'+analytics.orders.filter(function(o){return o.kind==="topup"&&o.status==="terjual";}).length+'</b><span>Top up selesai</span></div>';
          var fb=document.getElementById("funnelBox");
          if(fb){
            var rows=[["Kunjungan halaman",analytics.pageViews],["Lihat detail akun",analytics.detailViews],["Klik Beli (dipesan)",analytics.buyClicks],["Terjual (lunas)",sumStock("te")]];
            var max=Math.max(1,analytics.pageViews);
            fb.innerHTML=rows.map(function(r){return '<div class="funnel-row"><span class="f-label">'+r[0]+'</span><span class="funnel-bar"><i style="width:'+Math.round(r[1]/max*100)+'%"></i></span><span class="f-num">'+r[1]+"</span></div>";}).join("");
          }
          var rr=document.getElementById("reportSalesRows");if(rr)rr.innerHTML=salesRowsHTML();
        }
        var hs=document.getElementById("homeSalesSection"),hr=document.getElementById("homeSalesRows");
        if(hs&&hr){hs.hidden=analytics.orders.length===0;hr.innerHTML=salesRowsHTML();}
        renderMyOrders();
      }

      /* ---------- login lokal (tersimpan di browser perangkat ini) ---------- */
      var LS_USERS="gankstore_users", LS_SESSION="gankstore_session", pendingAdmin=false;
      function loadUsers(){try{var u=JSON.parse(localStorage.getItem(LS_USERS)||"[]");return Array.isArray(u)?u:[];}catch(e){return[];}}
      function saveUsers(u){try{localStorage.setItem(LS_USERS,JSON.stringify(u));}catch(e){}}
      function currentUser(){
        if(Server.enabled)return Server.user;
        try{var em=localStorage.getItem(LS_SESSION);if(!em)return null;var us=loadUsers();for(var i=0;i<us.length;i++){if(us[i].email===em)return us[i];}}catch(e){}return null;
      }
      /* Hanya admin yang boleh melihat Panel Admin. Mode server: flag
         is_admin dari /api/auth/me (ditentukan server dari GS_ADMIN_EMAIL,
         fallback sementara demo@gankstore.my.id). Mode lokal: bandingkan
         email dengan ADMIN_EMAIL di config.js. */
      function isAdminUser(){
        var u=currentUser();if(!u)return false;
        if(Server.enabled)return !!(Server.user&&Server.user.is_admin);
        return String(u.email||"").toLowerCase()===(window.GS_CONFIG.ADMIN_EMAIL||"demo@gankstore.my.id").toLowerCase();
      }
      function setSession(email){try{if(email)localStorage.setItem(LS_SESSION,email);else localStorage.removeItem(LS_SESSION);}catch(e){}}
      function hashPw(s){var h1=0xdeadbeef,h2=0x41c6ce57;for(var i=0;i<s.length;i++){var ch=s.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (h2>>>0).toString(16)+"-"+(h1>>>0).toString(16);}
      function validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);}
      function renderAuth(){
        var u=currentUser();
        var out=document.getElementById("authLoggedOut"),inn=document.getElementById("authLoggedIn");
        if(!out||!inn)return;
        out.hidden=!!u;inn.hidden=!u;
        if(u){document.getElementById("profileName").textContent=u.name;document.getElementById("profileEmail").textContent=u.email;document.getElementById("profileAvatar").textContent=u.name.charAt(0).toUpperCase();}
        /* Modul AKUN di sidebar: tampilkan Masuk/Daftar bila logout,
           Pesanan Saya + Keluar bila login. Modul ADMIN (terpisah,
           di bawah) HANYA untuk admin — user biasa tidak melihatnya
           sama sekali. Pakai style.display, bukan atribut hidden:
           .side-group mengatur display flex dan itu mengalahkan
           aturan [hidden] browser. */
        var slo=document.getElementById("sideLoggedOut"),sli=document.getElementById("sideLoggedIn");
        if(slo)slo.hidden=!!u;if(sli)sli.hidden=!u;
        var sun=document.getElementById("sideUserName");
        if(sun&&u)sun.textContent=u.name;
        var sideAdmin=document.getElementById("sideAdminGroup");
        if(sideAdmin)sideAdmin.style.display=isAdminUser()?"":"none";
        /* Tombol Panel Admin HANYA untuk admin — user biasa tidak
           melihatnya sama sekali di halaman Akun. Pakai style.display,
           bukan atribut hidden: class .btn-dark mengatur display
           inline-block dan itu mengalahkan aturan [hidden] browser,
           jadi hidden saja tidak menyembunyikan tombolnya. */
        var btnAdmin=document.getElementById("btnOpenAdmin");
        if(btnAdmin)btnAdmin.style.display=isAdminUser()?"":"none";
        var note=document.getElementById("authHeadNote");
        if(note)note.textContent=isAdminUser()?"Kamu sudah masuk sebagai admin toko. Dari sini bisa langsung membuka Panel Admin untuk mengelola stok.":"Kamu sudah masuk. Pesananmu ada di bawah — klik invoice-nya untuk melihat status dan data akunmu.";
      }
      function afterLogin(u){
        renderAuth();
        showToast("Selamat datang, "+u.name.split(" ")[0]+"!");
        if(pendingAdmin){
          pendingAdmin=false;
          if(isAdminUser()){location.hash="#/admin";if(isAdminPage(getRoute().page))applyRoute();}
          else{showToast("Akun ini tidak bisa membuka halaman itu.");location.hash="#/";}
        }
        else{location.hash="#/";if(getRoute().page==="beranda")applyRoute();}
      }

      /* ---------- sidebar burger — satu-satunya navigasi utama ---------- */
      var sidebar=document.getElementById("sidebar"),sideOverlay=document.getElementById("sideOverlay"),burgerBtn=document.getElementById("btnBurger");
      var pendingAuthTab=null; /* "login" / "register": tab Akun yang dibuka dari sidebar */
      function openSidebar(){
        if(!sidebar)return;
        sidebar.classList.add("open");sideOverlay.classList.add("open");
        document.body.classList.add("sidebar-open");
        burgerBtn.setAttribute("aria-expanded","true");sidebar.setAttribute("aria-hidden","false");
      }
      function closeSidebar(){
        if(!sidebar)return;
        sidebar.classList.remove("open");sideOverlay.classList.remove("open");
        document.body.classList.remove("sidebar-open");
        burgerBtn.setAttribute("aria-expanded","false");sidebar.setAttribute("aria-hidden","true");
      }
      if(burgerBtn)burgerBtn.addEventListener("click",openSidebar);
      var btnSideClose=document.getElementById("btnSideClose");
      if(btnSideClose)btnSideClose.addEventListener("click",closeSidebar);
      if(sideOverlay)sideOverlay.addEventListener("click",closeSidebar);
      document.addEventListener("keydown",function(ev){if(ev.key==="Escape")closeSidebar();});
      if(sidebar)sidebar.querySelectorAll("a").forEach(function(a){
        a.addEventListener("click",function(){
          var tab=a.getAttribute("data-auth-tab");
          if(tab)pendingAuthTab=tab;
          closeSidebar();
        });
      });

      /* ---------- routing multi-halaman (admin = area terpisah, tiap tugas 1 halaman) ---------- */
      function isAdminPage(page){return page==="admin"||page.indexOf("admin-")===0;}
      function getRoute(){
        var h=location.hash.replace(/^#/,"");
        if(!h||h==="/")return{page:"beranda"};
        if(h==="/katalog")return{page:"katalog"};
        if(h==="/cara-beli")return{page:"cara-beli"};
        if(h==="/bantuan")return{page:"bantuan"};
        if(h==="/privacy-policy")return{page:"privacy-policy"};
        if(h==="/akun")return{page:"akun"};
        if(h==="/admin")return{page:"admin"};
        if(h==="/admin/tambah")return{page:"admin-tambah"};
        if(h==="/admin/stok")return{page:"admin-stok"};
        if(h==="/admin/laporan")return{page:"admin-laporan"};
        if(h==="/admin/pengaturan")return{page:"admin-pengaturan"};
        if(h.indexOf("/detail/")===0){var id=parseInt(h.split("/")[2],10);return{page:"detail",id:id};}
        if(h.indexOf("/invoice/")===0){return{page:"invoice",invoiceNo:decodeURIComponent(h.slice("/invoice/".length))};}
        if(h.indexOf("/sukses/")===0){return{page:"sukses",invoiceNo:decodeURIComponent(h.slice("/sukses/".length))};}
        if(h==="/topup")return{page:"topup"};
        if(h.indexOf("/topup/")===0){return{page:"topup-game",game:decodeURIComponent(h.slice(7))};}
        if(h==="/admin/topup")return{page:"admin-toppup"};
        if(h==="/admin/support")return{page:"admin-support"};
        return{page:"beranda"};
      }
      function applyRoute(){
        var r=getRoute();
        closeSidebar(); /* ganti halaman = sidebar tertutup */
        if(isAdminPage(r.page)){
          if(!currentUser()){pendingAdmin=true;showToast("Masuk dulu untuk melanjutkan.");location.hash="#/akun";if(getRoute().page==="akun")applyRoute();return;}
          /* Sudah login tapi bukan admin: jangan tampilkan isi admin,
             arahkan ke Akun. (pendingAdmin TIDAK diset — kalau diset,
             setelah login non-admin akan diarahkan balik ke #/admin.) */
          if(!isAdminUser()){showToast("Kamu tidak punya akses ke halaman itu.");location.hash="#/akun";if(getRoute().page==="akun")applyRoute();return;}
        }
        var nowMs=Date.now();
        if(analytics.lastRoute!==r.page||nowMs-analytics.lastRouteAt>1200){
          analytics.lastRoute=r.page;analytics.lastRouteAt=nowMs;analytics.pageViews++;
          var pageNames={"beranda":"Beranda","katalog":"Katalog","cara-beli":"Cara Beli","bantuan":"Bantuan","privacy-policy":"Kebijakan Privasi","akun":"halaman Akun","detail":"Detail Akun","topup":"Top Up","topup-game":"Top Up","admin-toppup":"Paket Top Up","admin-support":"Pesan Support"};
          if(pageNames[r.page])logActivity("kunjung","Pengunjung membuka "+pageNames[r.page]+".");
          renderReport();
        }
        document.body.classList.toggle("admin-mode",isAdminPage(r.page));
        document.querySelectorAll(".page").forEach(function(p){p.classList.toggle("active",p.getAttribute("data-page")===r.page);});
        var navKey=(r.page==="detail"||r.page==="invoice"||r.page==="sukses")?"katalog":(r.page==="topup"||r.page==="topup-game")?"topup":isAdminPage(r.page)?"admin":r.page;
        document.querySelectorAll("[data-nav]").forEach(function(a){a.classList.toggle("active",a.getAttribute("data-nav")===navKey);});
        document.querySelectorAll("[data-anav]").forEach(function(a){a.classList.toggle("active",a.getAttribute("data-anav")===r.page);});
        if(r.page==="detail"){analytics.detailViews++;var dp=state.products.find(function(x){return x.id===r.id;});if(dp)logActivity("lihat",'Pengunjung melihat detail "'+dp.title+'" ('+formatIDR(dp.price)+").");renderReport();renderDetail(r.id);}
        if(r.page==="invoice")renderInvoice(r.invoiceNo);
        if(r.page==="sukses")renderSukses(r.invoiceNo);
        if(r.page==="akun"){
          renderAuth();
          /* Dibuka dari sidebar "Daftar": langsung buka tab Daftar. */
          if(pendingAuthTab){switchAuthView(pendingAuthTab);pendingAuthTab=null;}
        }
        if(r.page==="bantuan")renderSupportPage();
        if(r.page==="admin-support")renderSupportAdmin();
        if(r.page==="topup"&&window.TopUp)TopUp.renderTopup();
        if(r.page==="topup-game"&&window.TopUp)TopUp.renderTopupGame(r.game);
        if(r.page==="admin-toppup"&&window.TopUp)TopUp.renderTopupAdmin();
        if(r.page==="admin-stok"&&Server.enabled&&isAdminUser()){
          /* Stok bisa berubah dari luar sesi admin (pembeli lain / tab
             lain) — muat ulang produk + pesanan + unit dari server setiap
             kali halaman dibuka, supaya chip status unit, ringkasan stok,
             dan daftar pesanan aktif selalu cocok dengan server. */
          refreshServerData();
        }
        window.scrollTo(0,0);
      }
      window.addEventListener("hashchange",applyRoute);

      function specsHTML(p){var parts=[];if(p.rank)parts.push(p.rank);if(p.level)parts.push(p.level);if(p.server)parts.push("Server "+p.server);(p.specs||[]).forEach(function(s){parts.push(s);});return parts.map(function(s){return "<span>"+esc(s)+"</span>";}).join("");}
      function cardHTML(p){
        var media=p.photo?'<img src="'+p.photo+'" alt="Foto akun '+esc(p.title)+'" />':'<img src="icon.png" alt="GankStore" />';
        var st=pStatus(p);
        var c=stockCounts(p);
        var stockLine=c.total>0?'<div class="stock-line">Stok: <b>'+c.av+'</b> tersedia</div>':'<div class="stock-line">Stok habis</div>';
        var buyBtn=c.av>0?'<button class="btn-buy" type="button" data-buy="'+p.id+'">Beli Sekarang</button>':'<span class="btn-buy disabled">'+(st==="dipesan"?"Dipesan":st==="terjual"?"Terjual":"Stok Habis")+'</span>';
        var badge=st==="terjual"?'<span class="badge-sold">TERJUAL</span>':st==="dipesan"?'<span class="badge-ordered">DIPESAN</span>':st==="habis"?'<span class="badge-ordered">STOK HABIS</span>':"";
        return '<div class="card-media'+(isRankPhoto(p.photo)?' rank-photo':'')+'">'+media+'<span class="badge-game">'+esc(p.game)+"</span>"+badge+'</div><div class="card-body"><div class="card-title">'+esc(p.title)+'</div><div class="card-specs">'+specsHTML(p)+'</div>'+stockLine+'<div class="card-foot"><div class="price">'+formatIDR(p.price)+'</div><div style="font-size:13px;color:var(--ink-faint);font-weight:600">+ biaya admin 10% · total '+formatIDR(Number(p.price||0)+adminFee(p.price))+'</div><div class="card-actions"><a class="btn-detail" href="#/detail/'+p.id+'">Detail</a>'+buyBtn+"</div></div></div>";
      }
      function buildCard(p){var el=document.createElement("article");var st=pStatus(p);el.className="card"+(st==="terjual"||st==="habis"?" sold":st==="dipesan"?" ordered":"");el.innerHTML=cardHTML(p);var bb=el.querySelector("[data-buy]");if(bb)bb.addEventListener("click",function(){trackBuy(p).then(function(o){if(o)location.hash="#/invoice/"+encodeURIComponent(o.invoiceNo);});});return el;}

      function renderChips(){ /* toko fokus Point Blank saja — tidak ada filter per game */ }
      function visibleProducts(){
        var list=state.products.slice();
        if(state.filterGame!=="Semua")list=list.filter(function(p){return p.game===state.filterGame;});
        if(state.status==="tersedia")list=list.filter(function(p){return pStatus(p)==="tersedia";});
        if(state.status==="dipesan")list=list.filter(function(p){return pStatus(p)==="dipesan";});
        if(state.status==="terjual")list=list.filter(function(p){return pStatus(p)==="terjual";});
        if(state.status==="habis")list=list.filter(function(p){return pStatus(p)==="habis";});
        if(state.query){var q=state.query.toLowerCase();list=list.filter(function(p){return p.title.toLowerCase().indexOf(q)!==-1||p.game.toLowerCase().indexOf(q)!==-1||(p.rank||"").toLowerCase().indexOf(q)!==-1||(p.specs||[]).join(" ").toLowerCase().indexOf(q)!==-1;});}
        if(state.sort==="murah")list.sort(function(a,b){return a.price-b.price;});
        if(state.sort==="mahal")list.sort(function(a,b){return b.price-a.price;});
        if(state.sort==="baru")list.sort(function(a,b){return b.id-a.id;});
        return list;
      }

      function renderHome(){
        /* Bila semua angka 0, kartu statistik disembunyikan saja —
           pesan "Belum ada akun dipajang" sudah ada di bagian
           Akun Terbaru di bawah, jadi jangan ditulis dua kali. */
        var hs=document.getElementById("homeStats");
        var allZero=!state.products.length&&!countBy("tersedia")&&!countBy("dipesan")&&!countBy("terjual");
        hs.style.display=allZero?"none":"";
        if(!allZero){
          hs.innerHTML=
            '<div class="stat"><b>'+state.products.length+'</b><span>Total listing</span></div>'+
            '<div class="stat"><b>'+sumStock("av")+'</b><span>Stok tersedia</span></div>'+
            '<div class="stat"><b>'+sumStock("di")+'</b><span>Sedang dipesan</span></div>'+
            '<div class="stat"><b>'+sumStock("te")+'</b><span>Sudah terjual</span></div>';
        }
        homeGrid.innerHTML="";
        state.products.slice().sort(function(a,b){return b.id-a.id;}).slice(0,4).forEach(function(p){homeGrid.appendChild(buildCard(p));});
        document.getElementById("homeEmpty").hidden=state.products.length!==0;
        homeGrid.style.display=state.products.length?"":"none";
      }

      function render(){
        renderChips();renderHome();
        var list=visibleProducts();
        var ccParts=[];
        if(state.products.length){
          ccParts.push(state.products.length+" listing");
          if(sumStock("av"))ccParts.push(sumStock("av")+" unit tersedia");
          if(sumStock("di"))ccParts.push(sumStock("di")+" dipesan");
          if(sumStock("te"))ccParts.push(sumStock("te")+" terjual");
        }
        catalogCount.textContent=ccParts.join(" · ");
        grid.innerHTML="";list.forEach(function(p){grid.appendChild(buildCard(p));});
        if(list.length===0){
          emptyState.hidden=false;
          if(state.products.length===0){emptyTitle.textContent="Rak masih kosong";emptyText.textContent=isAdminUser()?"Belum ada akun Point Blank yang dipajang. Tambahkan stok pertama lewat Tambah Akun — isi rank, senjata, harga, dan foto akunnya.":"Belum ada akun dipajang. Cek lagi nanti.";document.getElementById("btnEmptyAdmin").style.display=isAdminUser()?"":"none";}
          else{emptyTitle.textContent="Tidak ada yang cocok";emptyText.textContent="Tidak ada akun yang cocok dengan pencarian atau filter saat ini. Coba kata kunci lain.";document.getElementById("btnEmptyAdmin").style.display="none";}
        }else emptyState.hidden=true;
        renderAdminDash();
        renderStockList();
        renderReport();
        if(getRoute().page==="detail"&&currentDetail)renderDetail(currentDetail.id);
        var rr=getRoute();if(rr.page==="invoice")renderInvoice(rr.invoiceNo);
      }

      /* ---------- halaman detail ---------- */
      function renderDetail(id){
        var p=state.products.find(function(x){return x.id===id;});
        var wrap=document.getElementById("detailWrap");
        if(!p){wrap.innerHTML='<div class="empty"><h3>Akun tidak ditemukan</h3><p>Akun ini sudah dihapus atau belum dipajang. Kembali ke katalog untuk melihat akun lain.</p><a class="btn-dark" href="#/katalog">Kembali ke Katalog</a></div>';currentDetail=null;return;}
        currentDetail=p;
        var st=pStatus(p);
        var c=stockCounts(p);
        var buyHTML=c.av>0?'<button class="btn-buy" type="button" id="detailBuyNow">Beli Sekarang</button>':'<span class="btn-buy disabled">'+(st==="habis"?"Stok Habis":st==="dipesan"?"Sedang Dipesan Pembeli Lain":"Sudah Terjual")+'</span>';
        var stLabel=st==="terjual"?" · Terjual":st==="dipesan"?" · Dipesan":st==="habis"?" · Stok habis":" · Tersedia";
        var stBadge=st==="terjual"?'<span class="badge-sold">TERJUAL</span>':st==="dipesan"?'<span class="badge-ordered">DIPESAN</span>':st==="habis"?'<span class="badge-ordered">STOK HABIS</span>':"";
        wrap.innerHTML='<div class="detail-layout"><div class="detail-media'+(isRankPhoto(p.photo)?' rank-photo':'')+'">'+(p.photo?'<img src="'+p.photo+'" alt="Foto akun '+esc(p.title)+'" />':'<img src="icon.png" alt="GankStore" />')+stBadge+'</div><div class="detail-panel"><div class="dlg-game">'+esc(p.game)+stLabel+'</div><h1>'+esc(p.title)+'</h1><div class="dlg-specs">'+specsHTML(p)+'</div><p class="dlg-desc">'+esc(p.desc||"Semua rincian transaksi ada di invoice setelah kamu klik Beli Sekarang.")+'</p><div class="dlg-price">'+formatIDR(p.price)+'</div><p class="dlg-stock">Stok tersedia: <b>'+c.av+' unit</b>'+(c.total>0?' dari '+c.total+' unit':'')+'</p><p style="color:var(--ink-soft);font-size:14.5px;margin:-8px 0 16px;font-weight:600">+ biaya admin 10% ('+formatIDR(adminFee(p.price))+') di invoice · <strong>Total bayar '+formatIDR(Number(p.price||0)+adminFee(p.price))+'</strong></p><div class="dlg-actions">'+buyHTML+'<button class="btn-detail" type="button" id="detailCopy">Salin Detail</button></div><p style="color:var(--ink-faint);font-size:14px;margin:16px 0 0">Klik Beli Sekarang — 1 unit stok ditandai <strong>Dipesan</strong> atas namamu dan invoice langsung terbit. Setelah lunas dikonfirmasi, username &amp; password akun ditampilkan <strong>satu kali</strong> di halaman sukses.</p></div></div>';
        var db=document.getElementById("detailBuyNow");if(db)db.addEventListener("click",function(){trackBuy(p).then(function(o){if(o)location.hash="#/invoice/"+encodeURIComponent(o.invoiceNo);});});
        var cp=document.getElementById("detailCopy");if(cp)cp.addEventListener("click",function(){
          var text=p.title+" — "+p.game+"\n"+(p.rank?"Rank: "+p.rank+"\n":"")+(p.level?"Level: "+p.level+"\n":"")+(p.server?"Server: "+p.server+"\n":"")+((p.specs||[]).length?"Isi akun: "+p.specs.join(", ")+"\n":"")+"Harga: "+formatIDR(p.price);
          function done(){showToast("Detail akun tersalin.");}
          if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,function(){fallbackCopy(text);done();});}else{fallbackCopy(text);done();}
        });
      }
      function fallbackCopy(text){var ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");}catch(e){}document.body.removeChild(ta);}

      document.getElementById("searchInput").addEventListener("input",function(ev){state.query=ev.target.value.trim();render();});
      document.getElementById("sortSelect").addEventListener("change",function(ev){state.sort=ev.target.value;render();});
      document.getElementById("statusSelect").addEventListener("change",function(ev){state.status=ev.target.value;render();});

      var gameSelect=document.getElementById("fGame");
      GAMES.forEach(function(g){var o=document.createElement("option");o.value=g;o.textContent=g;gameSelect.appendChild(o);});
      document.getElementById("fPhoto").addEventListener("change",function(ev){var file=ev.target.files&&ev.target.files[0];if(!file){state.photoData="";document.getElementById("photoPreview").style.display="none";return;}clearRankPick();var reader=new FileReader();reader.onload=function(){state.photoData=String(reader.result||"");document.getElementById("photoPreviewImg").src=state.photoData;document.getElementById("photoPreview").classList.remove("rank-mode");document.getElementById("photoPreview").style.display="block";};reader.readAsDataURL(file);});

      /* ---------- Pilih gambar pangkat (57 ikon resmi PB, folder /ranks/) ----------
         Ketuk ikon = gambar + kolom Rank terisi otomatis. Upload file di atas
         tetap bisa dipakai — pilih salah satu, yang terakhir dipilih yang menang. */
      var RANKS=[
        {g:"Enlisted",items:[["01-trainee.png","Trainee"],["02-senior-trainee.png","Senior Trainee"],["03-private.png","Private"],["04-corporal.png","Corporal"],["05-sergeant.png","Sergeant"]]},
        {g:"NCO",items:[["06-staff-sgt-grade-1.png","Staff Sgt Grade 1"],["07-staff-sgt-grade-2.png","Staff Sgt Grade 2"],["08-staff-sgt-grade-3.png","Staff Sgt Grade 3"],["09-sgt-1st-class-grade-1.png","Sgt 1st Class Grade 1"],["10-sgt-1st-class-grade-2.png","Sgt 1st Class Grade 2"],["11-sgt-1st-class-grade-3.png","Sgt 1st Class Grade 3"],["12-sgt-1st-class-grade-4.png","Sgt 1st Class Grade 4"],["13-master-sgt-grade-1.png","Master Sgt Grade 1"],["14-master-sgt-grade-2.png","Master Sgt Grade 2"],["15-master-sgt-grade-3.png","Master Sgt Grade 3"],["16-master-sgt-grade-4.png","Master Sgt Grade 4"],["17-master-sgt-grade-5.png","Master Sgt Grade 5"]]},
        {g:"Junior Officers",items:[["18-2nd-lt-grade-1.png","2nd Lt Grade 1"],["19-2nd-lt-grade-2.png","2nd Lt Grade 2"],["20-2nd-lt-grade-3.png","2nd Lt Grade 3"],["21-2nd-lt-grade-4.png","2nd Lt Grade 4"],["22-1st-lt-grade-1.png","1st Lt Grade 1"],["23-1st-lt-grade-2.png","1st Lt Grade 2"],["24-1st-lt-grade-3.png","1st Lt Grade 3"],["25-1st-lt-grade-4.png","1st Lt Grade 4"],["26-1st-lt-grade-5.png","1st Lt Grade 5"],["27-captain-grade-1.png","Captain Grade 1"],["28-captain-grade-2.png","Captain Grade 2"],["29-captain-grade-3.png","Captain Grade 3"],["30-captain-grade-4.png","Captain Grade 4"],["31-captain-grade-5.png","Captain Grade 5"]]},
        {g:"Senior Officers",items:[["32-major-grade-1.png","Major Grade 1"],["33-major-grade-2.png","Major Grade 2"],["34-major-grade-3.png","Major Grade 3"],["35-major-grade-4.png","Major Grade 4"],["36-major-grade-5.png","Major Grade 5"],["37-lt-colonel-grade-1.png","Lt Colonel Grade 1"],["38-lt-colonel-grade-2.png","Lt Colonel Grade 2"],["39-lt-colonel-grade-3.png","Lt Colonel Grade 3"],["40-lt-colonel-grade-4.png","Lt Colonel Grade 4"],["41-lt-colonel-grade-5.png","Lt Colonel Grade 5"],["42-colonel-grade-1.png","Colonel Grade 1"],["43-colonel-grade-2.png","Colonel Grade 2"],["44-colonel-grade-3.png","Colonel Grade 3"],["45-colonel-grade-4.png","Colonel Grade 4"],["46-colonel-grade-5.png","Colonel Grade 5"]]},
        {g:"General",items:[["47-brigadier.png","Brigadier"],["48-major-general.png","Major General"],["49-lt-general.png","Lt General"],["50-general.png","General"],["51-commander.png","Commander"]]},
        {g:"Hero",items:[["52-hero.png","Hero"]]},
        {g:"Hero Baru 2026",items:[["53-hero-brigadier-general.png","Hero Brigadier General"],["54-hero-major-general.png","Hero Major General"],["55-hero-lt-general.png","Hero Lt General"],["56-hero-general.png","Hero General"],["57-supreme-hero.png","Supreme Hero"]]}
      ];
      function isRankPhoto(src){return typeof src==="string"&&src.indexOf("ranks/")===0;}
      function clearRankPick(){
        var pk=document.getElementById("rankPicker");if(!pk)return;
        var sels=pk.querySelectorAll(".rank-opt.sel");for(var i=0;i<sels.length;i++)sels[i].classList.remove("sel");
        document.getElementById("rankPicked").style.display="none";
        if(state.photoData&&isRankPhoto(state.photoData)){state.photoData="";document.getElementById("photoPreview").style.display="none";}
        document.getElementById("photoPreview").classList.remove("rank-mode");
      }
      function initRankPicker(){
        var pk=document.getElementById("rankPicker");if(!pk)return;
        var html="";
        RANKS.forEach(function(grp){
          html+='<div class="rank-group">'+esc(grp.g)+'</div><div class="rank-grid">';
          grp.items.forEach(function(it){
            html+='<button type="button" class="rank-opt" data-file="'+it[0]+'" data-name="'+esc(it[1])+'" title="'+esc(it[1])+'" aria-label="Pangkat '+esc(it[1])+'"><img src="ranks/'+it[0]+'" alt="'+esc(it[1])+'" loading="lazy" /></button>';
          });
          html+='</div>';
        });
        pk.innerHTML=html;
        pk.addEventListener("click",function(ev){
          var btn=ev.target.closest?ev.target.closest(".rank-opt"):null;if(!btn)return;
          var file=btn.getAttribute("data-file"),name=btn.getAttribute("data-name");
          clearRankPick();
          btn.classList.add("sel");
          state.photoData="ranks/"+file;
          document.getElementById("fPhoto").value="";
          document.getElementById("photoPreviewImg").src=state.photoData;
          document.getElementById("photoPreview").classList.add("rank-mode");
          document.getElementById("photoPreview").style.display="block";
          document.getElementById("fRank").value=name;
          document.getElementById("rankPickedName").textContent=name;
          document.getElementById("rankPicked").style.display="block";
        });
        document.getElementById("rankClear").addEventListener("click",function(){clearRankPick();});
      }
      initRankPicker();
      document.getElementById("addForm").addEventListener("submit",function(ev){
        ev.preventDefault();
        var title=document.getElementById("fTitle").value.trim();var price=parseInt(document.getElementById("fPrice").value,10);
        if(!title||isNaN(price)||price<0){showToast("Judul dan harga wajib diisi dengan benar.");return;}
        var credUser=document.getElementById("fCredUser").value.trim();
        var credPass=document.getElementById("fCredPass").value;
        if(!credUser){showToast("Username akun Point Blank wajib diisi — data ini yang diserahkan ke pembeli setelah lunas.");return;}
        if(!credPass){showToast("Password akun game wajib diisi — data ini yang diserahkan ke pembeli setelah lunas.");return;}
        var specsRaw=document.getElementById("fSpecs").value.trim();
        var p={game:gameSelect.value,title:title,rank:document.getElementById("fRank").value.trim(),level:document.getElementById("fLevel").value.trim(),server:document.getElementById("fServer").value.trim(),price:price,specs:specsRaw?specsRaw.split(",").map(function(s){return s.trim();}).filter(Boolean):[],desc:document.getElementById("fDesc").value.trim(),photo:state.photoData,sold:false,status:"tersedia",units:[{username:credUser,password:credPass,status:"tersedia"}]};
        function done(saved){
          state.products.push(saved);
          state.filterGame="Semua";state.status="semua";document.getElementById("statusSelect").value="semua";
          ev.target.reset();state.photoData="";document.getElementById("photoPreview").style.display="none";clearRankPick();
          logActivity("stok",'Stok baru dipajang: "'+title+'" ('+formatIDR(price)+").");
          render();showToast('Akun "'+title+'" sudah dipajang. Cek di Daftar Stok.');
          location.hash="#/admin/stok";if(getRoute().page==="admin-stok")applyRoute();
        }
        if(Server.enabled){
          api("/api/products",{method:"POST",body:{game:p.game,title:p.title,rank:p.rank,level:p.level,server:p.server,price:p.price,specs:p.specs,desc:p.desc,photo:p.photo,units:p.units}}).then(function(saved){
            if(saved&&saved.id){done(serverProductToLocal(saved));}
            else{showToast("Gagal menyimpan ke server.");}
          }).catch(function(){showToast("Gagal menyimpan ke server. Cek koneksi lalu coba lagi.");});
          return;
        }
        p.id=++state.seq;
        syncLocalStock(p);
        done(p);
      });

      function renderAdminDash(){
        var box=document.getElementById("adminStats");if(!box)return;
        if(!isAdminUser()){box.innerHTML="";return;}
        box.innerHTML=
          '<div class="stat"><b>'+state.products.length+'</b><span>Total listing</span></div>'+
          '<div class="stat"><b>'+sumStock("total")+'</b><span>Total unit stok</span></div>'+
          '<div class="stat"><b>'+sumStock("av")+'</b><span>Stok tersedia</span></div>'+
          '<div class="stat"><b>'+sumStock("di")+'</b><span>Dipesan — menunggu lunas</span></div>'+
          '<div class="stat"><b>'+sumStock("te")+'</b><span>Sudah terjual</span></div>'+
          '<div class="stat"><b>'+analytics.pageViews+'</b><span>Kunjungan — <a href="#/admin/laporan" style="color:var(--accent-strong);font-weight:800">detail di Statistik &amp; Live</a></span></div>'+
          '<div class="stat"><b>'+formatIDR(totalRevenue())+'</b><span>Total penjualan</span></div>'+
          '<div class="stat"><b>'+analytics.orders.length+'</b><span>Pesanan masuk</span></div>'+
          '<div class="stat"><b>Midtrans</b><span>Pembayaran invoice · biaya admin 10% — <a href="#/admin/pengaturan" style="color:var(--accent-strong);font-weight:800">detail di Pengaturan</a></span></div>';
      }

      /* ---------- Daftar Stok (admin) — model unit ----------
         Kartu per LISTING (tumpuk vertikal, HP 390px aman):
           header: foto + judul + harga + ringkasan stok
           pesanan aktif: tiap invoice dipesan + Lunas/Batal (per invoice)
           unit stok: username terlihat, password tertutup + tombol Lihat,
             chip status, hapus (hanya unit tersedia)
           form Tambah Stok: N baris username+password
           hapus listing
         Semua aksi lewat delegasi klik di #stockList (dipasang sekali). */
      function renderStockList(){
        var box=document.getElementById("stockList");if(!box)return;
        if(!isAdminUser()){box.innerHTML="";return;}
        if(!box._stockBound){
          box._stockBound=true;
          box.addEventListener("click",function(ev){
            var t=ev.target;
            if(!t||!t.closest)return;
            var sp=t.closest("[data-showpass]");
            if(sp){
              var row=sp.closest(".unit-row");if(!row)return;
              var pv=row.querySelector(".unit-pass");if(!pv)return;
              var shown=pv.getAttribute("data-shown")==="1";
              if(shown){pv.textContent="••••••••";pv.setAttribute("data-shown","0");sp.textContent="Lihat";}
              else{pv.textContent=pv.getAttribute("data-pass")||"";pv.setAttribute("data-shown","1");sp.textContent="Sembunyikan";}
              return;
            }
            var addRow=t.closest("[data-addrow]");
            if(addRow){
              var wrap=box.querySelector('[data-rows="'+addRow.getAttribute("data-addrow")+'"]');
              if(wrap)wrap.insertAdjacentHTML("beforeend",'<div class="add-stock-row"><input type="text" placeholder="Username akun" maxlength="90" /><input type="text" placeholder="Password" maxlength="90" /></div>');
              return;
            }
            var addBtn=t.closest("[data-addstock]");
            if(addBtn){addStockSubmit(Number(addBtn.getAttribute("data-addstock")));return;}
            var delUnit=t.closest("[data-delunit]");
            if(delUnit){deleteUnitSubmit(delUnit.getAttribute("data-delunit"));return;}
            var lunas=t.closest("[data-lunas]");
            if(lunas){confirmOrderSubmit(decodeURIComponent(lunas.getAttribute("data-lunas")));return;}
            var batal=t.closest("[data-batal]");
            if(batal){cancelOrderSubmit(decodeURIComponent(batal.getAttribute("data-batal")));return;}
            var del=t.closest("[data-del]");
            if(del){deleteProductSubmit(Number(del.getAttribute("data-del")));return;}
          });
        }
        paintStockList(box);
      }
      function paintStockList(box){
        box.innerHTML="";
        if(!state.products.length){box.innerHTML='<p class="stock-empty">Belum ada stok. Tambahkan akun pertama lewat halaman <a href="#/admin/tambah" style="font-weight:800;color:var(--accent-strong)">Tambah Akun</a>.</p>';return;}
        state.products.slice().sort(function(a,b){return b.id-a.id;}).forEach(function(p){
          var c=stockCounts(p);
          var item=document.createElement("div");item.className="stock-item";
          var countsLine=c.total>0?('Stok: <b>'+c.av+' tersedia</b> · '+c.di+' dipesan · '+c.te+' terjual'):'Belum ada unit stok — tambah di bawah.';
          var activeOrders=analytics.orders.filter(function(o){return o.id===p.id&&o.status==="dipesan";});
          var ordersHTML="";
          if(activeOrders.length){
            ordersHTML='<div class="stock-orders"><div class="stock-sec-title">Pesanan aktif ('+activeOrders.length+')</div>'+activeOrders.map(function(o){
              return '<div class="stock-order-row"><div class="stock-order-meta"><b>'+esc(o.invoiceNo)+'</b><span>'+esc(o.buyerName||"Pembeli")+(o.buyerEmail?" · "+esc(o.buyerEmail):"")+' · '+formatIDR(o.total)+'</span></div><div class="acts"><button class="mini lunas" type="button" data-lunas="'+esc(o.invoiceNo)+'">Konfirmasi Lunas</button><button class="mini" type="button" data-batal="'+esc(o.invoiceNo)+'">Batalkan Pesanan</button></div></div>';
            }).join("")+'</div>';
          }
          var units=(p.units||[]).slice().sort(function(a,b){return (Number(a.id)||0)-(Number(b.id)||0);});
          var unitsHTML="";
          if(units.length){
            unitsHTML='<div class="unit-list"><div class="stock-sec-title">Unit stok ('+units.length+')</div>'+units.map(function(u){
              var chip=u.status==="tersedia"?"Tersedia":u.status==="dipesan"?"Dipesan":"Terjual";
              var del=u.status==="tersedia"?'<button class="mini danger" type="button" data-delunit="'+u.id+'">Hapus</button>':"";
              return '<div class="unit-row"><div class="unit-cred"><span class="unit-label">Username</span><span class="unit-value">'+esc(u.username)+'</span></div><div class="unit-cred"><span class="unit-label">Password</span><span class="unit-value unit-pass" data-pass="'+esc(u.password)+'" data-shown="0">••••••••</span><button class="mini unit-toggle" type="button" data-showpass="'+u.id+'">Lihat</button></div><div class="unit-foot"><span class="unit-chip '+u.status+'">'+chip+'</span>'+del+'</div></div>';
            }).join("")+'</div>';
          }
          var addHTML='<div class="add-stock"><div class="stock-sec-title">Tambah Stok</div><div class="add-stock-rows" data-rows="'+p.id+'"><div class="add-stock-row"><input type="text" placeholder="Username akun" maxlength="90" /><input type="text" placeholder="Password" maxlength="90" /></div></div><button class="mini" type="button" data-addrow="'+p.id+'">+ Tambah baris</button><button class="mini lunas" type="button" data-addstock="'+p.id+'">Tambah Stok</button></div>';
          item.innerHTML='<div class="stock-head"><div class="thumb'+(isRankPhoto(p.photo)?' rank-photo':'')+'">'+(p.photo?'<img src="'+p.photo+'" alt="" />':'<img src="icon.png" alt="GankStore" />')+'</div><div class="meta"><b>'+esc(p.title)+"</b><span>"+esc(p.game)+" · "+formatIDR(p.price)+" · "+countsLine+"</span></div></div>"+ordersHTML+unitsHTML+addHTML+'<div class="acts"><button class="mini danger" type="button" data-del="'+p.id+'">Hapus Listing</button></div>';
          box.appendChild(item);
        });
      }
      function addStockSubmit(productId){
        var p=state.products.find(function(x){return x.id===productId;});if(!p)return;
        var box=document.getElementById("stockList");if(!box)return;
        var wrap=box.querySelector('[data-rows="'+productId+'"]');if(!wrap)return;
        var units=[];
        var bad=false;
        wrap.querySelectorAll(".add-stock-row").forEach(function(r){
          var ins=r.querySelectorAll("input");
          var u=(ins[0].value||"").trim(), pw=ins[1].value||"";
          if(!u&&!pw)return;
          if(!u||!pw){bad=true;return;}
          units.push({username:u,password:pw});
        });
        if(bad){showToast("Tiap baris Tambah Stok wajib diisi username dan password.");return;}
        if(!units.length){showToast("Isi dulu username + password unit yang mau ditambah.");return;}
        function done(n){
          /* Jumlah stok dihitung dari listProducts — perbarui lokal
             supaya ringkasan stok langsung benar tanpa menunggu
             refresh penuh (unit baru semuanya 'tersedia'). */
          p.stockAvailable+=n;p.stockTotal+=n;p.status=pStatus(p);p.sold=(p.status==="terjual");
          logActivity("stok",'Stok ditambah: '+n+' unit untuk "'+p.title+'".');
          showToast(n+" unit stok ditambahkan ke \""+p.title+"\".");
          if(Server.enabled){loadUnitsForAdmin().then(function(){render();});}
          else render();
        }
        if(Server.enabled){
          api("/api/products/"+productId+"/stock",{method:"POST",body:{units:units}}).then(function(r){
            done(r&&r.added?r.added:units.length);
          }).catch(function(){showToast("Gagal menambah stok di server. Coba lagi.");});
          return;
        }
        units.forEach(function(u){p.units.push({id:"L"+(++state.unitSeq),username:u.username,password:u.password,status:"tersedia",invoiceNo:""});});
        syncLocalStock(p);
        done(units.length);
      }
      function deleteUnitSubmit(unitId){
        var sid=String(unitId);
        if(Server.enabled){
          api("/api/stock-units/"+encodeURIComponent(unitId),{method:"DELETE"}).then(function(){
            state.products.forEach(function(p){
              if((p.units||[]).some(function(u){return String(u.id)===sid;})){p.stockAvailable=Math.max(0,p.stockAvailable-1);p.stockTotal=Math.max(0,p.stockTotal-1);p.status=pStatus(p);p.sold=(p.status==="terjual");}
            });
            loadUnitsForAdmin().then(function(){render();showToast("Unit stok dihapus.");});
          }).catch(function(){showToast("Gagal menghapus unit — mungkin unit sedang dipesan.");});
          return;
        }
        var found=false;
        state.products.forEach(function(p){
          var before=(p.units||[]).length;
          p.units=(p.units||[]).filter(function(u){return String(u.id)!==sid;});
          if(p.units.length!==before){found=true;syncLocalStock(p);}
        });
        if(found){render();showToast("Unit stok dihapus.");}
      }
      function confirmOrderSubmit(invNo){
        var ord=findOrder(invNo);if(!ord){showToast("Invoice pesanan tidak ditemukan.");return;}
        var p=state.products.find(function(x){return x.id===ord.id;});
        if(Server.enabled){
          api("/api/orders/"+encodeURIComponent(invNo)+"/confirm",{method:"POST"}).then(function(u){
            var uo=serverOrderToLocal(u);
            analytics.orders.forEach(function(o){if(o.invoiceNo===uo.invoiceNo){o.status="terjual";o.time=uo.time;o.credPending=uo.credPending;o.credRevealed=false;}});
            if(p){p.stockDipesan=Math.max(0,p.stockDipesan-1);p.stockTerjual++;p.status=pStatus(p);p.sold=(p.status==="terjual");}
            logActivity("lunas",'Pembayaran lunas dikonfirmasi — "'+ord.title+'" resmi TERJUAL ('+formatIDR(ord.price)+")."+(uo.credPending?" Username & password akun dipindah ke invoice pembeli untuk ditampilkan satu kali, lalu dihapus dari stok.":""));
            if(p)showEventPopup(p,"lunas");
            loadUnitsForAdmin().then(function(){render();});
            showToast('Lunas! "'+ord.title+'" Terjual.'+(uo.credPending?" Data akun menunggu ditampilkan satu kali ke pembeli di halaman sukses.":""));
          }).catch(function(){showToast("Gagal konfirmasi lunas di server.");});
          return;
        }
        /* Mode lokal: unit yang terikat invoice jadi terjual, kredensial
           pindah ke order untuk ditampilkan satu kali ke pembeli. */
        var unit=null;
        if(p)(p.units||[]).forEach(function(u){if(!unit&&u.invoiceNo===invNo)unit=u;});
        var hasCred=!!(unit&&unit.username&&unit.password);
        if(unit){ord.credUser=unit.username;ord.credPass=unit.password;unit.status="terjual";}
        ord.status="terjual";ord.time=timeStr();
        if(hasCred){ord.credPending=true;ord.credRevealed=false;}
        if(p)syncLocalStock(p);
        logActivity("lunas",'Pembayaran lunas dikonfirmasi — "'+ord.title+'" resmi TERJUAL ('+formatIDR(ord.price)+")."+(hasCred?" Username & password akun dipindah ke invoice pembeli untuk ditampilkan satu kali, lalu dihapus dari stok.":""));
        if(p)showEventPopup(p,"lunas");
        render();showToast('Lunas! "'+ord.title+'" Terjual.'+(hasCred?" Data akun menunggu ditampilkan satu kali ke pembeli di halaman sukses.":""));
      }
      function cancelOrderSubmit(invNo){
        var ord=findOrder(invNo);if(!ord){showToast("Invoice pesanan tidak ditemukan.");return;}
        var p=state.products.find(function(x){return x.id===ord.id;});
        if(Server.enabled){
          api("/api/orders/"+encodeURIComponent(invNo)+"/cancel",{method:"POST"}).then(function(u){
            analytics.orders.forEach(function(o){if(o.invoiceNo===u.invoice_no)o.status="dibatalkan";});
            if(p){p.stockDipesan=Math.max(0,p.stockDipesan-1);p.stockAvailable++;p.status=pStatus(p);p.sold=false;}
            logActivity("batal",'Pesanan "'+ord.title+'" dibatalkan admin — invoice ditandai Dibatalkan, 1 unit stok tersedia lagi, kredensial tetap tersimpan di stok.');
            loadUnitsForAdmin().then(function(){render();});
            showToast('Pesanan "'+ord.title+'" dibatalkan. 1 unit stok tersedia lagi.');
          }).catch(function(){showToast("Gagal membatalkan pesanan di server.");});
          return;
        }
        ord.status="dibatalkan";ord.time=timeStr();
        if(p){(p.units||[]).forEach(function(u){if(u.invoiceNo===invNo){u.status="tersedia";u.invoiceNo="";}});syncLocalStock(p);}
        logActivity("batal",'Pesanan "'+ord.title+'" dibatalkan admin — invoice ditandai Dibatalkan, 1 unit stok tersedia lagi, kredensial tetap tersimpan di stok.');
        render();showToast('Pesanan "'+ord.title+'" dibatalkan. 1 unit stok tersedia lagi.');
      }
      function deleteProductSubmit(id){
        if(Server.enabled){
          api("/api/products/"+id,{method:"DELETE"}).then(function(){
            state.products=state.products.filter(function(x){return x.id!==id;});
            render();showToast("Listing dihapus dari stok.");
          }).catch(function(){showToast("Gagal menghapus di server — mungkin ada unit yang sedang dipesan.");});
          return;
        }
        state.products=state.products.filter(function(x){return x.id!==id;});
        analytics.orders=analytics.orders.filter(function(o){return o.id!==id;});
        render();showToast("Listing dihapus dari stok.");
      }

      /* ---------- kartu Masuk / Daftar TERPISAH ---------- */
      /* Primitif kartu saja (tanpa lampu): dipakai oleh setAuthView
         di js/lamp.js. */
      function showAuthCard(which){
        var isLogin=which==="login";
        var lc=document.getElementById("loginCard"),rc=document.getElementById("registerCard");
        if(lc)lc.hidden=!isLogin;
        if(rc)rc.hidden=isLogin;
      }
      /* Satu-satunya jalur ganti kartu + lampu: semua pemindah
         (tali, kepala lampu, tautan teks, pemrograman) lewat
         window.setAuthView di js/lamp.js — kalau lampu belum
         termuat, fallback ke kartu saja. */
      function switchAuthView(which){
        if(typeof window.setAuthView==="function")window.setAuthView(which);
        /* lamp.js belum termuat (app.js jalan duluan): kartu diganti
           sekarang, lampunya menyusul saat lamp.js init membaca
           flag ini. */
        else{window.__pendingAuthView=which;showAuthCard(which);}
      }
      /* ---------- login Google LANGSUNG (GIS + signInWithIdToken) ---------- */
      /* Seperti RekberSTORE: tombol Google dirender GIS dari
         gankstore.my.id, token ID diteruskan ke Supabase — TANPA
         redirect hosted-OAuth ke supabase.co, jadi layar pilih akun
         Google tertulis "Lanjutkan ke gankstore.my.id".
         Nonce (pola Supabase + GIS): rawNonce acak dibuat per
         inisialisasi dan disimpan di sessionStorage; ke Google
         dikirim SHA-256(rawNonce), ke Supabase dikirim rawNonce —
         Supabase me-hash sendiri lalu membandingkan dengan claim
         nonce di token. TIDAK ada lagi endpoint /api/auth/google. */
      /* Tombol Google ada di KEDUA kartu (di bawah tombol submit):
         pesan + fallback ditampilkan di kedua kartu sekaligus, dan
         GIS merender tombol ke kedua wadah dengan callback yang sama.
         Error Google ditampilkan di kartu yang sedang terlihat. */
      function googleErrorId(){var r=document.getElementById("registerCard");return (r&&!r.hidden)?"registerError":"loginError";}
      function googleMsgShow(text,showRetry){["Login","Register"].forEach(function(s){var m=document.getElementById("googleMsg"+s);if(m)m.textContent=text;var f=document.getElementById("googleFallback"+s);if(f)f.hidden=false;var b=document.getElementById("googleRetryBtn"+s);if(b)b.hidden=!showRetry;});}
      function googleMsgHide(){["Login","Register"].forEach(function(s){var f=document.getElementById("googleFallback"+s);if(f)f.hidden=true;});}
var _googleTries = 0;
var _googleServerRetried = false;
var _googleInitialized = false;
function googleNonceRaw(){
  /* Nonce mentah baru (32 byte acak -> hex) per inisialisasi. */
  var bytes = new Uint8Array(32);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else { for (var i=0;i<32;i++) bytes[i]=Math.floor(Math.random()*256); }
  var raw = Array.prototype.map.call(bytes,function(b){return ("0"+b.toString(16)).slice(-2);}).join("");
  try { sessionStorage.setItem("gs_google_nonce", raw); } catch (e) {}
  return raw;
}
function sha256Hex(str){
  if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
    var data = new TextEncoder().encode(str);
    return window.crypto.subtle.digest("SHA-256", data).then(function(buf){
      return Array.prototype.map.call(new Uint8Array(buf),function(b){return ("0"+b.toString(16)).slice(-2);}).join("");
    });
  }
  return Promise.resolve(str);
}
function handleGoogleCredential(resp){
  if (!resp || !resp.credential) { formError(googleErrorId(),"Login Google gagal. Coba lagi."); return; }
  var nonce = "";
  try { nonce = sessionStorage.getItem("gs_google_nonce") || ""; } catch (e) {}
  if (!nonce) { formError(googleErrorId(),"Login Google gagal. Coba lagi."); return; }
  try { sessionStorage.setItem("gs_after_oauth", location.hash || "#/"); } catch (e) {}
  Supa.signInWithIdToken(resp.credential, nonce).then(function(r){
    Server.user = { name: r.name, email: r.email, is_admin: !!r.is_admin };
    afterLogin(Server.user); refreshServerData();
  }).catch(function(){
    formError(googleErrorId(),"Login Google ditolak oleh server. Coba lagi atau pakai email + password.");
  });
}
function initGoogleSignIn(){
  /* Dua wadah (satu per kartu); lebar tombol diambil dari wadah yang
     terlihat — wadah di kartu yang tersembunyi lebarnya 0. GIS boleh
     merender ke dua wadah dengan satu initialize + callback yang sama;
     iframe tidak dipindah-pindah antar kartu. */
  var wraps=[document.getElementById("googleBtnWrapLogin"),document.getElementById("googleBtnWrapRegister")];
  if (!wraps[0]||!wraps[1]) return;
  function setWraps(display){wraps.forEach(function(w){if(w)w.style.display=display;});}
  var GOOGLE_CLIENT_ID = (window.GS_CONFIG && window.GS_CONFIG.GOOGLE_CLIENT_ID) || "";
  if (!Server.enabled) {
    if (!_googleServerRetried) {
      _googleServerRetried = true;
      setTimeout(function(){ initServer().then(function(){ _googleTries = 0; initGoogleSignIn(); }); }, 1000);
      return;
    }
    setWraps("none");
    googleMsgShow("Login Google butuh koneksi ke server toko — pakai email + password di atas.", true);
    return;
  }
  _googleServerRetried = false;
  googleMsgHide();
  setWraps("");
  if (!GOOGLE_CLIENT_ID) {
    setWraps("none");
    googleMsgShow("Login Google belum terhubung — pakai email + password di atas.", true);
    return;
  }
  if (!window.Supa || !Supa.ready) {
    setWraps("none");
    googleMsgShow("Login Google belum terhubung — pakai email + password di atas.", true);
    return;
  }
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    if (_googleTries < 10) { _googleTries++; setTimeout(initGoogleSignIn, 500); return; }
    setWraps("none");
    googleMsgShow("Login Google tidak bisa dimuat — pakai email + password di atas.", true);
    return;
  }
  if (_googleInitialized) return;
  _googleInitialized = true;
  var rawNonce = googleNonceRaw();
  sha256Hex(rawNonce).then(function(hashedNonce){
    try {
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential, nonce: hashedNonce, ux_mode: "popup" });
      var vis = wraps[0].clientWidth ? wraps[0] : wraps[1];
      var w = vis.clientWidth || 320; if (w < 200) w = 200; if (w > 400) w = 400;
      wraps.forEach(function(wrap){
        window.google.accounts.id.renderButton(wrap, { theme: "outline", size: "large", width: w, text: "continue_with" });
      });
    } catch (e) {
      _googleInitialized = false;
      setWraps("none");
      googleMsgShow("Login Google tidak bisa dimuat — pakai email + password di atas.", true);
    }
  }).catch(function(){
    _googleInitialized = false;
    setWraps("none");
    googleMsgShow("Login Google tidak bisa dimuat — pakai email + password di atas.", true);
  });
}
      /* Tombol "Coba lagi" di pesan Google (satu per kartu): sambung
         ulang ke server lalu coba inisialisasi Google lagi — tanpa
         reload halaman. */
      (function(){
        ["Login","Register"].forEach(function(s){
          var b=document.getElementById("googleRetryBtn"+s);
          if(!b)return;
          b.addEventListener("click",function(){
            _googleTries=0;_googleServerRetried=false;_googleInitialized=false;
            googleMsgHide();
            initServer().then(function(){initGoogleSignIn();});
          });
        });
      })();
      function formError(id,msg){var e=document.getElementById(id);e.textContent=msg;e.classList.add("show");}
      function clearError(id){document.getElementById(id).classList.remove("show");}
      document.getElementById("loginForm").addEventListener("submit",function(ev){
        ev.preventDefault();clearError("loginError");
        var email=document.getElementById("liEmail").value.trim().toLowerCase();
        var pass=document.getElementById("liPass").value;
        if(!validEmail(email)){formError("loginError","Format email tidak valid. Cek lagi alamat emailnya.");return;}
        if(!pass){formError("loginError","Password belum diisi.");return;}
        if(Server.enabled){
          api("/api/auth/login",{method:"POST",body:{email:email,password:pass}}).then(function(r){
            setToken(r.token);Server.user={name:r.name,email:r.email,is_admin:!!r.is_admin};
            ev.target.reset();afterLogin(Server.user);refreshServerData();
          }).catch(function(){formError("loginError","Email atau password salah, atau server tidak bisa dihubungi.");});
          return;
        }
        var users=loadUsers(),found=null;
        users.forEach(function(u){if(u.email===email)found=u;});
        if(!found){formError("registerError","Email ini belum terdaftar. Daftar dulu — emailnya sudah terisi di bawah.");switchAuthView("register");document.getElementById("rgEmail").value=email;return;}
        if(found.pass!==hashPw(pass)){formError("loginError","Password salah. Coba lagi.");return;}
        setSession(email);ev.target.reset();afterLogin(found);
      });
      document.getElementById("registerForm").addEventListener("submit",function(ev){
        ev.preventDefault();clearError("registerError");
        var name=document.getElementById("rgName").value.trim();
        var email=document.getElementById("rgEmail").value.trim().toLowerCase();
        var pass=document.getElementById("rgPass").value;
        var pass2=document.getElementById("rgPass2").value;
        if(!name){formError("registerError","Nama belum diisi.");return;}
        if(!validEmail(email)){formError("registerError","Format email tidak valid. Cek lagi alamat emailnya.");return;}
        if(pass.length<6){formError("registerError","Password minimal 6 karakter.");return;}
        if(pass!==pass2){formError("registerError","Ulangi password tidak sama dengan password.");return;}
        if(Server.enabled){
          api("/api/auth/register",{method:"POST",body:{name:name,email:email,password:pass}}).then(function(r){
            setToken(r.token);Server.user={name:r.name,email:r.email,is_admin:!!r.is_admin};
            ev.target.reset();
            showToast("Akun berhasil dibuat. Selamat datang, "+name.split(" ")[0]+"!");
            afterLogin(Server.user);refreshServerData();
          }).catch(function(e){formError("registerError",e&&e.message==="needs_confirmation"?"Akun dibuat — cek email kamu untuk konfirmasi, lalu masuk.":"Email ini sudah terdaftar, atau server tidak bisa dihubungi.");});
          return;
        }
        var users=loadUsers(),dup=false;
        users.forEach(function(u){if(u.email===email)dup=true;});
        if(dup){formError("registerError","Email ini sudah terdaftar. Masuk lewat kartu Masuk.");return;}
        var nu={name:name,email:email,pass:hashPw(pass)};
        users.push(nu);saveUsers(users);setSession(email);ev.target.reset();
        showToast("Akun berhasil dibuat. Selamat datang, "+name.split(" ")[0]+"!");
        afterLogin(nu);
      });
      function doLogout(){
        if(Server.enabled){api("/api/auth/logout",{method:"POST"}).catch(function(){});setToken(null);Server.user=null;}
        setSession(null);pendingAdmin=false;renderAuth();showToast("Kamu sudah keluar.");location.hash="#/";if(getRoute().page==="beranda")applyRoute();
      }
      document.getElementById("btnLogout").addEventListener("click",doLogout);
      var btnSideLogout=document.getElementById("btnSideLogout");
      if(btnSideLogout)btnSideLogout.addEventListener("click",doLogout);

      /* ---------- support: Jarvis — Support GankStore ---------- */
      var LS_SUPPORT="gankstore_support_messages";
      function loadLocalSupport(){try{var m=JSON.parse(localStorage.getItem(LS_SUPPORT)||"[]");return Array.isArray(m)?m:[];}catch(e){return[];}}
      function saveLocalSupport(m){try{localStorage.setItem(LS_SUPPORT,JSON.stringify(m));}catch(e){}}
      function renderSupportPage(){
        var note=document.getElementById("supportNote");if(!note)return;
        note.textContent=Server.enabled
          ?"Pesanmu tersimpan dan dibaca tim toko."
          :"Pesanmu tersimpan di perangkat ini. Untuk respon tercepat, hubungi langsung via WhatsApp di atas.";
      }
      document.getElementById("supportForm").addEventListener("submit",function(ev){
        ev.preventDefault();clearError("supportError");
        var name=document.getElementById("sName").value.trim();
        var contact=document.getElementById("sContact").value.trim();
        var topic=document.getElementById("sTopic").value;
        var message=document.getElementById("sMessage").value.trim();
        if(!name){formError("supportError","Nama belum diisi.");return;}
        if(!contact){formError("supportError","Email / WhatsApp belum diisi — kami butuh ini untuk membalasmu.");return;}
        if(message.length<3){formError("supportError","Pesan terlalu pendek. Tulis masalahmu, sertakan nomor invoice bila ada.");return;}
        var done=function(local){
          ev.target.reset();renderSupportPage();
          showToast(local?"Pesan tersimpan di perangkat ini. Untuk respon tercepat, hubungi via WhatsApp.":"Pesan terkirim. Jarvis — Support GankStore akan menindaklanjutinya.");
        };
        if(Server.enabled){
          api("/api/support",{method:"POST",body:{name:name,contact:contact,topic:topic,message:message}}).then(function(){done(false);}).catch(function(){showToast("Gagal mengirim ke server. Coba lagi, atau hubungi langsung via WhatsApp.");});
          return;
        }
        var list=loadLocalSupport();
        list.unshift({id:Date.now(),name:name,contact:contact,topic:topic,message:message,status:"baru",created_at:new Date().toLocaleString("id-ID")});
        saveLocalSupport(list);
        done(true);
      });
      function supportItemHTML(m){
        var replied=m.status==="dibalas";
        return '<div class="support-item"><div class="support-meta"><b>'+esc(m.name)+'</b><span>'+esc(m.contact)+'</span><span class="support-topic">'+esc(m.topic)+'</span><span>'+esc(m.created_at||"")+'</span><span class="support-status '+(replied?"done":"")+'">'+(replied?"Sudah dibalas":"Baru")+'</span></div><p>'+esc(m.message)+'</p>'+(replied?"":'<button class="mini lunas" type="button" data-replied="'+m.id+'">Tandai sudah dibalas</button>')+"</div>";
      }
      function renderSupportAdmin(){
        var box=document.getElementById("supportMsgList");if(!box)return;
        if(!isAdminUser()){box.innerHTML="";return;}
        function paint(list){
          if(!list.length){box.innerHTML='<p class="stock-empty">Belum ada pesan support masuk.</p>';return;}
          box.innerHTML=list.map(supportItemHTML).join("");
          box.querySelectorAll("[data-replied]").forEach(function(b){b.addEventListener("click",function(){
            var id=b.getAttribute("data-replied");
            if(Server.enabled){
              api("/api/support/"+encodeURIComponent(id)+"/replied",{method:"POST"}).then(function(){renderSupportAdmin();showToast("Pesan ditandai sudah dibalas.");}).catch(function(){showToast("Gagal menandai di server.");});
              return;
            }
            var l=loadLocalSupport();l.forEach(function(m){if(String(m.id)===String(id))m.status="dibalas";});
            saveLocalSupport(l);renderSupportAdmin();showToast("Pesan ditandai sudah dibalas.");
          });});
        }
        if(Server.enabled){
          api("/api/support").then(function(list){paint(list||[]);}).catch(function(){box.innerHTML='<p class="stock-empty">Gagal memuat pesan dari server. Coba muat ulang halaman.</p>';});
          return;
        }
        paint(loadLocalSupport());
      }

      if(!location.hash) location.hash="#/";
      initServer().then(function(){
        logActivity("kunjung","Sesi toko dimulai.");
        render();renderAuth();applyRoute();initGoogleSignIn();
      });
