/**
 * folderLists.js — per-folder Tasks and Ideas, each stored as a Markdown
 * file in the root of the active folder and shown in a full-width view
 * that overlays the editor area.
 *
 *   _tasks.md   - [ ] Draft API spec #work  !high  📅 2026-10-31  ➕ 2026-10-20
 *                   Notes are indented lines under the task
 *               - [x] Set up repo  !low  ➕ 2026-10-15  ✅ 2026-10-19
 *   _ideas.md   - Offline mode for the app  ➕ 2026-10-20
 *
 * Hand edits are respected: lines the app doesn't recognise stay exactly
 * where they are, indented lines under an item belong to that item (its
 * notes, editable in the side panel), and an unchanged item keeps its
 * original line. Only items changed in the view are re-written. The `_`
 * prefix keeps these apart from any tasks.md / ideas.md the user wrote.
 *
 * createFolderList() holds everything the two share (load/save, the view,
 * quick add, the details side panel, delete with undo, header button);
 * each config adds its own fields.
 */

function _flIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _flToday() { return _flIso(new Date()); }

/** Today + n days, as YYYY-MM-DD. */
function _flAddDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return _flIso(d);
}

function _flFmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { month: 'short', day: 'numeric' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

/** "Today", "Tomorrow", "Fri" for the next week, else "Oct 31". */
function _flFmtDue(iso) {
  if (iso === _flToday()) return 'Today';
  if (iso === _flAddDays(1)) return 'Tomorrow';
  if (iso === _flAddDays(-1)) return 'Yesterday';
  if (iso > _flToday() && iso <= _flAddDays(6)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return _flFmtDate(iso);
}

function _flJoin(folder, name) {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + sep + name;
}

/** Pull `re`'s first group out of `state.rest`, removing the match. */
function _flTake(state, re) {
  const hit = state.rest.match(re);
  if (!hit) return null;
  state.rest = state.rest.replace(re, ' ');
  return hit[1];
}

function _flEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Tags are `#word` starting with a letter, so "issue #12" stays text. */
const _FL_TAG_RE = /(?:^|\s)#([A-Za-z][\w/-]*)/g;

function _flTakeTags(state) {
  const tags = [];
  state.rest = state.rest.replace(_FL_TAG_RE, (_, t) => {
    if (!tags.includes(t.toLowerCase())) tags.push(t.toLowerCase());
    return ' ';
  });
  return tags;
}

/* ── Quick-add syntax ────────────────────────────────────────────── */

const _FL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Short forms; "sat" and "sun" are left out because they're common words.
const _FL_DAY_SHORT = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5 };

/** The next given weekday (0 = Sunday), counting today. */
function _flNextWeekday(day) {
  return _flAddDays((day - new Date().getDay() + 7) % 7);
}

/**
 * Parse quick-add text like "Call bank !high tomorrow #finance".
 *   priority  !high !h !med !m !low !l  (also !1 !2 !3)
 *   due       today, tomorrow/tmr, next week, in 3 days, in 2 weeks,
 *             monday…sunday, mon…fri, 2026-10-31
 *   tags      #word
 * Returns { text, priority|null, due|null, tags[] }. Anything not
 * recognised stays in the text.
 */
function parseQuickAdd(input) {
  const s = { rest: ` ${input} ` };
  const out = { priority: null, due: null, tags: [] };

  const p = _flTake(s, /\s!(high|med|medium|low|h|m|l|1|2|3)(?=\s)/i);
  if (p) out.priority = { h: 'high', 1: 'high', high: 'high', l: 'low', 3: 'low', low: 'low' }[p.toLowerCase()] || 'med';

  const dateRules = [
    [/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => m],
    [/\s(today|tod)(?=\s)/i, () => _flToday()],
    [/\s(tomorrow|tmr|tmrw)(?=\s)/i, () => _flAddDays(1)],
    [/\s(next week)(?=\s)/i, () => _flNextWeekday(1) === _flToday() ? _flAddDays(7) : _flNextWeekday(1)],
    [/\s(in \d{1,3} (?:days?|weeks?))(?=\s)/i, (m) => {
      const [, n, unit] = m.match(/(\d+) (\w+)/);
      return _flAddDays(Number(n) * (/^week/i.test(unit) ? 7 : 1));
    }],
    [new RegExp(`\\s(${_FL_DAYS.join('|')})(?=\\s)`, 'i'), (m) => _flNextWeekday(_FL_DAYS.indexOf(m.toLowerCase()))],
    [new RegExp(`\\s(${Object.keys(_FL_DAY_SHORT).join('|')})(?=\\s)`, 'i'), (m) => _flNextWeekday(_FL_DAY_SHORT[m.toLowerCase()])],
  ];
  for (const [re, fn] of dateRules) {
    const hit = _flTake(s, re);
    if (hit) { out.due = fn(hit); break; }
  }

  out.tags = _flTakeTags(s);
  out.text = s.rest.replace(/\s+/g, ' ').trim();
  return out;
}

/* ── Small date menu (row due chip) ─────────────────────────────── */

let _flMenu = null;

function _flCloseMenu() {
  _flMenu?.remove();
  _flMenu = null;
}

/** A popup under `anchor` offering Today / Tomorrow / Next week / Pick date / Clear. */
function _flDateMenu(anchor, current, onPick) {
  _flCloseMenu();
  const menu = _flEl('div', 'fl-menu');
  const add = (label, value, cls) => {
    const b = _flEl('button', 'fl-menu__item' + (cls ? ` ${cls}` : ''), label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); _flCloseMenu(); onPick(value); });
    menu.append(b);
  };
  add('Today', _flToday());
  add('Tomorrow', _flAddDays(1));
  add('Next week', _flNextWeekday(1) === _flToday() ? _flAddDays(7) : _flNextWeekday(1));
  const pick = _flEl('label', 'fl-menu__item', 'Pick date…');
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'fl-menu__date';
  input.value = current || '';
  input.addEventListener('change', () => { if (input.value) { _flCloseMenu(); onPick(input.value); } });
  pick.append(input);
  pick.addEventListener('click', (e) => { e.stopPropagation(); try { input.showPicker(); } catch { input.focus(); } });
  menu.append(pick);
  if (current) add('Clear date', null, 'fl-menu__item--danger');

  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  _flMenu = menu;
}

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => { if (_flMenu && !_flMenu.contains(e.target)) _flCloseMenu(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _flMenu) { e.stopPropagation(); _flCloseMenu(); }
  }, true);
}

/**
 * @param {object} cfg
 *   key, title, fileName, noun, buttonId, emptyText
 *   parse(line) → item | null          serialise(item) → line
 *   hasDone                            items with .done go to a "Completed" section
 *   leadIconHTML                       icon at the start of each row (lists without a checkbox)
 *   addPreview(text) → Element|null    shown under the text box as you type
 *   newItem(text) → item               build an item from the quick-add text
 *   rowParts(item, api) → Element[]    extra row elements (before ×)
 *   panelParts(item, api) → Element[]  extra fields in the details panel
 *                                      api: { changed(), remove(), cont() }
 *   sort(a, b)                         order of open items
 *   hasSubtasks                        indented "- [ ]" lines are a checklist in the panel
 *   groups / groupOf(item) → key       split open items into sections (in groups' order)
 *   filters                            extra filter chips: [{ key, label, test(item) }]
 *   badge(items) → { count, alert }    header badge
 */
function createFolderList(cfg) {
  let _folder = null;
  let _items = [];
  // The file, line by line, in order:
  //   { raw }                         a line the app doesn't recognise — kept as-is
  //   { item, line, snap, cont }      an item; `line` is its original text, `snap` its
  //                                   parsed fields (to spot edits), `cont` the indented
  //                                   lines under it (its notes)
  let _entries = [];
  let _exists = false;   // whether the file is on disk yet
  let _loadSeq = 0;
  let _rawPath = null;   // file opened via "Edit raw" — show it in the editor, not the view
  let _view = null;
  let _panel = null;
  let _selected = null;  // item shown in the side panel
  let _saveTimer = null;
  let _query = '';       // search box text
  let _filter = null;    // active chip: '#tag' or a cfg.filters key
  let _collapsed = new Set(_loadCollapsed());

  function _loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(`fl-collapsed-${cfg.key}`)) || []; } catch { return []; }
  }
  function _saveCollapsed() {
    try { localStorage.setItem(`fl-collapsed-${cfg.key}`, JSON.stringify([..._collapsed])); } catch { /* ignore */ }
  }

  const $btn = () => document.getElementById(cfg.buttonId);
  const _filePath = () => _flJoin(_folder, cfg.fileName);
  const _isShown = () => !!_view && !_view.classList.contains('hidden');
  const _isOwnFile = (p) => !!_folder && !!p && p === _filePath();
  const Noun = cfg.noun[0].toUpperCase() + cfg.noun.slice(1);

  /* ── Load / save ───────────────────────────────────────────────── */

  async function _save() {
    if (!_folder) return;
    clearTimeout(_saveTimer);
    _saveTimer = null;
    const isNew = !_exists;
    const lines = [];
    for (const e of _entries) {
      if (!e.item) { lines.push(e.raw); continue; }
      // Untouched items keep their original line (spacing, `*` bullets, …)
      lines.push(e.line != null && _snap(e.item) === e.snap ? e.line : cfg.serialise(e.item));
      lines.push(...e.cont);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const content = lines.join('\n') + '\n';
    const res = await window.electronAPI?.writeFile(_filePath(), content);
    if (!res?.ok) { StatusBar.showToast(res?.error || `Could not save ${cfg.fileName}`); return; }
    _exists = true;
    if (isNew) FileTreeManager.refresh(); // show the newly created file in the explorer
  }

  /** Write any edit still waiting on the typing debounce. */
  async function _flush() {
    if (_saveTimer) await _save();
  }

  async function loadFolder(folderPath) {
    await _flush();
    // setActiveFolder can fire twice in quick succession (e.g. at startup);
    // build into locals and let only the latest load win.
    const seq = ++_loadSeq;
    const entries = [];
    let res = null;
    if (folderPath) {
      res = await window.electronAPI?.readFile(_flJoin(folderPath, cfg.fileName));
      if (seq !== _loadSeq) return;
      let last = null; // the item entry indented lines attach to
      for (const line of (res?.content ?? '').split(/\r?\n/)) {
        if (last && /^\s+\S/.test(line)) { last.cont.push(line); continue; }
        const it = cfg.parse(line);
        if (it) {
          last = { item: it, line, snap: _snap(it), cont: [] };
          entries.push(last);
        } else {
          last = null;
          entries.push({ raw: line });
        }
      }
      while (entries.length && !entries[entries.length - 1].item && !entries[entries.length - 1].raw.trim()) entries.pop();
    }
    // Keep the panel on the same item if it's still there after the reload
    const sel = _selected && _entryOf(_selected);
    _folder = folderPath || null;
    _exists = res != null;
    _entries = entries;
    _items = entries.filter(e => e.item).map(e => e.item);
    if (sel) {
      const same = entries.find(e => e.item && e.line === sel.line && e.line != null)
        || entries.find(e => e.item && e.item.text === sel.item.text);
      _selected = same?.item ?? null;
    }
    _renderButton();
    if (_isShown()) { if (_folder) _renderView(); else close(); }
  }

  /** Add an item from outside the view (e.g. an idea promoted to a task). */
  async function addItem(item, cont = []) {
    if (!_folder) return;
    await loadFolder(_folder); // don't clobber edits made since the last load
    _push(item, cont);
    _changed();
  }

  const _snap = (item) => JSON.stringify(item);
  const _entryOf = (item) => _entries.find(e => e.item === item);

  function _push(item, cont = []) {
    _items.push(item);
    _entries.push({ item, line: null, snap: null, cont: [...cont] });
  }

  /** Lines not shown in the view, for its note. Headings are deliberate structure, so skip them. */
  const _unshownCount = () =>
    _entries.filter(e => !e.item && e.raw.trim() && !/^\s*#{1,6}\s/.test(e.raw)).length;

  // Indented checkbox lines under an item are its subtasks; other indented lines its notes
  const _SUB_RE = /^\s+[-*]\s+\[( |x|X)\]\s+(.*)$/;
  const _isSub = (l) => !!cfg.hasSubtasks && _SUB_RE.test(l);

  function _subsOf(item) {
    return (_entryOf(item)?.cont ?? []).filter(_isSub).map(l => {
      const m = l.match(_SUB_RE);
      return { done: m[1] !== ' ', text: m[2].trim() };
    });
  }

  function _setSubs(item, subs) {
    const e = _entryOf(item);
    if (!e) return;
    e.cont = [...e.cont.filter(l => !_isSub(l)),
      ...subs.filter(x => x.text.trim()).map(x => `    - [${x.done ? 'x' : ' '}] ${x.text.trim()}`)];
  }

  /** An item's notes as editable text: its indented lines with the shared indent removed. */
  function _notesOf(item) {
    const lines = (_entryOf(item)?.cont ?? []).filter(l => !_isSub(l));
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
  }

  function _setNotes(item, text) {
    const e = _entryOf(item);
    if (!e) return;
    // Blank lines would end the item in the file, so they're dropped; subtasks stay after the notes
    e.cont = [...text.split('\n').filter(l => l.trim()).map(l => '    ' + l.replace(/\s+$/, '')),
      ...e.cont.filter(_isSub)];
  }

  /* ── Rendering ─────────────────────────────────────────────────── */

  function _renderButton() {
    const btn = $btn();
    if (!btn) return;
    btn.classList.toggle('hidden', !_folder);
    const { count, alert } = cfg.badge(_items);
    const badge = btn.querySelector('.tasks-pill__count');
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    badge.classList.toggle('tasks-pill__count--overdue', !!alert);
    btn.title = count ? `${count} ${cfg.noun}${count > 1 ? 's' : ''}` : cfg.title;
  }

  const _api = (item) => ({
    changed: _changed,
    remove: () => _remove(item),
    cont: () => _entryOf(item)?.cont ?? [],
  });

  function _setDone(item, done) {
    item.done = done;
    item.completed = done ? _flToday() : null;
    _changed();
    if (done) {
      StatusBar.showToast(`${Noun} completed`, {
        action: { label: 'Undo', onClick: () => _setDone(item, false) },
      });
    }
  }

  function _rowEl(item) {
    const li = document.createElement('li');
    li.className = 'task-row' + (item.done ? ' task-row--done' : '') + (item === _selected ? ' task-row--selected' : '');
    li.tabIndex = 0;
    li.title = 'Open details';
    li._flItem = item;

    if (cfg.hasDone) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.title = item.done ? 'Mark as open' : 'Mark complete';
      cb.addEventListener('change', () => _setDone(item, cb.checked));
      li.append(cb);
    } else if (cfg.leadIconHTML) {
      const icon = _flEl('span', 'task-row__icon');
      icon.innerHTML = cfg.leadIconHTML;
      li.append(icon);
    }

    li.append(_flEl('span', 'task-row__text', item.text));

    if (_notesOf(item).trim()) {
      const n = _flEl('span', 'task-row__notes');
      n.title = _notesOf(item);
      n.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 2.5h10v11H3z M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      li.append(n);
    }

    const subs = _subsOf(item);
    if (subs.length) {
      const n = subs.filter(x => x.done).length;
      const c = _flEl('span', 'task-row__subs' + (n === subs.length ? ' task-row__subs--all' : ''), `${n}/${subs.length}`);
      c.title = subs.map(x => `${x.done ? '☑' : '☐'} ${x.text}`).join('\n');
      li.append(c);
    }

    li.append(...cfg.rowParts(item, _api(item)));

    const del = _flEl('button', 'task-row__del', '×');
    del.type = 'button';
    del.title = `Delete ${cfg.noun}`;
    del.addEventListener('click', () => _remove(item));
    li.append(del);

    // Click anywhere else on the row opens the details panel
    li.addEventListener('click', (e) => {
      if (e.target.closest('input, button, [data-fl-own-click]')) return;
      _select(item);
    });
    li.addEventListener('keydown', (e) => {
      if (e.target !== li) return;
      if (e.key === 'Enter') { e.preventDefault(); _select(item); }
    });
    return li;
  }

  /** Delete with an Undo toast instead of a confirm dialog. */
  function _remove(item) {
    const entry = _entryOf(item);
    const at = _entries.indexOf(entry);
    _items.splice(_items.indexOf(item), 1);
    _entries.splice(at, 1); // its notes go with it
    if (_selected === item) _closePanel();
    _changed();
    StatusBar.showToast(`${Noun} deleted`, {
      action: {
        label: 'Undo',
        onClick: () => {
          _entries.splice(Math.min(at, _entries.length), 0, entry);
          _items.push(item);
          _changed();
        },
      },
    });
  }

  /** Does an item pass the search box and the active chip? */
  function _matches(item) {
    if (_filter?.startsWith('#')) { if (!item.tags?.includes(_filter.slice(1))) return false; }
    else if (_filter) { if (!cfg.filters?.find(f => f.key === _filter)?.test(item)) return false; }
    const words = _query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = [item.text, ...(item.tags || []).map(t => '#' + t), _notesOf(item),
      ..._subsOf(item).map(x => x.text)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  }

  function _renderFilters() {
    const bar = _view.querySelector('.fl-chips');
    const open = _items.filter(it => !it.done);
    const counts = new Map();
    open.forEach(it => (it.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    // Forget a chip whose tag no longer exists
    if (_filter?.startsWith('#') && !counts.has(_filter.slice(1))) _filter = null;
    const chips = [['', `All ${open.length}`]];
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([t, n]) => chips.push([`#${t}`, `#${t} ${n}`]));
    (cfg.filters || []).forEach(f => chips.push([f.key, f.label]));
    bar.classList.toggle('hidden', chips.length < 2);
    bar.replaceChildren(...chips.map(([key, label]) => {
      const b = _flEl('button', 'fl-filter' + ((_filter || '') === key ? ' fl-filter--on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { _filter = _filter === key || !key ? null : key; _renderList(); });
      return b;
    }));
  }

  function _renderList() {
    const q = (sel) => _view.querySelector(sel);
    // Keep keyboard focus on the same item across re-renders
    const focused = document.activeElement?._flItem;
    _renderFilters();
    const filtering = !!(_filter || _query.trim());
    const open = _items.filter(it => !it.done && _matches(it)).sort(cfg.sort);
    const done = _items.filter(it => it.done && _matches(it))
      .sort((a, b) => (b.completed || '').localeCompare(a.completed || ''));

    const openList = q('.fl-open');
    openList.replaceChildren();
    if (cfg.groupOf) {
      for (const g of cfg.groups) {
        const inGroup = open.filter(it => cfg.groupOf(it) === g.key);
        if (!inGroup.length) continue;
        const shut = _collapsed.has(g.key) && !filtering;
        const head = _flEl('li', 'fl-group' + (g.alert ? ' fl-group--alert' : '') + (shut ? ' fl-group--shut' : ''));
        const btn = _flEl('button', 'fl-group__btn', `${g.label} · ${inGroup.length}`);
        btn.type = 'button';
        btn.setAttribute('aria-expanded', String(!shut));
        btn.addEventListener('click', () => {
          _collapsed.has(g.key) ? _collapsed.delete(g.key) : _collapsed.add(g.key);
          _saveCollapsed();
          _renderList();
        });
        head.append(btn);
        openList.append(head);
        if (!shut) openList.append(...inGroup.map(_rowEl));
      }
    } else {
      openList.append(...open.map(_rowEl));
    }
    if (!open.length) openList.append(_flEl('li', 'tasks-empty', filtering ? `No matching ${cfg.noun}s` : cfg.emptyText));
    const unshown = _unshownCount();
    const note = q('.fl-note');
    note.classList.toggle('hidden', !unshown);
    note.querySelector('span').textContent =
      `${unshown} line${unshown > 1 ? 's' : ''} in ${cfg.fileName} ${unshown > 1 ? "aren't" : "isn't"} ${cfg.noun}${unshown > 1 ? 's' : ''} and ${unshown > 1 ? 'are' : 'is'} not shown here ·`;

    if (cfg.hasDone) {
      q('.fl-done-list').replaceChildren(...done.map(_rowEl));
      q('.fl-done-summary').textContent = `Completed (${done.length})`;
      q('.tasks-done').classList.toggle('hidden', !done.length);
    }
    if (focused) [..._view.querySelectorAll('.task-row')].find(r => r._flItem === focused)?.focus();
  }

  function _changed() {
    _save();
    _renderButton();
    if (_view) {
      _renderList();
      // Refresh the panel, unless that would interrupt typing in one of its text boxes
      const a = document.activeElement;
      const typing = _panel.contains(a) && a.tagName === 'TEXTAREA';
      if (_selected && !typing) _renderPanel();
    }
  }

  /** For typing in the panel: update the list now, write the file after a pause. */
  function _changedSoon() {
    _renderButton();
    _renderList();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_save, 400);
  }

  /* ── Details side panel ────────────────────────────────────────── */

  function _select(item) {
    _selected = item;
    _renderList();
    _renderPanel();
    _panel.querySelector('.fl-panel__title')?.focus();
  }

  function _closePanel() {
    if (!_selected) return;
    const was = _selected;
    _flush();
    _selected = null;
    _renderPanel();
    if (_view) {
      _renderList();
      // Put focus back on the row that was open
      [..._view.querySelectorAll('.task-row')].find(r => r._flItem === was)?.focus();
    }
  }

  function _renderPanel() {
    const item = _selected;
    _view.classList.toggle('tasks-view--panel', !!item);
    _panel.classList.toggle('hidden', !item);
    if (!item) { _panel.replaceChildren(); return; }

    const top = _flEl('div', 'fl-panel__top');
    if (cfg.hasDone) {
      const done = _flEl('label', 'fl-panel__done');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.addEventListener('change', () => _setDone(item, cb.checked));
      done.append(cb, document.createTextNode(item.done ? 'Completed' : 'Mark complete'));
      top.append(done);
    } else {
      top.append(_flEl('span', 'fl-panel__kind', Noun));
    }
    const del = _flEl('button', 'fl-panel__icon');
    del.type = 'button';
    del.title = `Delete ${cfg.noun}`;
    del.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    del.addEventListener('click', () => _remove(item));
    const close = _flEl('button', 'fl-panel__icon');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    close.addEventListener('click', _closePanel);
    top.append(del, close);

    const title = _flEl('textarea', 'fl-panel__title');
    title.rows = 1;
    title.value = item.text;
    title.setAttribute('aria-label', `${Noun} text`);
    title.addEventListener('input', () => {
      _autoGrow(title);
      const v = title.value.replace(/\s+/g, ' ').trim();
      if (v) { item.text = v; _changedSoon(); }
    });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); notes.focus(); } });
    title.addEventListener('blur', () => { title.value = item.text; });

    const fields = _flEl('div', 'fl-panel__fields');
    fields.append(...(cfg.panelParts?.(item, _api(item)) ?? []));

    const subsBox = cfg.hasSubtasks ? _subtasksEl(item) : null;

    const notesLabel = _flEl('label', 'fl-panel__label', 'Notes');
    const notes = _flEl('textarea', 'fl-panel__notes');
    notes.placeholder = 'Add notes…';
    notes.value = _notesOf(item);
    notes.addEventListener('input', () => {
      _autoGrow(notes);
      _setNotes(item, notes.value);
      _changedSoon();
    });
    notesLabel.append(notes);

    const meta = [];
    if (item.created) meta.push(`Added ${_flFmtDate(item.created)}`);
    if (item.completed) meta.push(`Completed ${_flFmtDate(item.completed)}`);
    meta.push('Saves automatically');
    const foot = _flEl('div', 'fl-panel__foot', meta.join(' · '));

    _panel.replaceChildren(...[top, title, fields, subsBox, notesLabel, foot].filter(Boolean));
    requestAnimationFrame(() => { _autoGrow(title); _autoGrow(notes); });
  }

  /** Checklist editor for an item's subtasks. */
  function _subtasksEl(item) {
    const subs = _subsOf(item);
    const box = _flEl('div', 'fl-panel__label');
    const done = subs.filter(x => x.done).length;
    box.append(_flEl('span', null, subs.length ? `Subtasks · ${done}/${subs.length}` : 'Subtasks'));
    if (subs.length) {
      const bar = _flEl('div', 'fl-subs__bar');
      const fill = _flEl('div', 'fl-subs__fill');
      fill.style.width = `${Math.round((done / subs.length) * 100)}%`;
      bar.append(fill);
      box.append(bar);
    }
    const list = _flEl('div', 'fl-subs');
    subs.forEach((sub, i) => {
      const row = _flEl('div', 'fl-sub' + (sub.done ? ' fl-sub--done' : ''));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sub.done;
      cb.addEventListener('change', () => { subs[i].done = cb.checked; _setSubs(item, subs); _changed(); });
      const text = document.createElement('input');
      text.className = 'fl-sub__text';
      text.value = sub.text;
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); text.value = sub.text; text.blur(); }
      });
      text.addEventListener('change', () => {
        const v = text.value.replace(/\s+/g, ' ').trim();
        if (!v) subs.splice(i, 1); else subs[i].text = v;
        _setSubs(item, subs);
        _changed();
      });
      const rm = _flEl('button', 'fl-sub__x', '×');
      rm.type = 'button';
      rm.title = 'Remove subtask';
      rm.addEventListener('click', () => { subs.splice(i, 1); _setSubs(item, subs); _changed(); });
      row.append(cb, text, rm);
      list.append(row);
    });
    const add = document.createElement('input');
    add.className = 'fl-sub__new';
    add.placeholder = '+ Add subtask';
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = add.value.replace(/\s+/g, ' ').trim();
      if (!v) return;
      subs.push({ done: false, text: v });
      _setSubs(item, subs);
      _changed();
      _panelFocus('.fl-sub__new'); // ready for the next one
    });
    list.append(add);
    box.append(list);
    return box;
  }

  /* ── View (overlays the editor area) ───────────────────────────── */

  function _buildView() {
    _view = document.createElement('div');
    _view.className = 'tasks-view hidden';
    _view.setAttribute('role', 'region');
    _view.setAttribute('aria-label', cfg.title);
    _view.innerHTML = `
      <div class="tasks-view__inner">
        <div class="tasks-view__header">
          <h1 class="tasks-view__title"></h1>
          <button class="tasks-view__link fl-raw" type="button"
                  title="Open ${cfg.fileName} in the editor">Edit raw</button>
          <button class="settings-close-btn fl-close" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="fl-layout">
          <div class="fl-main">
            <form class="tasks-add">
              <textarea class="tasks-add__input" rows="1" autocomplete="off"
                        placeholder="${cfg.addPlaceholder || `Add ${/^[aeiou]/i.test(cfg.noun) ? 'an' : 'a'} ${cfg.noun}… (Enter)`}"></textarea>
              <button class="btn btn-primary btn-sm" type="submit">Add</button>
            </form>
            <div class="fl-preview hidden"></div>
            <div class="fl-filterbar">
              <div class="fl-chips hidden"></div>
              <input class="fl-search" type="search" placeholder="Search  ( / )" aria-label="Search ${cfg.noun}s"/>
            </div>
            <div class="fl-note hidden"><span></span>
              <button class="tasks-view__link fl-raw" type="button">Edit raw</button></div>
            <ul class="tasks-list fl-open"></ul>
            ${cfg.hasDone ? `
            <details class="tasks-done">
              <summary class="fl-done-summary">Completed (0)</summary>
              <ul class="tasks-list fl-done-list"></ul>
            </details>` : ''}
            <div class="fl-keys">
              <span><kbd>N</kbd> new</span><span><kbd>/</kbd> search</span><span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>Enter</kbd> open</span>${cfg.hasDone ? '<span><kbd>Space</kbd> complete</span>' : ''}<span><kbd>Del</kbd> delete</span><span><kbd>Esc</kbd> close</span>
            </div>
          </div>
          <aside class="fl-panel hidden" aria-label="${cfg.noun} details"></aside>
        </div>
      </div>`;
    document.querySelector('.main-content').append(_view);
    _panel = _view.querySelector('.fl-panel');

    const form = _view.querySelector('form');
    const input = form.querySelector('textarea');
    const preview = _view.querySelector('.fl-preview');
    const updatePreview = () => {
      const el = cfg.addPreview?.(input.value);
      preview.replaceChildren(...(el ? [el] : []));
      preview.classList.toggle('hidden', !el);
    };
    const search = _view.querySelector('.fl-search');
    search.addEventListener('input', () => { _query = search.value; _renderList(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; _query = ''; _renderList(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); _view.querySelector('.task-row')?.focus(); }
    });
    _view.querySelector('.fl-close').addEventListener('click', close);
    _view.querySelectorAll('.fl-raw').forEach(b => b.addEventListener('click', _openRaw));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const item = cfg.newItem(text);
      if (!item.text) return;
      _push(item);
      input.value = '';
      _autoGrow(input);
      updatePreview();
      _changed();
    });
    // The text box grows with its text; Enter adds instead of starting a new line
    input.addEventListener('input', () => { _autoGrow(input); updatePreview(); });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        form.requestSubmit();
      }
    });
  }

  function _autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function _renderView() {
    _view.querySelector('.tasks-view__title').textContent =
      `${cfg.title} · ${_folder.split(/[\\/]/).filter(Boolean).pop() || _folder}`;
    _renderList();
    _renderPanel();
  }

  function _hide() {
    _flush();
    _view?.classList.add('hidden');
    $btn()?.classList.remove('tasks-pill--active');
  }

  async function open() {
    if (!_folder) return;
    FolderLists.hideAllExcept(api);
    // Unsaved raw edits to this file in the editor must hit disk before we read it
    if (_isOwnFile(currentFile?.path)) await SaveManager.silentSave();
    await loadFolder(_folder); // pick up edits made to the file in the editor
    _renderView();
    _view.classList.remove('hidden');
    $btn()?.classList.add('tasks-pill--active');
    WelcomeScreen.hideWelcomeScreen();
    _view.querySelector('.tasks-add__input').focus();
  }

  function close() {
    _hide();
    // If this file itself is the document underneath, its editor copy is stale — reload it
    if (_isOwnFile(currentFile?.path)) _openRaw();
  }

  async function _openRaw() {
    await _flush();
    _rawPath = _filePath();
    _hide();
    openFileByPath(_rawPath);
  }

  /** Called from selectFile() whenever a document is opened. */
  function onFileSelected(filePath) {
    if (_isOwnFile(filePath) && filePath !== _rawPath) { open(); return; }
    if (filePath !== _rawPath) _rawPath = null;
    if (_isShown()) _hide();
  }

  function init() {
    _buildView();
    $btn()?.addEventListener('click', () => (_isShown() ? close() : open()));
    document.addEventListener('keydown', (e) => {
      if (!_isShown() || e.target.isContentEditable || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (_selected) { _closePanel(); return; } // first Esc closes the panel
        close();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select')) return; // typing somewhere
      _onKey(e);
    });
  }

  /** List shortcuts: N new, / search, ↑↓ move, Space complete, E open, Del delete. */
  function _onKey(e) {
    const rows = [..._view.querySelectorAll('.task-row')];
    const row = e.target.closest?.('.task-row');
    const item = row?._flItem;
    const at = rows.indexOf(row);
    const go = (i) => rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    switch (e.key) {
      case 'n': case 'N':
        e.preventDefault(); _view.querySelector('.tasks-add__input').focus(); break;
      case '/':
        e.preventDefault(); _view.querySelector('.fl-search').focus(); break;
      case 'ArrowDown': case 'j':
        e.preventDefault(); go(at < 0 ? 0 : at + 1); break;
      case 'ArrowUp': case 'k':
        e.preventDefault(); go(at < 0 ? 0 : at - 1); break;
      case ' ':
        if (item && cfg.hasDone) {
          e.preventDefault();
          const next = rows[at + 1]?._flItem || rows[at - 1]?._flItem;
          _setDone(item, !item.done);
          // The row moves to the other list, so keep focus in place
          [..._view.querySelectorAll('.task-row')].find(r => r._flItem === next)?.focus();
        }
        break;
      case 'e': case 'E':
        if (item) { e.preventDefault(); _select(item); }
        break;
      case 'Delete': case 'Backspace':
        if (item) {
          e.preventDefault();
          const next = rows[at + 1]?._flItem || rows[at - 1]?._flItem;
          _remove(item);
          [..._view.querySelectorAll('.task-row')].find(r => r._flItem === next)?.focus();
        }
        break;
    }
  }

  if (typeof document === 'undefined') { /* loaded by tests */ }
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  const api = { loadFolder, open, close, onFileSelected, addItem, hide: _hide };
  return api;
}

/* ── Tasks ───────────────────────────────────────────────────────── */

const Tasks = (() => {
  const PRIO_ORDER = { high: 0, med: 1, low: 2 };
  const PRIO_LABEL = { high: 'High', med: 'Med', low: 'Low' };
  const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
  const isOverdue = (t) => !t.done && t.due && t.due < _flToday();

  function chip(cls, text, title) {
    const el = _flEl('span', cls, text);
    if (title) el.title = title;
    return el;
  }

  /** Due-date chip; click opens the date menu. */
  function dueChip(t, changed, emptyLabel) {
    const due = chip('task-row__due' + (isOverdue(t) ? ' task-row__due--overdue' : '') + (t.due ? '' : ' task-row__due--empty'),
      t.due ? _flFmtDue(t.due) : emptyLabel, t.due ? `Target ${t.due} · click to change` : 'Set a target date');
    due.dataset.flOwnClick = '';
    due.addEventListener('click', (e) => {
      e.stopPropagation();
      _flDateMenu(due, t.due, (v) => { t.due = v; changed(); });
    });
    return due;
  }

  return createFolderList({
    key: 'tasks',
    title: 'Tasks',
    noun: 'task',
    fileName: '_tasks.md',
    buttonId: 'btn-tasks',
    emptyText: 'No open tasks 🎉',
    hasDone: true,
    hasSubtasks: true,
    groups: [
      { key: 'overdue', label: 'Overdue', alert: true },
      { key: 'today', label: 'Today' },
      { key: 'week', label: 'Next 7 days' },
      { key: 'later', label: 'Later' },
      { key: 'none', label: 'No date' },
    ],
    groupOf(t) {
      if (!t.due) return 'none';
      if (t.due < _flToday()) return 'overdue';
      if (t.due === _flToday()) return 'today';
      return t.due <= _flAddDays(7) ? 'week' : 'later';
    },
    filters: [{ key: 'high', label: 'High priority', test: (t) => t.priority === 'high' }],
    addPlaceholder: 'Add a task… (try !high, tomorrow, #tag)',

    parse(line) {
      const m = line.match(TASK_RE);
      if (!m) return null;
      const s = { rest: m[2] };
      const task = {
        done:      m[1].toLowerCase() === 'x',
        priority:  (_flTake(s, /(?:^|\s)!(high|med|low)\b/i) || 'med').toLowerCase(),
        due:       _flTake(s, /📅\s*(\d{4}-\d{2}-\d{2})/),
        created:   _flTake(s, /➕\s*(\d{4}-\d{2}-\d{2})/),
        completed: _flTake(s, /✅\s*(\d{4}-\d{2}-\d{2})/),
      };
      task.tags = _flTakeTags(s);
      task.text = s.rest.replace(/\s+/g, ' ').trim();
      return task;
    },

    serialise(t) {
      let line = `- [${t.done ? 'x' : ' '}] ${t.text}`;
      if (t.tags?.length) line += ' ' + t.tags.map(x => `#${x}`).join(' ');
      line += `  !${t.priority}`;
      if (t.due)       line += `  📅 ${t.due}`;
      if (t.created)   line += `  ➕ ${t.created}`;
      if (t.completed) line += `  ✅ ${t.completed}`;
      return line;
    },

    addPreview(text) {
      if (!text.trim()) return null;
      const q = parseQuickAdd(text);
      if (!q.priority && !q.due && !q.tags.length) return null;
      const row = _flEl('div', 'fl-preview__row');
      row.append(_flEl('span', 'fl-preview__label', 'Will add:'));
      row.append(chip('fl-preview__text', q.text || '(no text)'));
      if (q.priority) row.append(chip(`task-row__prio task-row__prio--${q.priority}`, PRIO_LABEL[q.priority]));
      if (q.due) row.append(chip('task-row__due', `📅 ${_flFmtDue(q.due)}`));
      q.tags.forEach(t => row.append(chip('task-row__tag', `#${t}`)));
      return row;
    },

    newItem(text) {
      const q = parseQuickAdd(text);
      return {
        text: q.text,
        done: false,
        priority: q.priority || 'med',
        due: q.due,
        tags: q.tags,
        created: _flToday(),
        completed: null,
      };
    },

    rowParts(t, { changed }) {
      const parts = t.tags?.map(x => chip('task-row__tag', `#${x}`)) ?? [];
      const prio = chip(`task-row__prio task-row__prio--${t.priority}`, t.priority, 'Click to change priority');
      prio.dataset.flOwnClick = '';
      prio.addEventListener('click', (e) => {
        e.stopPropagation();
        t.priority = { high: 'low', med: 'high', low: 'med' }[t.priority];
        changed();
      });
      parts.push(prio);
      if (t.due || !t.done) parts.push(dueChip(t, changed, '+ date'));
      return parts;
    },

    panelParts(t, { changed }) {
      // Priority: three-way switch
      const prioLabel = _flEl('div', 'fl-panel__label', 'Priority');
      const seg = _flEl('div', 'fl-seg');
      for (const p of ['high', 'med', 'low']) {
        const b = _flEl('button', `fl-seg__btn fl-seg__btn--${p}` + (t.priority === p ? ' fl-seg__btn--on' : ''), PRIO_LABEL[p]);
        b.type = 'button';
        b.addEventListener('click', () => { t.priority = p; changed(); });
        seg.append(b);
      }
      prioLabel.append(seg);

      // Due date: quick picks plus a date field
      const dueLabel = _flEl('div', 'fl-panel__label', 'Target date');
      const dueRow = _flEl('div', 'fl-panel__row');
      const date = document.createElement('input');
      date.type = 'date';
      date.className = 'fl-panel__date';
      date.value = t.due || '';
      date.addEventListener('change', () => { t.due = date.value || null; changed(); });
      dueRow.append(date);
      const quick = (label, v) => {
        const b = _flEl('button', 'fl-chip-btn', label);
        b.type = 'button';
        b.addEventListener('click', () => { t.due = v; changed(); });
        dueRow.append(b);
      };
      quick('Today', _flToday());
      quick('Tomorrow', _flAddDays(1));
      quick('Next week', _flNextWeekday(1) === _flToday() ? _flAddDays(7) : _flNextWeekday(1));
      if (t.due) quick('Clear', null);
      if (isOverdue(t)) dueRow.append(_flEl('span', 'task-row__due task-row__due--overdue', 'Overdue'));
      dueLabel.append(dueRow);

      // Tags: removable chips plus an input
      const tagLabel = _flEl('div', 'fl-panel__label', 'Tags');
      const tagRow = _flEl('div', 'fl-panel__row');
      (t.tags || []).forEach(x => {
        const c = _flEl('span', 'task-row__tag fl-tag', `#${x}`);
        const rm = _flEl('button', 'fl-tag__x', '×');
        rm.type = 'button';
        rm.title = `Remove #${x}`;
        rm.addEventListener('click', () => { t.tags = t.tags.filter(y => y !== x); changed(); });
        c.append(rm);
        tagRow.append(c);
      });
      const tagIn = document.createElement('input');
      tagIn.className = 'fl-tag__input';
      tagIn.placeholder = '+ tag';
      const addTag = () => {
        const v = tagIn.value.trim().replace(/^#/, '').toLowerCase();
        tagIn.value = '';
        if (!/^[a-z][\w/-]*$/.test(v) || t.tags?.includes(v)) return;
        t.tags = [...(t.tags || []), v];
        changed();
        _panelFocus('.fl-tag__input');
      };
      tagIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); addTag(); }
      });
      tagIn.addEventListener('blur', () => { if (tagIn.value.trim()) addTag(); });
      tagRow.append(tagIn);
      tagLabel.append(tagRow);

      return [prioLabel, dueLabel, tagLabel];
    },

    sort(a, b) {
      const ao = isOverdue(a), bo = isOverdue(b);
      if (ao !== bo) return ao ? -1 : 1;
      if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
      const p = PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
      if (p) return p;
      return (b.created || '').localeCompare(a.created || '');
    },

    badge(items) {
      const open = items.filter(t => !t.done);
      return { count: open.length, alert: open.some(isOverdue) };
    },
  });
})();

/** Re-focus an element in the open panel after it re-renders. */
function _panelFocus(sel) {
  // The panel re-renders synchronously, so the new element is already there
  document.querySelector(`.tasks-view:not(.hidden) .fl-panel ${sel}`)?.focus();
}

/* ── Ideas ───────────────────────────────────────────────────────── */

const Ideas = (() => {
  // A plain list item that isn't a checkbox: "- Offline mode  ➕ 2026-10-20"
  const IDEA_RE = /^\s*[-*]\s+(?!\[[ xX]\]\s)(.*\S.*)$/;

  return createFolderList({
    key: 'ideas',
    title: 'Ideas',
    noun: 'idea',
    fileName: '_ideas.md',
    buttonId: 'btn-ideas',
    emptyText: 'No ideas yet 💡',
    hasDone: false,
    leadIconHTML: `
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M7.5 1.5a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6v.2h3v-.2c0-.6.4-1.2.9-1.6a4 4 0 0 0-2.4-7.2Z"
              fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M6 12.5h3M6.5 14h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>`,

    parse(line) {
      const m = line.match(IDEA_RE);
      if (!m) return null;
      const s = { rest: m[1] };
      const created = _flTake(s, /➕\s*(\d{4}-\d{2}-\d{2})/);
      return { text: s.rest.replace(/\s+/g, ' ').trim(), created, done: false };
    },

    serialise: (it) => `- ${it.text}${it.created ? `  ➕ ${it.created}` : ''}`,

    newItem: (text) => ({ text, created: _flToday(), done: false }),

    rowParts(idea, { remove, cont }) {
      const toTask = _flEl('button', 'idea-row__to-task', '→ Task');
      toTask.type = 'button';
      toTask.title = 'Move this idea to Tasks';
      toTask.addEventListener('click', async () => {
        // Hashtags in the idea become task tags
        const s = { rest: idea.text };
        const tags = _flTakeTags(s);
        await Tasks.addItem({
          text: s.rest.replace(/\s+/g, ' ').trim() || idea.text, done: false, priority: 'med',
          due: null, tags, created: _flToday(), completed: null,
        }, cont()); // notes under the idea travel with it
        remove();
        StatusBar.showToast('Moved to Tasks');
      });
      return [toTask];
    },

    sort: (a, b) => (b.created || '').localeCompare(a.created || ''),

    badge: (items) => ({ count: items.length, alert: false }),
  });
})();

/* ── Shared entry points (called from fileTreeManager / index.js) ── */

const FolderLists = {
  all: () => [Tasks, Ideas],
  loadFolder: (folderPath) => FolderLists.all().forEach(l => l.loadFolder(folderPath)),
  onFileSelected: (filePath) => FolderLists.all().forEach(l => l.onFileSelected(filePath)),
  hideAllExcept: (keep) => FolderLists.all().forEach(l => { if (l !== keep) l.hide(); }),
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Tasks, Ideas, FolderLists, createFolderList, parseQuickAdd };
}
