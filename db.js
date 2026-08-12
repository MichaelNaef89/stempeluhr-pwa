/* IndexedDB-Persistenz.
   Ein Record pro Tag, Key = ISO-Datum (YYYY-MM-DD):
   { punches: [{type, time, category?}], abwesenheitStd, abwesenheitGrund, bemerkung }
   Fällt auf localStorage zurück, falls IndexedDB blockiert ist (z.B. privater Modus). */

const DB = (() => {
  const DB_NAME = 'stempeluhr';
  const DB_VERSION = 1;
  const STORE = 'days';
  const LS_PREFIX = 'stempeluhr:day:';

  let dbPromise = null;
  let useFallback = false;

  function open() {
    if (useFallback) return Promise.reject(new Error('fallback'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    }).catch((err) => {
      useFallback = true;
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(STORE, mode);
          const store = t.objectStore(STORE);
          let result;
          try {
            result = fn(store);
          } catch (err) {
            reject(err);
            return;
          }
          t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  const wrap = (req) => ({ __req: req });

  // ---- localStorage-Fallback ----
  const ls = {
    get(key) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        return raw ? JSON.parse(raw) : undefined;
      } catch {
        return undefined;
      }
    },
    put(key, value) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      } catch {
        /* Speicher voll oder gesperrt – lieber weiterlaufen als crashen */
      }
    },
    del(key) {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch {}
    },
    entries() {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_PREFIX)) {
            try {
              out[k.slice(LS_PREFIX.length)] = JSON.parse(localStorage.getItem(k));
            } catch {}
          }
        }
      } catch {}
      return out;
    },
  };

  return {
    /** Einen Tag lesen. Gibt undefined zurück, wenn nichts gespeichert ist. */
    async getDay(iso) {
      try {
        return await tx('readonly', (s) => wrap(s.get(iso)));
      } catch {
        return ls.get(iso);
      }
    },

    /** Einen Tag schreiben. Leere Tage werden gelöscht, damit die DB sauber bleibt. */
    async putDay(iso, data) {
      const empty =
        (!data.punches || data.punches.length === 0) &&
        !data.abwesenheitStd &&
        !data.abwesenheitGrund &&
        !(data.bemerkung || '').trim();
      try {
        await tx('readwrite', (s) => (empty ? s.delete(iso) : s.put(data, iso)));
      } catch {
        if (empty) ls.del(iso);
        else ls.put(iso, data);
      }
    },

    /** Alle Tage als { iso: data } – für Export und Backup. */
    async allDays() {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const out = {};
          const t = db.transaction(STORE, 'readonly');
          const req = t.objectStore(STORE).openCursor();
          req.onsuccess = () => {
            const cur = req.result;
            if (cur) {
              out[cur.key] = cur.value;
              cur.continue();
            }
          };
          t.oncomplete = () => resolve(out);
          t.onerror = () => reject(t.error);
        });
      } catch {
        return ls.entries();
      }
    },

    /** Mehrere Tage auf einmal lesen (z.B. eine Woche/ein Monat). */
    async getDays(isoList) {
      const out = {};
      try {
        const db = await open();
        await new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readonly');
          const store = t.objectStore(STORE);
          isoList.forEach((iso) => {
            const r = store.get(iso);
            r.onsuccess = () => {
              if (r.result) out[iso] = r.result;
            };
          });
          t.oncomplete = resolve;
          t.onerror = () => reject(t.error);
        });
      } catch {
        isoList.forEach((iso) => {
          const v = ls.get(iso);
          if (v) out[iso] = v;
        });
      }
      return out;
    },

    /** Backup einspielen: { iso: data }. Überschreibt vorhandene Tage. */
    async importDays(map) {
      const entries = Object.entries(map);
      try {
        await tx('readwrite', (s) => {
          entries.forEach(([iso, data]) => s.put(data, iso));
        });
      } catch {
        entries.forEach(([iso, data]) => ls.put(iso, data));
      }
      return entries.length;
    },
  };
})();
