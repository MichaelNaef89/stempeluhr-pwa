/* Automatischer Server-Sync gegen die API auf dem Pi.
   IndexedDB bleibt die primäre Datenquelle – jede Änderung wird zusätzlich
   sofort an den Server geschickt, sobald eine Verbindung besteht. Schlägt das
   fehl (offline, Server nicht erreichbar), merkt sich Sync das betroffene
   Datum und holt es automatisch nach, sobald die Verbindung zurückkommt.

   Mehrpersonenfähig über einen Profilnamen pro Gerät: jedes Gerät hat sein
   eigenes /api/{person}/days – dadurch überschreiben sich zwei Personen auf
   zwei Geräten nicht gegenseitig, auch wenn sie am selben Tag arbeiten. */

const Sync = (() => {
  const PENDING_KEY = 'stempeluhr:pendingSync';
  const PERSON_KEY = 'stempeluhr:person';
  const RETRY_MS = 20000;

  // Läuft die App nicht über den Pi (z.B. lokaler Testserver ohne /api),
  // bleibt Sync einfach inaktiv – IndexedDB funktioniert unverändert.
  let enabled = location.protocol.startsWith('http');

  let getDay = null; // (iso) => Tagesobjekt, vom Aufrufer injiziert
  let onStatus = null; // (status, pendingCount) => void

  function slugify(name) {
    return (
      (name || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // Akzente entfernen (Trema-Zeichen nach NFKD-Zerlegung)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'person'
    );
  }

  function getPerson() {
    try {
      return localStorage.getItem(PERSON_KEY) || '';
    } catch {
      return '';
    }
  }

  function setPerson(name) {
    try {
      localStorage.setItem(PERSON_KEY, (name || '').trim());
    } catch {
      /* ignorieren – Sync bleibt in diesem Fall inaktiv, App funktioniert weiter */
    }
  }

  /** Basis-URL für die Tage-API dieses Geräts, oder null solange kein Profil gesetzt ist. */
  function daysUrl(iso) {
    const person = getPerson();
    if (!person) return null;
    const base = `/api/${slugify(person)}/days`;
    return iso ? `${base}/${iso}` : base;
  }

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

  const FETCH_TIMEOUT_MS = 10000;

  /** fetch() hat von sich aus keinen Timeout – eine hängende Verbindung (mobiles
   *  Netz, Tailscale-Verbindungsaufbau o.ä.) würde sonst für immer auf eine
   *  Antwort warten und den ganzen Sync-Vorgang lautlos blockieren, ohne dass
   *  je ein Fehler oder Erfolg gemeldet wird. */
  async function fetchWithTimeout(url, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function putDay(iso, data) {
    const url = daysUrl(iso);
    if (!url) throw new Error('kein Profil gesetzt');
    const res = await fetchWithTimeout(url, {
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

  /** Schickt wirklich ALLE übergebenen Tage an den Server, nicht nur die als
   *  "pending" vorgemerkten. Für die einmalige Nachholung von Tagen, die
   *  entstanden sind, bevor es Sync überhaupt gab (oder während Sync deaktiviert
   *  war) – die laufen sonst nie automatisch nach, weil Sync nur bei tatsächlichen
   *  Änderungen aktiv wird, nicht beim blossen Anzeigen alter Tage. */
  async function pushAll(allDays) {
    if (!enabled) return { ok: 0, failed: 0 };
    let ok = 0;
    let failed = 0;
    for (const [iso, data] of Object.entries(allDays)) {
      try {
        await putDay(iso, data);
        pending.delete(iso);
        ok++;
      } catch {
        pending.add(iso);
        failed++;
      }
    }
    writePending(pending);
    if (pending.size) {
      report('offline');
      scheduleRetry();
    } else {
      report('synced');
    }
    return { ok, failed };
  }

  /** Holt beim allerersten Start Server-Daten dieses Profils, falls das Gerät
   *  lokal noch komplett leer ist (Neuinstallation, neues Handy). Überschreibt
   *  nie vorhandene lokale Einträge. */
  async function hydrateIfEmpty(isLocalEmpty, importDays) {
    const url = daysUrl();
    if (!enabled || !isLocalEmpty || !url) return false;
    try {
      const res = await fetchWithTimeout(url);
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

  return { init, push, flush, pushAll, hydrateIfEmpty, getPerson, setPerson };
})();
