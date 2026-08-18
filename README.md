# Stempeluhr – PWA zur Arbeitszeiterfassung

Installierbare Progressive Web App für Kommt/Geht-Stempel, Absenzen und CSV-Export.
Läuft vollständig offline (IndexedDB auf dem Gerät) und spiegelt jede Änderung
automatisch auf einen kleinen Server, sobald eine Verbindung besteht.

## Funktionen

| Bereich | Details |
|---|---|
| **Stempeln** | Grosser Button, erkennt automatisch Kommt/Geht, max. 4 Paare pro Tag. Vor jedem „Kommt" ist eine Tätigkeit Pflicht (Büro, Garantie, Werkstatt, Testen, Testevents, Sonstiges). |
| **+ Eintrag** | Auf dem Stempeln-Screen **und** in der Tagesansicht (für jeden beliebigen Tag, z.B. über Monat → Tag antippen): Tätigkeit wählen, dann **Stunden** (Stepper ±0.25h, Direkteingabe, Presets 1/2/4/8h) oder **Zeit** (Von/Bis-Picker mit Live-Dauer-Anzeige) – erzeugt in einem Schritt ein komplettes Kommt/Geht-Paar, ohne manuell zweimal zu stempeln. Schliesst nahtlos an den letzten Eintrag des jeweiligen Tages an (kein Überschneiden möglich, wird validiert); nur beim allerersten Eintrag von „heute" wird ohne Anschlusspunkt von „jetzt" rückwärts gerechnet (15-Min-gerundet) – an anderen Tagen braucht der erste Eintrag „+ nachtragen" mit fester Uhrzeit. |
| **Absenz** | Umschalter auf dem Startbildschirm: Stundenzahl + Grund (Ferien, krank, Unfall, geschäftlich, Weiterbild'g – exakt die Dropdown-Liste der Excel-Vorlage). |
| **Tag** | Beliebiges Datum per Pfeilen, jeder Eintrag editier- und löschbar, „+ nachtragen" für vergessene Stempel an **jedem** Tag, Absenz und Bemerkung pro Tag. |
| **Woche** | Kalenderwoche (ISO), Stunden bzw. Absenz pro Tag, Tippen springt in die Tagesansicht, Wochentotal. |
| **Monat** | Kalenderraster Mo–So mit Punkt je Tag (amber = gearbeitet, türkis = Absenz), Monatstotal. |
| **Export** | CSV für Woche und Monat, Semikolon-getrennt mit BOM (öffnet in Excel de-CH direkt korrekt). |
| **Sync** | Jede Änderung wird sofort ans Backend auf dem Pi geschickt; ohne Verbindung lokal gepuffert und automatisch nachgeholt. Mehrpersonenfähig: jedes Gerät hat sein eigenes Profil, keine gegenseitigen Überschreibungen. |

## Architektur

```
web/       Die PWA selbst – HTML/CSS/JS, kein Build-Schritt
server/    FastAPI-Backend: liefert web/ aus + kleine JSON-API unter /api
tools/     Icon-Generator, Smoke-Test, Excel-Sync (CLI + Klick-Fenster)
```

**IndexedDB im Browser bleibt die primäre Datenquelle.** Stempeln, Editieren,
Absenzen etc. funktionieren immer sofort und komplett offline – der Server ist
ein automatisches Backup, kein Ersatz dafür. Nach jeder Änderung versucht
[`web/sync.js`](web/sync.js) im Hintergrund, den betroffenen Tag per `PUT
/api/{person}/days/{iso}` an den Server zu schicken. Schlägt das fehl (kein
Netz, Pi nicht erreichbar), merkt sich `sync.js` das Datum in `localStorage`
und versucht es automatisch erneut – bei jedem `online`-Event, beim
Zurückkommen in den Vordergrund und zusätzlich alle 20 Sekunden, solange noch
etwas offen ist. Ein kleiner Punkt oben rechts neben der Uhr zeigt den
Sync-Status (gesichert / sync… / offline · n ausstehend).

**Mehrpersonenfähig über einen Profilnamen pro Gerät.** Beim allerersten
Start fragt die App einmalig nach einem Namen (z.B. „Michael" oder „Nadja"),
gespeichert in `localStorage` auf diesem Gerät. Daraus wird ein URL-sicherer
Slug gebildet (`Müller Käthe` → `muller-kathe`), der als eigener Bereich
`/api/{slug}/days/...` auf dem Server dient. Zwei Geräte mit unterschiedlichem
Namen schreiben also in getrennte Tabellenbereiche und überschreiben sich nie
gegenseitig – auch nicht, wenn beide am selben Tag arbeiten. Der Name lässt
sich jederzeit unter **Monat → Profil → ändern** anpassen (wirkt sich nur auf
künftige Syncs aus, bereits gesendete Tage bleiben unter dem alten Namen
liegen).

Ist die lokale Datenbank beim Start komplett leer (Neuinstallation, neues
Gerät, gleicher Profilname), holt die App einmalig alle Tage dieses Profils
vom Server nach (`GET /api/{person}/days`) – das deckt den Fall
„Handy verloren/zurückgesetzt" ab, ohne dass ein manuelles Backup nötig ist.

Kein Login: der Zugriffsschutz ist das Tailscale-Netz selbst (gleiches Modell
wie beim Familien-Dashboard) – wer keinen Zugriff auf das Tailnet hat, kommt
weder an die Seite noch an die API. Der Profilname ist keine Authentifizierung,
nur eine Datenraum-Trennung.

## Lokal testen

```powershell
cd "C:\Users\micha\Desktop\Privat\Ensis\Zeiterfassung\Software Zeitstempel\server"
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Dann `http://localhost:8000/` im Browser öffnen. `localhost` gilt als sicherer
Kontext – Service Worker und Installation funktionieren dort bereits, `/api`
läuft automatisch mit.

Ohne Backend (nur Frontend ansehen) reicht auch weiterhin:

```powershell
cd "C:\Users\micha\Desktop\Privat\Ensis\Zeiterfassung\Software Zeitstempel\web"
python -m http.server 8000
```

Dann läuft die App normal, Sync bleibt einfach dauerhaft „offline" (unschädlich).

## Installieren (jedes Gerät braucht Tailscale)

Die App läuft unter **https://pi5.tail0fe4c7.ts.net/** – erreichbar für jedes
Gerät, das im selben Tailnet ist. Voraussetzung auf dem neuen Gerät:

1. **Tailscale-App installieren** (Play Store / App Store / [tailscale.com/download](https://tailscale.com/download))
2. **Zum Tailnet einladen lassen** – der Tailnet-Besitzer (`michael.naef89@gmail.com`)
   schickt einen Einladungslink über die Tailscale-Admin-Konsole; ohne Einladung
   kein Zugriff, das ist der gesamte Zugriffsschutz der App.
3. In der Tailscale-App einloggen/anmelden, Verbindung sicherstellen (grüner Status)
4. **https://pi5.tail0fe4c7.ts.net/** in einem normalen Browser öffnen

**Erster Start:** Die App fragt einmalig nach einem Namen („Wie heisst du?").
Jede Person gibt ihren eigenen Namen ein – das trennt die Daten serverseitig
(siehe *Architektur* oben). Der Name lässt sich später unter
*Monat → Profil → ändern* korrigieren.

### Samsung / Android
- **Chrome:** Seite öffnen → unten/oben taucht automatisch ein Install-Banner
  auf, sonst über ⋮ (Menü) → *App installieren*. Landet als eigenes Icon auf
  dem Homescreen, startet ohne Adressleiste.
- **Samsung Internet:** Seite öffnen → Menü (☰ unten) → *Seite zu* →
  *Startbildschirm hinzufügen* (oder *Apps* → *Diese Seite installieren*,
  je nach Version).

### Mac
- **Safari (empfohlen, macOS Sonoma 14+):** Seite öffnen → Menü *Ablage* →
  *Zum Dock hinzufügen…* (oder Teilen-Symbol in der Adressleiste →
  *Zum Dock hinzufügen*). Landet als eigenständige App im Dock, eigenes
  Fenster ohne Adressleiste, Tailscale muss dafür nicht dauerhaft laufen –
  nur beim eigentlichen Stempeln/Sync.
- **Chrome:** Seite öffnen → Adressleiste → Install-Symbol (⊕ mit Monitor)
  ganz rechts, oder ⋮-Menü → *Übertragen* → *[Seite] installieren*. Landet im
  Launchpad/Programme-Ordner wie eine normale App.
- Ältere macOS-Versionen ohne „Zum Dock hinzufügen" in Safari: Chrome
  installieren und den Chrome-Weg nutzen.

Alle drei Browser erkennen `manifest.json` + Service Worker automatisch und
bieten die Installation von selbst an.

### Ohne Pi (Fallback, kein Server-Sync)

Falls der Pi mal nicht erreichbar sein soll (z.B. Weitergabe an Aussenstehende
ohne Tailscale-Zugriff): `web/`-Inhalt separat hosten, dann läuft nur das
Frontend offline-fähig, ohne automatischen Sync.

1. **GitHub Pages** – `web/`-Inhalt in ein Repo pushen, Pages auf den Branch zeigen lassen.
2. **Netlify Drop** – <https://app.netlify.com/drop>, `web/`-Ordner ins
   Browserfenster ziehen. Anonyme Deploys verfallen nach ~1h ohne Account-Claim.

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

## Excel-Export

Statt CSV manuell zu übertragen, schreibt `tools/sync_to_excel.py` die
Server-Daten direkt in die institutionelle Excel-Arbeitszeiterfassung
(Details zu Spalten/Zeilen-Mapping im Docstring der Datei). Legt vor jedem
Schreiben automatisch ein Backup an (`<Name>.backup-<Zeitstempel>.xlsx`),
rührt nur die reinen Eingabespalten an, Formeln bleiben unangetastet.

**Klick-Starter ohne Kommandozeile:** Verknüpfung **„Excel aktualisieren"**
direkt im Ordner `Zeiterfassung` (eine Ebene über diesem Repo) öffnet
`tools/excel_sync_gui.py` als Fenster (via `pythonw.exe`, kein
Konsolenfenster) – ein Klick auf „Excel-Datei aktualisieren" holt die
aktuellen Server-Daten und schreibt sie rein, mit Log-Ausgabe und einem
„Datei öffnen"-Knopf danach. Nutzt dieselbe Logik wie die CLI
(`tools/excel_sync_core.py`).

```powershell
python tools\sync_to_excel.py                    # schreibt direkt
python tools\sync_to_excel.py --dry-run           # nur anzeigen, nichts speichern
python tools\sync_to_excel.py --person nadja --file "C:\...\Nadjas Zeiterfassung.xlsx"
```

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
  styles.css                Helles, industrielles Design
  app.js                    Zustand, Rendering, Aktionen, CSV
  db.js                     IndexedDB-Zugriff (+ localStorage-Fallback)
  sync.js                   Automatischer Server-Sync mit Offline-Warteschlange
  sw.js                     Service Worker (Offline-Cache, lässt /api/* durch)
  manifest.json              PWA-Manifest
  icons/                     App-Icons (192, 512, maskable, favicon, .ico fürs Excel-Fenster)
server/
  main.py                    FastAPI: liefert web/ aus + /api/days
  requirements.txt
tools/
  make_icons.py              Erzeugt die Icons neu (benötigt Pillow)
  smoke-test.js               Durchläuft die App-Logik in einem DOM-Stub
  excel_sync_core.py          Gemeinsame Logik für den Excel-Export
  sync_to_excel.py             CLI-Wrapper um excel_sync_core.py
  excel_sync_gui.py            Klick-Fenster (Tkinter) um excel_sync_core.py
```

Ausserhalb des Repos, eine Ebene höher im Ordner `Zeiterfassung`: die
Verknüpfung **„Excel aktualisieren.lnk"** (zeigt auf `excel_sync_gui.py`)
und die eigentliche Excel-Datei selbst.

## Tests

```powershell
node tools\smoke-test.js
```

Lädt `db.js` + `sync.js` + `app.js` aus `web/` in einen minimalen DOM-Stub und
spielt Stempeln, Editieren, Nachtragen, Löschen, Absenz, Profilwechsel und
beide CSV-Exporte durch – inklusive Offline-Sync-Pfad (der Server ist im Test
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

`{person}` ist der URL-sichere Slug des Profilnamens (`[a-z0-9-]{1,40}`,
client-seitig aus dem eingegebenen Namen gebildet, siehe `web/sync.js`).

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/{person}/days` | Alle Tage einer Person – für die Erstbefüllung eines leeren Geräts |
| `GET` | `/api/{person}/days/{iso}` | Einzelner Tag |
| `PUT` | `/api/{person}/days/{iso}` | Tag vollständig ersetzen (Upsert, kompletter Tagesdatensatz als Body) |
| `DELETE` | `/api/{person}/days/{iso}` | Tag löschen |

Speicherung serverseitig in SQLite (`server/stempeluhr.db`, nicht in Git),
Primärschlüssel `(person, iso)`. Ältere Alleinnutzer-Daten (vor der
Mehrpersonen-Umstellung) werden beim ersten Start automatisch dem Profil
`michael` zugeordnet.

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
