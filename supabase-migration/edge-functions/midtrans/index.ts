// GankStore — Edge Function Midtrans (Supabase, Deno).
// Menggantikan POST /api/payments/snap-token, POST /api/payments/midtrans-webhook,
// dan GET /api/payments/config dari backend FastAPI lama.
//
// Deploy: lihat edge-functions/midtrans/README.md.
// Secret (JANGAN tulis nilainya di file ini — pasang via `supabase secrets set`):
//   MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY, MIDTRANS_IS_PRODUCTION ("1"/"0")
// Yang otomatis tersedia di Edge Function: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Rute (URL penuh: https://<ref>.supabase.co/functions/v1/midtrans/...):
//   GET  /config      -> {configured, is_production, client_key}
//   POST /snap-token  {invoice_no} -> {token, redirect_url}
//   POST /webhook     (dipanggil Midtrans) -> {ok: true}
// Logika konfirmasi webhook SAMA dengan backend lama (main.py):
// settlement / capture+accept -> terjual + kredensial pindah ke order_creds;
// deny / expire / cancel -> dibatalkan + produk kembali tersedia.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MIDTRANS_SERVER_KEY = Deno.env.get("MIDTRANS_SERVER_KEY") ?? "";
const MIDTRANS_CLIENT_KEY = Deno.env.get("MIDTRANS_CLIENT_KEY") ?? "";
const MIDTRANS_IS_PRODUCTION = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "1";

const SNAP_API = MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

const ALLOWED_ORIGINS = new Set([
  "https://gankstore.my.id",
  "https://www.gankstore.my.id",
  "https://gankstore.vercel.app",
]);

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://gankstore.my.id",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function sha512Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-512", new TextEncoder().encode(input)).then(
    (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

async function logActivity(tag: string, text: string): Promise<void> {
  const time = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta" });
  await service.from("activity").insert({ time, tag, text });
  // Pangkas ke 100 baris terbaru (sama seperti backend lama).
  const { data } = await service.from("activity").select("id").order("id", { ascending: false }).range(100, 1000);
  if (data && data.length > 0) {
    await service.from("activity").delete().in("id", data.map((r) => r.id));
  }
}

// Konfirmasi lunas dari webhook — SAMA dengan confirm_order() di SQL
// (03_functions.sql), tapi dijalankan service_role tanpa perlu login admin.
async function confirmOrderPaid(order: Record<string, unknown>): Promise<void> {
  const invoiceNo = order.invoice_no as string;
  await service.from("orders").update({ status: "terjual", updated_at: new Date().toISOString() }).eq("invoice_no", invoiceNo);
  if (order.kind === "akun" && order.product_id) {
    await service.from("products").update({ status: "terjual" }).eq("id", order.product_id);
    const { data: cred } = await service.from("product_creds").select("*").eq("product_id", order.product_id).maybeSingle();
    if (cred && cred.cred_email && cred.cred_pass) {
      await service.from("order_creds").upsert({ invoice_no: invoiceNo, cred_email: cred.cred_email, cred_pass: cred.cred_pass });
      await service.from("orders").update({ cred_pending: true }).eq("invoice_no", invoiceNo);
      await service.from("product_creds").delete().eq("product_id", order.product_id);
    }
  }
  await logActivity("lunas", `Pembayaran Midtrans lunas (webhook) — "${order.title}" resmi TERJUAL.`);
}

async function cancelOrderPaid(order: Record<string, unknown>, txStatus: string): Promise<void> {
  const invoiceNo = order.invoice_no as string;
  await service.from("orders").update({ status: "dibatalkan", updated_at: new Date().toISOString() }).eq("invoice_no", invoiceNo);
  if (order.kind === "akun" && order.product_id) {
    await service.from("products").update({ status: "tersedia" }).eq("id", order.product_id);
  }
  await logActivity("batal", `Pembayaran Midtrans ${txStatus} — pesanan "${order.title}" dibatalkan.`);
}

async function handleSnapToken(req: Request): Promise<Response> {
  if (!MIDTRANS_SERVER_KEY) {
    return json(req, 503, { error: "MIDTRANS_SERVER_KEY belum dipasang. Pasang sebagai secret Edge Function." });
  }
  let body: { invoice_no?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Body bukan JSON." });
  }
  const invoiceNo = String(body.invoice_no ?? "");
  if (!invoiceNo) return json(req, 400, { error: "invoice_no wajib diisi." });

  const { data: order, error } = await service.from("orders").select("*").eq("invoice_no", invoiceNo).maybeSingle();
  if (error || !order) return json(req, 404, { error: "Invoice tidak ditemukan." });
  if (order.status !== "dipesan") return json(req, 409, { error: "Invoice ini bukan berstatus Dipesan." });

  // Pemilik pesanan (atau admin) saja yang boleh minta Snap token.
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (jwt && jwt !== ANON_KEY) {
    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await authed.auth.getUser(jwt);
    const user = userData?.user;
    if (user) {
      const { data: profile } = await service.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
      const isAdmin = !!profile?.is_admin;
      const isOwner = order.buyer_id === user.id;
      if (!isAdmin && !isOwner) return json(req, 403, { error: "Invoice ini bukan milikmu." });
    }
    // Tanpa sesi login (tamu): order tamu (buyer_id null) tetap boleh —
    // sama seperti backend lama yang mengizinkan optional_user.
  }

  const payload = {
    transaction_details: { order_id: invoiceNo, gross_amount: Number(order.total) },
    item_details: [
      { id: String(order.product_id ?? order.package_id ?? "item"), price: Number(order.price), quantity: 1, name: String(order.title).slice(0, 50) },
      { id: "admin-fee", price: Number(order.fee), quantity: 1, name: "Biaya admin 10%" },
    ],
    customer_details: {
      first_name: String(order.buyer_name || "Pembeli").slice(0, 50),
      email: String(order.buyer_email || ""),
    },
    callbacks: { finish: "https://gankstore.my.id/" },
  };
  const auth = btoa(MIDTRANS_SERVER_KEY + ":");
  let resp: Response;
  try {
    resp = await fetch(SNAP_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + auth },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json(req, 503, { error: "Tidak bisa menghubungi Midtrans: " + String(e) });
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    return json(req, 503, { error: "Midtrans menolak permintaan Snap (" + resp.status + "): " + JSON.stringify(data) });
  }
  return json(req, 200, { token: data.token, redirect_url: data.redirect_url ?? null });
}

async function handleWebhook(req: Request): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(req, 400, { error: "Body bukan JSON." });
  }
  const orderId = String(payload.order_id ?? "");
  const statusCode = String(payload.status_code ?? "");
  const grossAmount = String(payload.gross_amount ?? "");
  const signature = String(payload.signature_key ?? "");
  if (!MIDTRANS_SERVER_KEY) return json(req, 401, { error: "Server Key belum dipasang." });
  const expected = await sha512Hex(orderId + statusCode + grossAmount + MIDTRANS_SERVER_KEY);
  if (expected !== signature) return json(req, 401, { error: "Signature webhook tidak valid." });

  const { data: order } = await service.from("orders").select("*").eq("invoice_no", orderId).maybeSingle();
  if (!order) return json(req, 200, { ok: true, note: "invoice tidak dikenal" });
  if (order.status !== "dipesan") return json(req, 200, { ok: true, note: "pesanan sudah diproses" });

  const txStatus = String(payload.transaction_status ?? "");
  const fraud = String(payload.fraud_status ?? "");
  if (txStatus === "settlement" || (txStatus === "capture" && fraud === "accept")) {
    await confirmOrderPaid(order);
  } else if (txStatus === "deny" || txStatus === "expire" || txStatus === "cancel") {
    await cancelOrderPaid(order, txStatus);
  }
  return json(req, 200, { ok: true });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (path.endsWith("/config") && req.method === "GET") {
    return json(req, 200, {
      configured: !!MIDTRANS_SERVER_KEY,
      is_production: MIDTRANS_IS_PRODUCTION,
      client_key: MIDTRANS_CLIENT_KEY || null,
    });
  }
  if (path.endsWith("/snap-token") && req.method === "POST") {
    return await handleSnapToken(req);
  }
  if (path.endsWith("/webhook") && req.method === "POST") {
    return await handleWebhook(req);
  }
  return json(req, 404, { error: "Rute tidak dikenal: " + path });
});
