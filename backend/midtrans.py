"""GankStore — integrasi Midtrans Snap.

Server Key TIDAK PERNAH ditulis di repo / frontend. Semua kunci dibaca
dari environment variable:
  MIDTRANS_SERVER_KEY  — kunci server (rahasia, hanya di server/.env)
  MIDTRANS_CLIENT_KEY  — kunci klien (publik, boleh tampil di browser)
  MIDTRANS_IS_PRODUCTION — "1" = Production, selain itu Sandbox.

Status saat ini: Sandbox dulu. Production menunggu KYC Midtrans disetujui
(Business review masih In progress). Jangan paksa Production sebelum itu.
"""
import base64
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

SANDBOX_SNAP_API = "https://app.sandbox.midtrans.com/snap/v1/transactions"
PRODUCTION_SNAP_API = "https://app.midtrans.com/snap/v1/transactions"


def midtrans_config():
    server_key = os.environ.get("MIDTRANS_SERVER_KEY", "")
    client_key = os.environ.get("MIDTRANS_CLIENT_KEY", "")
    is_production = os.environ.get("MIDTRANS_IS_PRODUCTION", "0") == "1"
    return {
        "configured": bool(server_key),
        "is_production": is_production,
        "client_key": client_key or None,
        "server_key": server_key,
    }


def create_snap_token(order):
    """Minta Snap token ke Midtrans untuk satu invoice.
    order: dict dari store (invoice_no, total, title, buyer_name, buyer_email).
    Return (token, redirect_url). Raise RuntimeError bila gagal."""
    cfg = midtrans_config()
    if not cfg["configured"]:
        raise RuntimeError(
            "MIDTRANS_SERVER_KEY belum dipasang di server. "
            "Isi di .env lalu restart server."
        )
    api_url = PRODUCTION_SNAP_API if cfg["is_production"] else SANDBOX_SNAP_API
    payload = {
        "transaction_details": {
            "order_id": order["invoice_no"],
            "gross_amount": int(order["total"]),
        },
        "item_details": [
            {
                "id": str(order.get("product_id") or order.get("package_id") or "item"),
                "price": int(order["price"]),
                "quantity": 1,
                "name": order["title"][:50],
            },
            {
                "id": "admin-fee",
                "price": int(order["fee"]),
                "quantity": 1,
                "name": "Biaya admin 10%",
            },
        ],
        "customer_details": {
            "first_name": (order.get("buyer_name") or "Pembeli")[:50],
            "email": order.get("buyer_email") or "",
        },
        "callbacks": {"finish": "https://gankstore.my.id/"},
    }
    auth = base64.b64encode((cfg["server_key"] + ":").encode()).decode()
    req = urllib.request.Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Basic " + auth,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError("Midtrans menolak permintaan Snap (%s): %s" % (exc.code, body))
    except Exception as exc:  # jaringan / timeout
        raise RuntimeError("Tidak bisa menghubungi Midtrans: %s" % exc)
    if "token" not in data:
        raise RuntimeError("Midtrans tidak mengembalikan Snap token: %s" % data)
    return data["token"], data.get("redirect_url")


def verify_signature(order_id, status_code, gross_amount, signature_key):
    """Verifikasi signature_key webhook Midtrans:
    SHA512(order_id + status_code + gross_amount + ServerKey)."""
    cfg = midtrans_config()
    if not cfg["configured"]:
        return False
    raw = "%s%s%s%s" % (order_id, status_code, gross_amount, cfg["server_key"])
    expected = hashlib.sha512(raw.encode()).hexdigest()
    return hmac.compare_digest(expected, signature_key or "")
