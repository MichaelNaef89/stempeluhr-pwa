"""Stempeluhr-Backend.

Liefert die statische PWA aus (`web/`) und stellt eine kleine JSON-API bereit,
über die das Handy jede Änderung automatisch spiegelt, sobald eine Verbindung
zum Pi besteht. Die IndexedDB auf dem Handy bleibt die primäre Datenquelle –
der Server ist ein automatisches Backup, kein Ersatz dafür. Kein Login: der
Zugriffsschutz ist das Tailscale-Netz selbst (gleiches Modell wie beim
Familien-Dashboard).

    uvicorn server.main:app --host 127.0.0.1 --port 8002
"""

import json
import re
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DB_PATH = Path(__file__).resolve().parent / "stempeluhr.db"

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

app = FastAPI(title="Stempeluhr")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS days ("
        "  iso TEXT PRIMARY KEY,"
        "  data TEXT NOT NULL,"
        "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")"
    )
    return conn


def require_iso(iso: str) -> None:
    if not ISO_RE.match(iso):
        raise HTTPException(400, "Ungültiges Datum, erwartet YYYY-MM-DD")


@app.get("/api/days")
def list_days():
    """Alle gespeicherten Tage – genutzt, um ein leeres Handy nach einer
    Neuinstallation automatisch wieder mit den Server-Daten zu befüllen."""
    conn = get_conn()
    try:
        rows = conn.execute("SELECT iso, data FROM days").fetchall()
    finally:
        conn.close()
    return {iso: json.loads(data) for iso, data in rows}


@app.get("/api/days/{iso}")
def get_day(iso: str):
    require_iso(iso)
    conn = get_conn()
    try:
        row = conn.execute("SELECT data FROM days WHERE iso = ?", (iso,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Kein Eintrag für dieses Datum")
    return json.loads(row[0])


@app.put("/api/days/{iso}")
async def put_day(iso: str, request: Request):
    """Legt einen Tag vollständig ab (Upsert) – das Handy schickt bei jeder
    Änderung den kompletten Tagesdatensatz, kein Feld-Merge nötig."""
    require_iso(iso)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Ungültiges JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Erwarte ein JSON-Objekt")

    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO days (iso, data, updated_at) VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(iso) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (iso, json.dumps(body, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/days/{iso}")
def delete_day(iso: str):
    require_iso(iso)
    conn = get_conn()
    try:
        conn.execute("DELETE FROM days WHERE iso = ?", (iso,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}


# Statische PWA – als letztes gemountet, damit /api/* zuerst greift.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
