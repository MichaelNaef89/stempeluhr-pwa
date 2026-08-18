/* Smoke-Test: lädt db.js + app.js in einem minimalen DOM-Stub und spielt die
   wichtigsten Abläufe durch (stempeln, nachtragen, editieren, CSV).

     node tools/smoke-test.js

   Kein Ersatz für einen echten Browsertest, findet aber Laufzeitfehler in den
   Render- und Aktionspfaden sofort. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const results = [];
let failed = 0;

function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  if (!cond) failed++;
}

// ------------------------------------------------------------------ DOM-Stub

class FakeEl {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this._html = '';
    this._text = '';
    this.listeners = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute() {}
  getAttribute() { return null; }
  contains() { return false; }
  focus() {}
  blur() {}
  remove() {}
  appendChild() {}
  click() {}
  select() {}
  setSelectionRange() {}
}

const els = {
  screen: new FakeEl('main', 'screen'),
  tabbar: new FakeEl('nav', 'tabbar'),
  toast: new FakeEl('div', 'toast'),
  clock: new FakeEl('div', 'clock'),
  topbarDate: new FakeEl('div', 'topbarDate'),
  syncRow: new FakeEl('div', 'syncRow'),
  syncLabel: new FakeEl('span', 'syncLabel'),
};

// Simuliert "kein Server erreichbar" – prüft damit gleich den Offline-Pfad von sync.js.
let fetchCalls = [];
async function fakeFetch(url, opts) {
  fetchCalls.push({ url, opts });
  throw new TypeError('Failed to fetch');
}

const store = new Map();
const localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let capturedBlob = null;

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  setInterval: () => 0, // Uhr-Ticks im Test nicht laufen lassen
  clearInterval: () => {},
  requestAnimationFrame: (cb) => cb(),
  Date,
  Math,
  JSON,
  Promise,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Set,
  Map,
  RegExp,
  Blob,
  File: typeof File !== 'undefined' ? File : undefined,
  fetch: fakeFetch,
  TypeError,
  localStorage,
  confirm: () => true,
  alert: () => {},
  prompt: () => 'TestUser', // einmalige Profil-Abfrage beim ersten Start -> Slug "testuser"
  navigator: {}, // kein serviceWorker, kein canShare -> Download-Pfad
  location: { protocol: 'http:', reload() {} },
  URL: {
    createObjectURL: (b) => { capturedBlob = b; return 'blob:test'; },
    revokeObjectURL: () => {},
  },
  document: {
    hidden: false,
    activeElement: null,
    body: new FakeEl('body'),
    getElementById: (id) => els[id] || null,
    createElement: (tag) => new FakeEl(tag),
    querySelector: () => null,
    addEventListener: () => {},
  },
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
const source = ['web/db.js', 'web/sync.js', 'web/app.js']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n;\n');
vm.runInContext(source, sandbox, { filename: 'app-bundle.js' });

// ------------------------------------------------------------------ Helfer

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(times = 12) {
  for (let i = 0; i < times; i++) await wait(5);
}

function html() {
  return els.screen.innerHTML;
}

function fire(el, dataset, extra) {
  const target = Object.assign({ dataset, disabled: false, closest: () => target }, extra || {});
  (el.listeners.click || []).forEach((fn) => fn({ target, preventDefault() {} }));
}

async function clickAction(dataset) {
  fire(els.screen, dataset);
  await settle();
}

/** Simuliert ein 'change' auf einem Formularfeld (Zeit-Inputs, Stunden-Eingabe) –
 *  die App liest solche Felder erst bei 'change', nicht bei jedem Tastendruck. */
async function changeAction(target) {
  const t = Object.assign({ dataset: {} }, target);
  (els.screen.listeners.change || []).forEach((fn) => fn({ target: t }));
  await settle();
}

async function clickTab(screen) {
  const target = { dataset: { screen }, closest: () => target };
  (els.tabbar.listeners.click || []).forEach((fn) => fn({ target, preventDefault() {} }));
  await settle();
}

function pressed(label) {
  // findet den Chip-Button mit diesem Label und liest aria-pressed
  const re = new RegExp(`data-value="${label}"\\s+aria-pressed="(true|false)"`);
  const m = html().match(re);
  return m ? m[1] === 'true' : null;
}

// ------------------------------------------------------------------ Ablauf

(async function run() {
  await settle(20);

  check('Startbildschirm rendert', html().includes('Zeiterfassung'));
  check('Primärer "+ Eintrag"-Button sichtbar (keine Kategorie/Stempel-Vorauswahl mehr)', html().includes('Eintrag erfassen'));

  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  // Erster Eintrag des Tages: "+ Eintrag" im Stunden-Modus (1h, Werkstatt).
  // Ohne bisherigen Eintrag rechnet der Stunden-Modus von "jetzt" rückwärts,
  // ergibt also direkt ein vollständiges Kommt/Geht-Paar in einem Schritt.
  await clickAction({ action: 'quick-open', iso: todayIso() });
  check('Eintrag-Formular offen', html().includes('data-action="quick-save"'));
  check('Standardmodus ist "Stunden" (Anker "jetzt" vorhanden)', /data-value="stunden"\s+aria-pressed="true"/.test(html()));
  await clickAction({ action: 'quick-hours-preset', value: '1' });
  await clickAction({ action: 'quick-cat', value: 'Werkstatt' });
  await clickAction({ action: 'quick-save' });
  check('Eintrag-Formular schliesst nach Speichern', !html().includes('data-action="quick-save"'));
  check('Kommt 1 erfasst mit Tätigkeit als Badge', /Kommt 1<\/span>\s*<span class="badge">Werkstatt/.test(html()));
  check('Geht 1 erfasst', (html().match(/class="dot teal"/g) || []).length >= 1);

  // Sync: Server ist im Test absichtlich unerreichbar (fakeFetch wirft immer) ->
  // muss lokal trotzdem gespeichert bleiben und als "offline/ausstehend" markiert werden.
  check(
    'Stempel löst personenbezogenen Server-Sync-Versuch aus',
    fetchCalls.some((c) => c.url === `/api/testuser/days/${todayIso()}`)
  );
  check('Sync-Status zeigt offline bei nicht erreichbarem Server', els.syncRow.className.includes('offline'));

  const geht1Time = [...html().matchAll(/class="time">(\d{2}:\d{2})</g)].map((m) => m[1]).pop();

  // Zweiter Eintrag desselben Tages ("+ Eintrag", 0.5h, Testevents) – muss
  // direkt an Geht 1 anschliessen (kein Überschneiden).
  await clickAction({ action: 'quick-open', iso: todayIso() });
  await clickAction({ action: 'quick-hours-preset', value: '0.5' });
  check('0.5h-Preset gesetzt', html().includes('value="0.50"'));
  await clickAction({ action: 'quick-cat', value: 'Testevents' });
  await clickAction({ action: 'quick-save' });
  check('Zweiter Eintrag zeigt Tätigkeit als Badge (Kommt 2)', /Kommt 2<\/span>\s*<span class="badge">Testevents/.test(html()));

  {
    const times = [...html().matchAll(/class="time">(\d{2}:\d{2})</g)].map((m) => m[1]);
    const [qKommt, qGeht] = times.slice(-2); // letztes Paar = der neue Eintrag
    check('Eintrag schliesst nahtlos an Geht 1 an', qKommt === geht1Time, `Geht 1=${geht1Time} Kommt 2=${qKommt}`);
    const diff = ((toMin(qGeht) - toMin(qKommt)) % 1440 + 1440) % 1440;
    check('Stunden-Eintrag (0.5h) beträgt exakt 30 Minuten', diff === 30, `${qKommt} -> ${qGeht} (${diff} Min)`);
  }

  // Stepper: +/- 0.25h dürfen keine Fliesskomma-Reste erzeugen
  await clickAction({ action: 'quick-open', iso: todayIso() });
  await clickAction({ action: 'quick-hours-step', value: '0.25' });
  await clickAction({ action: 'quick-hours-step', value: '0.25' });
  check('Stepper: 1.00h + 0.25h + 0.25h = 1.50h exakt', html().includes('value="1.50"'));
  await clickAction({ action: 'quick-cancel' });

  // Zeit von Hand korrigieren
  els.editTime = new FakeEl('input', 'editTime');
  els.editTime.value = '07:15';
  await clickAction({ action: 'edit-start', iso: todayIso(), idx: '0' });
  check('Edit-Modus offen', html().includes('data-action="edit-save"'));
  await clickAction({ action: 'edit-save', iso: todayIso(), idx: '0' });
  check('Zeit geändert auf 07:15', html().includes('>07:15<'));

  // Absenz für heute
  await clickAction({ action: 'mode', value: 'absence' });
  check('Absenz-Formular sichtbar', html().includes('bezahlte Abwesenheit'));
  await clickAction({ action: 'reason', value: 'Ferien' });
  check('Absenzgrund ausgewählt', pressed('Ferien') === true);
  await clickAction({ action: 'mode', value: 'punch' });
  check('Absenzgrund bleibt gespeichert', html().includes('Ferien'));

  // Tagesansicht + Nachtragen an einem anderen Tag – bewusst nicht "immer 2 Tage
  // zurück": läuft der Test z.B. an einem Montag/Dienstag, würde das in die
  // VORIGE Kalenderwoche springen und die späteren Wochen-/CSV-Checks (die
  // denselben Zeitraum wie "heute" erwarten) grundlos zum Scheitern bringen.
  await clickTab('tag');
  check('Tagesansicht rendert', html().includes('Tagesansicht') || html().includes('Heute'));
  const mondayOffset = (new Date().getDay() + 6) % 7; // 0=Mo..6=So
  const daysBack = Math.max(1, Math.min(2, mondayOffset));
  for (let i = 0; i < daysBack; i++) {
    await clickAction({ action: 'nav', value: 'day-prev' });
  }
  const backIso = html().match(/data-iso="(\d{4}-\d{2}-\d{2})"/);
  check('Vergangener Tag geöffnet', !!backIso && backIso[1] !== todayIso());
  check('Nachtragen-Button vorhanden', html().includes('nachtragen'));

  const pastIso = backIso ? backIso[1] : todayIso();
  await clickAction({ action: 'add-open', iso: pastIso });
  check('Nachtrag-Formular offen', html().includes('data-action="add-save"'));
  await clickAction({ action: 'add-cat', value: 'Büro' });
  els.addTime = new FakeEl('input', 'addTime');
  els.addTime.value = '08:00';
  await clickAction({ action: 'add-save', iso: pastIso });
  check('Kommt nachgetragen (08:00)', html().includes('>08:00<'));

  els.addTime.value = '12:30';
  await clickAction({ action: 'add-open', iso: pastIso });
  await clickAction({ action: 'add-save', iso: pastIso });
  check('Geht nachgetragen (12:30)', html().includes('>12:30<'));
  check('Geleistete Stunden berechnet (4:30)', html().includes('4:30 h'));

  // Wochenansicht
  await clickTab('woche');
  check('Wochenansicht rendert', html().includes('Total Woche') && html().includes('KW '));
  check('Woche zeigt Tageswerte', html().includes('4:30 h'));

  // CSV-Export Woche
  capturedBlob = null;
  await clickAction({ action: 'export', range: 'week' });
  check('CSV-Blob erzeugt', !!capturedBlob);

  const csv = capturedBlob ? await capturedBlob.text() : '';
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const header = lines[0].split(';');
  const expected = [
    'Datum', 'Kommt 1', 'Geht 1', 'Kommt 2', 'Geht 2', 'Kommt 3', 'Geht 3',
    'Kommt 4', 'Geht 4', 'bezahlte Abwesenheit', 'Abwesenheitsgrund', 'Bemerkung', 'Tätigkeit',
  ];
  check('CSV-Header exakt in geforderter Reihenfolge', header.join('|') === expected.join('|'), header.join(';'));
  // Blob.text() entfernt das BOM beim Dekodieren – deshalb die Bytes prüfen
  const bytes = capturedBlob ? new Uint8Array(await capturedBlob.arrayBuffer()) : new Uint8Array();
  check(
    'CSV hat BOM (Excel-Umlaute)',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    Array.from(bytes.slice(0, 3)).join(',')
  );
  check('CSV enthält 7 Datenzeilen', lines.length === 8, `${lines.length - 1} Zeilen`);

  const nachtragRow = lines.find((l) => l.includes('08:00;12:30'));
  check('Nachgetragene Zeiten in Spalten Kommt 1 / Geht 1', !!nachtragRow, nachtragRow);
  check('Tätigkeit in letzter Spalte', !!nachtragRow && nachtragRow.split(';')[12] === 'Büro');

  const heuteRow = lines.find((l) => l.startsWith(deDate(todayIso())));
  check('Heutige Zeile enthält 07:15', !!heuteRow && heuteRow.includes('07:15'));
  check('Absenzgrund in Spalte 11', !!heuteRow && heuteRow.split(';')[10] === 'Ferien');

  // Monatsansicht
  await clickTab('monat');
  check('Monatsansicht rendert', html().includes('Total Monat') && html().includes('month-grid'));
  check('Monatsraster hat Punkte', html().includes('mdot work') || html().includes('mdot abs'));
  check('Profil-Sektion zeigt aktuellen Namen', html().includes('TestUser'));

  fetchCalls = [];
  await clickAction({ action: 'change-person' }); // prompt-Stub liefert immer 'TestUser' -> identisch, kein neuer Sync-Aufruf
  check('Profilname bleibt bei identischer Eingabe unverändert', html().includes('TestUser') && fetchCalls.length === 0);

  capturedBlob = null;
  await clickAction({ action: 'export', range: 'month' });
  const mcsv = capturedBlob ? await capturedBlob.text() : '';
  check('Monats-CSV erzeugt', mcsv.split('\r\n').length >= 29);

  // "Vollständig synchronisieren" muss wirklich JEDEN lokal gespeicherten Tag
  // an den Server schicken, nicht nur die zuletzt geänderten (das war die
  // Lücke, die dazu führte, dass alte, vor-Sync erfasste Tage nie ankamen).
  fetchCalls = [];
  await clickAction({ action: 'sync-all' });
  await settle();
  const syncedIsos = new Set(
    fetchCalls.filter((c) => c.opts && c.opts.method === 'PUT').map((c) => c.url.split('/').pop())
  );
  const storedDayCount = Array.from(store.keys()).filter((k) => k.startsWith('stempeluhr:day:')).length;
  check(
    'Vollständig synchronisieren erreicht alle gespeicherten Tage',
    syncedIsos.size === storedDayCount,
    `${syncedIsos.size} von ${storedDayCount}`
  );

  // Regressionstest: An einem Tag ganz ohne bisherigen Eintrag UND der nicht
  // "heute" ist, fehlt der Anker für den Stunden-Modus (der ohne Anker von
  // "jetzt" rückwärts rechnet) – der Button muss trotzdem sichtbar bleiben,
  // aber automatisch im Zeit-Modus starten und "Stunden" deaktivieren.
  const freshEmptyIso = '2026-11-11';
  await clickAction({ action: 'goday', iso: freshEmptyIso });
  await clickAction({ action: 'quick-open', iso: freshEmptyIso });
  check(
    'Ohne Anker startet "+ Eintrag" automatisch im Zeit-Modus',
    /data-value="zeit"\s+aria-pressed="true"/.test(html())
  );
  check(
    'Ohne Anker ist "Stunden" deaktiviert statt umgekehrt',
    /data-value="stunden"[^>]*disabled/.test(html())
  );
  await clickAction({ action: 'quick-cancel' });

  // "+ Eintrag" muss auch in der Tagesansicht für einen beliebigen, nicht-
  // heutigen Tag verfügbar sein – nicht nur auf dem Stempeln-Screen. Bewusst
  // erst hier (ganz am Ende) getestet: verändert pastIso, was frühere, auf
  // "4:30 h" fixierte Wochen-/CSV-Checks kaputt machen würde. Testet hier
  // gleich den Zeit-Modus (Von/Bis) inkl. Validierung – der Stunden-Modus
  // wurde bereits weiter oben auf dem Stempeln-Screen abgedeckt.
  await clickAction({ action: 'goday', iso: pastIso });
  check(
    'Eintrag-Button auch für vergangenen Tag sichtbar',
    html().includes(`data-action="quick-open" data-iso="${pastIso}"`)
  );
  await clickAction({ action: 'quick-open', iso: pastIso });
  check('Eintrag-Formular für vergangenen Tag offen', html().includes('data-action="quick-save"'));
  await clickAction({ action: 'quick-mode', value: 'zeit' });
  check('Zeit-Modus zeigt Von/Bis-Felder', html().includes('id="quickVon"') && html().includes('id="quickBis"'));

  // Validierung: Bis vor Von -> Speichern muss abgelehnt werden (Formular bleibt offen)
  await changeAction({ type: 'time', value: '15:00', dataset: { role: 'quick-von' } });
  await changeAction({ type: 'time', value: '14:00', dataset: { role: 'quick-bis' } });
  check('Ungültige Spanne zeigt Hinweis statt Dauer', html().includes('Bis muss nach Von liegen'));
  await clickAction({ action: 'quick-cat', value: 'Werkstatt' });
  await clickAction({ action: 'quick-save' });
  check('Speichern bei Bis < Von abgelehnt (Formular bleibt offen)', html().includes('data-action="quick-save"'));

  // Validierung: Von vor dem letzten bestehenden Eintrag (12:30) -> Überschneidung, ablehnen
  await changeAction({ type: 'time', value: '10:00', dataset: { role: 'quick-von' } });
  await changeAction({ type: 'time', value: '11:00', dataset: { role: 'quick-bis' } });
  await clickAction({ action: 'quick-save' });
  check(
    'Speichern bei Überschneidung mit bestehendem Eintrag abgelehnt (Formular bleibt offen)',
    html().includes('data-action="quick-save"')
  );

  // Gültige Zeitspanne direkt nach dem letzten Eintrag (12:30) -> muss klappen
  await changeAction({ type: 'time', value: '13:00', dataset: { role: 'quick-von' } });
  await changeAction({ type: 'time', value: '15:00', dataset: { role: 'quick-bis' } });
  check('Live-Dauer-Anzeige zeigt 2:00 h', html().includes('= 2:00 h'));
  await clickAction({ action: 'quick-save' });
  check('Eintrag (Zeit-Modus) am vergangenen Tag gespeichert', /Kommt 2<\/span>\s*<span class="badge">Werkstatt/.test(html()));
  check(
    'Eintrag (Zeit-Modus) übernimmt exakt Von/Bis (13:00–15:00)',
    html().includes('>13:00<') && html().includes('>15:00<')
  );

  // Löschen
  await clickTab('tag');
  await clickAction({ action: 'goday', iso: todayIso() });
  const before = (html().match(/data-action="delete"/g) || []).length;
  await clickAction({ action: 'delete', iso: todayIso(), idx: '0' });
  const after = (html().match(/data-action="delete"/g) || []).length;
  check('Eintrag gelöscht', after === before - 1, `${before} -> ${after}`);

  // Persistenz
  check('Daten im Speicher abgelegt', store.size >= 2, `${store.size} Tage`);

  // Wird ein Tag durch Löschen wieder komplett leer, muss der Server einen
  // DELETE bekommen statt eines leeren PUT (das war der Bug, der Karteileichen
  // wie ein leeres 2026-08-10 auf dem Server hinterliess).
  const freshIso = '2026-12-25';
  await clickAction({ action: 'goday', iso: freshIso });
  await clickAction({ action: 'add-open', iso: freshIso });
  await clickAction({ action: 'add-cat', value: 'Sonstiges' });
  els.addTime = new FakeEl('input', 'addTime');
  els.addTime.value = '09:00';
  await clickAction({ action: 'add-save', iso: freshIso });
  fetchCalls = [];
  await clickAction({ action: 'delete', iso: freshIso, idx: '0' });
  const lastCallForFreshIso = fetchCalls.filter((c) => c.url.endsWith(`/days/${freshIso}`)).pop();
  check(
    'Leer werdender Tag löst DELETE statt leerem PUT aus',
    !!lastCallForFreshIso && lastCallForFreshIso.opts.method === 'DELETE',
    lastCallForFreshIso ? lastCallForFreshIso.opts.method : 'kein Aufruf'
  );

  // ---------------------------------------------------------------- Ausgabe
  console.log('');
  results.forEach((r) => {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  [${r.extra}]` : ''}`);
  });
  console.log(`\n${results.length - failed}/${results.length} Checks bestanden`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Test abgebrochen:', err);
  process.exit(1);
});

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function deDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
