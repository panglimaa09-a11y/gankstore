#!/bin/bash
# install.sh — pasang (ulang) systemd service backend GankStore (:8773).
# /etc/systemd/system itu EPHEMERAL (hilang saat VM replacement), jadi
# jalankan script ini lagi setelah VM di-replace untuk menghidupkan service.
# Harus dijalankan sebagai root.
# Database SQLite ada di backend/gankstore.db (di ~/workspace, selamat
# dari restart VM — JANGAN pindah ke /tmp).
# Route publik /gankstore-api/ ada di revproxy2.py (TARGETS) + backup
# tunnel-scripts/revproxy2.py; restart revproxy bila route belum ada.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
UNIT="gankstore-backend.service"
APP_DIR="/home/hatch/workspace/gankstore-fullstack"

if [ "$(id -u)" -ne 0 ]; then echo "harus root"; exit 1; fi
[ -f "$APP_DIR/backend/main.py" ] || { echo "backend/main.py tidak ditemukan di $APP_DIR"; exit 1; }

# venv: bangun ulang kalau rusak/hilang (fastapi/uvicorn hanya ada di
# ~/.local user hatch, TIDAK terlihat oleh service systemd root — jadi
# backend ini WAJIB pakai venv sendiri, seperti onerouter/pb-ai)
if [ ! -x "$APP_DIR/.venv/bin/python" ]; then
  python3 -m venv "$APP_DIR/.venv"
  "$APP_DIR/.venv/bin/pip install" -r "$APP_DIR/requirements.txt"
fi

# 1. Hentikan service lama / instance manual (hindari rebutan port 8773)
systemctl stop "$UNIT" 2>/dev/null || true
PIDS="$(ss -tlnp 2>/dev/null | grep -E '[:.]8773[[:space:]]' | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
for pid in $PIDS; do
  echo "menghentikan pid $pid (port 8773)"
  kill "$pid" 2>/dev/null || true
done
for i in $(seq 1 15); do ss -tln 2>/dev/null | grep -q ":8773 " || break; sleep 1; done

# 2. Pasang unit file + enable + start
cp "$SRC/$UNIT" /etc/systemd/system/$UNIT
systemctl daemon-reload
systemctl enable --now "$UNIT"
sleep 6

# 3. Verifikasi
systemctl is-active --quiet "$UNIT" || { echo "SERVICE GAGAL START"; systemctl status "$UNIT" --no-pager | tail -15; exit 1; }
curl -sf --max-time 10 http://127.0.0.1:8773/api/health | grep -q '"ok":true' || { echo "HEALTH CHECK GAGAL"; exit 1; }
echo "OK: gankstore-backend aktif di 127.0.0.1:8773 (via tunnel: /gankstore-api/)"
