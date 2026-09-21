/**
 * quickEdit.js — Edit a single block in place from Preview mode.
 *
 * Double-click a rendered block (paragraph, heading, list, quote, code block)
 * to swap it for a small textarea holding that block's Markdown. Ctrl+Enter or
 * clicking away saves, Esc cancels. Tables open the visual Table Builder.
 *
 * Block → source mapping comes from the data-line / data-line-end attributes
 * that markdownRenderer.js stamps on each top-level block.
 *
 * Loaded as a plain <script> tag (no bundler); exposes window.QuickEdit.
 * The pure range helpers are exported via CommonJS for Jest.
 */

const QuickEdit = (() => {

  const SETTING_KEY = 'quickEditPreview';
  const INDENT      = '  ';

  let _deps    = {};
  let _session = null; // { el, wrap, ta, startLine, endLine, original, done }

  /* ═══════════════════════════════════════════════════════════════════
     Pure helpers (no DOM)
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Character range [start, end) covering lines startLine..endLine (inclusive,
   * 0-based) of `text`. `end` excludes the trailing newline.
   */
  function lineRange(text, startLine, endLine) {
    let start = 0;
    for (let l = 0; l < startLine; l++) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) return null;
      start = nl + 1;
    }
    let end = start;
    for (let l = startLine; l <= endLine; l++) {
      const nl = text.indexOf('\n', end);
      if (nl === -1) { end = text.length; break; }
      end = l === endLine ? nl : nl + 1;
    }
    return { start, end };
  }

  /**
   * Compute the patch that replaces lines startLine..endLine with `newBlock`.
   * An empty replacement removes the block's lines entirely (with one adjacent
   * newline) instead of leaving a blank gap behind.
   *
   * @returns {{start:number, end:number, replacement:string}|null}
   */
  function blockPatch(text, startLine, endLine, newBlock) {
    const r = lineRange(text, startLine, endLine);
    if (!r) return null;
    if (newBlock !== '') return { start: r.start, end: r.end, replacement: newBlock };

    if (r.end < text.length)  return { start: r.start,     end: r.end + 1, replacement: '' };
    if (r.start > 0)          return { start: r.start - 1, end: r.end,     replacement: '' };
    return { start: r.start, end: r.end, replacement: '' };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Settings / mode gating
     ═══════════════════════════════════════════════════════════════════ */

  function isEnabled() {
    try { return (localStorage.getItem(SETTING_KEY) || 'on') !== 'off'; }
    catch (_) { return true; }
  }

  function applySetting() {
    const preview = _deps.getPreviewContent && _deps.getPreviewContent();
    if (preview) preview.classList.toggle('qe-enabled', isEnabled());
  }

  function inPreviewMode() {
    const area = document.getElementById('editorArea');
    return !!area && area.getAttribute('data-view') === 'preview';
  }

  /* ═══════════════════════════════════════════════════════════════════
     Committing edits back to the editor
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Apply a patch to the (hidden) editor textarea. The editor pane is
   * display:none in Preview mode, so it is un-hidden for the duration of the
   * call — replaceRangeNative() needs a focusable textarea to record the change
   * in the native undo history (and not type into whatever else has focus).
   */
  function applyPatch(patch) {
    const pane = document.getElementById('editorPane');
    const wasHidden = pane && pane.classList.contains('hidden');
    if (wasHidden) pane.classList.remove('hidden');
    try {
      EditorCore.replaceRangeNative(patch.start, patch.end, patch.replacement);
    } finally {
      if (wasHidden) pane.classList.add('hidden');
    }
    EditorCore.updateHighlight();
    EditorCore.updateStats();
    if (typeof ChatPanel !== 'undefined') {
      ChatPanel.updateTokenEstimate();
      ChatPanel.updateFileSizeWarning();
    }
    EditorCore.renderMarkdown();
  }

  function commitBlock(startLine, endLine, newBlock) {
    const editor = _deps.getEditor();
    if (!editor) return;
    const patch = blockPatch(editor.value, startLine, endLine, newBlock);
    if (!patch) return;
    // Skip no-ops so an untouched block doesn't dirty the file or the undo stack.
    if (editor.value.slice(patch.start, patch.end) === patch.replacement) return;
    applyPatch(patch);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Inline mini editor
     ═══════════════════════════════════════════════════════════════════ */

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  function endSession(commit) {
    const s = _session;
    if (!s || s.done) return;
    s.done = true;
    _session = null;

    const newBlock = s.ta.value.replace(/\n+$/, '');
    if (s.wrap.isConnected) s.wrap.replaceWith(s.el); // restore before re-render replaces it

    if (commit && newBlock !== s.original) {
      commitBlock(s.startLine, s.endLine, newBlock);
    }
  }

  function wrapSelection(ta, mark) {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    ta.setRangeText(mark + value.slice(a, b) + mark, a, b, 'end');
    if (a === b) ta.setSelectionRange(a + mark.length, a + mark.length);
    autosize(ta);
  }

  function startTextEdit(el, startLine, endLine, source) {
    const wrap = document.createElement('div');
    wrap.className = 'quick-edit';

    const ta = document.createElement('textarea');
    ta.className   = 'quick-edit__input';
    ta.value       = source;
    ta.spellcheck  = false;
    ta.rows        = 1;

    const hint = document.createElement('div');
    hint.className   = 'quick-edit__hint';
    hint.textContent = 'Ctrl+Enter to save · Esc to cancel';

    wrap.append(ta, hint);
    el.replaceWith(wrap);

    _session = { el, wrap, ta, startLine, endLine, original: source, done: false };

    ta.addEventListener('input', () => autosize(ta));
    ta.addEventListener('blur', () => {
      // Window switch (Alt+Tab) also blurs — keep editing in that case.
      if (document.hasFocus()) endSession(true);
    });
    ta.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endSession(false);
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        endSession(true);
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        wrapSelection(ta, '**');
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        wrapSelection(ta, '*');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        ta.setRangeText(INDENT, ta.selectionStart, ta.selectionEnd, 'end');
        autosize(ta);
      }
    });

    autosize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function startTableEdit(startLine, endLine, source, range) {
    const parsed = typeof TableBuilder !== 'undefined' && TableBuilder.parseTable(source);
    if (!parsed) return false; // unusual table syntax — caller falls back to raw editing

    TableBuilder.show({
      cols: parsed.cols,
      rows: parsed.rows,
      selStart: range.start,
      selEnd:   range.end,
      onSave: md => commitBlock(startLine, endLine, md),
    });
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Double-click handler
     ═══════════════════════════════════════════════════════════════════ */

  function onDblClick(e) {
    if (!isEnabled() || !inPreviewMode()) return;
    const preview = _deps.getPreviewContent();
    if (!preview || _session) return;

    // Leave links, checkboxes and the code-copy button to their own handlers.
    if (e.target.closest('a, input, button, .quick-edit')) return;

    // Walk up to the top-level block.
    let el = e.target;
    while (el && el.parentElement !== preview) el = el.parentElement;
    if (!el) return;

    const lineEl = el.hasAttribute('data-line-end') ? el : el.querySelector('[data-line-end]');
    if (!lineEl) return; // hr, empty-state placeholder, etc.

    const startLine = parseInt(lineEl.getAttribute('data-line'), 10);
    const endLine   = parseInt(lineEl.getAttribute('data-line-end'), 10);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || endLine < startLine) return;

    const editor = _deps.getEditor();
    if (!editor) return;
    const range = lineRange(editor.value, startLine, endLine);
    if (!range) return;
    const source = editor.value.slice(range.start, range.end);

    e.preventDefault();
    window.getSelection()?.removeAllRanges(); // dblclick selects a word — don't leave it highlighted

    if (lineEl.tagName === 'TABLE' && startTableEdit(startLine, endLine, source, range)) return;
    startTextEdit(el, startLine, endLine, source);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Init
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * @param {object}   deps
   * @param {function} deps.getEditor          — returns the #mdEditor textarea
   * @param {function} deps.getPreviewContent  — returns the #previewContent div
   */
  function init(deps) {
    _deps = deps;
    const preview = deps.getPreviewContent();
    if (preview) preview.addEventListener('dblclick', onDblClick);
    applySetting();
  }

  return { init, applySetting, lineRange, blockPatch };

})();

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QuickEdit };
}
