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

  _flPlace(menu, anchor);
}

/** Show `menu` under `anchor` (above it if there's no room), as the one open popup. */
function _flPlace(menu, anchor) {
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  _flMenu = menu;
}

/** Tags editor for the details panel: removable chips plus an input. */
function _flTagsField(t, changed) {
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
  return tagLabel;
}

/** A three-or-more-way switch: options [[value, label]], calls onPick(value). */
function _flSeg(options, current, onPick, cls = '') {
  const seg = _flEl('div', 'fl-seg');
  for (const [v, label] of options) {
    const b = _flEl('button', `fl-seg__btn ${cls}${v}` + (current === v ? ' fl-seg__btn--on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => onPick(v));
    seg.append(b);
  }
  return seg;
}

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => { if (_flMenu && !_flMenu.contains(e.target)) _flCloseMenu(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _flMenu) { e.stopPropagation(); _flCloseMenu(); }
  }, true);
}

/**
 * Notes text → indented lines under an item. A plain blank line would end the
 * item in the file, so paragraph breaks are written as indented blank lines;
 * leading/trailing blank lines and runs of blanks are trimmed.
 */
function _noteLines(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''))
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.filter((l, i) => l || lines[i - 1]).map(l => '    ' + l);
}

/**
 * @param {object} cfg
 *   key, title, fileName, noun, buttonId, emptyText
 *   parse(line) → item | null          serialise(item) → line
 *   hasDone                            a checkbox; items with .done go to a "Completed" section
 *   doneTitle                          title for that section (lists without a checkbox can still have one)
 *   leadIconHTML                       icon at the start of each row (lists without a checkbox)
 *   addPreview(text) → Element|null    shown under the text box as you type
 *   newItem(text) → item               build an item from the quick-add text
 *   rowParts(item, api) → Element[]    extra row elements (before ×)
 *   panelParts(item, api) → Element[]  extra fields in the details panel
 *                                      api: { changed(), remove(), cont() }
 *   sort(a, b)                         order of open items
 *   confirmDelete                      ask before deleting (Undo is still offered)
 *   deleteTip                          extra line in that dialog
 *   singleBody                         the item is one block of text (first line + its indented lines):
 *                                      shown whole on the row and edited in one box, no separate notes
 *   hasSubtasks                        indented "- [ ]" lines are a checklist in the panel
 *   groups / groupOf(item) → key       split open items into sections (in groups' order)
 *   filters                            extra filter chips: [{ key, label, test(item) }]
 *   badge(items) → { count, alert }    header badge
 */
function createFolderList(cfg) {
  let _folder = null;    // folder whose list is loaded (the open folder, or a sub-folder whose file you clicked)
  let _root = null;      // the folder open in the Explorer — the header button shows this one
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
        // Indented lines belong to the item above, including indented blank lines (paragraph breaks in notes)
        if (last && /^[ \t]+(\S|$)/.test(line)) { last.cont.push(line); continue; }
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

  /** The Explorer's folder changed: show its list on the header button. */
  function setRoot(folderPath) {
    _root = folderPath || null;
    return loadFolder(_root);
  }

  /** Back to the open folder's list (after looking at a sub-folder's). */
  function _backToRoot() {
    if (_root && _folder !== _root) loadFolder(_root);
  }

  /**
   * Add an item from outside the view (e.g. an idea promoted to a task),
   * into `folder`'s list (default: the one loaded now).
   */
  async function addItem(item, cont = [], folder = null) {
    const target = folder || _folder;
    if (!target) return;
    await loadFolder(target); // don't clobber edits made since the last load
    _push(item, cont);
    _changed(); // the write starts now, for this folder's file
    if (!_isShown()) _backToRoot();
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
    e.cont = [..._noteLines(text), ...e.cont.filter(_isSub)];
  }

  /** The whole text of a singleBody item: its line plus the lines under it. */
  function _fullText(item) {
    const rest = _notesOf(item).replace(/\s+$/, '');
    return rest ? `${item.text}\n${rest}` : item.text;
  }

  /** Split edited text back into the item's line and the lines under it. */
  function _setFullText(item, text) {
    const lines = text.replace(/\r/g, '').replace(/^\s*\n/, '').split('\n');
    const first = (lines.shift() || '').replace(/\s+/g, ' ').trim();
    if (!first) return false; // keep the old text rather than an empty item
    item.text = first;
    _setNotes(item, lines.join('\n'));
    return true;
  }

  const _expanded = new WeakSet(); // rows showing all their text

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
    folder: () => _folder,
    changed: _changed,
    remove: () => _remove(item, { confirmFirst: false }), // moving elsewhere, not deleting
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

    const notesText = _notesOf(item).trim();
    if (cfg.singleBody) {
      // The whole text, cut off after 3 lines with "Show more"
      const body = _flEl('div', 'task-row__body');
      const text = _flEl('div', 'task-row__text task-row__text--body' + (_expanded.has(item) ? '' : ' task-row__text--clamp'), _fullText(item));
      body.append(text);
      if (notesText) {
        const more = _flEl('button', 'task-row__more', _expanded.has(item) ? 'Show less' : 'Show more');
        more.type = 'button';
        more.addEventListener('click', () => {
          _expanded.has(item) ? _expanded.delete(item) : _expanded.add(item);
          _renderList();
        });
        body.append(more);
        // Only offer it when the text is actually cut off
        requestAnimationFrame(() => {
          if (!_expanded.has(item) && text.scrollHeight <= text.clientHeight + 1) more.remove();
        });
      }
      li.append(body);
      li.classList.add('task-row--body');
    } else {
      li.append(_flEl('span', 'task-row__text', item.text));
    }

    if (notesText && !cfg.singleBody) {
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

  /** Delete after asking (when the list wants that), with an Undo toast after. */
  async function _remove(item, { confirmFirst = true } = {}) {
    if (cfg.confirmDelete && confirmFirst) {
      const name = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
      const ok = typeof ConfirmDialog !== 'undefined'
        ? await ConfirmDialog.ask({
            title: `Delete ${cfg.noun}?`,
            message: `“${name}” will be removed from ${cfg.fileName}.`,
            note: cfg.deleteTip || '',
            okLabel: 'Delete',
            danger: true,
          })
        : confirm(`Delete ${cfg.noun} "${name}"?`);
      if (!ok) return false;
    }
    const entry = _entryOf(item);
    if (!entry) return false; // already gone (e.g. changed while the dialog was open)
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
    return true;
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

    if (cfg.hasDone || cfg.doneTitle) {
      q('.fl-done-list').replaceChildren(...done.map(_rowEl));
      q('.fl-done-summary').textContent = `${cfg.doneTitle || 'Completed'} (${done.length})`;
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
    _panel.querySelector('.fl-panel__title, .fl-panel__body')?.focus();
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

    if (cfg.singleBody) {
      // One box for the whole text instead of a title and notes
      const body = _flEl('textarea', 'fl-panel__notes fl-panel__body');
      body.setAttribute('aria-label', Noun);
      body.value = _fullText(item);
      body.addEventListener('input', () => {
        _autoGrow(body);
        if (_setFullText(item, body.value)) _changedSoon();
      });
      body.addEventListener('blur', () => { body.value = _fullText(item); });
      _panel.replaceChildren(...[top, body, fields, subsBox, foot].filter(Boolean));
      requestAnimationFrame(() => _autoGrow(body));
      return;
    }

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
                        placeholder="${cfg.addPlaceholder || `Add ${/^[aeiou]/i.test(cfg.noun) ? 'an' : 'a'} ${cfg.noun}… (Enter)`}"
                        title="Enter to add · Shift+Enter for a new line (saved as notes)"></textarea>
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
            ${cfg.hasDone || cfg.doneTitle ? `
            <details class="tasks-done">
              <summary class="fl-done-summary">${cfg.doneTitle || 'Completed'} (0)</summary>
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
    // Text boxes re-fit when the panel's width changes (window resize, or a
    // scrollbar appearing when there are many subtasks) — wrapping changes.
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      new ResizeObserver(() => {
        const w = _panel.clientWidth;
        if (w === lastW) return;
        lastW = w;
        _panel.querySelectorAll('textarea').forEach(_autoGrow);
      }).observe(_panel);
    }

    const form = _view.querySelector('form');
    const input = form.querySelector('textarea');
    const preview = _view.querySelector('.fl-preview');
    const updatePreview = () => {
      const el = cfg.addPreview?.(input.value.split('\n')[0]);
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
      // First line is the item; any lines after it (Shift+Enter) become its notes
      const [first, ...more] = input.value.replace(/\r/g, '').trim().split('\n');
      const text = (first || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const item = cfg.newItem(text);
      if (!item.text) return;
      _push(item, _noteLines(more.join('\n')));
      input.value = '';
      _autoGrow(input);
      updatePreview();
      _changed();
    });
    // The text box grows with its text. Enter adds; Shift+Enter or Alt+Enter starts a new line.
    input.addEventListener('input', () => { _autoGrow(input); updatePreview(); });
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName === 'BUTTON') return;
      if (e.shiftKey) return; // the textarea adds the line break itself
      e.preventDefault();
      if (e.altKey) {
        input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input'));
        return;
      }
      form.requestSubmit();
    });
  }

  function _autoGrow(el) {
    if (!el.isConnected || !el.offsetParent) return; // hidden: measure later
    // Keep the panel's scroll position: 'auto' briefly shrinks the box
    const scroller = el.closest('.fl-panel');
    const keep = scroller?.scrollTop;
    el.style.height = 'auto';
    // scrollHeight leaves out the border; add it so the last line isn't cut off
    const cs = getComputedStyle(el);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = (el.scrollHeight + border) + 'px';
    if (scroller && keep != null) scroller.scrollTop = keep;
  }

  function _renderView() {
    _view.querySelector('.tasks-view__title').textContent =
      `${cfg.title} · ${_folder.split(/[\\/]/).filter(Boolean).pop() || _folder}`;
    _renderList();
    _renderPanel();
  }

  function _hide() {
    _flush();
    const wasShown = _isShown();
    _view?.classList.add('hidden');
    $btn()?.classList.remove('tasks-pill--active');
    if (wasShown) FolderLists.notifyChange();
    _backToRoot(); // the header button counts the open folder's list again
  }

  /** Show the list for `folder` (default: the folder open in the Explorer). */
  async function open(folder = null) {
    const target = folder || _root || _folder;
    if (!target) return;
    FolderLists.hideAllExcept(api);
    // Unsaved raw edits to this file in the editor must hit disk before we read it
    if (currentFile?.path && currentFile.path === _flJoin(target, cfg.fileName)) await SaveManager.silentSave();
    await loadFolder(target); // pick up edits made to the file in the editor
    _renderView();
    _view.classList.remove('hidden');
    $btn()?.classList.add('tasks-pill--active');
    FolderLists.notifyChange();
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
    // A _tasks.md / _ideas.md in any folder (not only the open one) opens its list
    const name = filePath ? filePath.split(/[\\/]/).pop() : '';
    if (name === cfg.fileName && filePath !== _rawPath) {
      open(filePath.slice(0, filePath.length - name.length).replace(/[\\/]+$/, ''));
      return;
    }
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
          _remove(item).then((removed) => {
            if (!removed) { row.isConnected && row.focus(); return; } // cancelled
            [..._view.querySelectorAll('.task-row')].find(r => r._flItem === next)?.focus();
          });
        }
        break;
    }
  }

  if (typeof document === 'undefined') { /* loaded by tests */ }
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /**
   * What the AI Assistant should work on while this list is on screen:
   * the list file's current text, plus a write() that saves an AI edit
   * and refreshes the view. null when the list isn't shown.
   */
  function aiTarget() {
    if (!_isShown() || !_folder) return null;
    const folder = _folder;
    const path = _filePath();
    const name = folder.split(/[\/]/).filter(Boolean).pop() || folder;
    return {
      path,
      fileName: cfg.fileName,
      label: `${cfg.title} · ${name}`,
      noun: cfg.noun,
      format: cfg.aiFormat || '',
      async read() {
        await _flush();
        const res = await window.electronAPI?.readFile(path);
        return res?.content ?? '';
      },
      async write(content) {
        await _flush();
        const res = await window.electronAPI?.writeFile(path, content.endsWith('\n') ? content : content + '\n');
        if (!res?.ok) return res || { ok: false, error: `Could not save ${cfg.fileName}` };
        if (!_exists) FileTreeManager.refresh();
        await loadFolder(folder);
        if (_isShown() && _folder === folder) _renderView();
        return { ok: true };
      },
    };
  }

  const api = { loadFolder, setRoot, open, close, onFileSelected, addItem, hide: _hide, aiTarget };
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
    aiFormat: [
      'Each task is one line: "- [ ] Task text #tag  !med  📅 2026-10-31  ➕ 2026-10-20".',
      '"- [x]" marks a done task; a done task also gets "  ✅ YYYY-MM-DD" (the day it was completed).',
      'Priority is !high, !med or !low. 📅 is the due date (optional). ➕ is the created date; give new tasks the current date.',
      'Subtasks are indented lines under a task: "    - [ ] Subtask text". Other indented lines are notes for that task.',
    ].join('\n'),
    buttonId: 'btn-tasks',
    emptyText: 'No open tasks 🎉',
    hasDone: true,
    hasSubtasks: true,
    confirmDelete: true,
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

      const tagLabel = _flTagsField(t, changed);

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
  // A plain list item that isn't a checkbox:
  //   "- Offline mode #app  ⭐  🔖exploring  ➕ 2026-10-20"
  const IDEA_RE = /^\s*[-*]\s+(?!\[[ xX]\]\s)(.*\S.*)$/;
  const STATUS = [['new', 'New'], ['exploring', 'Exploring'], ['parked', 'Parked'], ['used', 'Used']];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const isArchived = (st) => st === 'parked' || st === 'used';

  function setStatus(idea, st) {
    idea.status = st;
    idea.done = isArchived(st);
  }

  /** Popup for "→ Task": priority, target date, keep the idea. */
  function toTaskPopup(anchor, idea, { remove, cont, changed, folder }) {
    let priority = 'med', due = null, keep = true;
    const form = _flEl('div', 'fl-totask');
    form.append(_flEl('div', 'fl-totask__title', 'Create a task from this idea'));

    const prioLabel = _flEl('div', 'fl-panel__label', 'Priority');
    const renderPrio = () => prioLabel.replaceChildren(document.createTextNode('Priority'),
      _flSeg([['high', 'High'], ['med', 'Med'], ['low', 'Low']], priority, (v) => { priority = v; renderPrio(); }, 'fl-seg__btn--'));
    renderPrio();

    const dueLabel = _flEl('div', 'fl-panel__label', 'Target date');
    const nextWeek = _flNextWeekday(1) === _flToday() ? _flAddDays(7) : _flNextWeekday(1);
    const renderDue = () => dueLabel.replaceChildren(document.createTextNode('Target date'),
      _flSeg([['', 'None'], [_flToday(), 'Today'], [_flAddDays(1), 'Tomorrow'], [nextWeek, 'Next week']],
        due || '', (v) => { due = v || null; renderDue(); }));
    renderDue();

    const keepLabel = _flEl('label', 'fl-totask__keep');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = keep;
    cb.addEventListener('change', () => { keep = cb.checked; });
    keepLabel.append(cb, document.createTextNode('Keep the idea (marked Used)'));

    const go = _flEl('button', 'btn btn-primary btn-sm', 'Create task');
    go.type = 'button';
    go.addEventListener('click', async (e) => {
      e.stopPropagation();
      _flCloseMenu();
      const notes = [...cont()];
      if (idea.created) notes.push(`    From idea added ${idea.created}`);
      await Tasks.addItem({
        text: idea.text, done: false, priority, due, tags: [...(idea.tags || [])],
        created: _flToday(), completed: null,
      }, notes, folder()); // into the same folder as the idea
      if (keep) { setStatus(idea, 'used'); changed(); StatusBar.showToast('Task created · idea marked Used'); }
      else { remove(); StatusBar.showToast('Moved to Tasks'); }
    });

    form.append(prioLabel, dueLabel, keepLabel, go);
    const menu = _flEl('div', 'fl-menu fl-menu--form');
    menu.append(form);
    menu.addEventListener('click', (e) => e.stopPropagation());
    _flPlace(menu, anchor);
  }

  return createFolderList({
    key: 'ideas',
    title: 'Ideas',
    noun: 'idea',
    fileName: '_ideas.md',
    aiFormat: [
      'Each idea is one line: "- Idea text #tag  ⭐  🔖exploring  ➕ 2026-10-20".',
      '⭐ means starred (optional). 🔖 is the status: exploring, parked or used; leave it out for a new idea.',
      '➕ is the created date; give new ideas the current date. Never use "- [ ]" checkboxes for ideas.',
      'Indented lines under an idea are its notes.',
    ].join('\n'),
    buttonId: 'btn-ideas',
    emptyText: 'No ideas yet 💡',
    hasDone: false,
    doneTitle: 'Used and parked',
    singleBody: true,
    confirmDelete: true,
    deleteTip: 'To keep it out of the way instead, set its status to Parked.',
    addPlaceholder: 'Write an idea… (Shift+Enter for a new line)',
    leadIconHTML: `
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M7.5 1.5a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6v.2h3v-.2c0-.6.4-1.2.9-1.6a4 4 0 0 0-2.4-7.2Z"
              fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M6 12.5h3M6.5 14h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>`,
    filters: [
      { key: 'starred', label: '★ Starred', test: (i) => i.star },
      { key: 'exploring', label: 'Exploring', test: (i) => i.status === 'exploring' },
    ],

    parse(line) {
      const m = line.match(IDEA_RE);
      if (!m) return null;
      const s = { rest: m[1] };
      const created = _flTake(s, /➕\s*(\d{4}-\d{2}-\d{2})/);
      const status = (_flTake(s, /🔖\s*(new|exploring|parked|used)\b/i) || 'new').toLowerCase();
      const star = !!_flTake(s, /(⭐)/);
      const tags = _flTakeTags(s);
      const idea = { text: s.rest.replace(/\s+/g, ' ').trim(), tags, star, status, created, done: false };
      idea.done = isArchived(status);
      return idea.text ? idea : null;
    },

    serialise(it) {
      let line = `- ${it.text}`;
      if (it.tags?.length) line += ' ' + it.tags.map(x => `#${x}`).join(' ');
      if (it.star) line += '  ⭐';
      if (it.status && it.status !== 'new') line += `  🔖${it.status}`;
      if (it.created) line += `  ➕ ${it.created}`;
      return line;
    },

    addPreview(text) {
      const s = { rest: ` ${text} ` };
      const tags = _flTakeTags(s);
      if (!tags.length) return null;
      const row = _flEl('div', 'fl-preview__row');
      row.append(_flEl('span', 'fl-preview__label', 'Will add:'),
        _flEl('span', 'fl-preview__text', s.rest.replace(/\s+/g, ' ').trim() || '(no text)'));
      tags.forEach(t => row.append(_flEl('span', 'task-row__tag', `#${t}`)));
      return row;
    },

    newItem(text) {
      const s = { rest: ` ${text} ` };
      const tags = _flTakeTags(s);
      return { text: s.rest.replace(/\s+/g, ' ').trim(), tags, star: false, status: 'new', created: _flToday(), done: false };
    },

    rowParts(idea, api) {
      const parts = (idea.tags || []).map(x => _flEl('span', 'task-row__tag', `#${x}`));
      if (idea.status !== 'new') {
        parts.push(_flEl('span', `idea-row__status idea-row__status--${idea.status}`, STATUS_LABEL[idea.status]));
      }
      const star = _flEl('button', 'idea-row__star' + (idea.star ? ' idea-row__star--on' : ''), idea.star ? '★' : '☆');
      star.type = 'button';
      star.title = idea.star ? 'Unstar' : 'Star';
      star.addEventListener('click', () => { idea.star = !idea.star; api.changed(); });
      parts.push(star);
      if (idea.status !== 'used') {
        const toTask = _flEl('button', 'idea-row__to-task', '→ Task');
        toTask.type = 'button';
        toTask.title = 'Create a task from this idea';
        toTask.addEventListener('click', (e) => { e.stopPropagation(); toTaskPopup(toTask, idea, api); });
        parts.push(toTask);
      }
      return parts;
    },

    panelParts(idea, { changed }) {
      const starLabel = _flEl('label', 'fl-totask__keep');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!idea.star;
      cb.addEventListener('change', () => { idea.star = cb.checked; changed(); });
      starLabel.append(cb, document.createTextNode('★ Starred'));

      const stLabel = _flEl('div', 'fl-panel__label', 'Status');
      stLabel.append(_flSeg(STATUS, idea.status, (v) => { setStatus(idea, v); changed(); }));

      return [starLabel, stLabel, _flTagsField(idea, changed)];
    },

    // Starred first, then exploring, then newest
    sort: (a, b) => (b.star - a.star)
      || ((b.status === 'exploring') - (a.status === 'exploring'))
      || (b.created || '').localeCompare(a.created || ''),

    badge: (items) => ({ count: items.filter(i => !i.done).length, alert: false }),
  });
})();

/* ── Shared entry points (called from fileTreeManager / index.js) ── */

const FolderLists = {
  all: () => [Tasks, Ideas],
  loadFolder: (folderPath) => FolderLists.all().forEach(l => l.setRoot(folderPath)),
  onFileSelected: (filePath) => FolderLists.all().forEach(l => l.onFileSelected(filePath)),
  hideAllExcept: (keep) => FolderLists.all().forEach(l => { if (l !== keep) l.hide(); }),
  /** The Tasks/Ideas list on screen, as an AI Assistant target (or null). */
  aiTarget: () => FolderLists.all().map(l => l.aiTarget()).find(Boolean) || null,
  /** Tell the AI Assistant which document it's working on now. */
  notifyChange: () => {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('folderlist-change'));
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Tasks, Ideas, FolderLists, createFolderList, parseQuickAdd, _noteLines };
}
