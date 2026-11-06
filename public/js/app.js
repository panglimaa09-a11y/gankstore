      "use strict";
      var GAMES=window.GS_CONFIG.GAMES;
      var state={products:[],filterGame:"Semua",query:"",sort:"baru",status:"semua",photoData:"",seq:0};
      var grid=document.getElementById("grid"), homeGrid=document.getElementById("homeGrid"), emptyState=document.getElementById("emptyState"), emptyTitle=document.getElementById("emptyTitle"), emptyText=document.getElementById("emptyText"), catalogCount=document.getElementById("catalogCount"), chipsBox=document.getElementById("gameChips"), toastEl=document.getElementById("toast");
      var toastTimer=null, currentDetail=null;
      /* ---------- mode server (Python/FastAPI) vs lokal ---------- */
      /* Kalau halaman disajikan backend Python, stok/pesanan/akun tersimpan
         di SQLite server. Kalau dibuka sebagai file statis (Vercel statis /
         GitHub Pages), semua fungsi lama (localStorage + memori) tetap jalan. */
      var Server={enabled:false,token:null,user:null,payments:{configured:false,is_production:false,client_key:null}};
      /* API_BASE dari config.js: alamat backend remote (lewat tunnel ngrok).
         "" = origin yang sama (saat disajikan backend Python). Sebelumnya
         API_BASE didefinisikan tapi TIDAK PERNAH dipakai — api() selalu
         fetch relatif, jadi frontend Vercel tidak pernah bisa mencapai
         backend remote. Sekarang semua fetch API melewati API_BASE. */
      var API_BASE=(window.GS_CONFIG.API_BASE||"").replace(/\/$/,"");
      /* Video intro hero: hormati prefers-reduced-motion — jangan autoplay,
         tampilkan poster saja. */
      (function(){var v=document.querySelector(".hero-video");if(!v)return;if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches){v.removeAttribute("autoplay");v.pause();}})();
      function apiToken(){try{return localStorage.getItem("gankstore_token");}catch(e){return null;}}
      function setToken(t){try{if(t)localStorage.setItem("gankstore_token",t);else localStorage.removeItem("gankstore_token");}catch(e){}}
      function api(path,opts){
        opts=opts||{};
        var headers={"Content-Type":"application/json"};
        var t=apiToken();if(t)headers["Authorization"]="Bearer "+t;
        return fetch(API_BASE+path,{method:opts.method||"GET",headers:headers,body:opts.body?JSON.stringify(opts.body):undefined}).then(function(r){
          if(!r.ok)throw new Error("HTTP "+r.status);
          return r.json();
        });
      }
      function serverProductToLocal(p){return{id:p.id,game:p.game,title:p.title,rank:p.rank||"",level:p.level||"",server:p.server||"",price:p.price,specs:p.specs||[],desc:p.desc||"",photo:p.photo||"",sold:p.status==="terjual",status:p.status,credEmail:p.cred_email||"",credPass:p.cred_pass||"",credWiped:!!p.cred_wiped};}
      function serverOrderToLocal(o){return{id:o.product_id||o.package_id,kind:o.kind||"akun",invoiceNo:o.invoice_no,title:o.title,price:o.price,fee:o.fee,total:o.total,photo:o.photo||"",game:o.game,rank:o.rank||"",time:(o.created_at||"").slice(11,19),status:o.status,buyerName:o.buyer_name||"",buyerEmail:o.buyer_email||"",userId:o.user_id_game||"",serverId:o.server_id||"",packageName:o.package_name||"",amount:o.amount||"",currency:o.currency||"",credPending:!!o.cred_pending,credRevealed:!!o.cred_revealed,credEmail:"",credPass:""};}
      function serverPackageToLocal(p){return{id:p.id,game:p.game,name:p.name,amount:p.amount,currency:p.currency,price:p.price};}
      function refreshServerData(){
        if(!Server.enabled)return Promise.resolve();
        return Promise.all([api("/api/products").catch(function(){return[];}),api("/api/orders").catch(function(){return[];}),api("/api/topup/packages").catch(function(){return[];})]).then(function(res){
          state.products=(res[0]||[]).map(serverProductToLocal);
          state.seq=(res[0]||[]).reduce(function(m,p){return Math.max(m,p.id||0);},0);
          analytics.orders=(res[1]||[]).map(serverOrderToLocal);
          if(window.TopUp&&TopUp.setPackages)TopUp.setPackages((res[2]||[]).map(serverPackageToLocal));
          render();
        }).catch(function(){});
      }
      function initServer(){
        return fetch(API_BASE+"/api/health",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("no api");return r.json();}).then(function(){
          Server.enabled=true;
          return Promise.all([
            api("/api/products").catch(function(){return[];}),
            api("/api/orders").catch(function(){return[];}),
            api("/api/topup/packages").catch(function(){return[];}),
            api("/api/activity").catch(function(){return[];}),
            api("/api/auth/me").catch(function(){return null;}),
            api("/api/payments/config").catch(function(){return null;})
          ]).then(function(res){
            state.products=(res[0]||[]).map(serverProductToLocal);
            state.seq=(res[0]||[]).reduce(function(m,p){return Math.max(m,p.id||0);},0);
            analytics.orders=(res[1]||[]).map(serverOrderToLocal);
            analytics.invoiceSeq=analytics.orders.length;
            if(window.TopUp&&TopUp.setPackages)TopUp.setPackages((res[2]||[]).map(serverPackageToLocal));
            var acts=res[3]||[];
            if(acts.length){analytics.activity=acts.map(function(a){return{time:a.time,tag:a.tag,text:a.text};});}
            if(res[4]&&res[4].email){Server.user={name:res[4].name,email:res[4].email,is_admin:!!res[4].is_admin};}
            if(res[5]){Server.payments=res[5];}
          });
        }).catch(function(){Server.enabled=false;});
      }

      function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
      function formatIDR(n){return "Rp"+Number(n||0).toLocaleString("id-ID");}
      function showToast(msg){toastEl.textContent=msg;toastEl.classList.add("show");if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.classList.remove("show");},2600);}

      /* ---------- statistik, live tracking, pesanan otomatis ---------- */
      var analytics={pageViews:0,detailViews:0,buyClicks:0,activity:[],orders:[],lastRoute:"",lastRouteAt:0,invoiceSeq:0};
      function timeStr(d){return (d||new Date()).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});}
      function pStatus(p){return p.status||(p.sold?"terjual":"tersedia");}
      function setStatus(p,st){p.status=st;p.sold=(st==="terjual");}
      function countBy(st){return state.products.filter(function(p){return pStatus(p)===st;}).length;}
      function totalRevenue(){var a=state.products.filter(function(p){return pStatus(p)==="terjual";}).reduce(function(s,p){return s+Number(p.price||0);},0);var b=analytics.orders.filter(function(o){return o.kind==="topup"&&o.status==="terjual";}).reduce(function(s,o){return s+Number(o.price||0);},0);return a+b;}
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
        parts.push("Tersedia: <b>"+countBy("tersedia")+" akun</b>");
        if(countBy("terjual")>0)parts.push("Terjual: <b>"+countBy("terjual")+" akun</b>");
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
        if(pStatus(p)!=="tersedia")return Promise.resolve(null);
        if(Server.enabled){
          return api("/api/orders",{method:"POST",body:{product_id:p.id}}).then(function(o){
            if(!o)return null;
            var order=serverOrderToLocal(o);
            analytics.buyClicks++;
            setStatus(p,"dipesan");
            analytics.orders.unshift(order);
            logActivity("pesan",'Akun "'+p.title+'" dipesan — invoice '+order.invoiceNo+" terbit ("+formatIDR(order.total)+" termasuk biaya admin "+formatIDR(order.fee)+"). Menunggu pembayaran via Midtrans.");
            showEventPopup(p,"pesan");
            showToast('Pesanan dibuat! Invoice '+order.invoiceNo+" — akun otomatis ditandai DIPESAN.");
            render();
            return order;
          }).catch(function(){showToast("Gagal membuat pesanan di server. Coba lagi.");return null;});
        }
        analytics.buyClicks++;
        setStatus(p,"dipesan");
        var u=currentUser();
        var fee=adminFee(p.price);
        var order={id:p.id,invoiceNo:makeInvoiceNo(),title:p.title,price:p.price,fee:fee,total:Number(p.price||0)+fee,photo:p.photo,game:p.game,rank:p.rank||"",time:timeStr(),status:"dipesan",buyerName:u?u.name:"Pembeli",buyerEmail:u?u.email:""};
        analytics.orders.unshift(order);
        logActivity("pesan",'Akun "'+p.title+'" dipesan — invoice '+order.invoiceNo+" terbit ("+formatIDR(order.total)+" termasuk biaya admin "+formatIDR(fee)+"). Menunggu pembayaran via Midtrans.");
        showEventPopup(p,"pesan");
        showToast('Pesanan dibuat! Invoice '+order.invoiceNo+" — akun otomatis ditandai DIPESAN.");
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
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔ — data akunmu siap</b><p>Email &amp; password akun ini ditampilkan <strong>satu kali</strong> di halaman sukses. Siapkan tempat menyimpannya sebelum membuka — setelah ditampilkan, data otomatis dihapus dari toko dan tidak bisa dilihat lagi.</p></div><a class="btn-pay" href="#/sukses/'+esc(o.invoiceNo)+'" style="display:block;text-align:center;text-decoration:none">Lihat Data Akun (satu kali)</a>';
          }else if(o.credRevealed){
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔</b><p>Data login akun ini <strong>sudah ditampilkan satu kali</strong> di halaman sukses dan sudah dihapus dari data toko, jadi tidak bisa ditampilkan lagi. Segera amankan akun dengan password barumu.</p></div>';
          }else{
            payBlock='<div class="pay-method"><b>Pembayaran lunas ✔</b><p>Pembayaranmu sudah dikonfirmasi lunas. Akun ini tidak menyimpan email &amp; password di toko, jadi data login diserahkan toko secara terpisah.</p></div>';
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
        if(Server.enabled&&o.credPending&&!o.credEmail){
          wrap.innerHTML='<div class="empty"><h3>Memuat data akun…</h3><p>Mengambil data login satu kali dari server.</p></div>';
          api("/api/orders/"+encodeURIComponent(invNo)+"/credentials").then(function(c){if(c&&c.email){o.credEmail=c.email;o.credPass=c.password;renderSukses(invNo);}else{wrap.innerHTML='<div class="empty"><h3>Data akun tidak tersedia</h3><p>Server tidak mengembalikan data login untuk invoice ini. Hubungi kami dengan nomor invoice '+esc(invNo)+'.</p></div>';}});
          return;
        }
        if(o.credPending&&o.credEmail){
          /* TAMPIL SATU KALI: tangkap nilainya, lalu hapus permanen dari data order & stok saat itu juga */
          var ce=o.credEmail, cpw=o.credPass;
          o.credEmail="";o.credPass="";o.credPending=false;o.credRevealed=true;
          var prod=state.products.find(function(x){return x.id===o.id;});
          if(prod){prod.credEmail="";prod.credPass="";prod.credWiped=true;}
          logActivity("lunas",'Data login "'+o.title+'" ditampilkan satu kali ke pembeli di halaman sukses lalu dihapus dari data stok.');
          wrap.innerHTML='<div class="invoice-box"><div class="invoice-head"><div><div class="invoice-no">'+esc(o.title)+'</div><div style="color:var(--ink-faint);font-weight:600;font-size:14px">Invoice '+esc(o.invoiceNo)+' · Lunas · '+esc(o.game)+'</div></div><span class="inv-status lunas">Data Akun</span></div><div class="cred-box"><div class="cred-row"><span>Email akun</span><code>'+esc(ce)+'</code></div><div class="cred-row"><span>Password akun</span><code>'+esc(cpw)+'</code></div><button class="btn-pay" type="button" id="btnCopyCred" style="margin-top:14px">Salin Email &amp; Password</button><p class="cred-warn">⚠ Ini satu-satunya penampilan data ini. Data sudah dihapus dari toko — kalau halaman ini ditutup atau dimuat ulang, email &amp; password di atas <strong>tidak bisa ditampilkan lagi</strong>. Salin sekarang, lalu login dan ganti password akunnya.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn-detail" href="#/katalog" style="flex:1">Lihat Katalog</a><a class="btn-detail" href="#/invoice/'+esc(o.invoiceNo)+'" style="flex:1">Kembali ke Invoice</a></div></div>';
          var bc=document.getElementById("btnCopyCred");
          if(bc)bc.addEventListener("click",function(){
            var text="Akun: "+o.title+"\nEmail: "+ce+"\nPassword: "+cpw;
            function done(){showToast("Email & password tersalin. Simpan di tempat aman!");}
            if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,function(){fallbackCopy(text);done();});}else{fallbackCopy(text);done();}
          });
          return;
        }
        if(o.credRevealed){
          wrap.innerHTML='<div class="empty"><h3>Data akun sudah pernah ditampilkan</h3><p>Email &amp; password akun ini sudah ditampilkan satu kali dan otomatis dihapus dari data toko, jadi tidak bisa ditampilkan atau dipakai lagi dari sini. Kalau kamu belum sempat menyimpannya, hubungi kami dengan nomor invoice '+esc(o.invoiceNo)+'.</p><a class="btn-dark" href="#/invoice/'+esc(o.invoiceNo)+'">Kembali ke Invoice</a></div>';return;
        }
        wrap.innerHTML='<div class="empty"><h3>Pembayaran lunas</h3><p>Akun ini tidak menyimpan email &amp; password di toko, jadi data login diserahkan toko secara terpisah. Tunjukkan nomor invoice '+esc(o.invoiceNo)+' ke toko.</p><a class="btn-dark" href="#/invoice/'+esc(o.invoiceNo)+'">Kembali ke Invoice</a></div>';
      }
      function renderReport(){
        renderTicker();renderFeed();
        var rs=document.getElementById("reportStats");
        if(rs){
          rs.innerHTML=
            '<div class="stat"><b>'+analytics.pageViews+'</b><span>Kunjungan halaman</span></div>'+
            '<div class="stat"><b>'+analytics.detailViews+'</b><span>Kali lihat detail akun</span></div>'+
            '<div class="stat"><b>'+analytics.buyClicks+'</b><span>Klik Beli Sekarang (pesanan dibuat)</span></div>'+
            '<div class="stat"><b>'+countBy("dipesan")+'</b><span>Akun sedang dipesan</span></div>'+
            '<div class="stat"><b>'+state.products.length+'</b><span>Total stok dipajang</span></div>'+
            '<div class="stat"><b>'+countBy("tersedia")+'</b><span>Stok tersedia</span></div>'+
            '<div class="stat"><b>'+countBy("terjual")+'</b><span>Akun terjual (lunas)</span></div>'+
            '<div class="stat"><b>'+formatIDR(totalRevenue())+'</b><span>Total penjualan</span></div>'+
            '<div class="stat"><b>'+analytics.orders.filter(function(o){return o.kind==="topup"&&o.status==="terjual";}).length+'</b><span>Top up selesai</span></div>';
          var fb=document.getElementById("funnelBox");
          if(fb){
            var rows=[["Kunjungan halaman",analytics.pageViews],["Lihat detail akun",analytics.detailViews],["Klik Beli (dipesan)",analytics.buyClicks],["Terjual (lunas)",countBy("terjual")]];
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
          var pageNames={"beranda":"Beranda","katalog":"Katalog","cara-beli":"Cara Beli","bantuan":"Bantuan","akun":"halaman Akun","detail":"Detail Akun","topup":"Top Up","topup-game":"Top Up","admin-toppup":"Paket Top Up","admin-support":"Pesan Support"};
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
          if(pendingAuthTab){var t=document.getElementById(pendingAuthTab==="register"?"tabRegister":"tabLogin");if(t)t.click();pendingAuthTab=null;}
        }
        if(r.page==="bantuan")renderSupportPage();
        if(r.page==="admin-support")renderSupportAdmin();
        if(r.page==="topup"&&window.TopUp)TopUp.renderTopup();
        if(r.page==="topup-game"&&window.TopUp)TopUp.renderTopupGame(r.game);
        if(r.page==="admin-toppup"&&window.TopUp)TopUp.renderTopupAdmin();
        window.scrollTo(0,0);
      }
      window.addEventListener("hashchange",applyRoute);

      function specsHTML(p){var parts=[];if(p.rank)parts.push(p.rank);if(p.level)parts.push(p.level);if(p.server)parts.push("Server "+p.server);(p.specs||[]).forEach(function(s){parts.push(s);});return parts.map(function(s){return "<span>"+esc(s)+"</span>";}).join("");}
      function cardHTML(p){
        var media=p.photo?'<img src="'+p.photo+'" alt="Foto akun '+esc(p.title)+'" />':'<img src="icon.png" alt="GankStore" />';
        var st=pStatus(p);
        var buyBtn=st==="terjual"?'<span class="btn-buy disabled">Terjual</span>':st==="dipesan"?'<span class="btn-buy disabled">Dipesan</span>':'<button class="btn-buy" type="button" data-buy="'+p.id+'">Beli Sekarang</button>';
        var badge=st==="terjual"?'<span class="badge-sold">TERJUAL</span>':st==="dipesan"?'<span class="badge-ordered">DIPESAN</span>':"";
        return '<div class="card-media">'+media+'<span class="badge-game">'+esc(p.game)+"</span>"+badge+'</div><div class="card-body"><div class="card-title">'+esc(p.title)+'</div><div class="card-specs">'+specsHTML(p)+'</div><div class="card-foot"><div class="price">'+formatIDR(p.price)+'</div><div style="font-size:13px;color:var(--ink-faint);font-weight:600">+ biaya admin 10% · total '+formatIDR(Number(p.price||0)+adminFee(p.price))+'</div><div class="card-actions"><a class="btn-detail" href="#/detail/'+p.id+'">Detail</a>'+buyBtn+"</div></div></div>";
      }
      function buildCard(p){var el=document.createElement("article");var st=pStatus(p);el.className="card"+(st==="terjual"?" sold":st==="dipesan"?" ordered":"");el.innerHTML=cardHTML(p);var bb=el.querySelector("[data-buy]");if(bb)bb.addEventListener("click",function(){trackBuy(p).then(function(o){if(o)location.hash="#/invoice/"+encodeURIComponent(o.invoiceNo);});});return el;}

      function renderChips(){ /* toko fokus Point Blank saja — tidak ada filter per game */ }
      function visibleProducts(){
        var list=state.products.slice();
        if(state.filterGame!=="Semua")list=list.filter(function(p){return p.game===state.filterGame;});
        if(state.status==="tersedia")list=list.filter(function(p){return pStatus(p)==="tersedia";});
        if(state.status==="dipesan")list=list.filter(function(p){return pStatus(p)==="dipesan";});
        if(state.status==="terjual")list=list.filter(function(p){return pStatus(p)==="terjual";});
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
            '<div class="stat"><b>'+state.products.length+'</b><span>Total akun PB dipajang</span></div>'+
            '<div class="stat"><b>'+countBy("tersedia")+'</b><span>Akun tersedia</span></div>'+
            '<div class="stat"><b>'+countBy("dipesan")+'</b><span>Sedang dipesan</span></div>'+
            '<div class="stat"><b>'+countBy("terjual")+'</b><span>Sudah terjual</span></div>';
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
          ccParts.push(state.products.length+" akun dipajang");
          if(countBy("tersedia"))ccParts.push(countBy("tersedia")+" tersedia");
          if(countBy("dipesan"))ccParts.push(countBy("dipesan")+" dipesan");
          if(countBy("terjual"))ccParts.push(countBy("terjual")+" terjual");
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
        var buyHTML=st==="terjual"?'<span class="btn-buy disabled">Sudah Terjual</span>':st==="dipesan"?'<span class="btn-buy disabled">Sedang Dipesan Pembeli Lain</span>':'<button class="btn-buy" type="button" id="detailBuyNow">Beli Sekarang</button>';
        var stLabel=st==="terjual"?" · Terjual":st==="dipesan"?" · Dipesan":" · Tersedia";
        var stBadge=st==="terjual"?'<span class="badge-sold">TERJUAL</span>':st==="dipesan"?'<span class="badge-ordered">DIPESAN</span>':"";
        wrap.innerHTML='<div class="detail-layout"><div class="detail-media">'+(p.photo?'<img src="'+p.photo+'" alt="Foto akun '+esc(p.title)+'" />':'<img src="icon.png" alt="GankStore" />')+stBadge+'</div><div class="detail-panel"><div class="dlg-game">'+esc(p.game)+stLabel+'</div><h1>'+esc(p.title)+'</h1><div class="dlg-specs">'+specsHTML(p)+'</div><p class="dlg-desc">'+esc(p.desc||"Semua rincian transaksi ada di invoice setelah kamu klik Beli Sekarang.")+'</p><div class="dlg-price">'+formatIDR(p.price)+'</div><p style="color:var(--ink-soft);font-size:14.5px;margin:-8px 0 16px;font-weight:600">+ biaya admin 10% ('+formatIDR(adminFee(p.price))+') di invoice · <strong>Total bayar '+formatIDR(Number(p.price||0)+adminFee(p.price))+'</strong></p><div class="dlg-actions">'+buyHTML+'<button class="btn-detail" type="button" id="detailCopy">Salin Detail</button></div><p style="color:var(--ink-faint);font-size:14px;margin:16px 0 0">Klik Beli Sekarang — akun ditandai <strong>Dipesan</strong> atas namamu dan invoice langsung terbit. Setelah lunas dikonfirmasi, email &amp; password akun ditampilkan <strong>satu kali</strong> di halaman sukses.</p></div></div>';
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
      document.getElementById("fPhoto").addEventListener("change",function(ev){var file=ev.target.files&&ev.target.files[0];if(!file){state.photoData="";document.getElementById("photoPreview").style.display="none";return;}var reader=new FileReader();reader.onload=function(){state.photoData=String(reader.result||"");document.getElementById("photoPreviewImg").src=state.photoData;document.getElementById("photoPreview").style.display="block";};reader.readAsDataURL(file);});
      document.getElementById("addForm").addEventListener("submit",function(ev){
        ev.preventDefault();
        var title=document.getElementById("fTitle").value.trim();var price=parseInt(document.getElementById("fPrice").value,10);
        if(!title||isNaN(price)||price<0){showToast("Judul dan harga wajib diisi dengan benar.");return;}
        var credEmail=document.getElementById("fCredEmail").value.trim();
        var credPass=document.getElementById("fCredPass").value;
        if(!validEmail(credEmail)){showToast("Email akun game wajib diisi dengan format email yang benar — data ini yang diserahkan ke pembeli setelah lunas.");return;}
        if(!credPass){showToast("Password akun game wajib diisi — data ini yang diserahkan ke pembeli setelah lunas.");return;}
        var specsRaw=document.getElementById("fSpecs").value.trim();
        var p={game:gameSelect.value,title:title,rank:document.getElementById("fRank").value.trim(),level:document.getElementById("fLevel").value.trim(),server:document.getElementById("fServer").value.trim(),price:price,specs:specsRaw?specsRaw.split(",").map(function(s){return s.trim();}).filter(Boolean):[],desc:document.getElementById("fDesc").value.trim(),photo:state.photoData,sold:false,status:"tersedia",credEmail:credEmail,credPass:credPass,credWiped:false};
        function done(saved){
          state.products.push(saved);
          state.filterGame="Semua";state.status="semua";document.getElementById("statusSelect").value="semua";
          ev.target.reset();state.photoData="";document.getElementById("photoPreview").style.display="none";
          logActivity("stok",'Stok baru dipajang: "'+title+'" ('+formatIDR(price)+").");
          render();showToast('Akun "'+title+'" sudah dipajang. Cek di Daftar Stok.');
          location.hash="#/admin/stok";if(getRoute().page==="admin-stok")applyRoute();
        }
        if(Server.enabled){
          api("/api/products",{method:"POST",body:{game:p.game,title:p.title,rank:p.rank,level:p.level,server:p.server,price:p.price,specs:p.specs,desc:p.desc,photo:p.photo,credEmail:p.credEmail,credPass:p.credPass}}).then(function(saved){
            if(saved&&saved.id){done(serverProductToLocal(saved));}
            else{showToast("Gagal menyimpan ke server.");}
          }).catch(function(){showToast("Gagal menyimpan ke server. Cek koneksi lalu coba lagi.");});
          return;
        }
        p.id=++state.seq;
        done(p);
      });

      function renderAdminDash(){
        var box=document.getElementById("adminStats");if(!box)return;
        if(!isAdminUser()){box.innerHTML="";return;}
        box.innerHTML=
          '<div class="stat"><b>'+state.products.length+'</b><span>Total stok dipajang</span></div>'+
          '<div class="stat"><b>'+countBy("tersedia")+'</b><span>Tersedia</span></div>'+
          '<div class="stat"><b>'+countBy("dipesan")+'</b><span>Dipesan — menunggu lunas</span></div>'+
          '<div class="stat"><b>'+countBy("terjual")+'</b><span>Sudah terjual</span></div>'+
          '<div class="stat"><b>'+analytics.pageViews+'</b><span>Kunjungan — <a href="#/admin/laporan" style="color:var(--accent-strong);font-weight:800">detail di Statistik &amp; Live</a></span></div>'+
          '<div class="stat"><b>'+formatIDR(totalRevenue())+'</b><span>Total penjualan</span></div>'+
          '<div class="stat"><b>'+analytics.orders.length+'</b><span>Pesanan masuk</span></div>'+
          '<div class="stat"><b>Midtrans</b><span>Pembayaran invoice · biaya admin 10% — <a href="#/admin/pengaturan" style="color:var(--accent-strong);font-weight:800">detail di Pengaturan</a></span></div>';
      }

      function renderStockList(){
        var box=document.getElementById("stockList");if(!box)return;box.innerHTML="";
        if(!isAdminUser())return;
        if(!state.products.length){box.innerHTML='<p class="stock-empty">Belum ada stok. Tambahkan akun pertama lewat halaman <a href="#/admin/tambah" style="font-weight:800;color:var(--accent-strong)">Tambah Akun</a>.</p>';return;}
        state.products.slice().sort(function(a,b){return b.id-a.id;}).forEach(function(p){
          var item=document.createElement("div");item.className="stock-item";var st=pStatus(p);
          var stTxt=st==="terjual"?" · TERJUAL":st==="dipesan"?" · DIPESAN — menunggu lunas":" · Tersedia";
          var acts="";
          if(st==="dipesan")acts='<button class="mini lunas" type="button" data-lunas="'+p.id+'">Konfirmasi Lunas</button><button class="mini" type="button" data-batal="'+p.id+'">Batalkan Pesanan</button>';
          else if(st==="terjual")acts='<button class="mini" type="button" data-pajang="'+p.id+'">Pajang lagi</button>';
          else acts='<span style="font-size:13px;color:var(--ink-faint);font-weight:600">Menunggu pembeli klik Beli</span>';
          var credLine="";
          if(st!=="terjual"&&p.credEmail)credLine='<span class="admin-cred">🔒 Khusus admin — Email: '+esc(p.credEmail)+" · Password: "+esc(p.credPass)+"</span>";
          else if(p.credWiped&&st==="terjual")credLine='<span class="admin-cred">🔒 Email &amp; password sudah dipindah ke invoice pembeli dan dihapus dari stok.</span>';
          else if(p.credWiped)credLine='<span class="admin-cred" style="color:var(--danger)">⚠ Kredensial kosong (sudah terhapus saat penjualan sebelumnya) — hapus &amp; tambah ulang stok dengan email &amp; password baru.</span>';
          else credLine='<span class="admin-cred">🔒 Tidak ada kredensial tersimpan untuk akun ini.</span>';
          item.innerHTML='<div class="thumb">'+(p.photo?'<img src="'+p.photo+'" alt="" />':'<img src="icon.png" alt="GankStore" />')+'</div><div class="meta"><b>'+esc(p.title)+"</b><span>"+esc(p.game)+" · "+formatIDR(p.price)+stTxt+"</span>"+credLine+'</div><div class="acts">'+acts+'<button class="mini danger" type="button" data-del="'+p.id+'">Hapus</button></div>';
          box.appendChild(item);
        });
        function findOrderFor(p){var found=null;analytics.orders.forEach(function(o){if(o.id===p.id&&o.status==="dipesan")found=o;});return found;}
        box.querySelectorAll("[data-lunas]").forEach(function(b){b.addEventListener("click",function(){
          var p=state.products.find(function(x){return x.id===Number(b.getAttribute("data-lunas"));});if(!p||pStatus(p)!=="dipesan")return;
          var ord=findOrderFor(p);if(!ord){showToast("Invoice pesanan tidak ditemukan.");return;}
          if(Server.enabled){
            api("/api/orders/"+encodeURIComponent(ord.invoiceNo)+"/confirm",{method:"POST"}).then(function(u){
              var uo=serverOrderToLocal(u);
              setStatus(p,"terjual");
              analytics.orders.forEach(function(o){if(o.invoiceNo===uo.invoiceNo){o.status="terjual";o.time=uo.time;o.credPending=uo.credPending;o.credRevealed=false;}});
              var hasCred=uo.credPending;
              if(hasCred){p.credEmail="";p.credPass="";p.credWiped=true;}
              logActivity("lunas",'Pembayaran lunas dikonfirmasi — "'+p.title+'" resmi TERJUAL ('+formatIDR(p.price)+")."+(hasCred?" Email & password akun dipindah ke invoice pembeli untuk ditampilkan satu kali, lalu dihapus dari stok.":""));
              showEventPopup(p,"lunas");
              render();showToast('Lunas! "'+p.title+'" Terjual.'+(hasCred?" Data akun menunggu ditampilkan satu kali ke pembeli di halaman sukses.":""));
            }).catch(function(){showToast("Gagal konfirmasi lunas di server.");});
            return;
          }
          setStatus(p,"terjual");
          var hasCred=!!(p.credEmail&&p.credPass);
          analytics.orders.forEach(function(o){if(o.id===p.id&&o.status==="dipesan"){o.status="terjual";o.time=timeStr();if(hasCred){o.credEmail=p.credEmail;o.credPass=p.credPass;o.credPending=true;o.credRevealed=false;}}});
          if(hasCred){p.credEmail="";p.credPass="";p.credWiped=true;}
          logActivity("lunas",'Pembayaran lunas dikonfirmasi — "'+p.title+'" resmi TERJUAL ('+formatIDR(p.price)+")."+(hasCred?" Email & password akun dipindah ke invoice pembeli untuk ditampilkan satu kali, lalu dihapus dari stok.":""));
          showEventPopup(p,"lunas");
          render();showToast('Lunas! "'+p.title+'" Terjual.'+(hasCred?" Data akun menunggu ditampilkan satu kali ke pembeli di halaman sukses.":""));
        });});
        box.querySelectorAll("[data-batal]").forEach(function(b){b.addEventListener("click",function(){
          var p=state.products.find(function(x){return x.id===Number(b.getAttribute("data-batal"));});if(!p||pStatus(p)!=="dipesan")return;
          var ord=findOrderFor(p);if(!ord){showToast("Invoice pesanan tidak ditemukan.");return;}
          if(Server.enabled){
            api("/api/orders/"+encodeURIComponent(ord.invoiceNo)+"/cancel",{method:"POST"}).then(function(u){
              setStatus(p,"tersedia");
              analytics.orders.forEach(function(o){if(o.invoiceNo===u.invoice_no)o.status="dibatalkan";});
              logActivity("batal",'Pesanan "'+p.title+'" dibatalkan admin — invoice ditandai Dibatalkan, akun tersedia lagi, kredensial tetap tersimpan di stok.');
              render();showToast('Pesanan "'+p.title+'" dibatalkan. Akun tersedia lagi.');
            }).catch(function(){showToast("Gagal membatalkan pesanan di server.");});
            return;
          }
          setStatus(p,"tersedia");
          analytics.orders.forEach(function(o){if(o.id===p.id&&o.status==="dipesan"){o.status="dibatalkan";o.time=timeStr();}});
          logActivity("batal",'Pesanan "'+p.title+'" dibatalkan admin — invoice ditandai Dibatalkan, akun tersedia lagi, kredensial tetap tersimpan di stok.');
          render();showToast('Pesanan "'+p.title+'" dibatalkan. Akun tersedia lagi.');
        });});
        box.querySelectorAll("[data-pajang]").forEach(function(b){b.addEventListener("click",function(){
          var p=state.products.find(function(x){return x.id===Number(b.getAttribute("data-pajang"));});if(!p)return;
          if(Server.enabled){
            api("/api/products/"+p.id+"/relist",{method:"POST"}).then(function(){
              setStatus(p,"tersedia");
              logActivity("stok",'"'+p.title+'" dipajang lagi sebagai stok tersedia.');
              render();showToast('"'+p.title+'" dipajang lagi.');
            }).catch(function(){showToast("Gagal memajang lagi di server.");});
            return;
          }
          setStatus(p,"tersedia");
          logActivity("stok",'"'+p.title+'" dipajang lagi sebagai stok tersedia.');
          render();showToast(p.credWiped?'"'+p.title+'" dipajang lagi — PERHATIAN: email & password lamanya sudah terhapus saat penjualan sebelumnya. Hapus stok ini dan tambah ulang lewat Tambah Akun dengan email & password akun yang baru sebelum ada yang membeli.':'"'+p.title+'" dipajang lagi.');
        });});
        box.querySelectorAll("[data-del]").forEach(function(b){b.addEventListener("click",function(){
          var id=Number(b.getAttribute("data-del"));
          if(Server.enabled){
            api("/api/products/"+id,{method:"DELETE"}).then(function(){
              state.products=state.products.filter(function(x){return x.id!==id;});
              render();showToast("Akun dihapus dari stok.");
            }).catch(function(){showToast("Gagal menghapus di server — mungkin akun sedang dipesan.");});
            return;
          }
          state.products=state.products.filter(function(x){return x.id!==id;});analytics.orders=analytics.orders.filter(function(o){return o.id!==id;});render();showToast("Akun dihapus dari stok.");
        });});
      }

      /* ---------- event login lokal ---------- */
      function showAuthTab(which){
        var isLogin=which==="login";
        document.getElementById("tabLogin").classList.toggle("on",isLogin);
        document.getElementById("tabRegister").classList.toggle("on",!isLogin);
        document.getElementById("tabLogin").setAttribute("aria-selected",isLogin?"true":"false");
        document.getElementById("tabRegister").setAttribute("aria-selected",!isLogin?"true":"false");
        document.getElementById("loginForm").hidden=!isLogin;
        document.getElementById("registerForm").hidden=isLogin;
      }
      document.getElementById("tabLogin").addEventListener("click",function(){showAuthTab("login");});
      document.getElementById("tabRegister").addEventListener("click",function(){showAuthTab("register");});
      document.getElementById("btnGoogle").addEventListener("click",function(){document.getElementById("googleMsg").hidden=false;});
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
        if(!found){formError("loginError","Email ini belum terdaftar. Daftar dulu lewat tab Daftar.");showAuthTab("register");document.getElementById("rgEmail").value=email;return;}
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
          }).catch(function(){formError("registerError","Email ini sudah terdaftar, atau server tidak bisa dihubungi.");});
          return;
        }
        var users=loadUsers(),dup=false;
        users.forEach(function(u){if(u.email===email)dup=true;});
        if(dup){formError("registerError","Email ini sudah terdaftar. Masuk lewat tab Masuk.");return;}
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
        render();renderAuth();applyRoute();
      });
