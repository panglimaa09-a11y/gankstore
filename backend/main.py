"""GankStore — backend Python (FastAPI).

Menjalankan:
    pip install -r requirements.txt
    cp .env.example .env   # isi MIDTRANS_SERVER_KEY bila ada
    uvicorn backend.main:app --host 127.0.0.1 --port 8000

API di bawah /api/*, frontend statis (public/) disajikan di /.
Data tersimpan di SQLite (backend/gankstore.db).

Aturan keamanan versi pertama:
- Server Key Midtrans hanya dari env, tidak pernah dikirim ke browser.
- Kredensial akun game (email/password) hanya dikembalikan ke user yang
  login, dan hanya SATU KALI lewat /credentials — setelah itu dihapus.
- Semua user yang login bisa membuka Panel Admin (sama seperti versi
  statis). Peran admin khusus (role) belum ada — TODO sebelum toko
  dibuka untuk umum.
"""
import os
import re

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import store
from .midtrans import create_snap_token, midtrans_config, verify_signature

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "public")

app = FastAPI(title="GankStore API", version="1.0.0")

store.init_db()

# Daftar game tetap untuk Top Up — HARUS sama dengan public/js/config.js.
TOPUP_GAMES = [
    {"name": "Mobile Legends", "currency": "Diamond", "needsServer": True, "serverLabel": "Server / Zone ID", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "Free Fire", "currency": "Diamond", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "PUBG Mobile", "currency": "UC", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 5123456789"},
    {"name": "Honor of Kings", "currency": "Token", "needsServer": True, "serverLabel": "Server ID", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "Genshin Impact", "currency": "Genesis Crystal", "needsServer": True, "serverLabel": "Server", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 800123456"},
    {"name": "Roblox", "currency": "Robux", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. nama_roblox"},
    {"name": "Point Blank", "currency": "PB Cash", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "Valorant", "currency": "Points", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. nama#1234"},
    {"name": "Call of Duty: Mobile", "currency": "CP", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "EA Sports FC Mobile", "currency": "FC Points", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    # Produk digital lain (dari banner promo). Kategori KOSONG yang bisa
    # diisi admin seperti paket top up game — JANGAN isi harga/paket palsu.
    # Pulsa/PPOB/e-wallet masih diproses MANUAL dan butuh supplier PPOB
    # (belum ada); jangan klaim otomatis.
    {"name": "Voucher Digital", "currency": "Voucher", "needsServer": False, "serverLabel": "", "idLabel": "ID / Email penerima", "idPlaceholder": "cth. nama@email.com"},
    {"name": "Pulsa & Paket Data", "currency": "Pulsa", "needsServer": False, "serverLabel": "", "idLabel": "Nomor HP", "idPlaceholder": "cth. 081234567890"},
    {"name": "E-Wallet & PPOB", "currency": "Saldo", "needsServer": False, "serverLabel": "", "idLabel": "Nomor akun / ID pelanggan", "idPlaceholder": "cth. 081234567890"},
    {"name": "Item Game", "currency": "Item", "needsServer": False, "serverLabel": "", "idLabel": "User ID / ID Akun Game", "idPlaceholder": "cth. 12345678"},
    {"name": "Produk Digital Lainnya", "currency": "Produk", "needsServer": False, "serverLabel": "", "idLabel": "ID / keterangan penerima", "idPlaceholder": "cth. ID atau email penerima"},
]
TOPUP_GAME_MAP = {g["name"]: g for g in TOPUP_GAMES}

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


# ---------- model input ----------

class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    email: str = Field(max_length=90)
    password: str = Field(min_length=6, max_length=90)


class LoginIn(BaseModel):
    email: str = Field(max_length=90)
    password: str = Field(max_length=90)


class ProductIn(BaseModel):
    game: str = "Point Blank"
    title: str = Field(min_length=1, max_length=90)
    rank: str = ""
    level: str | int = ""
    server: str = ""
    price: int = Field(ge=0)
    specs: list = []
    desc: str = ""
    photo: str = ""
    credEmail: str = ""
    credPass: str = ""


class OrderIn(BaseModel):
    product_id: int


class TopupOrderIn(BaseModel):
    package_id: int
    user_id: str = Field(min_length=1, max_length=40)
    server_id: str = ""


class PackageIn(BaseModel):
    game: str
    name: str = Field(min_length=1, max_length=60)
    amount: int = Field(gt=0)
    price: int = Field(ge=0)


class SnapTokenIn(BaseModel):
    invoice_no: str


# ---------- auth ----------

def _public_user(user):
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


def _bearer(authorization: str = Header(default="")):
    if authorization.startswith("Bearer "):
        return authorization[len("Bearer "):].strip()
    return ""


def require_user(token: str = Depends(_bearer)):
    user = store.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Login dulu.")
    return user


def optional_user(token: str = Depends(_bearer)):
    return store.get_user_by_token(token) if token else None


# ---------- umum ----------

@app.get("/api/health")
def health():
    cfg = midtrans_config()
    return {
        "ok": True,
        "mode": "server",
        "midtrans_configured": cfg["configured"],
        "midtrans_production": cfg["is_production"],
    }


@app.get("/api/payments/config")
def payments_config():
    cfg = midtrans_config()
    return {
        "configured": cfg["configured"],
        "is_production": cfg["is_production"],
        "client_key": cfg["client_key"],
    }


@app.get("/api/stats")
def get_stats(user: dict = Depends(require_user)):
    return store.stats()


@app.get("/api/activity")
def get_activity(user: dict = Depends(optional_user)):
    return store.list_activity()


# ---------- akun pengguna ----------

@app.post("/api/auth/register")
def register(body: RegisterIn):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Format email tidak valid.")
    if store.get_user_by_email(email):
        raise HTTPException(status_code=400, detail="Email ini sudah terdaftar.")
    user = store.create_user(body.name.strip(), email, body.password)
    token = store.create_session(user["id"])
    return {"token": token, **_public_user(user)}


@app.post("/api/auth/login")
def login(body: LoginIn):
    user = store.verify_user(body.email.strip().lower(), body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Email atau password salah.")
    token = store.create_session(user["id"])
    return {"token": token, **_public_user(user)}


@app.post("/api/auth/logout")
def logout(token: str = Depends(_bearer)):
    store.delete_session(token)
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(require_user)):
    return _public_user(user)


# ---------- produk (stok akun) ----------

@app.get("/api/products")
def list_products(user: dict = Depends(optional_user)):
    rows = store.list_products()
    return [store.product_to_dict(r, include_creds=bool(user)) for r in rows]


@app.post("/api/products")
def add_product(body: ProductIn, user: dict = Depends(require_user)):
    if body.credEmail and not EMAIL_RE.match(body.credEmail):
        raise HTTPException(
            status_code=400,
            detail="Email akun game wajib format email yang benar.",
        )
    if not body.credPass:
        raise HTTPException(status_code=400, detail="Password akun game wajib diisi.")
    row = store.create_product(body.model_dump())
    store.log_activity(
        "stok", 'Stok baru dipajang: "%s" (Rp%s).' % (row["title"], f"{row['price']:,}"),
    )
    return store.product_to_dict(row, include_creds=True)


@app.delete("/api/products/{product_id}")
def remove_product(product_id: int, user: dict = Depends(require_user)):
    product = store.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")
    if store.product_has_active_order(product_id):
        raise HTTPException(
            status_code=409, detail="Akun sedang dipesan — batalkan dulu pesanannya."
        )
    store.delete_product(product_id)
    return {"ok": True}


@app.post("/api/products/{product_id}/relist")
def relist_product(product_id: int, user: dict = Depends(require_user)):
    product = store.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")
    row = store.update_product_status(product_id, "tersedia")
    return store.product_to_dict(row, include_creds=True)


# ---------- pesanan (akun + top up) ----------

@app.get("/api/orders")
def list_orders(kind: str = "", user: dict = Depends(require_user)):
    return [store.order_to_dict(r) for r in store.list_orders(kind or None)]


@app.post("/api/orders")
def create_account_order(body: OrderIn, user: dict = Depends(optional_user)):
    product = store.get_product(body.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")
    if product["status"] != "tersedia":
        raise HTTPException(status_code=409, detail="Akun ini sedang dipesan / sudah terjual.")
    fee = store.admin_fee(product["price"])
    invoice_no = store.next_invoice_no()
    order = store.create_order(
        {
            "invoice_no": invoice_no,
            "kind": "akun",
            "product_id": product["id"],
            "title": product["title"],
            "game": product["game"],
            "rank": product.get("rank", ""),
            "price": product["price"],
            "fee": fee,
            "total": int(product["price"]) + fee,
            "photo": product.get("photo", ""),
            "buyer_name": user["name"] if user else "Pembeli tamu",
            "buyer_email": user["email"] if user else "",
        }
    )
    store.update_product_status(product["id"], "dipesan")
    store.log_activity(
        "pesan",
        'Akun "%s" dipesan — invoice %s terbit. Menunggu pembayaran via Midtrans.'
        % (product["title"], invoice_no),
    )
    return store.order_to_dict(order)


@app.post("/api/orders/{invoice_no}/confirm")
def confirm_order(invoice_no: str, user: dict = Depends(require_user)):
    order = store.get_order(invoice_no)
    if not order:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan.")
    if order["status"] != "dipesan":
        raise HTTPException(status_code=409, detail="Pesanan ini bukan berstatus Dipesan.")
    updated = store.update_order_status(invoice_no, "terjual")
    if order["kind"] == "akun" and order.get("product_id"):
        product = store.get_product(order["product_id"])
        store.update_product_status(order["product_id"], "terjual")
        if product and product.get("cred_email") and product.get("cred_pass"):
            store.update_order_status(
                invoice_no,
                "terjual",
                cred_pending=1,
                cred_email=product["cred_email"],
                cred_pass=product["cred_pass"],
            )
            store.wipe_product_creds(order["product_id"])
            updated = store.get_order(invoice_no)
    store.log_activity(
        "lunas",
        'Pembayaran lunas dikonfirmasi — "%s" resmi TERJUAL.' % order["title"],
    )
    return store.order_to_dict(updated)


@app.post("/api/orders/{invoice_no}/cancel")
def cancel_order(invoice_no: str, user: dict = Depends(require_user)):
    order = store.get_order(invoice_no)
    if not order:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan.")
    if order["status"] != "dipesan":
        raise HTTPException(status_code=409, detail="Pesanan ini bukan berstatus Dipesan.")
    updated = store.update_order_status(invoice_no, "dibatalkan")
    if order["kind"] == "akun" and order.get("product_id"):
        store.update_product_status(order["product_id"], "tersedia")
    store.log_activity(
        "batal", 'Pesanan "%s" dibatalkan admin.' % order["title"]
    )
    return store.order_to_dict(updated)


@app.get("/api/orders/{invoice_no}/credentials")
def get_credentials(invoice_no: str, user: dict = Depends(require_user)):
    """Kembalikan email+password akun SATU KALI, lalu hapus permanen.
    Hanya untuk pesanan akun yang sudah lunas dan kredensialnya menunggu."""
    order = store.get_order(invoice_no)
    if not order:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan.")
    if order["status"] != "terjual":
        raise HTTPException(status_code=409, detail="Pesanan belum lunas.")
    if order["kind"] != "akun":
        raise HTTPException(status_code=409, detail="Pesanan ini bukan pembelian akun.")
    if order.get("buyer_email") and order["buyer_email"] != user["email"]:
        # v1: semua user login dianggap admin — izinkan, tapi catat.
        pass
    creds = store.reveal_order_credentials(invoice_no)
    if not creds:
        raise HTTPException(
            status_code=410,
            detail="Data akun sudah pernah ditampilkan / tidak tersedia.",
        )
    return creds


# ---------- top up ----------

@app.get("/api/topup/games")
def topup_games():
    return TOPUP_GAMES


@app.get("/api/topup/packages")
def list_packages(game: str = ""):
    return store.list_packages(game or None)


@app.post("/api/topup/packages")
def add_package(body: PackageIn, user: dict = Depends(require_user)):
    cfg = TOPUP_GAME_MAP.get(body.game)
    if not cfg:
        raise HTTPException(status_code=400, detail="Game tidak ada di daftar top up.")
    row = store.create_package(
        {
            "game": body.game,
            "name": body.name,
            "amount": body.amount,
            "currency": cfg["currency"],
            "price": body.price,
        }
    )
    return row


@app.put("/api/topup/packages/{package_id}")
def edit_package(package_id: int, body: PackageIn, user: dict = Depends(require_user)):
    if not store.get_package(package_id):
        raise HTTPException(status_code=404, detail="Paket tidak ditemukan.")
    cfg = TOPUP_GAME_MAP.get(body.game)
    if not cfg:
        raise HTTPException(status_code=400, detail="Game tidak ada di daftar top up.")
    return store.update_package(
        package_id,
        {
            "game": body.game,
            "name": body.name,
            "amount": body.amount,
            "currency": cfg["currency"],
            "price": body.price,
        },
    )


@app.delete("/api/topup/packages/{package_id}")
def remove_package(package_id: int, user: dict = Depends(require_user)):
    if not store.get_package(package_id):
        raise HTTPException(status_code=404, detail="Paket tidak ditemukan.")
    active = [
        o for o in store.list_orders(kind="topup")
        if o["package_id"] == package_id and o["status"] == "dipesan"
    ]
    if active:
        raise HTTPException(
            status_code=409,
            detail="Paket ini masih ada pesanan berstatus Dipesan — selesaikan / batalkan dulu.",
        )
    store.delete_package(package_id)
    return {"ok": True}


@app.post("/api/topup/orders")
def create_topup_order(body: TopupOrderIn, user: dict = Depends(optional_user)):
    package = store.get_package(body.package_id)
    if not package:
        raise HTTPException(status_code=404, detail="Paket top up tidak ditemukan.")
    cfg = TOPUP_GAME_MAP.get(package["game"], {})
    if cfg.get("needsServer") and not body.server_id.strip():
        raise HTTPException(
            status_code=400,
            detail="%s wajib diisi untuk %s." % (cfg.get("serverLabel", "Server ID"), package["game"]),
        )
    fee = store.admin_fee(package["price"])
    invoice_no = store.next_invoice_no()
    order = store.create_order(
        {
            "invoice_no": invoice_no,
            "kind": "topup",
            "package_id": package["id"],
            "title": "Top Up %s %s — %s"
            % (package["amount"], package["currency"], package["game"]),
            "game": package["game"],
            "price": package["price"],
            "fee": fee,
            "total": int(package["price"]) + fee,
            "buyer_name": user["name"] if user else "Pembeli tamu",
            "buyer_email": user["email"] if user else "",
            "user_id_game": body.user_id.strip(),
            "server_id": body.server_id.strip(),
            "package_name": package["name"],
            "amount": str(package["amount"]),
            "currency": package["currency"],
        }
    )
    store.log_activity(
        "pesan",
        'Top up "%s" dipesan — invoice %s terbit. Menunggu pembayaran via Midtrans.'
        % (order["title"], invoice_no),
    )
    return store.order_to_dict(order)


# ---------- Midtrans ----------

@app.post("/api/payments/snap-token")
def snap_token(body: SnapTokenIn, user: dict = Depends(optional_user)):
    order = store.get_order(body.invoice_no)
    if not order:
        raise HTTPException(status_code=404, detail="Invoice tidak ditemukan.")
    if order["status"] != "dipesan":
        raise HTTPException(status_code=409, detail="Invoice ini bukan berstatus Dipesan.")
    try:
        token, redirect_url = create_snap_token(order)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"token": token, "redirect_url": redirect_url}


@app.post("/api/payments/midtrans-webhook")
async def midtrans_webhook(request: Request):
    payload = await request.json()
    order_id = str(payload.get("order_id", ""))
    status_code = str(payload.get("status_code", ""))
    gross_amount = str(payload.get("gross_amount", ""))
    signature = str(payload.get("signature_key", ""))
    if not verify_signature(order_id, status_code, gross_amount, signature):
        raise HTTPException(status_code=401, detail="Signature webhook tidak valid.")
    order = store.get_order(order_id)
    if not order:
        return {"ok": True, "note": "invoice tidak dikenal"}
    tx_status = payload.get("transaction_status", "")
    fraud = payload.get("fraud_status", "")
    if order["status"] != "dipesan":
        return {"ok": True, "note": "pesanan sudah diproses"}
    if tx_status in ("settlement",) or (tx_status == "capture" and fraud == "accept"):
        # Samakan dengan konfirmasi manual — tapi tanpa butuh login admin.
        store.update_order_status(order_id, "terjual")
        if order["kind"] == "akun" and order.get("product_id"):
            product = store.get_product(order["product_id"])
            store.update_product_status(order["product_id"], "terjual")
            if product and product.get("cred_email") and product.get("cred_pass"):
                store.update_order_status(
                    order_id,
                    "terjual",
                    cred_pending=1,
                    cred_email=product["cred_email"],
                    cred_pass=product["cred_pass"],
                )
                store.wipe_product_creds(order["product_id"])
        store.log_activity(
            "lunas",
            'Pembayaran Midtrans lunas (webhook) — "%s" resmi TERJUAL.' % order["title"],
        )
    elif tx_status in ("deny", "expire", "cancel"):
        store.update_order_status(order_id, "dibatalkan")
        if order["kind"] == "akun" and order.get("product_id"):
            store.update_product_status(order["product_id"], "tersedia")
        store.log_activity(
            "batal",
            'Pembayaran Midtrans %s — pesanan "%s" dibatalkan.' % (tx_status, order["title"]),
        )
    return {"ok": True}


# ---------- frontend statis ----------

@app.get("/")
def index():
    return FileResponse(os.path.join(PUBLIC_DIR, "index.html"))


app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
