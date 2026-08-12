"""Stempeluhr-Backend.

Liefert die statische PWA aus (`web/`) und stellt eine kleine JSON-API bereit,
über die jedes Gerät seine Änderungen automatisch spiegelt, sobald eine
Verbindung zum Pi besteht. Die IndexedDB auf dem Gerät bleibt die primäre
Datenquelle – der Server ist ein automatisches Backup, kein Ersatz dafür.

Mehrpersonenfähig über einen simplen Pfad-Präfix: jedes Gerät wählt beim
ersten Start einen Namen (client-seitig zu einem URL-sicheren Slug normiert,
siehe web/sync.js), der als eigener Bereich `/api/{person}/days/...` dient.
Keine Logins, kein Passwortschutz – der Zugriffsschutz ist das Tailscale-Netz
selbst (gleiches Modell wie beim Familien-Dashboard). Wer keinen Zugriff auf
das Tailnet hat, kommt weder an die Seite noch an die API.

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
PERSON_RE = re.compile(r"^[a-z0-9-]{1,40}$")

# Bisherige Alleinnutzer-Daten (Tabelle ohne "person"-Spalte) werden bei der
# ersten Migration diesem Profil zugeordnet, damit nichts verloren geht.
LEGACY_PERSON = "michael"

app = FastAPI(title="Stempeluhr")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS days ("
        "  person TEXT NOT NULL,"
        "  iso TEXT NOT NULL,"
        "  data TEXT NOT NULL,"
        "  updated_at TEXT NOT NULL DEFAULT (datetime('now')),"
        "  PRIMARY KEY (person, iso)"
        ")"
    )
    _migrate_legacy_schema(conn)
    return conn


def _migrate_legacy_schema(conn: sqlite3.Connection) -> None:
    """Einmalige Migration von der alten Ein-Personen-Tabelle (PRIMARY KEY nur
    `iso`, keine `person`-Spalte) auf das neue Schema. No-op, sobald migriert."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(days)").fetchall()}
    if "person" in cols or not cols:
        return
    conn.execute("ALTER TABLE days RENAME TO days_legacy")
    conn.execute(
        "CREATE TABLE days ("
        "  person TEXT NOT NULL,"
        "  iso TEXT NOT NULL,"
        "  data TEXT NOT NULL,"
        "  updated_at TEXT NOT NULL DEFAULT (datetime('now')),"
        "  PRIMARY KEY (person, iso)"
        ")"
    )
    conn.execute(
        "INSERT INTO days (person, iso, data, updated_at) "
        "SELECT ?, iso, data, updated_at FROM days_legacy",
        (LEGACY_PERSON,),
    )
    conn.execute("DROP TABLE days_legacy")
    conn.commit()


def require_iso(iso: str) -> None:
    if not ISO_RE.match(iso):
        raise HTTPException(400, "Ungültiges Datum, erwartet YYYY-MM-DD")


def require_person(person: str) -> None:
    if not PERSON_RE.match(person):
        raise HTTPException(400, "Ungültiges Profil")


@app.get("/api/{person}/days")
def list_days(person: str):
    """Alle Tage eines Profils – befüllt ein leeres Gerät nach einer
    Neuinstallation automatisch wieder mit den Server-Daten dieser Person."""
    require_person(person)
    conn = get_conn()
    try:
        rows = conn.execute("SELECT iso, data FROM days WHERE person = ?", (person,)).fetchall()
    finally:
        conn.close()
    return {iso: json.loads(data) for iso, data in rows}


@app.get("/api/{person}/days/{iso}")
def get_day(person: str, iso: str):
    require_person(person)
    require_iso(iso)
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT data FROM days WHERE person = ? AND iso = ?", (person, iso)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Kein Eintrag für dieses Datum")
    return json.loads(row[0])


@app.put("/api/{person}/days/{iso}")
async def put_day(person: str, iso: str, request: Request):
    """Legt einen Tag vollständig ab (Upsert) – das Gerät schickt bei jeder
    Änderung den kompletten Tagesdatensatz, kein Feld-Merge nötig."""
    require_person(person)
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
            "INSERT INTO days (person, iso, data, updated_at) VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(person, iso) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (person, iso, json.dumps(body, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/{person}/days/{iso}")
def delete_day(person: str, iso: str):
    require_person(person)
    require_iso(iso)
    conn = get_conn()
    try:
        conn.execute("DELETE FROM days WHERE person = ? AND iso = ?", (person, iso))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}


# Statische PWA – als letztes gemountet, damit /api/* zuerst greift.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
