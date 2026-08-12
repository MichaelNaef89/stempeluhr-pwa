/* Automatischer Server-Sync gegen die API auf dem Pi.
   IndexedDB bleibt die primäre Datenquelle – jede Änderung wird zusätzlich
   sofort an den Server geschickt, sobald eine Verbindung besteht. Schlägt das
   fehl (offline, Server nicht erreichbar), merkt sich Sync das betroffene
   Datum und holt es automatisch nach, sobald die Verbindung zurückkommt. */

const Sync = (() => {
  const PENDING_KEY = 'stempeluhr:pendingSync';
  const RETRY_MS = 20000;

  // Läuft die App nicht über den Pi (z.B. lokaler Testserver ohne /api),
  // bleibt Sync einfach inaktiv – IndexedDB funktioniert unverändert.
  let enabled = location.protocol.startsWith('http');

  let getDay = null; // (iso) => Tagesobjekt, vom Aufrufer injiziert
  let onStatus = null; // (status, pendingCount) => void

  function readPending() {
    try {
      return new Set(JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function writePending(set) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(set)));
    } catch {
      /* Speicher voll oder gesperrt – Sync versucht es trotzdem weiter */
    }
  }

  let pending = readPending();
  let syncing = false;
  let retryTimer = null;

  function report(status) {
    if (onStatus) onStatus(status, pending.size);
  }

  async function putDay(iso, data) {
    const res = await fetch(`/api/days/${iso}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  /** Schickt einen geänderten Tag sofort an den Server; merkt ihn bei Fehlschlag vor. */
  async function push(iso, data) {
    if (!enabled) return;
    try {
      await putDay(iso, data);
      if (pending.delete(iso)) writePending(pending);
      report(pending.size ? 'pending' : 'synced');
    } catch {
      pending.add(iso);
      writePending(pending);
      report('offline');
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush();
    }, RETRY_MS);
  }

  /** Versucht alle vorgemerkten Tage erneut zu senden. */
  async function flush() {
    if (!enabled || syncing || !pending.size || !getDay) return;
    syncing = true;
    report('syncing');
    const todo = Array.from(pending);
    for (const iso of todo) {
      try {
        const data = await getDay(iso); // getDay darf sync oder async sein
        await putDay(iso, data);
        pending.delete(iso);
        writePending(pending);
      } catch {
        // bleibt vorgemerkt, nächster Versuch später
      }
    }
    syncing = false;
    if (pending.size) {
      report('offline');
      scheduleRetry();
    } else {
      report('synced');
    }
  }

  /** Holt beim allerersten Start Server-Daten, falls das Gerät lokal noch
   *  komplett leer ist (Neuinstallation, neues Handy). Überschreibt nie
   *  vorhandene lokale Einträge. */
  async function hydrateIfEmpty(isLocalEmpty, importDays) {
    if (!enabled || !isLocalEmpty) return false;
    try {
      const res = await fetch('/api/days');
      if (!res.ok) return false;
      const days = await res.json();
      const n = Object.keys(days).length;
      if (!n) return false;
      await importDays(days);
      return true;
    } catch {
      return false;
    }
  }

  function init(opts) {
    getDay = opts.getDay;
    onStatus = opts.onStatus;
    report(pending.size ? 'offline' : 'synced');

    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) flush();
    });
    // Falls "online" nie feuert (manche Browser sind unzuverlässig), zusätzlich
    // regelmässig probieren, solange etwas offen ist.
    setInterval(() => {
      if (pending.size) flush();
    }, RETRY_MS);
  }

  return { init, push, flush, hydrateIfEmpty };
})();
