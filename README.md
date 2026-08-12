# Stempeluhr – PWA zur Arbeitszeiterfassung

Installierbare Progressive Web App für Kommt/Geht-Stempel, Absenzen und CSV-Export.
Läuft vollständig offline (IndexedDB auf dem Gerät) und spiegelt jede Änderung
automatisch auf einen kleinen Server, sobald eine Verbindung besteht.

## Funktionen

| Bereich | Details |
|---|---|
| **Stempeln** | Grosser Button, erkennt automatisch Kommt/Geht, max. 4 Paare pro Tag. Vor jedem „Kommt" ist eine Tätigkeit Pflicht (Büro, Garantie, Werkstatt, Testen, Testevents, Sonstiges). |
| **Absenz** | Umschalter auf dem Startbildschirm: Stundenzahl + Grund (Ferien, Krankheit, Feiertag, Unfall, Sonstiges). |
| **Tag** | Beliebiges Datum per Pfeilen, jeder Eintrag editier- und löschbar, „+ nachtragen" für vergessene Stempel an **jedem** Tag, Absenz und Bemerkung pro Tag. |
| **Woche** | Kalenderwoche (ISO), Stunden bzw. Absenz pro Tag, Tippen springt in die Tagesansicht, Wochentotal. |
| **Monat** | Kalenderraster Mo–So mit Punkt je Tag (amber = gearbeitet, türkis = Absenz), Monatstotal. |
| **Export** | CSV für Woche und Monat, Semikolon-getrennt mit BOM (öffnet in Excel de-CH direkt korrekt). |
| **Sync** | Jede Änderung wird sofort ans Backend auf dem Pi geschickt; ohne Verbindung lokal gepuffert und automatisch nachgeholt. |

## Architektur

```
web/       Die PWA selbst – HTML/CSS/JS, kein Build-Schritt
server/    FastAPI-Backend: liefert web/ aus + kleine JSON-API unter /api
tools/     Icon-Generator, Smoke-Test
```

**IndexedDB im Browser bleibt die primäre Datenquelle.** Stempeln, Editieren,
Absenzen etc. funktionieren immer sofort und komplett offline – der Server ist
ein automatisches Backup, kein Ersatz dafür. Nach jeder Änderung versucht
[`web/sync.js`](web/sync.js) im Hintergrund, den betroffenen Tag per `PUT
/api/days/{iso}` an den Server zu schicken. Schlägt das fehl (kein Netz, Pi
nicht erreichbar), merkt sich `sync.js` das Datum in `localStorage` und
versucht es automatisch erneut – bei jedem `online`-Event, beim
Zurückkommen in den Vordergrund und zusätzlich alle 20 Sekunden, solange noch
etwas offen ist. Ein kleiner Punkt oben rechts neben der Uhr zeigt den
Sync-Status (gesichert / sync… / offline · n ausstehend).

Ist die lokale Datenbank beim Start komplett leer (Neuinstallation, neues
Gerät), holt die App einmalig alle Tage vom Server nach (`GET /api/days`) –
das deckt den Fall „Handy verloren/zurückgesetzt" ab, ohne dass ein manuelles
Backup nötig ist.

Kein Login: der Zugriffsschutz ist das Tailscale-Netz selbst (gleiches Modell
wie beim Familien-Dashboard) – wer keinen Zugriff auf das Tailnet hat, kommt
weder an die Seite noch an die API.

## Lokal testen

```powershell
cd C:\Users\micha\stempeluhr-pwa\server
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Dann `http://localhost:8000/` im Browser öffnen. `localhost` gilt als sicherer
Kontext – Service Worker und Installation funktionieren dort bereits, `/api`
läuft automatisch mit.

Ohne Backend (nur Frontend ansehen) reicht auch weiterhin:

```powershell
cd C:\Users\micha\stempeluhr-pwa\web
python -m http.server 8000
```

Dann läuft die App normal, Sync bleibt einfach dauerhaft „offline" (unschädlich).

## Auf dem Samsung-Handy installieren

Der Service Worker verlangt **HTTPS** (Ausnahme: `localhost`). Aktuell läuft
das über `tailscale serve` auf dem Pi – siehe *Deployment* unten. Ohne Pi
funktionieren auch die Fallback-Wege:

1. **GitHub Pages** – `web/`-Inhalt in ein Repo pushen, Pages auf den Branch
   zeigen lassen (dann läuft nur das Frontend, ohne Server-Sync).
2. **Netlify Drop** – <https://app.netlify.com/drop>, `web/`-Ordner ins
   Browserfenster ziehen. Anonyme Deploys verfallen nach ~1h ohne
   Account-Claim.

Die URL dann auf dem Samsung-Gerät öffnen:

- **Chrome:** Seite öffnen → unten/oben taucht automatisch ein Install-Banner
  auf, sonst über ⋮ (Menü) → *App installieren*. Landet als eigenes Icon auf
  dem Homescreen, startet ohne Adressleiste.
- **Samsung Internet:** Seite öffnen → Menü (☰ unten) → *Seite zu* →
  *Startbildschirm hinzufügen* (oder *Apps* → *Diese Seite installieren*,
  je nach Version).

Beide Browser erkennen `manifest.json` + Service Worker automatisch und bieten
die Installation von selbst an.

## CSV-Format

Spaltenreihenfolge exakt wie in der Excel-Arbeitszeiterfassung:

```
Datum;Kommt 1;Geht 1;Kommt 2;Geht 2;Kommt 3;Geht 3;Kommt 4;Geht 4;bezahlte Abwesenheit;Abwesenheitsgrund;Bemerkung;Tätigkeit
12.08.2026;07:15;12:00;13:00;17:30;;;;;;;Kundentermin;Werkstatt, Büro
```

- Trennzeichen `;`, Zeilenende CRLF, UTF-8 mit BOM
- Eine Zeile pro Tag des Zeitraums (auch leere Tage – 1:1 übertragbar)
- `Tätigkeit` listet alle am Tag verwendeten Kategorien
- Semikolon und Zeilenumbrüche in der Bemerkung werden entschärft, damit die
  Spalten nicht verrutschen

Export öffnet auf dem Handy das Teilen-Menü (Datei sichern, mailen …).
Alternativ legt „CSV in Zwischenablage" den Text direkt zum Einfügen bereit.

## Daten und Backup

Primärspeicher ist die IndexedDB auf dem Gerät (Fallback: `localStorage`).
Jede Änderung wird zusätzlich automatisch auf den Pi gespiegelt (siehe
*Architektur* oben) – das ist der eigentliche Backup-Mechanismus im
Alltagsbetrieb.

Zusätzlich lässt sich unter **Monat → Datensicherung** jederzeit ein
manuelles JSON-Backup exportieren/importieren – nützlich, um Daten auf ein
komplett anderes Gerät zu übertragen oder ausserhalb des Tailnets zu sichern.

## Dateien

```
web/
  index.html                App-Shell und Grundgerüst
  styles.css                Dunkles, industrielles Design
  app.js                    Zustand, Rendering, Aktionen, CSV
  db.js                     IndexedDB-Zugriff (+ localStorage-Fallback)
  sync.js                   Automatischer Server-Sync mit Offline-Warteschlange
  sw.js                     Service Worker (Offline-Cache, lässt /api/* durch)
  manifest.json              PWA-Manifest
  icons/                     App-Icons (192, 512, maskable, favicon)
server/
  main.py                    FastAPI: liefert web/ aus + /api/days
  requirements.txt
tools/
  make_icons.py              Erzeugt die Icons neu (benötigt Pillow)
  smoke-test.js               Durchläuft die App-Logik in einem DOM-Stub
```

## Tests

```powershell
node tools\smoke-test.js
```

Lädt `db.js` + `sync.js` + `app.js` aus `web/` in einen minimalen DOM-Stub und
spielt Stempeln, Editieren, Nachtragen, Löschen, Absenz und beide
CSV-Exporte durch – inklusive Offline-Sync-Pfad (der Server ist im Test
absichtlich nicht erreichbar, das ist Teil der Prüfung).

## Datenmodell

Ein Record pro Tag, Key = ISO-Datum (`YYYY-MM-DD`):

```json
{
  "punches": [{ "type": "Kommt", "time": "07:15", "category": "Werkstatt" }],
  "abwesenheitStd": "",
  "abwesenheitGrund": "",
  "bemerkung": ""
}
```

Leere Tage werden lokal nicht gespeichert (serverseitig entsprechend auch
nicht angelegt).

## API (server/main.py)

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/days` | Alle Tage – für die Erstbefüllung eines leeren Geräts |
| `GET` | `/api/days/{iso}` | Einzelner Tag |
| `PUT` | `/api/days/{iso}` | Tag vollständig ersetzen (Upsert, kompletter Tagesdatensatz als Body) |
| `DELETE` | `/api/days/{iso}` | Tag löschen |

Speicherung serverseitig in SQLite (`server/stempeluhr.db`, nicht in Git).

## Deployment auf dem Pi

- **Repo**: <https://github.com/MichaelNaef89/stempeluhr-pwa> (öffentlich, keine Secrets enthalten)
- **Pi5**: `/home/pi/stempeluhr-pwa`, venv unter `/home/pi/stempeluhr-pwa/venv`
- **Dienst**: `stempeluhr-pwa.service` → `venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8002`
- **HTTPS**: `tailscale serve` proxyt Port 8002 auf `https://pi5.tail0fe4c7.ts.net/`
- **Workflow**:
  ```bash
  # auf dem PC
  git push

  # auf dem Pi
  cd /home/pi/stempeluhr-pwa
  git pull
  venv/bin/pip install -r server/requirements.txt   # nur nötig, wenn sich requirements.txt geändert hat
  sudo systemctl restart stempeluhr-pwa.service
  ```
