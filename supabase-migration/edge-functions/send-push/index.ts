// GankStore — send-push: kirim Web Push ke perangkat admin (PWA).
// Dipicu Database Webhook Supabase:
//  - INSERT live_chat_messages (sender=buyer) -> "Pesan baru — Live Chat"
//  - INSERT orders -> "Pesanan baru INV-..."
//  - Invoke langsung dengan body {test:true} -> notifikasi tes.
// Kunci VAPID dibaca dari tabel push_settings (hanya service_role).
// Langganan dibaca dari push_subscriptions. Subscription yang sudah
// kedaluwarsa (HTTP 410/404 dari push service) dihapus otomatis.
// Webhook: Database -> Webhooks -> tabel live_chat_messages (INSERT) dan
//   tabel orders (INSERT), tipe "Supabase Edge Functions", URL:
//   https://<ref>.supabase.co/functions/v1/send-push
//   Header Authorization: BIARKAN default (service-role) — fungsi ini
//   butuh baca tabel push_settings/push_subscriptions.
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_CHAT_URL = "https://www.gankstore.my.id/#/admin/chat";
const ADMIN_STOCK_URL = "https://www.gankstore.my.id/#/admin/stok";

const h = {
  apikey: SERVICE_KEY,
  Authorization: "Bearer " + SERVICE_KEY,
  "Content-Type": "application/json",
};

const idr = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");

async function sb(path, opts) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: h,
    ...(opts || {}),
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + path);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    let title = "";
    let text = "";
    let url = ADMIN_CHAT_URL;

    if (body && body.test === true) {
      title = "Tes notifikasi GankStore";
      text = "Kalau ini muncul di HP, push notification sudah aktif.";
    } else if (body && body.table === "live_chat_messages" && body.record) {
      const rec = body.record;
      if (rec.sender !== "buyer") return Response.json({ ignored: true });
      const chats = await sb(
        "live_chats?id=eq." + encodeURIComponent(rec.chat_id) +
          "&select=buyer_name",
      );
      const name = (chats && chats[0] && chats[0].buyer_name) || "Pembeli";
      title = "Pesan baru — Live Chat";
      text = name + ": " + String(rec.text || "").slice(0, 120);
    } else if (body && body.table === "orders" && body.record) {
      const o = body.record;
      title = "Pesanan baru " + String(o.invoice_no || "");
      text = String(o.title || "") + " — " + idr(o.total);
      url = ADMIN_STOCK_URL;
    } else {
      return Response.json({ ignored: true });
    }

    const keys = await sb("push_settings?id=eq.1&select=public_key,private_key");
    if (!keys || !keys[0] || !keys[0].private_key) {
      return Response.json({ error: "kunci VAPID belum dibuat (panggil setup-push-keys dulu)" }, { status: 500 });
    }
    webpush.setVapidDetails(
      "mailto:panglimaa09@gmail.com",
      keys[0].public_key,
      keys[0].private_key,
    );
    const subs = await sb("push_subscriptions?select=endpoint,p256dh,auth");
    if (!subs || !subs.length) return Response.json({ sent: 0, note: "tidak ada langganan" });

    const payload = JSON.stringify({ title, body: text, url });
    let sent = 0;
    const failed = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 410 || code === 404) {
          await sb(
            "push_subscriptions?endpoint=eq." + encodeURIComponent(s.endpoint),
            { method: "DELETE" },
          ).catch(() => {});
        }
        failed.push({ endpoint: String(s.endpoint).slice(0, 60), code: code || String(e).slice(0, 80) });
      }
    }
    return Response.json({ sent, failed });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
