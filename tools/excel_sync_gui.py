r"""Klick-Starter-Fenster für den Excel-Sync – kein Terminal nötig.

Ein Doppelklick auf die Verknüpfung im Zeiterfassung-Ordner öffnet dieses
kleine Fenster mit einem Knopf "Arbeitszeiterfassung aktualisieren". Nutzt
dieselbe Logik wie sync_to_excel.py (siehe excel_sync_core.py), läuft aber
in einem Hintergrund-Thread, damit das Fenster währenddessen nicht einfriert.

    pythonw tools/excel_sync_gui.py
"""

import os
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont
from tkinter import messagebox, scrolledtext

sys.path.insert(0, str(Path(__file__).resolve().parent))
from excel_sync_core import DEFAULT_FILE, DEFAULT_PERSON, DEFAULT_URL, sync_to_excel

BG = "#ffffff"
SURFACE = "#f6f5f2"
TEXT = "#201d19"
MUTED = "#8a8375"
AMBER = "#e8a33d"
AMBER_INK = "#a6591a"
LINE = "#e2ded4"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Stempeluhr → Excel")
        self.geometry("560x460")
        self.minsize(480, 380)
        self.configure(bg=BG)
        try:
            self.iconbitmap(str(Path(__file__).resolve().parent.parent / "web" / "icons" / "stempeluhr.ico"))
        except tk.TclError:
            pass  # kein Icon vorhanden -> Standard-Icon, kein Problem

        mono = tkfont.Font(family="Consolas", size=10)
        sans = tkfont.Font(family="Segoe UI", size=10)
        sans_bold = tkfont.Font(family="Segoe UI", size=15, weight="bold")

        header = tk.Frame(self, bg=BG, padx=20, pady=18)
        header.pack(fill="x")
        tk.Label(header, text="Arbeitszeiterfassung", font=sans_bold, bg=BG, fg=TEXT).pack(anchor="w")
        tk.Label(
            header,
            text=f"Profil «{DEFAULT_PERSON}» · {Path(DEFAULT_FILE).name}",
            font=sans,
            bg=BG,
            fg=MUTED,
            wraplength=520,
            justify="left",
        ).pack(anchor="w", pady=(2, 0))

        btn_frame = tk.Frame(self, bg=BG, padx=20)
        btn_frame.pack(fill="x")
        self.run_btn = tk.Button(
            btn_frame,
            text="Excel-Datei aktualisieren",
            font=sans,
            bg=AMBER,
            fg="#1c1e21",
            activebackground=AMBER_INK,
            activeforeground="#ffffff",
            relief="flat",
            padx=16,
            pady=10,
            cursor="hand2",
            command=self.on_run,
        )
        self.run_btn.pack(side="left")

        self.open_btn = tk.Button(
            btn_frame,
            text="Datei öffnen",
            font=sans,
            bg=SURFACE,
            fg=TEXT,
            relief="flat",
            padx=16,
            pady=10,
            cursor="hand2",
            command=self.on_open_file,
            state="disabled",
        )
        self.open_btn.pack(side="left", padx=(10, 0))

        self.status = tk.Label(self, text="Bereit.", font=sans, bg=BG, fg=MUTED, padx=20, anchor="w")
        self.status.pack(fill="x", pady=(10, 4))

        log_frame = tk.Frame(self, bg=BG, padx=20)
        log_frame.pack(fill="both", expand=True, pady=(0, 18))
        self.log_box = scrolledtext.ScrolledText(
            log_frame,
            font=mono,
            bg=SURFACE,
            fg=TEXT,
            relief="flat",
            wrap="word",
            state="disabled",
            highlightthickness=1,
            highlightbackground=LINE,
            highlightcolor=LINE,
        )
        self.log_box.pack(fill="both", expand=True)

        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def log(self, msg: str):
        def _write():
            self.log_box.configure(state="normal")
            self.log_box.insert("end", msg + "\n")
            self.log_box.see("end")
            self.log_box.configure(state="disabled")

        self.after(0, _write)

    def set_status(self, text: str, color: str = MUTED):
        self.after(0, lambda: self.status.configure(text=text, fg=color))

    def on_run(self):
        self.run_btn.configure(state="disabled", text="Läuft …")
        self.open_btn.configure(state="disabled")
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.configure(state="disabled")
        self.set_status("Verbinde mit dem Server …")
        threading.Thread(target=self._run_sync, daemon=True).start()

    def _run_sync(self):
        result = sync_to_excel(
            person=DEFAULT_PERSON,
            file_path=DEFAULT_FILE,
            base_url=DEFAULT_URL,
            dry_run=False,
            make_backup=True,
            log=self.log,
        )
        self.after(0, lambda: self._on_done(result))

    def _on_done(self, result):
        self.run_btn.configure(state="normal", text="Excel-Datei aktualisieren")
        if not result.ok:
            self.set_status(f"Fehlgeschlagen: {result.error}", color="#c1392f")
            messagebox.showerror("Fehlgeschlagen", result.error or "Unbekannter Fehler.")
            return
        self.open_btn.configure(state="normal")
        if result.written:
            self.set_status(f"{len(result.written)} Tag(e) aktualisiert.", color="#0e7c6b")
        else:
            self.set_status("Keine neuen Daten – nichts zu tun.", color=MUTED)

    def on_open_file(self):
        try:
            os.startfile(DEFAULT_FILE)  # noqa: S606 (Windows-only, gewollt)
        except OSError as exc:
            messagebox.showerror("Konnte Datei nicht öffnen", str(exc))


if __name__ == "__main__":
    App().mainloop()
