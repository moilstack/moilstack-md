/**
 * editorCore.js — Editor display, manipulation, and toolbar logic.
 *
 * Loaded as a plain <script> tag (no bundler); exposes window.EditorCore.
 * The CommonJS export guard at the bottom makes it importable by Jest / Node.
 *
 * Depends on:
 *  - MarkdownRenderer  (global, loaded by markdownRenderer.js before this file)
 *  - ChatPanel         (global peer — accessed only at interaction time)
 *  - EditorCore.init(deps) must be called once from index.js DOMContentLoaded
 */

const EditorCore = (() => {

  /* ── Injected dependencies (populated by init) ──────────────────── */
  let _deps = {};

  /* ═══════════════════════════════════════════════════════════════════
     Private state
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Stack of full-document snapshots taken before each AI edit.
   * Drained by the Ctrl+Z interceptor in the editor keydown handler.
   * @type {string[]}
   */
  const aiUndoStack  = [];
  const AI_UNDO_LIMIT = 20; // keep at most 20 AI-edit snapshots

  /** Heading regex — used by buildHighlight to colour heading lines. */
  const HEADING_RE = /^(#{1,6})(\s)/;

  /** Debounce handle for the preview render. */
  let renderTimer = null;

  /**
   * Canvas 2-D context used for text-width measurement.
   * measureText() causes zero DOM reflow — safe to call per line on every keystroke.
   */
  let _rulerCtx    = null;
  /** Last measured usable text-area content width (clientWidth − h-padding). */
  let _rulerWidth  = 0;
  /** Cached line-height in pixels (font-size × 1.7). */
  let _rulerLineH  = 0;
  /** Width of a single monospace character — used for per-char row counting. */
  let _singleCharW = 0;
  /** requestAnimationFrame handle — batches gutter rebuilds to one per frame. */
  let _lineNumRaf  = null;

  /* ═══════════════════════════════════════════════════════════════════
     Find & Replace — match computation
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Find all non-overlapping occurrences of `query` in `text`.
   * Supports case-insensitive search and whole-word matching.
   * Returns an array of {start, end} character-index objects.
   *
   * @param {string}  text
   * @param {string}  query
   * @param {boolean} caseSensitive
   * @param {boolean} wholeWord
   * @returns {{start:number, end:number}[]}
   */
  function computeMatches(text, query, caseSensitive, wholeWord) {
    if (!query) return [];
    try {
      const flags   = caseSensitive ? 'g' : 'gi';
      let   pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // literal
      if (wholeWord) pattern = `\\b${pattern}\\b`;
      const re  = new RegExp(pattern, flags);
      const out = [];
      let m;
      while ((m = re.exec(text)) !== null) {
        out.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex++; // guard against zero-width match loop
      }
      return out;
    } catch {
      return []; // malformed pattern (e.g. dangling \b) — return nothing
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Syntax highlight overlay
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Build inner HTML for the highlight div.
   * Each line is either a plain escaped string or a <span class="hl-hN"> wrapper.
   */
  function buildHighlight(text) {
    return text.split('\n').map(line => {
      const m = line.match(HEADING_RE);
      if (m) {
        const level = m[1].length;
        return `<span class="hl-h${level}">${MarkdownRenderer.escapeHtml(line)}</span>`;
      }
      return MarkdownRenderer.escapeHtml(line);
    }).join('\n') + '\n'; // trailing \n prevents last-line height mismatch
  }

  /**
   * Build highlight HTML with find-match <mark> spans injected at the
   * correct character positions.  Falls back to normal heading colours on
   * lines that have no match.
   *
   * @param {string}   text         Full editor text.
   * @param {{start:number,end:number}[]} matches  All match positions.
   * @param {number}   activeIndex  Index of the currently focused match.
   * @returns {string}  innerHTML for #editor-highlight
   */
  function buildHighlightWithMatches(text, matches, activeIndex) {
    const lines = text.split('\n');
    const out   = [];
    let   offset = 0; // cumulative character offset of the current line start

    for (const line of lines) {
      const lineStart = offset;
      const lineEnd   = offset + line.length; // exclusive; does NOT include '\n'

      // Matches that overlap this line (may be partially off-line at either end)
      const lineMatches = matches.filter(m => m.start < lineEnd && m.end > lineStart);

      if (lineMatches.length === 0) {
        // No match on this line — normal heading highlight path
        const hm = line.match(HEADING_RE);
        out.push(hm
          ? `<span class="hl-h${hm[1].length}">${MarkdownRenderer.escapeHtml(line)}</span>`
          : MarkdownRenderer.escapeHtml(line));
      } else {
        // Build HTML by walking through the line and injecting <mark> spans
        let html = '';
        let pos  = lineStart; // current write position in the full text

        for (const match of lineMatches) {
          const mStart   = Math.max(match.start, lineStart);
          const mEnd     = Math.min(match.end,   lineEnd);
          const matchIdx = matches.indexOf(match);

          // Plain text before this match
          if (pos < mStart) html += MarkdownRenderer.escapeHtml(text.slice(pos, mStart));

          // The match itself — active match gets a stronger style
          const cls = matchIdx === activeIndex
            ? 'find-match find-match--active'
            : 'find-match';
          html += `<mark class="${cls}">${MarkdownRenderer.escapeHtml(text.slice(mStart, mEnd))}</mark>`;
          pos = mEnd;
        }

        // Remaining plain text on this line after the last match
        if (pos < lineEnd) html += MarkdownRenderer.escapeHtml(text.slice(pos, lineEnd));

        // Wrap in a heading span if applicable
        const hm = line.match(HEADING_RE);
        out.push(hm ? `<span class="hl-h${hm[1].length}">${html}</span>` : html);
      }

      offset = lineEnd + 1; // +1 skips the '\n' separator
    }

    return out.join('\n') + '\n'; // trailing \n prevents last-line height mismatch
  }

  /** Refresh the highlight layer from the current editor content. */
  function updateHighlight() {
    const overlay = document.getElementById('editor-highlight');
    const editor  = _deps.getEditor ? _deps.getEditor() : null;
    if (!overlay || !editor) return;

    const { widgetOpen, matches, activeIndex } = _deps.getFindState
      ? _deps.getFindState()
      : { widgetOpen: false, matches: [], activeIndex: 0 };

    overlay.innerHTML = (widgetOpen && matches.length > 0)
      ? buildHighlightWithMatches(editor.value, matches, activeIndex)
      : buildHighlight(editor.value);

    // innerHTML resets scrollTop to 0 — re-sync immediately so the overlay
    // stays locked to the textarea's scroll position.
    overlay.scrollTop  = editor.scrollTop;
    overlay.scrollLeft = editor.scrollLeft;

    updateLineNumbers();
  }

  /* ═══════════════════════════════════════════════════════════════════
     Canvas ruler & line-number gutter
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * (Re-)read textarea CSS metrics into the canvas ruler.
   * Only updates if the content width has changed (e.g. after a panel resize).
   */
  function syncRuler() {
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!editor) return;
    // Textarea horizontal padding: 24px left + 24px right = 48px total
    const cw = Math.max(1, editor.clientWidth - 48);
    if (cw === _rulerWidth && _rulerCtx) return; // nothing changed — keep cache
    if (!_rulerCtx) _rulerCtx = document.createElement('canvas').getContext('2d');
    const cs      = getComputedStyle(editor);
    _rulerCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    _rulerLineH   = parseFloat(cs.lineHeight);
    _rulerWidth   = cw;
    // Single-char width for the per-char row calculation in visualRowsForLine.
    // measureText on a repeated block is more stable than a single glyph.
    _singleCharW  = _rulerCtx.measureText('x'.repeat(20)).width / 20;

    // The textarea's vertical scrollbar (6 px wide) reduces its clientWidth, so
    // its text wraps at a different column than the highlight overlay (overflow:hidden,
    // no scrollbar).  Widen the overlay's right padding by the same scrollbar width so
    // both layers always wrap at exactly the same character column.  Without this,
    // selected text in the textarea visually "bleeds" into the next line because the
    // two layers disagree on where a long line ends.
    const scrollbarW = editor.offsetWidth - editor.clientWidth;
    const overlay    = document.getElementById('editor-highlight');
    if (overlay) overlay.style.paddingRight = (24 + scrollbarW) + 'px';
  }

  /**
   * Return how many visual rows a single logical line occupies in the textarea.
   * Uses canvas measureText — O(1), no DOM reflow.
   *
   * For monospace fonts the browser lays out characters discretely:
   *   charsPerRow = floor(availableWidth / charWidth)
   *   rows        = ceil(charCount / charsPerRow)
   * This matches the browser's arithmetic exactly, avoiding the off-by-one that
   * ceil(totalPx / availPx) produces when a line sits right at the wrap boundary.
   *
   * @param {string} text  A single logical line (no newline characters).
   * @returns {number}     ≥ 1
   */
  function visualRowsForLine(text) {
    if (!text.length) return 1;                    // empty line is always 1 row
    if (_singleCharW > 0) {
      const charsPerRow = Math.max(1, Math.floor(_rulerWidth / _singleCharW));
      return Math.max(1, Math.ceil(text.length / charsPerRow));
    }
    // Fallback for proportional fonts (no single-char width cached yet)
    const px = _rulerCtx.measureText(text).width;
    return Math.max(1, Math.ceil(px / _rulerWidth));
  }

  /**
   * Rebuild the entire gutter DOM with correct per-line heights.
   * Called via RAF so multiple keystrokes within one frame trigger one rebuild.
   */
  function _rebuildGutter() {
    const gutter = document.getElementById('line-numbers');
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!gutter || !editor) return;

    syncRuler(); // no-op if width hasn't changed

    const lines  = editor.value.split('\n');
    const count  = lines.length;
    const digits = String(count).length;
    const lineH  = _rulerLineH || (12 * 1.7); // fallback: 12 px × 1.7

    // Widen gutter to fit the widest line-number (e.g. 4 digits → ~64 px)
    gutter.style.minWidth = (digits * 9 + 28) + 'px';

    // Build the HTML string: every div gets an explicit height so the gutter
    // total height always matches the textarea's scroll height exactly.
    // Omitting the inline style for single-row lines causes CSS line-height
    // rounding (20.4 px → 20 px) to accumulate into a visible drift over many lines.
    const parts = new Array(count);
    for (let i = 0; i < count; i++) {
      const rows = visualRowsForLine(lines[i]);
      parts[i] = `<div style="height:${(rows * lineH).toFixed(2)}px">${i + 1}</div>`;
    }
    gutter.innerHTML = parts.join('');

    // Restore scroll after rebuild
    gutter.scrollTop = editor.scrollTop;
  }

  /**
   * Public entry-point called by updateHighlight() and scroll/resize handlers.
   * Syncs gutter scrollTop immediately, then schedules a DOM rebuild on the
   * next animation frame.
   */
  function updateLineNumbers() {
    const gutter = document.getElementById('line-numbers');
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!gutter || !editor) return;

    gutter.scrollTop = editor.scrollTop; // instant — never lags behind caret

    if (!_lineNumRaf) {
      _lineNumRaf = requestAnimationFrame(() => {
        _lineNumRaf = null;
        _rebuildGutter();
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Preview rendering
     ═══════════════════════════════════════════════════════════════════ */

  /** Rewrite <img src="..."> paths to absolute local-file:// URLs. */
  function resolveImagePaths(html) {
    const filePath = _deps.getCurrentFilePath ? _deps.getCurrentFilePath() : null;
    const dir = filePath
      ? filePath.replace(/[/\\][^/\\]+$/, '').replace(/\\/g, '/')
      : null;
    return html.replace(/<img([^>]*)\ssrc="([^"]+)"/g, (match, attrs, src) => {
      if (/^(https?:|file:|data:|local-file:)/i.test(src)) return match;
      // Windows absolute path (e.g. C:\... or C:/...)
      if (/^[a-zA-Z]:[/\\]/.test(src)) {
        return `<img${attrs} src="local-file:///${src.replace(/\\/g, '/')}"`;
      }
      // Relative path — needs the current file's directory
      if (!dir) return match;
      return `<img${attrs} src="local-file:///${dir}/${src}"`;
    });
  }

  /** Re-render the preview pane from the editor content. */
  function renderMarkdown() {
    const editor  = _deps.getEditor ? _deps.getEditor() : null;
    const preview = _deps.getPreviewContent ? _deps.getPreviewContent() : null;
    const md      = editor ? editor.value : '';
    const html    = resolveImagePaths(MarkdownRenderer.parseMarkdown(md));
    if (preview) {
      preview.innerHTML = html || '<p class="preview-empty">Preview will appear here…</p>';
    }
  }

  /**
   * Toggle a GFM task-list checkbox at the given index (0-based, document order).
   *
   * @param {number}  taskIndex  Position of the checkbox among all task items.
   * @param {boolean} nowChecked Whether the checkbox was just checked or unchecked.
   */
  function toggleTaskCheckbox(taskIndex, nowChecked) {
    const editor  = _deps.getEditor ? _deps.getEditor() : null;
    const preview = _deps.getPreviewContent ? _deps.getPreviewContent() : null;
    if (!editor) return;

    let count = 0;
    let found = false;
    // Match every [ ] / [x] in the source — same scope as parseInline renders them,
    // so the nth checkbox in the preview always maps to the nth match here.
    const newMd = editor.value.replace(
      /\[([ xX])\]/g,
      (match) => {
        if (count === taskIndex) {
          found = true;
          count++;
          return nowChecked ? '[x]' : '[ ]';
        }
        count++;
        return match;
      }
    );

    if (found && newMd !== editor.value) {
      setEditorContentUndoable(newMd);
      _deps.markDirty();
      // Manually update just the preview — skip triggerUpdate() debounce so the
      // checkbox toggle feels instant.
      const html = resolveImagePaths(MarkdownRenderer.parseMarkdown(editor.value));
      if (preview) {
        preview.innerHTML = html || '<p class="preview-empty">Preview will appear here…</p>';
      }
    }
  }

  /** Re-render preview and update status bar (debounced). */
  function triggerUpdate() {
    clearTimeout(renderTimer);
    // Highlight must update immediately (text is transparent — overlay is what you see)
    updateHighlight();
    // ChatPanel is a peer global — safe to call at event time
    if (typeof ChatPanel !== 'undefined') {
      ChatPanel.updateTokenEstimate();
      ChatPanel.updateFileSizeWarning();
    }

    // Preview render is expensive — keep it debounced
    renderTimer = setTimeout(() => {
      const editor  = _deps.getEditor ? _deps.getEditor() : null;
      const preview = _deps.getPreviewContent ? _deps.getPreviewContent() : null;
      const md      = editor ? editor.value : '';
      const html    = resolveImagePaths(MarkdownRenderer.parseMarkdown(md));
      if (preview) {
        preview.innerHTML = html || '<p class="preview-empty">Preview will appear here…</p>';
      }
    }, 120); // 120 ms debounce
  }

  /* ═══════════════════════════════════════════════════════════════════
     Status bar
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Update the bottom status bar with live line / char counts,
   * then kick off the debounced preview render.
   */
  function updateStats() {
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    const val    = editor ? editor.value : '';
    const lines  = val.split('\n').length;
    const chars  = val.length;

    const sbLines = document.getElementById('sbLines');
    const sbChars = document.getElementById('sbChars');
    if (sbLines) sbLines.textContent = `${lines} line${lines !== 1 ? 's' : ''}`;
    if (sbChars) sbChars.textContent = `${chars.toLocaleString()} chars`;

    triggerUpdate(); // debounced preview render + internal word/char/cursor bar
  }

  /* ═══════════════════════════════════════════════════════════════════
     AI undo stack
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Replace the entire editor content and push a snapshot to the AI undo stack.
   * Goes through direct assignment so it targets the correct element every time.
   *
   * @param {string} content  New content to place in the editor.
   */
  function setEditorContentUndoable(content) {
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!editor) return;

    // Push current content onto the AI undo stack before overwriting
    aiUndoStack.push(editor.value);
    if (aiUndoStack.length > AI_UNDO_LIMIT) aiUndoStack.shift(); // cap size

    editor.value = content;
    editor.focus();
    updateStats();
    updateHighlight();
    triggerUpdate();
  }

  /* ═══════════════════════════════════════════════════════════════════
     Toolbar helpers
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Wrap the current selection (or insert at cursor) with before/after strings.
   */
  function insertMd(before, after) {
    const ta = _deps.getEditor ? _deps.getEditor() : null;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.substring(start, end);
    ta.focus();
    ta.setSelectionRange(start, end);
    ta.setRangeText(before + sel + after, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    updateStats();
  }

  /**
   * Prepend prefix to the start of the line containing the cursor.
   */
  function insertLine(prefix) {
    const ta = _deps.getEditor ? _deps.getEditor() : null;
    if (!ta) return;
    const start     = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart);
    ta.setRangeText(prefix, lineStart, lineStart, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.setSelectionRange(start + prefix.length, start + prefix.length);
    updateStats();
  }

  /**
   * Wrap the current selection (or a placeholder) with before/after strings.
   */
  function wrapSelection(before, after = '', placeholder = 'text') {
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!editor) return;
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const selected = editor.value.slice(start, end) || placeholder;
    const insertion = before + selected + after;
    editor.focus();
    editor.setSelectionRange(start, end);
    editor.setRangeText(insertion, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setSelectionRange(start + before.length, start + before.length + selected.length);
    triggerUpdate();
  }

  /**
   * Prepend each selected line with a prefix string.
   * If every line already starts with the prefix, remove it (toggle).
   */
  function toggleLinePrefix(prefix) {
    const editor = _deps.getEditor ? _deps.getEditor() : null;
    if (!editor) return;
    const val   = editor.value;
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;

    // Find the start of the first selected line
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineEnd   = val.indexOf('\n', end);
    const block     = val.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

    const lines    = block.split('\n');
    const allHave  = lines.every(l => l.startsWith(prefix));
    const newBlock = allHave
      ? lines.map(l => l.slice(prefix.length)).join('\n')
      : lines.map(l => prefix + l).join('\n');

    const realEnd = lineEnd === -1 ? val.length : lineEnd;
    editor.focus();
    editor.setSelectionRange(lineStart, realEnd);
    editor.setRangeText(newBlock, lineStart, realEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setSelectionRange(lineStart, lineStart + newBlock.length);
    triggerUpdate();
  }

  /* ── Toolbar actions map ────────────────────────────────────────── */

  const TOOLBAR_ACTIONS = {
    // ── Toolbar-left buttons (insertMd / insertLine) ──────────────────
    bold:          () => insertMd('**', '**'),
    italic:        () => insertMd('*',  '*'),
    inlinecode:    () => insertMd('`',  '`'),
    link:          () => insertMd('[',  '](url)'),
    image:         () => insertMd('![alt](', ')'),
    h1:            () => insertLine('# '),
    h2:            () => insertLine('## '),
    list:          () => insertLine('- '),
    quote:         () => insertLine('> '),

    // ── Legacy actions (keyboard shortcuts still reference these) ──────
    strikethrough: () => wrapSelection('~~', '~~', 'strikethrough'),
    code:          () => wrapSelection('`',  '`',  'code'),
    h3:            () => toggleLinePrefix('### '),
    ul:            () => toggleLinePrefix('- '),
    blockquote:    () => toggleLinePrefix('> '),
    ol: () => {
      const editor = _deps.getEditor ? _deps.getEditor() : null;
      if (!editor) return;
      const val   = editor.value;
      const start = editor.selectionStart;
      const end   = editor.selectionEnd;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineEnd   = val.indexOf('\n', end);
      const block = val.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const lines = block.split('\n');
      const allHave = lines.every((l, i) => l.startsWith(`${i + 1}. `));
      const newBlock = allHave
        ? lines.map((l, i) => l.slice(`${i + 1}. `.length)).join('\n')
        : lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
      const realEnd = lineEnd === -1 ? val.length : lineEnd;
      editor.focus();
      editor.setSelectionRange(lineStart, realEnd);
      editor.setRangeText(newBlock, lineStart, realEnd, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(lineStart, lineStart + newBlock.length);
      triggerUpdate();
    },
    table: () => {
      if (typeof TableBuilder === 'undefined') return;
      const editor = _deps.getEditor ? _deps.getEditor() : null;
      if (editor) {
        const selStart = editor.selectionStart;
        const selEnd   = editor.selectionEnd;
        if (selStart !== selEnd) {
          const selected = editor.value.slice(selStart, selEnd);
          const parsed   = TableBuilder.parseTable(selected.trim());
          if (parsed) {
            TableBuilder.show({ ...parsed, selStart, selEnd });
            return;
          }
        }
      }
      TableBuilder.show();
    },
    codeblock: () => {
      const editor = _deps.getEditor ? _deps.getEditor() : null;
      if (!editor) return;
      const start    = editor.selectionStart;
      const end      = editor.selectionEnd;
      const selected = editor.value.slice(start, end) || 'code here';
      const insertion = '```\n' + selected + '\n```';
      editor.focus();
      editor.setSelectionRange(start, end);
      editor.setRangeText(insertion, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(start + 4, start + 4 + selected.length);
      triggerUpdate();
    },
    hr: () => {
      const editor = _deps.getEditor ? _deps.getEditor() : null;
      if (!editor) return;
      const pos = editor.selectionStart;
      const val    = editor.value;
      const before = val[pos - 1] === '\n' || pos === 0 ? '' : '\n';
      const after  = val[pos]     === '\n'              ? '' : '\n';
      editor.focus();
      editor.setSelectionRange(pos, pos);
      editor.setRangeText(`${before}---${after}`, pos, pos, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      triggerUpdate();
    },
  };

  /* ── Ruler state getters (used by ChatPanel via deps injection) ─── */

  function getRulerCtx()    { return _rulerCtx;    }
  function getRulerWidth()  { return _rulerWidth;  }
  function getRulerLineH()  { return _rulerLineH;  }
  function getSingleCharW() { return _singleCharW; }

  /* ═══════════════════════════════════════════════════════════════════
     init — wire event listeners + store deps
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Wire all editor event listeners and store injected dependencies.
   * Must be called once from index.js DOMContentLoaded.
   *
   * @param {object} deps
   * @param {function} deps.getEditor          — returns the #mdEditor textarea
   * @param {function} deps.getPreviewContent  — returns the #previewContent div
   * @param {function} deps.markDirty          — mark the current file as unsaved
   * @param {function} deps.saveFile           — save the current file (for AI undo)
   * @param {function} deps.getCurrentFilePath — returns currentFile.path
   * @param {function} deps.onEditorInput      — called on each input event (for find sync)
   * @param {function} deps.getFindState       — returns { widgetOpen, matches, activeIndex }
   */
  function init(deps) {
    _deps = deps;

    const editor  = deps.getEditor();
    const preview = deps.getPreviewContent();

    /* ── Editor event listeners ───────────────────────────────────── */
    if (editor) {
      editor.addEventListener('input', () => {
        deps.markDirty();
        updateStats();
        deps.onEditorInput(); // triggers _resyncFindMatches if find widget is open
      });

      // Keep the highlight layer and line-number gutter scrolled in sync
      editor.addEventListener('scroll', () => {
        const overlay = document.getElementById('editor-highlight');
        if (overlay) {
          overlay.scrollTop  = editor.scrollTop;
          overlay.scrollLeft = editor.scrollLeft;
        }
        const gutter = document.getElementById('line-numbers');
        if (gutter) gutter.scrollTop = editor.scrollTop;

        // Reposition the selection ghost whenever the user scrolls
        if (typeof ChatPanel !== 'undefined') ChatPanel.positionSelectionGhost();
      });

      // When the editor loses focus and a line range is selected, paint the ghost
      editor.addEventListener('blur', () => {
        if (typeof ChatPanel !== 'undefined') ChatPanel.positionSelectionGhost();
      });

      // When the editor regains focus, hide the ghost (native selection takes over)
      editor.addEventListener('focus', () => {
        if (typeof ChatPanel !== 'undefined') ChatPanel.hideSelectionGhost();
      });

      // Tab key → insert two spaces instead of focus-out
      editor.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = editor.selectionStart;
          const end   = editor.selectionEnd;
          editor.setRangeText('  ', start, end, 'end');
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Keyboard shortcuts: Ctrl+B, Ctrl+I, Ctrl+Z (AI undo)
      editor.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
          e.preventDefault();
          TOOLBAR_ACTIONS.bold();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          e.preventDefault();
          TOOLBAR_ACTIONS.italic();
        }

        // Ctrl+Z — AI undo takes priority over textarea's native undo.
        // Once the AI stack is empty the event falls through to the browser
        // so normal keystroke undo continues to work.
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          if (aiUndoStack.length > 0) {
            e.preventDefault();
            const prev = aiUndoStack.pop();
            editor.value = prev;
            updateStats();
            updateHighlight();
            triggerUpdate();
            const filePath = deps.getCurrentFilePath ? deps.getCurrentFilePath() : null;
            if (filePath) deps.saveFile();
          }
          // else: let native undo handle regular typing
        }
      });
    }

    /* ── Preview: delegated task-checkbox listener ────────────────── */
    if (preview) {
      preview.addEventListener('change', (e) => {
        const cb = e.target;
        if (!cb.matches('.task-checkbox')) return;

        const allCBs  = preview.querySelectorAll('.task-checkbox');
        const taskIdx = Array.from(allCBs).indexOf(cb);
        if (taskIdx === -1) return;

        toggleTaskCheckbox(taskIdx, cb.checked);
      });
    }

    /* ── ResizeObserver — invalidates ruler cache on panel resize ─── */
    if (typeof ResizeObserver !== 'undefined') {
      const editorWrapper = document.querySelector('.editor-wrapper');
      if (editorWrapper) {
        new ResizeObserver(() => {
          _rulerWidth = 0; // force syncRuler() to re-measure on next rebuild
          updateLineNumbers();
        }).observe(editorWrapper);
      }
    }

    /* ── Global hook for font-size changes from aiConfig.js ─────── */
    // Expose a small helper so aiConfig.js can invalidate the ruler when
    // the font size or family changes (avoids reaching into private variables).
    window.invalidateEditorRuler = function () {
      _rulerWidth = 0;
      updateLineNumbers();
    };
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /** Clear the AI undo stack — must be called whenever a new file is loaded. */
  function clearAiUndoStack() { aiUndoStack.length = 0; }

  return {
    init,
    updateHighlight,
    updateLineNumbers,
    updateStats,
    triggerUpdate,
    renderMarkdown,
    setEditorContentUndoable,
    clearAiUndoStack,
    syncRuler,
    visualRowsForLine,
    computeMatches,
    wrapSelection,
    toggleLinePrefix,
    insertMd,
    insertLine,
    TOOLBAR_ACTIONS,
    toggleTaskCheckbox,
    getRulerCtx,
    getRulerWidth,
    getRulerLineH,
    getSingleCharW,
  };

})();

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EditorCore };
}
