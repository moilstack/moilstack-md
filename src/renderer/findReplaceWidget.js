/**
 * findReplaceWidget.js — Find & Replace widget: state, logic, and event wiring.
 *
 * EditorCore and mdEditor are resolved lazily at call time (loaded after this module).
 */

const FindReplaceWidget = (() => {

  /* ── State ────────────────────────────────────────────────────────── */

  let _widgetOpen    = false;
  let _replaceMode   = false;
  let _matches       = [];
  let _activeIndex   = -1;

  /* ── Public state accessor (passed to EditorCore.init as getFindState) */
  function getFindState() {
    return { widgetOpen: _widgetOpen, matches: _matches, activeIndex: _activeIndex };
  }

  /** Called by EditorCore on every input event; re-syncs matches without scrolling. */
  function resyncIfOpen() {
    if (_widgetOpen) _resyncFindMatches();
  }

  /* ── Scroll helper ────────────────────────────────────────────────── */

  function scrollEditorToChar(charPos) {
    const editor = document.getElementById('mdEditor');
    if (!editor) return;
    EditorCore.syncRuler();
    if (!EditorCore.getRulerCtx() || EditorCore.getRulerLineH() === 0) return;

    const lines = editor.value.slice(0, charPos).split('\n');
    let visualRowsBefore = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      visualRowsBefore += EditorCore.visualRowsForLine(lines[i]);
    }

    const padTop    = 20;
    const targetTop = padTop + visualRowsBefore * EditorCore.getRulerLineH();
    editor.scrollTop = Math.max(0, targetTop - editor.clientHeight / 2);
  }

  /* ── Match computation ────────────────────────────────────────────── */

  function _resyncFindMatches() {
    const editor        = document.getElementById('mdEditor');
    const findInput     = document.getElementById('findInput');
    const query         = findInput?.value ?? '';
    const caseSensitive = document.getElementById('findCaseSensitive')?.classList.contains('active') ?? false;
    const wholeWord     = document.getElementById('findWholeWord')?.classList.contains('active')     ?? false;
    const text          = editor ? editor.value : '';

    _matches = EditorCore.computeMatches(text, query, caseSensitive, wholeWord);

    if (_matches.length === 0) {
      _activeIndex = -1;
    } else {
      _activeIndex = Math.min(Math.max(0, _activeIndex), _matches.length - 1);
    }

    const countEl = document.getElementById('findCount');
    if (countEl) {
      if (!query)               countEl.textContent = '';
      else if (!_matches.length) countEl.textContent = 'No results';
      else                       countEl.textContent = `${_activeIndex + 1} of ${_matches.length}`;
    }

    findInput?.classList.toggle('find-input--no-match', !!query && _matches.length === 0);
  }

  /* ── Search ───────────────────────────────────────────────────────── */

  function runSearch() {
    const editor        = document.getElementById('mdEditor');
    const findInput     = document.getElementById('findInput');
    const countEl       = document.getElementById('findCount');
    const query         = findInput?.value ?? '';
    const caseSensitive = document.getElementById('findCaseSensitive')?.classList.contains('active') ?? false;
    const wholeWord     = document.getElementById('findWholeWord')?.classList.contains('active')     ?? false;
    const text          = editor ? editor.value : '';

    if (!query) {
      _matches     = [];
      _activeIndex = -1;
      if (countEl) countEl.textContent = '';
      findInput?.classList.remove('find-input--no-match');
      EditorCore.updateHighlight();
      return;
    }

    _matches = EditorCore.computeMatches(text, query, caseSensitive, wholeWord);

    if (_matches.length === 0) {
      _activeIndex = -1;
      if (countEl) countEl.textContent = 'No results';
      findInput?.classList.add('find-input--no-match');
      EditorCore.updateHighlight();
      return;
    }

    findInput?.classList.remove('find-input--no-match');

    if (_activeIndex < 0 || _activeIndex >= _matches.length) _activeIndex = 0;
    if (countEl) countEl.textContent = `${_activeIndex + 1} of ${_matches.length}`;

    EditorCore.updateHighlight();

    const active = _matches[_activeIndex];
    scrollEditorToChar(active.start);
    editor?.setSelectionRange(active.start, active.end);
  }

  /* ── Navigation ───────────────────────────────────────────────────── */

  function navigateMatch(direction) {
    const editor = document.getElementById('mdEditor');
    if (_matches.length === 0) return;

    _activeIndex = (_activeIndex + direction + _matches.length) % _matches.length;

    const countEl = document.getElementById('findCount');
    if (countEl) countEl.textContent = `${_activeIndex + 1} of ${_matches.length}`;

    const active = _matches[_activeIndex];
    scrollEditorToChar(active.start);
    editor?.focus();
    editor?.setSelectionRange(active.start, active.end);
    EditorCore.updateHighlight();
  }

  /* ── Open / close ─────────────────────────────────────────────────── */

  function openFindWidget(replaceMode = false) {
    const editor     = document.getElementById('mdEditor');
    const widget     = document.getElementById('find-widget');
    const replaceRow = document.getElementById('replaceRow');
    const findInput  = document.getElementById('findInput');
    if (!widget || !findInput) return;

    _widgetOpen  = true;
    _replaceMode = replaceMode;

    widget.classList.remove('hidden');
    replaceRow?.classList.toggle('hidden', !replaceMode);

    if (editor) {
      const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (sel && sel.length <= 200 && !sel.includes('\n')) {
        findInput.value = sel;
      }
    }

    findInput.focus();
    findInput.select();
    runSearch();
  }

  function closeFindWidget() {
    const editor = document.getElementById('mdEditor');
    const widget = document.getElementById('find-widget');
    if (!widget) return;

    _widgetOpen  = false;
    _matches     = [];
    _activeIndex = -1;
    widget.classList.add('hidden');

    EditorCore.updateHighlight();
    editor?.focus();
  }

  /* ── Replace ──────────────────────────────────────────────────────── */

  function replaceCurrentMatch() {
    const editor = document.getElementById('mdEditor');
    if (!editor || _activeIndex < 0 || _activeIndex >= _matches.length) return;

    const replaceWith    = document.getElementById('replaceInput')?.value ?? '';
    const { start, end } = _matches[_activeIndex];

    SaveManager.markDirty();
    editor.focus();
    editor.setRangeText(replaceWith, start, end, 'end');
    EditorCore.updateStats();

    runSearch();
  }

  function replaceAllMatches() {
    const editor = document.getElementById('mdEditor');
    if (!editor || _matches.length === 0) return;

    const replaceWith = document.getElementById('replaceInput')?.value ?? '';

    let result = editor.value;
    for (let i = _matches.length - 1; i >= 0; i--) {
      const { start, end } = _matches[i];
      result = result.slice(0, start) + replaceWith + result.slice(end);
    }

    EditorCore.setEditorContentUndoable(result);
    SaveManager.markDirty();
    if (currentFile.path) SaveManager.saveFile();

    _activeIndex = 0;
    runSearch();
  }

  /* ── Event wiring ─────────────────────────────────────────────────── */

  (function wireFindWidget() {
    const findInput    = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');

    findInput?.addEventListener('input', runSearch);

    findInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); navigateMatch(e.shiftKey ? -1 : +1); }
      if (e.key === 'Escape') { e.preventDefault(); closeFindWidget(); }
      if (e.key === 'Tab' && !e.shiftKey && _replaceMode) {
        e.preventDefault();
        replaceInput?.focus();
      }
    });

    replaceInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); replaceCurrentMatch(); }
      if (e.key === 'Escape') { e.preventDefault(); closeFindWidget(); }
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); findInput?.focus(); }
    });

    document.getElementById('findCaseSensitive')?.addEventListener('click', function () {
      this.classList.toggle('active');
      this.setAttribute('aria-pressed', String(this.classList.contains('active')));
      runSearch();
    });
    document.getElementById('findWholeWord')?.addEventListener('click', function () {
      this.classList.toggle('active');
      this.setAttribute('aria-pressed', String(this.classList.contains('active')));
      runSearch();
    });

    document.getElementById('findPrev')?.addEventListener('click',  () => navigateMatch(-1));
    document.getElementById('findNext')?.addEventListener('click',  () => navigateMatch(+1));
    document.getElementById('findClose')?.addEventListener('click', closeFindWidget);
    document.getElementById('replaceOne')?.addEventListener('click', replaceCurrentMatch);
    document.getElementById('replaceAll')?.addEventListener('click', replaceAllMatches);
  })();

  /* ── Global keyboard shortcuts ────────────────────────────────────── */

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openFindWidget(false); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); openFindWidget(true); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
      e.preventDefault();
      if (_widgetOpen) navigateMatch(e.shiftKey ? -1 : +1);
      else openFindWidget(false);
    }
  });

  // Escape in the editor while the widget is open → close it
  const _editorEl = document.getElementById('mdEditor');
  if (_editorEl) {
    _editorEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _widgetOpen) {
        e.stopPropagation();
        closeFindWidget();
      }
    });
  }

  return {
    openFindWidget,
    closeFindWidget,
    getFindState,
    resyncIfOpen,
    runSearch,
    navigateMatch,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FindReplaceWidget };
}
