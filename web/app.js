/* Stempeluhr – App-Logik.
   Datenmodell pro Tag (Key = ISO-Datum YYYY-MM-DD):
   { punches: [{type: 'Kommt'|'Geht', time: 'HH:MM', category?}], abwesenheitStd, abwesenheitGrund, bemerkung } */

(function () {
  'use strict';

  // ---------------------------------------------------------------- Konstanten

  const WORK_CATEGORIES = ['Büro', 'Garantie', 'Werkstatt', 'Testen', 'Testevents', 'Sonstiges'];
  // Muss exakt der Dropdown-Liste (Spalte P) in der institutionellen Excel-
  // Arbeitszeiterfassung entsprechen, sonst schlägt der 1:1-Übertrag fehl.
  // "Feiertag" entfällt bewusst: Feiertage berechnet die Excel-Vorlage selbst.
  const ABSENCE_REASONS = ['Ferien', 'krank', 'Unfall', 'geschäftlich', "Weiterbild'g"];
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MONTHS = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ];
  const MAX_PUNCHES = 8; // 4 Kommt/Geht-Paare

  // ---------------------------------------------------------------- Datum/Zeit

  const pad = (n) => String(n).padStart(2, '0');

  function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fromIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function timeNow() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDateLabel(iso) {
    const d = fromIso(iso);
    return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function fmtShort(d) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  }

  function startOfWeek(d) {
    const day = d.getDay();
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    monday.setDate(monday.getDate() + ((day === 0 ? -6 : 1) - day));
    return monday;
  }

  function weekDates(anchor) {
    const mon = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }

  /** Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag). */
  function isoWeek(date) {
    const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return {
      week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7),
      year: t.getUTCFullYear(),
    };
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function monthDates(anchor) {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => new Date(y, m, i + 1));
  }

  function minutesBetween(t1, t2) {
    const [h1, m1] = t1.split(':').map(Number);
    const [h2, m2] = t2.split(':').map(Number);
    return h2 * 60 + m2 - (h1 * 60 + m1);
  }

  function worktimeMinutes(punches) {
    let total = 0;
    for (let i = 0; i + 1 < punches.length; i += 2) {
      const diff = minutesBetween(punches[i].time, punches[i + 1].time);
      if (diff > 0) total += diff;
    }
    return total;
  }

  function fmtMinutes(min) {
    return `${Math.floor(min / 60)}:${pad(min % 60)}`;
  }

  // ---------------------------------------------------------------- Datenzugriff

  const emptyDay = () => ({ punches: [], abwesenheitStd: '', abwesenheitGrund: '', bemerkung: '' });

  function normalize(raw) {
    const d = emptyDay();
    if (!raw || typeof raw !== 'object') return d;
    if (Array.isArray(raw.punches)) {
      d.punches = raw.punches
        .filter((p) => p && typeof p.time === 'string')
        .slice(0, MAX_PUNCHES)
        .map((p) => {
          const e = { type: p.type === 'Geht' ? 'Geht' : 'Kommt', time: p.time };
          if (p.category) e.category = String(p.category);
          return e;
        });
    }
    d.abwesenheitStd = raw.abwesenheitStd == null ? '' : String(raw.abwesenheitStd);
    d.abwesenheitGrund = raw.abwesenheitGrund ? String(raw.abwesenheitGrund) : '';
    d.bemerkung = raw.bemerkung ? String(raw.bemerkung) : '';
    return d;
  }

  const state = {
    screen: 'stempeln',
    todayIso: isoDate(new Date()),
    cache: Object.create(null), // iso -> day
    mode: 'punch', // punch | absence (nur Startbildschirm)
    selectedCategory: null,
    viewDate: new Date(),
    weekAnchor: new Date(),
    monthAnchor: new Date(),
    editing: null, // { iso, idx }
    addForm: null, // { iso, category }
    ready: false,
  };

  async function ensureDays(isoList) {
    const missing = isoList.filter((iso) => state.cache[iso] === undefined);
    if (!missing.length) return;
    const got = await DB.getDays(missing);
    missing.forEach((iso) => {
      state.cache[iso] = normalize(got[iso]);
    });
  }

  function getDay(iso) {
    return state.cache[iso] || emptyDay();
  }

  async function saveDay(iso, data) {
    state.cache[iso] = data;
    await DB.putDay(iso, data);
    Sync.push(iso, data); // im Hintergrund, blockiert die UI nicht
  }

  async function updateDay(iso, updater) {
    const next = updater(getDay(iso));
    await saveDay(iso, next);
    return next;
  }

  // Freitext-Felder werden verzögert geschrieben, damit jeder Tastendruck
  // nicht eine eigene IndexedDB-Transaktion auslöst.
  const dirty = new Set();
  let saveTimer = null;

  function queueSave(iso) {
    dirty.add(iso);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, 400);
  }

  async function flushSaves() {
    clearTimeout(saveTimer);
    const isos = Array.from(dirty);
    dirty.clear();
    for (const iso of isos) {
      const data = getDay(iso);
      await DB.putDay(iso, data);
      Sync.push(iso, data);
    }
  }

  // ---------------------------------------------------------------- Icons

  const ICON = {
    clock: '<svg class="ico punch-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg class="ico thick check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    checkPlain: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    pencil: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    left: '<svg class="ico" viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"/></svg>',
    right: '<svg class="ico" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    download: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    copy: '<svg class="ico" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    palm: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 21c0-6 1-9 2-12"/><path d="M14 9c-3-3-7-2-8 1 2-2 5-1 6 1"/><path d="M14 9c1-4 5-5 7-3-3 0-5 2-5 4"/><path d="M14 9c-2-3-1-6 2-7 0 2-1 4 0 5"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  };

  // ---------------------------------------------------------------- HTML-Helfer

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function chips(items, selected, action, opts) {
    const o = opts || {};
    const cls = o.teal ? 'chip teal' : 'chip';
    const wrap = o.pill ? 'chip-row' : 'chip-grid';
    return `<div class="${wrap}">${items
      .map(
        (item) => `<button class="${cls}" type="button" data-action="${action}" data-value="${esc(item)}"
          aria-pressed="${selected === item ? 'true' : 'false'}">${ICON.check}<span>${esc(item)}</span></button>`
      )
      .join('')}</div>`;
  }

  function punchListHtml(iso, day) {
    if (!day.punches.length) return '<div class="empty">Noch keine Einträge</div>';
    return `<div class="list">${day.punches
      .map((p, idx) => {
        const nr = Math.floor(idx / 2) + 1;
        const isEditing = state.editing && state.editing.iso === iso && state.editing.idx === idx;
        const right = isEditing
          ? `<input class="input time-input" type="time" id="editTime" value="${esc(p.time)}" data-role="edit-time">
             <button class="iconbtn ok" data-action="edit-save" data-iso="${iso}" data-idx="${idx}" aria-label="Speichern">${ICON.checkPlain}</button>
             <button class="iconbtn cancel" data-action="edit-cancel" aria-label="Abbrechen">${ICON.x}</button>`
          : `<span class="time">${esc(p.time)}</span>
             <button class="iconbtn" data-action="edit-start" data-iso="${iso}" data-idx="${idx}" aria-label="Zeit ändern">${ICON.pencil}</button>
             <button class="iconbtn" data-action="delete" data-iso="${iso}" data-idx="${idx}" aria-label="Löschen">${ICON.trash}</button>`;
        return `<div class="row">
            <div class="row-left">
              <span class="dot ${p.type === 'Kommt' ? 'amber' : 'teal'}"></span>
              <span class="row-title">${p.type} ${nr}</span>
              ${p.category ? `<span class="badge">${esc(p.category)}</span>` : ''}
            </div>
            <div class="row-right">${right}</div>
          </div>`;
      })
      .join('')}</div>`;
  }

  function absenceCardHtml(iso, day) {
    return `<div class="card">
      <div class="field">
        <label class="label" for="absStd">Stunden (bezahlte Abwesenheit)</label>
        <input class="input mono" id="absStd" type="number" inputmode="decimal" step="0.25" min="0" max="24"
               placeholder="z.B. 8.4" value="${esc(day.abwesenheitStd)}"
               data-field="abwesenheitStd" data-iso="${iso}">
      </div>
      <div class="field">
        <span class="label">Grund</span>
        ${chips(ABSENCE_REASONS, day.abwesenheitGrund, 'reason', { teal: true, pill: true })}
      </div>
      ${
        day.abwesenheitStd || day.abwesenheitGrund
          ? `<div class="btn-row"><button class="btn ghost" style="width:100%" data-action="clear-absence" data-iso="${iso}">Absenz entfernen</button></div>`
          : ''
      }
    </div>`;
  }

  function bemerkungHtml(iso, day) {
    return `<div class="section">
      <label class="label" for="bem">Bemerkung</label>
      <textarea class="input" id="bem" rows="2" placeholder="optional…"
                data-field="bemerkung" data-iso="${iso}">${esc(day.bemerkung)}</textarea>
    </div>`;
  }

  function addFormHtml(iso, day) {
    if (day.punches.length >= MAX_PUNCHES) {
      return '<div class="hint center">Alle 4 Kommt/Geht-Paare sind erfasst.</div>';
    }
    const nextType = day.punches.length % 2 === 0 ? 'Kommt' : 'Geht';
    const nr = Math.floor(day.punches.length / 2) + 1;
    const open = state.addForm && state.addForm.iso === iso;
    if (!open) {
      return `<button class="btn dashed" data-action="add-open" data-iso="${iso}">${ICON.plus} ${nextType} ${nr} nachtragen</button>`;
    }
    const cat = state.addForm.category;
    return `<div class="card" style="margin-top:12px">
      <div class="label">${nextType} ${nr} nachtragen</div>
      ${nextType === 'Kommt' ? chips(WORK_CATEGORIES, cat, 'add-cat') : ''}
      <div class="field">
        <label class="label" for="addTime">Uhrzeit</label>
        <input class="input mono" id="addTime" type="time" value="${esc(state.addForm.time || '')}" data-role="add-time">
      </div>
      <div class="btn-row">
        <button class="btn primary" data-action="add-save" data-iso="${iso}">Speichern</button>
        <button class="btn ghost" data-action="add-cancel">Abbrechen</button>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- Screens

  function renderStempeln() {
    const iso = state.todayIso;
    const day = getDay(iso);
    const worked = worktimeMinutes(day.punches);
    const limit = day.punches.length >= MAX_PUNCHES;
    const nextType = day.punches.length % 2 === 0 ? 'Kommt' : 'Geht';
    const nr = Math.floor(day.punches.length / 2) + 1;
    const needsCat = nextType === 'Kommt' && !state.selectedCategory;
    const blocked = limit || needsCat;

    let html = `<div class="section seg">
      <button class="seg-btn" type="button" data-action="mode" data-value="punch"
              aria-pressed="${state.mode === 'punch'}">Zeiterfassung</button>
      <button class="seg-btn teal" type="button" data-action="mode" data-value="absence"
              aria-pressed="${state.mode === 'absence'}">${ICON.palm} Absenz</button>
    </div>`;

    if (state.mode === 'punch') {
      if (!limit && nextType === 'Kommt') {
        html += `<div class="section">
          <span class="label">Wo arbeitest du?</span>
          ${chips(WORK_CATEGORIES, state.selectedCategory, 'cat')}
        </div>`;
      }

      html += `<div class="section">
        <button class="punch ${blocked ? '' : nextType === 'Kommt' ? 'kommt' : 'geht'}"
                data-action="punch" ${blocked ? 'disabled' : ''}>
          ${ICON.clock}
          <span class="punch-title">${limit ? 'Maximum erreicht' : `${nextType} ${nr}`}</span>
          ${
            limit
              ? '<span class="punch-sub">4 Paare pro Tag</span>'
              : `<span class="punch-sub">${needsCat ? 'zuerst Tätigkeit wählen' : 'antippen zum Erfassen'}</span>`
          }
        </button>
      </div>`;

      if (day.abwesenheitStd || day.abwesenheitGrund) {
        const std = day.abwesenheitStd ? `${esc(day.abwesenheitStd)} h ` : '';
        html += `<div class="hint" style="color:var(--teal)">Für heute ist eine Absenz erfasst: ${std}${esc(
          day.abwesenheitGrund || 'ohne Grund'
        )}.</div>`;
      }

      html += `<div class="section">
        <span class="label">Heute erfasst</span>
        ${punchListHtml(iso, day)}
        ${worked > 0 ? `<div class="total"><span>Geleistet heute</span><strong>${fmtMinutes(worked)} h</strong></div>` : ''}
      </div>`;
    } else {
      html += `<div class="section">${absenceCardHtml(iso, day)}</div>`;
      if (day.punches.length) {
        html += `<div class="hint">Achtung: für heute sind zusätzlich ${day.punches.length} Stempel erfasst.</div>`;
      }
    }

    html += bemerkungHtml(iso, day);
    return html;
  }

  function renderTag() {
    const iso = isoDate(state.viewDate);
    const day = getDay(iso);
    const worked = worktimeMinutes(day.punches);
    const isToday = iso === state.todayIso;

    let html = `<div class="navrow">
      <button class="navbtn" data-action="nav" data-value="day-prev" aria-label="Vorheriger Tag">${ICON.left}</button>
      <div class="nav-title">${fmtDateLabel(iso)}<small>${isToday ? 'Heute' : 'Tagesansicht'}</small></div>
      <button class="navbtn" data-action="nav" data-value="day-next" aria-label="Nächster Tag">${ICON.right}</button>
    </div>`;

    if (!isToday) {
      html += `<button class="today-link" data-action="nav" data-value="day-today">↩ zu heute springen</button>`;
    }

    html += `<div class="section">
      ${day.abwesenheitStd
        ? `<div class="row list" style="margin-bottom:10px">
             <div class="row-left"><span class="dot teal"></span><span class="row-title">${esc(
               day.abwesenheitGrund || 'Absenz'
             )}</span></div>
             <div class="row-right"><span class="time">${esc(day.abwesenheitStd)} h</span></div>
           </div>`
        : ''}
      ${punchListHtml(iso, day)}
      ${worked > 0 ? `<div class="total"><span>Geleistet</span><strong>${fmtMinutes(worked)} h</strong></div>` : ''}
    </div>`;

    html += `<div class="section">${addFormHtml(iso, day)}
      <div class="hint">Vergessen zu stempeln? Hier kannst du fehlende Kommt/Geht-Einträge für diesen Tag von Hand ergänzen.</div>
    </div>`;

    html += `<div class="section"><span class="label">Absenz</span>${absenceCardHtml(iso, day)}</div>`;
    html += bemerkungHtml(iso, day);
    return html;
  }

  function renderWoche() {
    const days = weekDates(state.weekAnchor);
    const { week, year } = isoWeek(days[0]);
    let total = 0;

    const rows = days
      .map((d) => {
        const iso = isoDate(d);
        const day = getDay(iso);
        const min = worktimeMinutes(day.punches);
        total += min;
        const cats = Array.from(new Set(day.punches.map((p) => p.category).filter(Boolean))).join(', ');
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;

        let val;
        if (day.abwesenheitStd) {
          val = `<span class="abs">${esc(day.abwesenheitStd)} h · ${esc(day.abwesenheitGrund || 'Absenz')}</span>`;
          if (min > 0) val += `<span class="cat">+ ${fmtMinutes(min)} h gearbeitet</span>`;
        } else if (min > 0) {
          val = `${fmtMinutes(min)} h${cats ? `<span class="cat">${esc(cats)}</span>` : ''}`;
        } else {
          val = '<span class="none">–</span>';
        }

        return `<button class="week-row ${iso === state.todayIso ? 'is-today' : ''} ${isWeekend ? 'weekend' : ''}"
                        data-action="goday" data-iso="${iso}">
          <span class="row-left"><span class="wd">${WEEKDAYS[d.getDay()]}</span><span class="wdate">${fmtShort(d)}</span></span>
          <span class="wval">${val}</span>
        </button>`;
      })
      .join('');

    return `<div class="navrow">
        <button class="navbtn" data-action="nav" data-value="week-prev" aria-label="Vorherige Woche">${ICON.left}</button>
        <div class="nav-title">KW ${week} · ${year}<small>${fmtShort(days[0])} – ${pad(days[6].getDate())}.${pad(
      days[6].getMonth() + 1
    )}.${days[6].getFullYear()}</small></div>
        <button class="navbtn" data-action="nav" data-value="week-next" aria-label="Nächste Woche">${ICON.right}</button>
      </div>
      <div class="list">${rows}</div>
      <div class="total"><span>Total Woche</span><strong>${fmtMinutes(total)} h</strong></div>
      <button class="btn primary" data-action="export" data-range="week">${ICON.download} Woche als CSV</button>
      <button class="btn" data-action="copy" data-range="week">${ICON.copy} CSV in Zwischenablage</button>
      <div class="hint center">Spalten: Datum, Kommt 1–4, Geht 1–4, bezahlte Abwesenheit, Abwesenheitsgrund, Bemerkung, Tätigkeit</div>`;
  }

  function renderMonat() {
    const dates = monthDates(state.monthAnchor);
    const first = (dates[0].getDay() + 6) % 7; // Montag = 0
    const selIso = isoDate(state.viewDate);
    let total = 0;

    const cells = dates
      .map((d) => {
        const iso = isoDate(d);
        const day = getDay(iso);
        const min = worktimeMinutes(day.punches);
        total += min;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const dot = day.abwesenheitStd ? 'abs' : min > 0 ? 'work' : '';
        return `<button class="mcell ${isWeekend ? 'weekend' : ''} ${iso === state.todayIso ? 'is-today' : ''} ${
          iso === selIso ? 'is-selected' : ''
        }" data-action="goday" data-iso="${iso}" aria-label="${fmtDateLabel(iso)}">
          <span>${d.getDate()}</span><span class="mdot ${dot}"></span>
        </button>`;
      })
      .join('');

    return `<div class="navrow">
        <button class="navbtn" data-action="nav" data-value="month-prev" aria-label="Vorheriger Monat">${ICON.left}</button>
        <div class="nav-title">${MONTHS[state.monthAnchor.getMonth()]} ${state.monthAnchor.getFullYear()}<small>Monatsübersicht</small></div>
        <button class="navbtn" data-action="nav" data-value="month-next" aria-label="Nächster Monat">${ICON.right}</button>
      </div>
      <div class="month-head">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div>${w}</div>`).join('')}</div>
      <div class="month-grid">
        ${Array.from({ length: first }, () => '<div class="mcell blank"></div>').join('')}
        ${cells}
      </div>
      <div class="legend">
        <span><span class="mdot work"></span> gearbeitet</span>
        <span><span class="mdot abs"></span> Absenz</span>
      </div>
      <div class="total"><span>Total Monat</span><strong>${fmtMinutes(total)} h</strong></div>
      <button class="btn primary" data-action="export" data-range="month">${ICON.download} Monat als CSV</button>
      <button class="btn" data-action="copy" data-range="month">${ICON.copy} CSV in Zwischenablage</button>
      <div class="section">
        <span class="label">Profil</span>
        <div class="row list">
          <div class="row-left"><span class="row-title">${esc(Sync.getPerson() || '–')}</span></div>
          <div class="row-right"><button class="btn ghost" data-action="change-person">ändern</button></div>
        </div>
        <div class="hint">Bestimmt, unter welchem Bereich auf dem Server synchronisiert wird. Zwei Geräte mit unterschiedlichem Namen überschreiben sich nicht gegenseitig.</div>
      </div>
      <div class="section">
        <span class="label">Datensicherung</span>
        <div class="btn-row" style="margin-top:0">
          <button class="btn" data-action="backup-export">Backup speichern</button>
          <button class="btn" data-action="backup-import">Backup laden</button>
        </div>
        <button class="btn dashed" data-action="sync-all">Vollständig synchronisieren</button>
        <div class="hint">Primärspeicher ist dieses Gerät, jede Änderung wird zusätzlich automatisch auf den Server gespiegelt (siehe Sync-Status oben). "Vollständig synchronisieren" schickt wirklich alle auf diesem Gerät gespeicherten Tage an den Server – nützlich für Einträge, die vor dem Einschalten von Sync oder ohne Verbindung entstanden sind. Das JSON-Backup ist zusätzlich nützlich, um Daten auf ein komplett anderes Gerät zu übertragen.</div>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>`;
  }

  // ---------------------------------------------------------------- Rendern

  const screenEl = document.getElementById('screen');
  const tabbarEl = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');
  const clockEl = document.getElementById('clock');
  const topbarDateEl = document.getElementById('topbarDate');
  const eyebrowEl = document.getElementById('eyebrow');
  const syncRowEl = document.getElementById('syncRow');
  const syncLabelEl = document.getElementById('syncLabel');

  const SYNC_LABELS = {
    synced: 'gesichert',
    syncing: 'sync…',
    pending: (n) => `${n} ausstehend`,
    offline: (n) => (n ? `offline · ${n}` : 'offline'),
  };

  function updateSyncUI(status, pendingCount) {
    if (!syncRowEl) return;
    syncRowEl.hidden = false;
    syncRowEl.className = `syncrow ${status}`;
    const label = SYNC_LABELS[status];
    syncLabelEl.textContent = typeof label === 'function' ? label(pendingCount) : label || '';
  }

  const RENDERERS = { stempeln: renderStempeln, tag: renderTag, woche: renderWoche, monat: renderMonat };

  function render() {
    // Fokus + Cursorposition über das Neuzeichnen retten (Bemerkungsfeld!)
    const active = document.activeElement;
    const focusId = active && active.id && screenEl.contains(active) ? active.id : null;
    let caret = null;
    if (focusId) {
      try {
        caret = active.selectionStart;
      } catch {
        caret = null;
      }
    }

    screenEl.innerHTML = RENDERERS[state.screen]();

    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret != null && el.setSelectionRange) {
          try {
            el.setSelectionRange(caret, caret);
          } catch {}
        }
      }
    }

    Array.from(tabbarEl.querySelectorAll('.tab')).forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.screen === state.screen));
    });
    topbarDateEl.textContent = fmtDateLabel(state.todayIso);
    if (eyebrowEl) {
      const person = Sync.getPerson();
      eyebrowEl.textContent = person ? `Stempeluhr · ${person}` : 'Stempeluhr';
    }
  }

  /** Lädt die Tage, die der Ziel-Screen braucht, und zeichnet neu. */
  async function go(screen) {
    if (screen) state.screen = screen;
    await preload();
    render();
  }

  async function preload() {
    const need = new Set([state.todayIso]);
    if (state.screen === 'tag') {
      need.add(isoDate(state.viewDate));
    } else if (state.screen === 'woche') {
      weekDates(state.weekAnchor).forEach((d) => need.add(isoDate(d)));
    } else if (state.screen === 'monat') {
      monthDates(state.monthAnchor).forEach((d) => need.add(isoDate(d)));
      need.add(isoDate(state.viewDate));
    }
    await ensureDays(Array.from(need));
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => {
        toastEl.hidden = true;
      }, 220);
    }, 1900);
  }

  // ---------------------------------------------------------------- CSV

  const CSV_HEADER = [
    'Datum',
    'Kommt 1', 'Geht 1',
    'Kommt 2', 'Geht 2',
    'Kommt 3', 'Geht 3',
    'Kommt 4', 'Geht 4',
    'bezahlte Abwesenheit',
    'Abwesenheitsgrund',
    'Bemerkung',
    'Tätigkeit',
  ];

  function csvCell(v) {
    return String(v == null ? '' : v)
      .replace(/[\r\n]+/g, ' ')
      .replace(/;/g, ',');
  }

  function buildCsv(dates) {
    const rows = dates.map((d) => {
      const iso = isoDate(d);
      const day = getDay(iso);
      const slots = ['', '', '', '', '', '', '', ''];
      day.punches.forEach((p, i) => {
        if (i < MAX_PUNCHES) slots[i] = p.time;
      });
      const cats = Array.from(new Set(day.punches.map((p) => p.category).filter(Boolean))).join(', ');
      return [
        `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
        ...slots,
        day.abwesenheitStd || '',
        day.abwesenheitGrund || '',
        day.bemerkung || '',
        cats,
      ].map(csvCell);
    });
    return [CSV_HEADER, ...rows].map((r) => r.join(';')).join('\r\n');
  }

  function currentRange(range) {
    if (range === 'week') {
      const days = weekDates(state.weekAnchor);
      const { week, year } = isoWeek(days[0]);
      return { dates: days, name: `arbeitszeit_KW${pad(week)}_${year}.csv` };
    }
    const dates = monthDates(state.monthAnchor);
    return {
      dates,
      name: `arbeitszeit_${state.monthAnchor.getFullYear()}-${pad(state.monthAnchor.getMonth() + 1)}.csv`,
    };
  }

  function exportCsv(range) {
    const { dates, name } = currentRange(range);
    // BOM voranstellen, damit Excel die Umlaute richtig liest
    const blob = new Blob(['\uFEFF' + buildCsv(dates)], { type: 'text/csv;charset=utf-8;' });

    // iOS: über das Teilen-Menü landet die Datei direkt in Dateien/Mail.
    try {
      if (typeof File === 'function' && navigator.canShare) {
        const file = new File([blob], name, { type: 'text/csv' });
        if (navigator.canShare({ files: [file] })) {
          navigator
            .share({ files: [file], title: name })
            .then(() => toast('CSV geteilt'))
            .catch(() => {});
          return;
        }
      }
    } catch {}

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('CSV exportiert');
  }

  async function copyCsv(range) {
    const { dates } = currentRange(range);
    const text = buildCsv(dates);
    try {
      await navigator.clipboard.writeText(text);
      toast('CSV kopiert');
    } catch {
      // Fallback für Browser ohne Clipboard-API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('CSV kopiert');
      } catch {
        toast('Kopieren nicht möglich');
      }
      ta.remove();
    }
  }

  // ---------------------------------------------------------------- Backup

  async function backupExport() {
    const all = await DB.allDays();
    const payload = { app: 'stempeluhr', version: 1, exported: new Date().toISOString(), days: all };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = `stempeluhr-backup_${isoDate(new Date())}.json`;
    try {
      if (typeof File === 'function' && navigator.canShare) {
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).catch(() => {});
          return;
        }
      }
    } catch {}
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Backup gespeichert');
  }

  async function backupImport(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const days = parsed && parsed.days ? parsed.days : parsed;
      if (!days || typeof days !== 'object') throw new Error('Format');
      const clean = {};
      Object.keys(days).forEach((iso) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) clean[iso] = normalize(days[iso]);
      });
      const n = Object.keys(clean).length;
      if (!n) throw new Error('leer');
      if (!confirm(`${n} Tage aus dem Backup einspielen? Bestehende Einträge an diesen Tagen werden überschrieben.`))
        return;
      await DB.importDays(clean);
      Object.keys(clean).forEach((iso) => {
        state.cache[iso] = clean[iso];
      });
      await go();
      toast(`${n} Tage importiert`);
    } catch {
      toast('Backup konnte nicht gelesen werden');
    }
  }

  // ---------------------------------------------------------------- Aktionen

  let lastPunchAt = 0;

  async function doPunch() {
    // Doppeltipp abfangen – sonst landet ein "Geht" versehentlich auf derselben Minute
    const t = Date.now();
    if (t - lastPunchAt < 900) return;
    lastPunchAt = t;

    const iso = state.todayIso;
    const day = getDay(iso);
    if (day.punches.length >= MAX_PUNCHES) return;
    const type = day.punches.length % 2 === 0 ? 'Kommt' : 'Geht';
    if (type === 'Kommt' && !state.selectedCategory) return;

    const entry = { type, time: timeNow() };
    if (type === 'Kommt') entry.category = state.selectedCategory;
    const nr = Math.floor(day.punches.length / 2) + 1;

    await updateDay(iso, (d) => ({ ...d, punches: [...d.punches, entry] }));
    state.selectedCategory = null;
    if (navigator.vibrate) navigator.vibrate(18);
    render();
    toast(type === 'Kommt' ? `Kommt ${nr} · ${entry.category} – ${entry.time}` : `Geht ${nr} erfasst – ${entry.time}`);
  }

  async function handleAction(action, el) {
    const iso = el.dataset.iso;
    const value = el.dataset.value;

    switch (action) {
      case 'mode':
        state.mode = value;
        render();
        break;

      case 'cat':
        state.selectedCategory = state.selectedCategory === value ? null : value;
        render();
        break;

      case 'punch':
        await doPunch();
        break;

      case 'reason': {
        const target = iso || (state.screen === 'tag' ? isoDate(state.viewDate) : state.todayIso);
        await updateDay(target, (d) => ({ ...d, abwesenheitGrund: d.abwesenheitGrund === value ? '' : value }));
        render();
        break;
      }

      case 'clear-absence':
        await updateDay(iso, (d) => ({ ...d, abwesenheitStd: '', abwesenheitGrund: '' }));
        render();
        toast('Absenz entfernt');
        break;

      case 'edit-start':
        state.editing = { iso, idx: Number(el.dataset.idx) };
        render();
        document.getElementById('editTime')?.focus({ preventScroll: true });
        break;

      case 'edit-cancel':
        state.editing = null;
        render();
        break;

      case 'edit-save': {
        const idx = Number(el.dataset.idx);
        const input = document.getElementById('editTime');
        const time = input && input.value;
        if (time) {
          await updateDay(iso, (d) => ({
            ...d,
            punches: d.punches.map((p, i) => (i === idx ? { ...p, time } : p)),
          }));
        }
        state.editing = null;
        render();
        break;
      }

      case 'delete': {
        const idx = Number(el.dataset.idx);
        const day = getDay(iso);
        const p = day.punches[idx];
        if (!p) break;
        if (!confirm(`${p.type} ${Math.floor(idx / 2) + 1} (${p.time}) löschen?`)) break;
        await updateDay(iso, (d) => ({ ...d, punches: d.punches.filter((_, i) => i !== idx) }));
        state.editing = null;
        render();
        toast('Eintrag gelöscht');
        break;
      }

      case 'add-open':
        state.addForm = { iso, category: null, time: '' };
        render();
        break;

      case 'add-cat':
        if (state.addForm) state.addForm.category = state.addForm.category === value ? null : value;
        render();
        break;

      case 'add-cancel':
        state.addForm = null;
        render();
        break;

      case 'add-save': {
        const day = getDay(iso);
        const type = day.punches.length % 2 === 0 ? 'Kommt' : 'Geht';
        const input = document.getElementById('addTime');
        const time = input && input.value;
        if (!time) {
          toast('Bitte Uhrzeit eingeben');
          break;
        }
        if (type === 'Kommt' && !state.addForm.category) {
          toast('Bitte Tätigkeit wählen');
          break;
        }
        const entry = { type, time };
        if (type === 'Kommt') entry.category = state.addForm.category;
        await updateDay(iso, (d) => ({ ...d, punches: [...d.punches, entry] }));
        state.addForm = null;
        render();
        toast(`${type} nachgetragen – ${time}`);
        break;
      }

      case 'goday':
        state.viewDate = fromIso(iso);
        state.editing = null;
        state.addForm = null;
        await go('tag');
        break;

      case 'nav':
        await handleNav(value);
        break;

      case 'export':
        exportCsv(el.dataset.range);
        break;

      case 'copy':
        await copyCsv(el.dataset.range);
        break;

      case 'backup-export':
        await backupExport();
        break;

      case 'backup-import':
        document.getElementById('importFile')?.click();
        break;

      case 'sync-all': {
        const all = await DB.allDays();
        const n = Object.keys(all).length;
        if (!n) {
          toast('Keine lokalen Daten vorhanden');
          break;
        }
        toast(`Synchronisiere ${n} Tage…`);
        const result = await Sync.pushAll(all);
        render();
        toast(
          result.failed
            ? `${result.ok} synchronisiert, ${result.failed} fehlgeschlagen (später erneut versucht)`
            : `${result.ok} Tage synchronisiert`
        );
        break;
      }

      case 'change-person': {
        const current = Sync.getPerson() || '';
        const next = (prompt('Neuer Profilname für dieses Gerät:', current) || '').trim();
        if (next && next !== current) {
          Sync.setPerson(next);
          render();
          toast(`Profil: ${next}`);
        }
        break;
      }
    }
  }

  async function handleNav(value) {
    const shift = (date, days) => {
      const n = new Date(date);
      n.setDate(n.getDate() + days);
      return n;
    };

    switch (value) {
      case 'day-prev':
        state.viewDate = shift(state.viewDate, -1);
        break;
      case 'day-next':
        state.viewDate = shift(state.viewDate, 1);
        break;
      case 'day-today':
        state.viewDate = fromIso(state.todayIso);
        break;
      case 'week-prev':
        state.weekAnchor = shift(state.weekAnchor, -7);
        break;
      case 'week-next':
        state.weekAnchor = shift(state.weekAnchor, 7);
        break;
      case 'month-prev':
        state.monthAnchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() - 1, 1);
        break;
      case 'month-next':
        state.monthAnchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() + 1, 1);
        break;
    }
    state.editing = null;
    state.addForm = null;
    await go();
  }

  // ---------------------------------------------------------------- Events

  screenEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    e.preventDefault();
    handleAction(el.dataset.action, el);
  });

  // Freitext / Zahlen: Zustand sofort, Persistenz verzögert – ohne Neuzeichnen.
  screenEl.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.role === 'add-time' && state.addForm) {
      state.addForm.time = el.value;
      return;
    }
    const field = el.dataset && el.dataset.field;
    if (!field) return;
    const iso = el.dataset.iso;
    state.cache[iso] = { ...getDay(iso), [field]: el.value };
    queueSave(iso);
  });

  screenEl.addEventListener(
    'blur',
    (e) => {
      if (e.target.dataset && e.target.dataset.field) flushSaves();
    },
    true
  );

  screenEl.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files && e.target.files[0]) {
      backupImport(e.target.files[0]);
      e.target.value = '';
    }
  });

  tabbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const next = btn.dataset.screen;
    if (next === state.screen) return;
    state.editing = null;
    state.addForm = null;
    go(next);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushSaves();
    } else {
      checkDayRollover();
    }
  });

  window.addEventListener('pagehide', flushSaves);

  // ---------------------------------------------------------------- Uhr

  function tickClock() {
    const d = new Date();
    clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function checkDayRollover() {
    const iso = isoDate(new Date());
    if (iso === state.todayIso) return;
    state.todayIso = iso;
    state.viewDate = new Date();
    state.weekAnchor = new Date();
    state.monthAnchor = new Date();
    state.selectedCategory = null;
    await ensureDays([iso]);
    state.mode = getDay(iso).abwesenheitStd ? 'absence' : 'punch';
    await go();
  }

  // ---------------------------------------------------------------- Service Worker

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return; // ohne Server kein SW – App läuft trotzdem
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(sw);
          });
        });
      })
      .catch(() => {});
  }

  function showUpdateBar(sw) {
    if (document.querySelector('.updatebar')) return;
    const bar = document.createElement('div');
    bar.className = 'updatebar';
    bar.innerHTML = '<span>Neue Version verfügbar</span><button type="button">Neu laden</button>';
    bar.querySelector('button').addEventListener('click', () => {
      sw.postMessage('skipWaiting');
      location.reload();
    });
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------------- Start

  /** Fragt beim allerersten Start dieses Geräts einmalig einen Profilnamen ab –
   *  bestimmt, unter welchem Bereich auf dem Server synchronisiert wird, damit
   *  zwei Personen auf zwei Geräten sich nicht gegenseitig überschreiben. */
  function ensurePerson() {
    if (Sync.getPerson()) return;
    const name = (prompt('Wie heisst du? (für die eigene Zeiterfassung auf dem gemeinsamen Server)') || '').trim();
    Sync.setPerson(name || 'Person');
  }

  (async function init() {
    tickClock();
    setInterval(tickClock, 10000);
    setInterval(checkDayRollover, 60000);

    ensurePerson();

    Sync.init({
      getDay: async (iso) => {
        await ensureDays([iso]);
        return getDay(iso);
      },
      onStatus: updateSyncUI,
    });

    // Neuinstallation / neues Gerät: lokale DB ist leer -> vom Server befüllen.
    const existing = await DB.allDays();
    const hydrated = await Sync.hydrateIfEmpty(Object.keys(existing).length === 0, DB.importDays);
    if (hydrated) state.cache = Object.create(null);

    await ensureDays([state.todayIso]);
    state.mode = getDay(state.todayIso).abwesenheitStd ? 'absence' : 'punch';
    state.ready = true;
    await go('stempeln');
    registerSW();
  })();
})();
