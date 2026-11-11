// GankStore — setup-push-keys: buat kunci VAPID SEKALI untuk push notification.
// Dipanggil manual sekali (invoke langsung, tanpa body).
// Kalau kunci sudah ada di tabel push_settings, TIDAK membuat baru — hanya
// mengembalikan public key yang sudah ada.
// Private key TIDAK PERNAH dikembalikan atau ditampilkan di mana pun; ia
// hanya tersimpan di tabel push_settings yang tidak punya policy untuk
// anon/authenticated (hanya service_role yang bisa baca). Public key yang
// dikembalikan ini yang dimasukkan ke js/config.js (VAPID_PUBLIC_KEY).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const h = {
  apikey: SERVICE_KEY,
  Authorization: "Bearer " + SERVICE_KEY,
  "Content-Type": "application/json",
};

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const get = await fetch(
      SUPABASE_URL + "/rest/v1/push_settings?id=eq.1&select=public_key",
      { headers: h },
    );
    const rows = await get.json();
    if (Array.isArray(rows) && rows[0] && rows[0].public_key) {
      return Response.json({ public_key: rows[0].public_key, created: false });
    }
    const kp = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const xB = b64urlDecode(pubJwk.x);
    const yB = b64urlDecode(pubJwk.y);
    const pub = new Uint8Array(65);
    pub[0] = 0x04;
    pub.set(xB, 1);
    pub.set(yB, 33);
    const publicKey = b64url(pub);
    const privateKey = privJwk.d;
    const ins = await fetch(SUPABASE_URL + "/rest/v1/push_settings", {
      method: "POST",
      headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ id: 1, public_key: publicKey, private_key: privateKey }),
    });
    if (!ins.ok) {
      return Response.json({ error: "gagal simpan kunci: HTTP " + ins.status }, { status: 500 });
    }
    return Response.json({ public_key: publicKey, created: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
