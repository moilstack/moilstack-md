/**
 * folderLists.js — per-folder Tasks and Ideas, each stored as a Markdown
 * file in the root of the active folder and shown in a full-width view
 * that overlays the editor area.
 *
 *   _tasks.md   - [ ] Draft API spec  !high  📅 2026-10-31  ➕ 2026-10-20
 *               - [x] Set up repo  !low  ➕ 2026-10-15  ✅ 2026-10-19
 *   _ideas.md   - Offline mode for the app  ➕ 2026-10-20
 *
 * Hand edits are respected: lines the app doesn't recognise stay exactly
 * where they are, indented lines under an item belong to that item (shown
 * under it, written back verbatim), and an unchanged item keeps its
 * original line. Only items changed in the view are re-written. The `_`
 * prefix keeps these apart from any tasks.md / ideas.md the user wrote.
 *
 * createFolderList() holds everything the two share (load/save, the view,
 * quick add, edit/delete, header button); each config adds its own fields.
 */

function _flToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _flFmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

/**
 * @param {object} cfg
 *   key, title, fileName, noun, buttonId, emptyText
 *   parse(line) → item | null          serialise(item) → line
 *   hasDone                            items with .done go to a "Completed" section
 *   leadIconHTML                       icon at the start of each row (lists without a checkbox)
 *   addControlsHTML                    extra controls after the text box
 *   newItem(text, viewEl) → item       build an item from the quick-add row
 *   resetAdd(viewEl)                   clear the extra controls after adding
 *   rowParts(item, api) → Element[]    extra row elements (before ×);
 *                                      api: { changed(), remove(), cont() }
 *   sort(a, b)                         order of open items
 *   badge(items) → { count, alert }    header badge
 */
function createFolderList(cfg) {
  let _folder = null;
  let _items = [];
  // The file, line by line, in order:
  //   { raw }                         a line the app doesn't recognise — kept as-is
  //   { item, line, snap, cont }      an item; `line` is its original text, `snap` its
  //                                   parsed fields (to spot edits), `cont` the indented
  //                                   lines under it
  let _entries = [];
  let _exists = false;   // whether the file is on disk yet
  let _loadSeq = 0;
  let _rawPath = null;   // file opened via "Edit raw" — show it in the editor, not the view
  let _view = null;

  const $btn = () => document.getElementById(cfg.buttonId);
  const _filePath = () => _flJoin(_folder, cfg.fileName);
  const _isShown = () => !!_view && !_view.classList.contains('hidden');
  const _isOwnFile = (p) => !!_folder && !!p && p === _filePath();

  /* ── Load / save ───────────────────────────────────────────────── */

  async function _save() {
    if (!_folder) return;
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

  async function loadFolder(folderPath) {
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
    _folder = folderPath || null;
    _exists = res != null;
    _entries = entries;
    _items = entries.filter(e => e.item).map(e => e.item);
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

  function _rowEl(item) {
    const li = document.createElement('li');
    li.className = 'task-row' + (item.done ? ' task-row--done' : '');

    if (cfg.hasDone) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.addEventListener('change', () => {
        item.done = cb.checked;
        item.completed = item.done ? _flToday() : null;
        _changed();
      });
      li.append(cb);
    } else if (cfg.leadIconHTML) {
      const icon = document.createElement('span');
      icon.className = 'task-row__icon';
      icon.innerHTML = cfg.leadIconHTML;
      li.append(icon);
    }

    const text = document.createElement('span');
    text.className = 'task-row__text';
    text.textContent = item.text;
    text.title = 'Click to edit';
    text.addEventListener('click', () => {
      if (text.isContentEditable) return;
      text.contentEditable = 'true';
      text.focus();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); text.textContent = item.text; text.blur(); }
    });
    text.addEventListener('blur', () => {
      text.contentEditable = 'false';
      const v = text.textContent.replace(/\s+/g, ' ').trim();
      if (v && v !== item.text) { item.text = v; _changed(); } else text.textContent = item.text;
    });
    const sub = _entryOf(item)?.cont.filter(l => l.trim()) ?? [];
    if (sub.length) {
      const body = document.createElement('div');
      body.className = 'task-row__body';
      const subEl = document.createElement('div');
      subEl.className = 'task-row__sub';
      subEl.title = `Indented under this ${cfg.noun} in ${cfg.fileName} — edit with Edit raw`;
      subEl.textContent = sub.map(l => l.trim().replace(/^[-*+]\s+/, '• ')).join('\n');
      body.append(text, subEl);
      li.append(body);
    } else {
      li.append(text);
    }

    if (item.created) {
      const created = document.createElement('span');
      created.className = 'task-row__created';
      created.textContent = `Added ${_flFmtDate(item.created)}`;
      li.append(created);
    }

    li.append(...cfg.rowParts(item, {
      changed: _changed,
      remove: () => _remove(item),
      cont: () => _entryOf(item)?.cont ?? [],
    }));

    const del = document.createElement('button');
    del.className = 'task-row__del';
    del.type = 'button';
    del.title = `Delete ${cfg.noun}`;
    del.textContent = '×';
    del.addEventListener('click', () => {
      const name = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
      if (!confirm(`Delete ${cfg.noun} "${name}"?`)) return;
      _remove(item);
    });
    li.append(del);
    return li;
  }

  function _remove(item) {
    _items.splice(_items.indexOf(item), 1);
    _entries.splice(_entries.indexOf(_entryOf(item)), 1); // its indented lines go with it
    _changed();
  }

  function _renderList() {
    const q = (sel) => _view.querySelector(sel);
    const open = _items.filter(it => !it.done).sort(cfg.sort);
    const done = _items.filter(it => it.done)
      .sort((a, b) => (b.completed || '').localeCompare(a.completed || ''));

    const openList = q('.fl-open');
    openList.replaceChildren(...open.map(_rowEl));
    if (!open.length) {
      const empty = document.createElement('li');
      empty.className = 'tasks-empty';
      empty.textContent = cfg.emptyText;
      openList.append(empty);
    }
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
  }

  function _changed() {
    _save();
    _renderButton();
    if (_view) _renderList();
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
        <form class="tasks-add">
          <textarea class="tasks-add__input" rows="1" autocomplete="off"
                    placeholder="Add ${/^[aeiou]/i.test(cfg.noun) ? 'an' : 'a'} ${cfg.noun}… (Enter)"></textarea>
          ${cfg.addControlsHTML || ''}
          <button class="btn btn-primary btn-sm" type="submit">Add</button>
        </form>
        <div class="fl-note hidden"><span></span>
          <button class="tasks-view__link fl-raw" type="button">Edit raw</button></div>
        <ul class="tasks-list fl-open"></ul>
        ${cfg.hasDone ? `
        <details class="tasks-done">
          <summary class="fl-done-summary">Completed (0)</summary>
          <ul class="tasks-list fl-done-list"></ul>
        </details>` : ''}
      </div>`;
    document.querySelector('.main-content').append(_view);

    const form = _view.querySelector('form');
    const input = form.querySelector('textarea');
    _view.querySelector('.fl-close').addEventListener('click', close);
    _view.querySelectorAll('.fl-raw').forEach(b => b.addEventListener('click', _openRaw));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      _push(cfg.newItem(text, _view));
      input.value = '';
      _autoGrow(input);
      cfg.resetAdd?.(_view);
      _changed();
    });
    // The text box grows with its text; Enter adds instead of starting a new line
    input.addEventListener('input', () => _autoGrow(input));
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
  }

  function _hide() {
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

  function _openRaw() {
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
      if (e.key === 'Escape' && _isShown() && !e.target.isContentEditable) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  const api = { loadFolder, open, close, onFileSelected, addItem, hide: _hide };
  return api;
}

/* ── Tasks ───────────────────────────────────────────────────────── */

const Tasks = (() => {
  const PRIO_ORDER = { high: 0, med: 1, low: 2 };
  const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
  const isOverdue = (t) => !t.done && t.due && t.due < _flToday();

  return createFolderList({
    key: 'tasks',
    title: 'Tasks',
    noun: 'task',
    fileName: '_tasks.md',
    buttonId: 'btn-tasks',
    emptyText: 'No open tasks 🎉',
    hasDone: true,

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
      task.text = s.rest.replace(/\s+/g, ' ').trim();
      return task;
    },

    serialise(t) {
      let line = `- [${t.done ? 'x' : ' '}] ${t.text}  !${t.priority}`;
      if (t.due)       line += `  📅 ${t.due}`;
      if (t.created)   line += `  ➕ ${t.created}`;
      if (t.completed) line += `  ✅ ${t.completed}`;
      return line;
    },

    addControlsHTML: `
      <select class="tasks-add__priority" title="Priority">
        <option value="high">High</option>
        <option value="med" selected>Med</option>
        <option value="low">Low</option>
      </select>
      <input class="tasks-add__due" type="date" title="Target date (optional)"/>`,

    newItem: (text, view) => ({
      text,
      done: false,
      priority: view.querySelector('.tasks-add__priority').value,
      due: view.querySelector('.tasks-add__due').value || null,
      created: _flToday(),
      completed: null,
    }),

    resetAdd: (view) => { view.querySelector('.tasks-add__due').value = ''; },

    rowParts(t, { changed }) {
      const prio = document.createElement('span');
      prio.className = `task-row__prio task-row__prio--${t.priority}`;
      prio.textContent = t.priority;
      prio.title = 'Click to change priority';
      prio.addEventListener('click', () => {
        t.priority = { high: 'low', med: 'high', low: 'med' }[t.priority];
        changed();
      });
      const parts = [prio];
      if (t.due) {
        const due = document.createElement('span');
        due.className = 'task-row__due' + (isOverdue(t) ? ' task-row__due--overdue' : '');
        due.textContent = _flFmtDate(t.due);
        due.title = `Target ${t.due}`;
        parts.push(due);
      }
      return parts;
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
      const toTask = document.createElement('button');
      toTask.className = 'idea-row__to-task';
      toTask.type = 'button';
      toTask.textContent = '→ Task';
      toTask.title = 'Move this idea to Tasks';
      toTask.addEventListener('click', async () => {
        await Tasks.addItem({
          text: idea.text, done: false, priority: 'med',
          due: null, created: _flToday(), completed: null,
        }, cont()); // indented notes under the idea travel with it
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
  module.exports = { Tasks, Ideas, FolderLists, createFolderList };
}
