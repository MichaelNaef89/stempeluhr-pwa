r"""Trägt die in der Stempeluhr-PWA erfassten Tage direkt in die
institutionelle Excel-Arbeitszeiterfassung ein.

Holt alle Tage eines Profils vom Pi (GET /api/{person}/days) und schreibt
Kommt/Geht-Zeiten, bezahlte Abwesenheit, Abwesenheitsgrund und Bemerkung in
die passende Zeile der Datei "Arbeitszeiterfassung <Jahr> ....xlsx"
(Tabellenblatt "Arbeitszeiterfassung", Zeile 4 = 1. Januar, danach ein Tag
pro Zeile). Formelzellen (Datum, Wochentag, Soll-/Ist-Arbeitszeit, Saldo)
werden nicht angerührt – nur die reinen Eingabespalten G–N, O, P, T.

Vor jedem Schreibvorgang wird automatisch eine Backup-Kopie der Datei mit
Zeitstempel angelegt (z.B. "...backup-20260814-101500.xlsx").

Nur Tage mit tatsächlichen Daten (Stempel, Absenz oder Bemerkung) werden
geschrieben – Tage ohne App-Eintrag bleiben in der Excel-Datei unangetastet,
falls dort z.B. schon manuell etwas eingetragen wurde.

Für einen klickbaren Starter ohne Kommandozeile siehe excel_sync_gui.py.

Nutzung:
    python tools/sync_to_excel.py                    # schreibt direkt
    python tools/sync_to_excel.py --dry-run           # zeigt nur, was passieren würde
    python tools/sync_to_excel.py --person nadja --file "C:\...\Nadjas Zeiterfassung.xlsx"
"""

import argparse
import sys

from excel_sync_core import DEFAULT_FILE, DEFAULT_PERSON, DEFAULT_URL, sync_to_excel

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass  # ältere Python-Version ohne reconfigure – Umlaute evtl. verstümmelt, sonst egal


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--person", default=DEFAULT_PERSON, help=f"Profilname auf dem Server (Standard: {DEFAULT_PERSON})")
    ap.add_argument("--file", default=DEFAULT_FILE, help="Pfad zur Excel-Datei")
    ap.add_argument("--url", default=DEFAULT_URL, help="Basis-URL des Stempeluhr-Servers")
    ap.add_argument("--dry-run", action="store_true", help="Nur anzeigen, was geschrieben würde, nichts speichern")
    ap.add_argument("--no-backup", action="store_true", help="Backup-Kopie überspringen (nicht empfohlen)")
    args = ap.parse_args()

    result = sync_to_excel(
        person=args.person,
        file_path=args.file,
        base_url=args.url,
        dry_run=args.dry_run,
        make_backup=not args.no_backup,
        log=print,
    )
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
