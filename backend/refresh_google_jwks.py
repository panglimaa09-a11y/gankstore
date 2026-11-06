#!/usr/bin/env python3
"""Refresh cache JWKS Google (backend/google_jwks.json).

Dijalankan dari SHELL (bukan service systemd) karena butuh proxy egress
— token proxy shell segar tiap jalan, sedangkan service systemd tidak
punya env proxy. Contoh cron (tiap 12 jam, sebagai root):

    0 */12 * * * /home/hatch/workspace/gankstore-fullstack/.venv/bin/python /home/hatch/workspace/gankstore-fullstack/backend/refresh_google_jwks.py >> /var/log/gankstore-jwks.log 2>&1

Tulis atomik (file .tmp + ganti nama) supaya backend tidak pernah baca
file setengah tertulis. Backend memuat ulang cache otomatis saat mtime
file berubah (lihat backend/google_auth.py). Keluar 0 bila sukses.
"""
import json
import os
import sys
import urllib.request

JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "google_jwks.json")


def main():
    req = urllib.request.Request(
        JWKS_URL, headers={"User-Agent": "GankStore-JWKS-refresh/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    keys = [k for k in data.get("keys", []) if k.get("kty") == "RSA" and k.get("kid")]
    if not keys:
        print("JWKS kosong/tidak ada kunci RSA — tidak ditulis", file=sys.stderr)
        return 1
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"keys": keys}, f)
    os.replace(tmp, OUT)
    print("OK: %d kunci RSA ditulis ke %s" % (len(keys), OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
