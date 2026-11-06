"""GankStore — lapisan data SQLite.

Satu file database (backend/gankstore.db) untuk versi server pertama:
users, sessions, products (stok akun), orders (akun + top up),
topup_packages, activity, dan counter nomor invoice.

Bukan klaim database permanen/terkelola: ini SQLite file lokal — cukup
untuk satu server, dan gampang dipindah ke Postgres nanti.
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from datetime import datetime

DB_PATH = os.environ.get(
    "GANKSTORE_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "gankstore.db"),
)

_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def time_str():
    return datetime.now().strftime("%H:%M:%S")


def init_db():
    with _lock:
        conn = _connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    pass_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game TEXT NOT NULL,
                    title TEXT NOT NULL,
                    rank TEXT DEFAULT '',
                    level TEXT DEFAULT '',
                    server TEXT DEFAULT '',
                    price INTEGER NOT NULL,
                    specs TEXT DEFAULT '[]',
                    description TEXT DEFAULT '',
                    photo TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'tersedia',
                    cred_email TEXT DEFAULT '',
                    cred_pass TEXT DEFAULT '',
                    cred_wiped INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_no TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL DEFAULT 'akun',
                    product_id INTEGER,
                    package_id INTEGER,
                    title TEXT NOT NULL,
                    game TEXT NOT NULL,
                    rank TEXT DEFAULT '',
                    price INTEGER NOT NULL,
                    fee INTEGER NOT NULL,
                    total INTEGER NOT NULL,
                    photo TEXT DEFAULT '',
                    buyer_name TEXT DEFAULT '',
                    buyer_email TEXT DEFAULT '',
                    user_id_game TEXT DEFAULT '',
                    server_id TEXT DEFAULT '',
                    package_name TEXT DEFAULT '',
                    amount TEXT DEFAULT '',
                    currency TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'dipesan',
                    cred_pending INTEGER NOT NULL DEFAULT 0,
                    cred_email TEXT DEFAULT '',
                    cred_pass TEXT DEFAULT '',
                    cred_revealed INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS topup_packages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game TEXT NOT NULL,
                    name TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    price INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS activity (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    time TEXT NOT NULL,
                    tag TEXT NOT NULL,
                    text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS counters (
                    name TEXT PRIMARY KEY,
                    value INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            conn.commit()
        finally:
            conn.close()
    seed_demo_user()


# ---------- password & sesi ----------

def _hash_password(password, salt_hex):
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return dk.hex()


def create_user(name, email, password):
    salt = secrets.token_hex(16)
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "INSERT INTO users (name, email, pass_hash, salt, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (name, email, _hash_password(password, salt), salt, now_str()),
            )
            conn.commit()
            return get_user_by_id(cur.lastrowid)
        except sqlite3.IntegrityError:
            return None
        finally:
            conn.close()


def get_user_by_id(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_email(email):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower(),)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def verify_user(email, password):
    user = get_user_by_email(email)
    if not user:
        return None
    if hmac.compare_digest(_hash_password(password, user["salt"]), user["pass_hash"]):
        return user
    return None


def create_session(user_id):
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
                (token_hash, user_id, now_str()),
            )
            conn.commit()
        finally:
            conn.close()
    return token


def get_user_by_token(token):
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_session(token):
    if not token:
        return
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            conn.commit()
        finally:
            conn.close()


def seed_demo_user():
    """Akun demo PEMBELI untuk review Midtrans (demo@gankstore.my.id).
    Bukan akun admin. Aktif bila GS_SEED_DEMO=1 (default 1); matikan
    dengan GS_SEED_DEMO=0. Password dari env GS_DEMO_PASSWORD."""
    if os.environ.get("GS_SEED_DEMO", "1") != "1":
        return
    if get_user_by_email("demo@gankstore.my.id"):
        return
    password = os.environ.get("GS_DEMO_PASSWORD", "Demo1234")
    create_user("Demo GankStore", "demo@gankstore.my.id", password)


# ---------- produk (stok akun) ----------

def product_to_dict(row, include_creds=False):
    d = dict(row)
    d["specs"] = json.loads(d.get("specs") or "[]")
    d["desc"] = d.pop("description", "")
    if not include_creds:
        d.pop("cred_email", None)
        d.pop("cred_pass", None)
    return d


def list_products():
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM products ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_product(product_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_product(data):
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "INSERT INTO products (game, title, rank, level, server, price,"
                " specs, description, photo, status, cred_email, cred_pass, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tersedia', ?, ?, ?)",
                (
                    data["game"],
                    data["title"],
                    data.get("rank", ""),
                    data.get("level", ""),
                    data.get("server", ""),
                    int(data["price"]),
                    json.dumps(data.get("specs") or []),
                    data.get("desc", ""),
                    data.get("photo", ""),
                    data.get("credEmail", ""),
                    data.get("credPass", ""),
                    now_str(),
                ),
            )
            conn.commit()
            return get_product(cur.lastrowid)
        finally:
            conn.close()


def update_product_status(product_id, status):
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE products SET status = ? WHERE id = ?", (status, product_id)
            )
            conn.commit()
        finally:
            conn.close()
    return get_product(product_id)


def wipe_product_creds(product_id):
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE products SET cred_email = '', cred_pass = '', cred_wiped = 1"
                " WHERE id = ?",
                (product_id,),
            )
            conn.commit()
        finally:
            conn.close()


def delete_product(product_id):
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.commit()
        finally:
            conn.close()


def product_has_active_order(product_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM orders WHERE product_id = ? AND status = 'dipesan'",
            (product_id,),
        ).fetchone()
        return row["c"] > 0
    finally:
        conn.close()


# ---------- invoice & pesanan ----------

def next_invoice_no():
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT value FROM counters WHERE name = 'invoice_seq'"
            ).fetchone()
            seq = (row["value"] if row else 0) + 1
            conn.execute(
                "INSERT INTO counters (name, value) VALUES ('invoice_seq', ?)"
                " ON CONFLICT(name) DO UPDATE SET value = ?",
                (seq, seq),
            )
            conn.commit()
        finally:
            conn.close()
    d = datetime.now()
    return "INV-%04d%02d%02d-%02d%02d%02d-%d" % (
        d.year, d.month, d.day, d.hour, d.minute, d.second, seq,
    )


def admin_fee(price):
    return round(int(price or 0) * 0.10)


def order_to_dict(row):
    return dict(row)


def list_orders(kind=None):
    conn = _connect()
    try:
        if kind:
            rows = conn.execute(
                "SELECT * FROM orders WHERE kind = ? ORDER BY id DESC", (kind,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_order(invoice_no):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM orders WHERE invoice_no = ?", (invoice_no,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_order(data):
    with _lock:
        conn = _connect()
        try:
            ts = now_str()
            cur = conn.execute(
                "INSERT INTO orders (invoice_no, kind, product_id, package_id, title,"
                " game, rank, price, fee, total, photo, buyer_name, buyer_email,"
                " user_id_game, server_id, package_name, amount, currency, status,"
                " created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dipesan', ?, ?)",
                (
                    data["invoice_no"],
                    data.get("kind", "akun"),
                    data.get("product_id"),
                    data.get("package_id"),
                    data["title"],
                    data["game"],
                    data.get("rank", ""),
                    int(data["price"]),
                    int(data["fee"]),
                    int(data["total"]),
                    data.get("photo", ""),
                    data.get("buyer_name", ""),
                    data.get("buyer_email", ""),
                    data.get("user_id_game", ""),
                    data.get("server_id", ""),
                    data.get("package_name", ""),
                    data.get("amount", ""),
                    data.get("currency", ""),
                    ts,
                    ts,
                ),
            )
            conn.commit()
            return get_order(data["invoice_no"])
        finally:
            conn.close()


def update_order_status(invoice_no, status, **extra):
    sets = ["status = ?", "updated_at = ?"]
    vals = [status, now_str()]
    for key, val in extra.items():
        sets.append("%s = ?" % key)
        vals.append(val)
    vals.append(invoice_no)
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE orders SET %s WHERE invoice_no = ?" % ", ".join(sets), vals
            )
            conn.commit()
        finally:
            conn.close()
    return get_order(invoice_no)


def reveal_order_credentials(invoice_no):
    """Kembalikan kredensial SATU KALI lalu hapus dari order.
    Return None bila tidak ada kredensial / sudah pernah ditampilkan."""
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT * FROM orders WHERE invoice_no = ?", (invoice_no,)
            ).fetchone()
            if not row or not row["cred_pending"] or not row["cred_email"]:
                return None
            creds = {"email": row["cred_email"], "password": row["cred_pass"]}
            conn.execute(
                "UPDATE orders SET cred_email = '', cred_pass = '',"
                " cred_pending = 0, cred_revealed = 1, updated_at = ?"
                " WHERE invoice_no = ?",
                (now_str(), invoice_no),
            )
            conn.commit()
            return creds
        finally:
            conn.close()


# ---------- paket top up ----------

def list_packages(game=None):
    conn = _connect()
    try:
        if game:
            rows = conn.execute(
                "SELECT * FROM topup_packages WHERE game = ? ORDER BY price ASC",
                (game,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM topup_packages ORDER BY game ASC, price ASC"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_package(package_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM topup_packages WHERE id = ?", (package_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_package(data):
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "INSERT INTO topup_packages (game, name, amount, currency, price, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    data["game"],
                    data["name"],
                    int(data["amount"]),
                    data["currency"],
                    int(data["price"]),
                    now_str(),
                ),
            )
            conn.commit()
            return get_package(cur.lastrowid)
        finally:
            conn.close()


def update_package(package_id, data):
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE topup_packages SET game = ?, name = ?, amount = ?,"
                " currency = ?, price = ? WHERE id = ?",
                (
                    data["game"],
                    data["name"],
                    int(data["amount"]),
                    data["currency"],
                    int(data["price"]),
                    package_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()
    return get_package(package_id)


def delete_package(package_id):
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM topup_packages WHERE id = ?", (package_id,))
            conn.commit()
        finally:
            conn.close()


# ---------- aktivitas & statistik ----------

def log_activity(tag, text):
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO activity (time, tag, text, created_at) VALUES (?, ?, ?, ?)",
                (time_str(), tag, text, now_str()),
            )
            conn.execute(
                "DELETE FROM activity WHERE id NOT IN"
                " (SELECT id FROM activity ORDER BY id DESC LIMIT 100)"
            )
            conn.commit()
        finally:
            conn.close()


def list_activity(limit=40):
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT time, tag, text FROM activity ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def stats():
    conn = _connect()
    try:
        def one(sql, args=()):
            row = conn.execute(sql, args).fetchone()
            return row[0] if row else 0

        return {
            "products_total": one("SELECT COUNT(*) FROM products"),
            "products_tersedia": one(
                "SELECT COUNT(*) FROM products WHERE status = 'tersedia'"
            ),
            "products_dipesan": one(
                "SELECT COUNT(*) FROM products WHERE status = 'dipesan'"
            ),
            "products_terjual": one(
                "SELECT COUNT(*) FROM products WHERE status = 'terjual'"
            ),
            "orders_total": one("SELECT COUNT(*) FROM orders"),
            "orders_dipesan": one(
                "SELECT COUNT(*) FROM orders WHERE status = 'dipesan'"
            ),
            "orders_terjual": one(
                "SELECT COUNT(*) FROM orders WHERE status = 'terjual'"
            ),
            "topup_terjual": one(
                "SELECT COUNT(*) FROM orders WHERE kind = 'topup' AND status = 'terjual'"
            ),
            "revenue_akun": one(
                "SELECT COALESCE(SUM(price), 0) FROM products WHERE status = 'terjual'"
            ),
            "revenue_topup": one(
                "SELECT COALESCE(SUM(price), 0) FROM orders"
                " WHERE kind = 'topup' AND status = 'terjual'"
            ),
        }
    finally:
        conn.close()
