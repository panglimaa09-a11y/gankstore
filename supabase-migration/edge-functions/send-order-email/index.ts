// GankStore — email otomatis ke penjual (panglimaa09@gmail.com).
// Dipicu Database Webhook Supabase (INSERT / UPDATE tabel orders):
//  - INSERT (pesanan baru) -> email "Pesanan baru ..." berisi rincian invoice.
//  - UPDATE dengan proof_image baru -> email "Bukti pembayaran ..." berisi
//    rincian invoice + foto bukti sebagai lampiran.
// Secret yang dibutuhkan: RESEND_API_KEY (Resend, daftar gratis di resend.com).
// Pengirim bawaan Resend: onboarding@resend.dev (tanpa domain sendiri).
// Akun Resend terdaftar atas panglimaa09@gmail.com, jadi tanpa domain
// terverifikasi email hanya bisa dikirim ke alamat itu. Kalau nanti mau
// kirim ke nexorateam44@gmail.com, verifikasi domain gankstore.my.id di
// Resend dan ubah FROM jadi noreply@gankstore.my.id.
// Webhook: Database -> Webhooks -> tabel orders, event INSERT + UPDATE,
//   URL: https://<ref>.supabase.co/functions/v1/send-order-email
//   Header: Authorization: Bearer <anon key project>

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SELLER_EMAIL = "panglimaa09@gmail.com";
const FROM = "GankStore <onboarding@resend.dev>";

const idr = (n: unknown) => "Rp" + Number(n || 0).toLocaleString("id-ID");

type Order = Record<string, unknown>;
const s = (o: Order, k: string) => String(o[k] ?? "");
const num = (o: Order, k: string) => Number(o[k] || 0);

function invoiceHtml(o: Order, heading: string): string {
  const rows: Array<[string, string]> = [
    ["Invoice", s(o, "invoice_no")],
    ["Akun / paket", s(o, "title")],
    ["Game", s(o, "game")],
    ["Rank", s(o, "rank")],
    ["Harga", idr(num(o, "price"))],
    ["Biaya admin (10%)", idr(num(o, "fee"))],
    ["Total bayar", idr(num(o, "total"))],
    ["Pembeli", [s(o, "buyer_name"), s(o, "buyer_email")].filter(Boolean).join(" — ")],
    ["Status", s(o, "status")],
    ["Dibuat", s(o, "created_at")],
  ];
  if (s(o, "kind") === "topup") {
    rows.push(["Top up", [
      (s(o, "amount") + " " + s(o, "currency")).trim(),
      s(o, "user_id_game") ? "User ID " + s(o, "user_id_game") : "",
      s(o, "server_id") ? "Server " + s(o, "server_id") : "",
    ].filter(Boolean).join(" · ")]);
  }
  const body = rows
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#555">${k}</td><td style="padding:6px 0;font-weight:700">${v}</td></tr>`)
    .join("");
  return `<div style="font-family:sans-serif;max-width:560px"><h2 style="margin:0 0 8px">${heading}</h2><table style="border-collapse:collapse">${body}</table><p style="color:#555">Cek uang masuk di DANA, lalu klik <b>Konfirmasi Lunas</b> di Daftar Stok GankStore.</p></div>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!RESEND_API_KEY) return new Response("RESEND_API_KEY belum diset", { status: 500 });
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const type = String(payload.type ?? "");
  const o = (payload.record ?? {}) as Order;
  const old = (payload.old_record ?? {}) as Order;
  if (!s(o, "invoice_no")) return new Response("no invoice", { status: 200 });

  let subject = "";
  let html = "";
  const attachments: Array<Record<string, string>> = [];

  if (type === "INSERT") {
    subject = `Pesanan baru ${s(o, "invoice_no")} — ${s(o, "title")} (${idr(num(o, "total"))})`;
    html = invoiceHtml(o, `Pesanan baru — ${s(o, "invoice_no")}`);
  } else if (type === "UPDATE" && s(o, "proof_image") && s(o, "proof_image") !== s(old, "proof_image")) {
    subject = `Bukti pembayaran ${s(o, "invoice_no")} — ${s(o, "title")} (${idr(num(o, "total"))})`;
    html = invoiceHtml(o, `Bukti pembayaran diterima — ${s(o, "invoice_no")}`) +
      `<p style="color:#555">Foto bukti terlampir di email ini.</p>`;
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(s(o, "proof_image"));
    if (m) {
      attachments.push({
        filename: `bukti-${s(o, "invoice_no")}.jpg`,
        content: m[2],
        content_type: m[1] === "jpg" ? "image/jpeg" : `image/${m[1]}`,
      });
    }
  } else {
    return new Response("ignored", { status: 200 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [SELLER_EMAIL], subject, html, attachments }),
  });
  const text = await res.text();
  return new Response(text, { status: res.status });
});
