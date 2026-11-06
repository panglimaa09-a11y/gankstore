"""Verifikasi ID token Google SECARA OFFLINE (tanpa internet per-request).

Konteks: service systemd backend di VM ini tidak punya env proxy egress
(token proxy shell berumur menit; fetch langsung diblokir gateway), jadi
verifikasi token TIDAK BOLEH memanggil Google tiap login (tokeninfo /
fetch JWKS per-request pasti gagal di server live).

Sebagai gantinya, kunci publik Google (JWKS) diunduh SEKALI lewat shell
(proxy shell jalan) ke backend/google_jwks.json dan dipakai untuk
verifikasi signature RS256 secara lokal dengan PyJWT. Refresh berkala:
backend/refresh_google_jwks.py (dijalankan dari shell/cron — token proxy
segar tiap jalan).

File JWKS berisi kunci PUBLIK Google — aman disimpan di server, tapi
JANGAN di-commit ke GitHub (sudah ada di .gitignore). Client ID di bawah
adalah identifier PUBLIK (dipakai frontend juga) — BUKAN secret. Client
Secret TIDAK PERNAH dipakai/disimpan di GankStore: alur GIS credential
hanya butuh verifikasi ID token.
"""
import json
import os

import jwt
from jwt.algorithms import RSAAlgorithm

GOOGLE_CLIENT_ID = os.environ.get(
    "GS_GOOGLE_CLIENT_ID",
    "308078866758-2qdr6ep644jpkm0e5jtu15vatgno14u0.apps.googleusercontent.com",
)
_GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
_JWKS_PATH = os.environ.get(
    "GS_GOOGLE_JWKS_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "google_jwks.json"),
)
_keys_cache = {"mtime": 0, "keys": {}}


def _load_keys():
    """Baca JWKS dari disk (cache per-mtime file, jadi file JWKS yang
    di-refresh langsung kepakai tanpa restart server)."""
    try:
        mtime = os.path.getmtime(_JWKS_PATH)
    except OSError as e:
        raise ValueError(
            "cache JWKS Google tidak ada di server (%s) — jalankan "
            "backend/refresh_google_jwks.py dulu" % _JWKS_PATH
        ) from e
    if mtime != _keys_cache["mtime"]:
        with open(_JWKS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        keys = {}
        for jwk in data.get("keys", []):
            kid = jwk.get("kid")
            if kid and jwk.get("kty") == "RSA":
                keys[kid] = RSAAlgorithm.from_jwk(json.dumps(jwk))
        if not keys:
            raise ValueError("cache JWKS Google kosong/tidak ada kunci RSA")
        _keys_cache["mtime"] = mtime
        _keys_cache["keys"] = keys
    return _keys_cache["keys"]


def verify_google_id_token(credential, nonce=None):
    """Verifikasi ID token Google secara offline. Kembalikan claims bila
    valid; lempar ValueError bila apa pun tidak cocok (bukan JWT, kid
    tidak dikenal, signature salah, issuer/audience salah, kedaluwarsa,
    nonce tidak cocok, email belum terverifikasi)."""
    if not credential or not isinstance(credential, str):
        raise ValueError("credential kosong")
    try:
        header = jwt.get_unverified_header(credential)
    except Exception as e:
        raise ValueError("token bukan JWT yang valid") from e
    kid = header.get("kid")
    if not kid:
        raise ValueError("token tidak punya kid")
    key = _load_keys().get(kid)
    if key is None:
        raise ValueError("kid tidak dikenal — refresh cache JWKS Google")
    try:
        claims = jwt.decode(
            credential,
            key,
            algorithms=["RS256"],
            audience=GOOGLE_CLIENT_ID,
            issuer=_GOOGLE_ISSUERS,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise ValueError("signature/aud/iss/exp tidak valid: %s" % e) from e
    if nonce is not None:
        if not nonce or claims.get("nonce") != nonce:
            raise ValueError("nonce tidak cocok")
    if claims.get("email_verified") is not True:
        raise ValueError("email Google belum terverifikasi")
    if not claims.get("email"):
        raise ValueError("token tidak berisi email")
    return claims
