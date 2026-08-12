# Stempeluhr – PWA zur Arbeitszeiterfassung

Installierbare Progressive Web App für Kommt/Geht-Stempel, Absenzen und CSV-Export.
Läuft vollständig offline, alle Daten bleiben lokal auf dem Gerät (IndexedDB).
Kein Build-Schritt, keine Abhängigkeiten – reines HTML/CSS/JS.

## Funktionen

| Bereich | Details |
|---|---|
| **Stempeln** | Grosser Button, erkennt automatisch Kommt/Geht, max. 4 Paare pro Tag. Vor jedem „Kommt" ist eine Tätigkeit Pflicht (Büro, Garantie, Werkstatt, Testen, Testevents, Sonstiges). |
| **Absenz** | Umschalter auf dem Startbildschirm: Stundenzahl + Grund (Ferien, Krankheit, Feiertag, Unfall, Sonstiges). |
| **Tag** | Beliebiges Datum per Pfeilen, jeder Eintrag editier- und löschbar, „+ nachtragen" für vergessene Stempel an **jedem** Tag, Absenz und Bemerkung pro Tag. |
| **Woche** | Kalenderwoche (ISO), Stunden bzw. Absenz pro Tag, Tippen springt in die Tagesansicht, Wochentotal. |
| **Monat** | Kalenderraster Mo–So mit Punkt je Tag (amber = gearbeitet, türkis = Absenz), Monatstotal. |
| **Export** | CSV für Woche und Monat, Semikolon-getrennt mit BOM (öffnet in Excel de-CH direkt korrekt). |

## Lokal testen

```powershell
cd C:\Users\micha\stempeluhr-pwa
python -m http.server 8000
```

Dann `http://localhost:8000/` im Browser öffnen. `localhost` gilt als sicherer
Kontext – Service Worker und Installation funktionieren dort bereits.

## Auf dem Samsung-Handy installieren

Der Service Worker verlangt **HTTPS** (Ausnahme: `localhost`). Über die reine
LAN-IP (`http://192.168.x.x:8000`) lädt die App zwar, ist aber nicht offline-
fähig installierbar. Praktische Wege, eine HTTPS-URL zu bekommen:

1. **GitHub Pages** – Ordnerinhalt in ein Repo pushen, Pages auf den Branch
   zeigen lassen, die `https://…github.io/…`-URL auf dem Handy öffnen.
2. **Netlify Drop** – <https://app.netlify.com/drop>, Ordner ins Browserfenster
   ziehen, fertige HTTPS-URL verwenden.
3. **Eigener Webspace** – Ordner per FTP in ein Verzeichnis mit HTTPS legen.

Die URL dann auf dem Samsung-Gerät öffnen:

- **Chrome:** Seite öffnen → unten/oben taucht automatisch ein Install-Banner
  auf, sonst über ⋮ (Menü) → *App installieren*. Landet als eigenes Icon auf
  dem Homescreen, startet ohne Adressleiste.
- **Samsung Internet:** Seite öffnen → Menü (☰ unten) → *Seite zu* →
  *Startbildschirm hinzufügen* (oder *Apps* → *Diese Seite installieren*,
  je nach Version).

Beide Browser erkennen `manifest.json` + Service Worker automatisch und bieten
die Installation von selbst an – ein manuelles „Zum Startbildschirm“ wie bei
iOS ist nicht nötig, funktioniert aber genauso als Fallback.

Auf dem iPhone dann in **Safari** öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.
Die App startet danach im Vollbild ohne Safari-Leiste.

> Wichtig: Nur Safari kann auf iOS zum Home-Bildschirm hinzufügen – Chrome/Firefox
> auf dem iPhone können das nicht.

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

Auf dem iPhone öffnet der Export das Teilen-Menü (Datei sichern, mailen …).
Alternativ legt „CSV in Zwischenablage" den Text direkt zum Einfügen bereit.

## Daten und Backup

Alle Einträge liegen ausschliesslich lokal in der IndexedDB des Browsers
(Fallback: `localStorage`). Kein Server, kein Konto, keine Übertragung.

Das heisst aber auch: Wenn iOS den Website-Speicher aufräumt oder der Browser-
Speicher gelöscht wird, sind die Daten weg. Unter **Monat → Datensicherung**
lässt sich deshalb ein JSON-Backup speichern und wieder einspielen. Nach der
Installation auf dem Home-Bildschirm behandelt iOS die Daten deutlich
beständiger als in einem normalen Safari-Tab.

## Dateien

```
index.html                App-Shell und Grundgerüst
styles.css                Dunkles, industrielles Design
app.js                    Zustand, Rendering, Aktionen, CSV
db.js                     IndexedDB-Zugriff (+ localStorage-Fallback)
sw.js                     Service Worker (Offline-Cache)
manifest.json             PWA-Manifest
icons/                    App-Icons (192, 512, maskable, favicon)
tools/make_icons.py       Erzeugt die Icons neu (benötigt Pillow)
tools/smoke-test.js       Durchläuft die App-Logik in einem DOM-Stub
```

## Tests

```powershell
node tools\smoke-test.js
```

Lädt `db.js` + `app.js` in einen minimalen DOM-Stub und spielt Stempeln,
Editieren, Nachtragen, Löschen, Absenz und beide CSV-Exporte durch (36 Checks).

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

Leere Tage werden nicht gespeichert.
