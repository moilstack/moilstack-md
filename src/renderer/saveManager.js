/**
 * saveManager.js — Dirty-state tracking, auto-save, manual save, and PDF export.
 *
 * Depends on globals set in index.js at runtime:
 *   currentFile  — { name, path } of the currently open file
 *   mdEditor     — the #mdEditor textarea element
 * Both are resolved lazily (inside function bodies) so load order is irrelevant.
 */

const SaveManager = (() => {

  /* ── State ────────────────────────────────────────────────────────── */

  let _isDirty            = false;
  let _bypassBeforeUnload = false;

  const AUTO_SAVE_DELAY = 30_000;
  let _autoSaveTimer    = null;

  /* ── Untitled-buffer draft (survives close / crash until saved-as or discarded) ──
     Persisted to a single file — <userData>/backups/untitled-draft.md — via
     the main process (see ipc.js draft:read/write/clear), not localStorage.
     getDraft()/hasDraft() are called synchronously from many places
     (recentsPanel.render() fires on nearly every file action), so the file
     is read once into this in-memory cache at startup (initDraft(), awaited
     by index.js before anything reads it) and kept in sync on every write/
     clear; the disk round-trip itself is fire-and-forget from the caller's
     perspective, same as the existing beforeunload silentSave() pattern. ── */

  let _draftCache = { content: '', exists: false };

  // One-time migration from the pre-file-backed draft storage (localStorage
  // keys 'untitledDraft'/'untitledDraftExists'). Only runs when the new
  // file has nothing yet, so it can't clobber a draft already migrated or
  // written since. Legacy keys are removed either way so this never re-runs.
  async function _migrateLegacyLocalStorageDraft() {
    const legacyExists = localStorage.getItem('untitledDraftExists') === '1';
    const legacyContent = localStorage.getItem('untitledDraft') || '';

    if (legacyExists && !_draftCache.exists) {
      _draftCache = { content: legacyContent, exists: true };
      await window.electronAPI?.draft?.write?.(legacyContent);
    }

    localStorage.removeItem('untitledDraft');
    localStorage.removeItem('untitledDraftExists');
  }

  async function initDraft() {
    const result = await window.electronAPI?.draft?.read?.();
    if (result?.ok) _draftCache = { content: result.content, exists: result.exists };
    await _migrateLegacyLocalStorageDraft();
  }

  function getDraft() { return _draftCache.content; }

  // Distinct from getDraft() being non-empty: an untitled buffer that was
  // switched away from before anything was typed still needs to be
  // reachable from Recent Files, so its "slot" is tracked even when the
  // persisted content is an empty string.
  function hasDraft() { return _draftCache.exists; }

  function _setDraft(content) {
    _draftCache = { content, exists: true };
    window.electronAPI?.draft?.write?.(content);
  }

  function clearDraft() {
    _draftCache = { content: '', exists: false };
    window.electronAPI?.draft?.clear?.();
  }

  /**
   * Save the persisted draft to disk via the native Save dialog, without
   * touching whatever is currently loaded in the editor. Used by the
   * "Recent Files" draft row's × button when the user chooses "Save".
   */
  async function saveDraftAs() {
    const content = getDraft();
    if (!content) return true;

    const raw  = _extractFirstLine(content);
    const safe = raw.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'untitled';
    const folder = sessionStorage.getItem('lastFolder') || null;

    const result = await window.electronAPI?.newFile(safe, folder);
    if (!result?.filePath) return false; // cancelled

    const writeResult = await window.electronAPI.writeFile(result.filePath, content);
    if (!writeResult?.ok) { StatusBar.showToast(writeResult?.error || 'Save failed.'); return false; }

    clearDraft();
    const name = result.filePath.split(/[\\/]/).pop();
    StorageManager.addRecentItem('file', result.filePath, name, raw);
    return true;
  }

  /* ── Auto-save ────────────────────────────────────────────────────── */

  function _scheduleAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(async () => {
      if (_isDirty) await silentSave();
    }, AUTO_SAVE_DELAY);
  }

  function _cancelAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }

  /* ── Dirty state ──────────────────────────────────────────────────── */

  function markDirty() {
    if (!_isDirty) {
      _isDirty = true;
      document.querySelector('.statusbar-dot')?.classList.add('statusbar-dot--dirty');
    }
    _scheduleAutoSave();
  }

  function markClean() {
    _isDirty = false;
    _cancelAutoSave();
    document.querySelector('.statusbar-dot')?.classList.remove('statusbar-dot--dirty');
  }

  function isDirty()                     { return _isDirty; }
  function setBypassBeforeUnload(val)    { _bypassBeforeUnload = val; }
  function isBypassBeforeUnload()        { return _bypassBeforeUnload; }

  /* ── Sidebar preview update ───────────────────────────────────────── */

  // Only treat a leading `---`…`---` block as frontmatter to skip if it
  // actually contains YAML (`key: value`) — otherwise it's just two
  // horizontal rules with ordinary prose between them.
  function _looksLikeYaml(fmText) {
    return /^[ \t]*[A-Za-z0-9_-]+:([ \t]|$)/m.test(fmText);
  }

  function _extractFirstLine(content) {
    let text = content;
    if (text.startsWith('---')) {
      const fmEnd = text.indexOf('\n---', 3);
      if (fmEnd !== -1 && _looksLikeYaml(text.slice(3, fmEnd))) text = text.slice(fmEnd + 4);
    }
    for (const line of text.split('\n')) {
      const stripped = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
      if (stripped) return stripped.slice(0, 100);
    }
    return '';
  }

  function _updateSidebarPreview(filePath, content) {
    const list = document.getElementById('file-list');
    if (!list) return;

    let item = null;
    for (const el of list.querySelectorAll('.file-item--flat')) {
      if (el.dataset.path === filePath) { item = el; break; }
    }
    if (!item) return;

    const firstLine = _extractFirstLine(content);

    let previewRow = item.querySelector('.file-item__preview');
    if (!previewRow) {
      previewRow = document.createElement('div');
      previewRow.className = 'file-item__preview';
      item.appendChild(previewRow);
    }
    let previewSpan = previewRow.querySelector('span:first-child');
    if (!previewSpan) {
      previewSpan = document.createElement('span');
      previewRow.insertBefore(previewSpan, previewRow.firstChild);
    }
    previewSpan.textContent = firstLine;
  }

  /* ── Backup-before-overwrite ─────────────────────────────────────────
     Snapshots whatever is currently on disk (not yet the new content)
     into the same rolling backup store used for AI edits, so a plain
     save/autosave also leaves a recovery point. ──────────────────── */

  async function _backupBeforeOverwrite(filePath) {
    try {
      const existing = await window.electronAPI.readFile(filePath);
      if (existing?.content !== undefined) {
        await window.electronAPI.writeBackup(filePath, existing.content);
      }
    } catch { /* no existing file or backup write failed — nothing to snapshot */ }
  }

  /* ── Silent save ──────────────────────────────────────────────────── */

  async function silentSave() {
    const filePath = currentFile.path;

    if (!filePath) {
      const content = mdEditor ? mdEditor.value : '';
      _setDraft(content);
      RecentsPanel?.render();
      return true;
    }

    if (!_isDirty) return true;

    const content = mdEditor ? mdEditor.value : '';

    try {
      await _backupBeforeOverwrite(filePath);
      const result = await window.electronAPI.writeFile(filePath, content);
      if (!result?.ok) throw new Error(result?.error || 'write failed');
      markClean();
      _updateSidebarPreview(filePath, content);
      FileTreeManager.touchFile(filePath, _extractFirstLine(content));
      return true;
    } catch (err) {
      console.warn('[silentSave]', err.message);
      return false;
    }
  }

  /* ── Manual save ──────────────────────────────────────────────────── */

  const FLOPPY_SVG = `<svg width="18" height="18" viewBox="0 0 13 13" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="1" y="1" width="11" height="11" rx="1.5"
        stroke="currentColor" stroke-width="1.3"/>
  <rect x="3.5" y="1" width="4" height="3.5" rx=".5"
        fill="currentColor" stroke="none"/>
  <rect x="2.5" y="7" width="8" height="4" rx=".8"
        stroke="currentColor" stroke-width="1.2"/>
</svg>`;

  const SPINNER_SVG = `<svg width="18" height="18" viewBox="0 0 13 13" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="spin">
  <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"
          stroke-dasharray="22" stroke-dashoffset="10" stroke-linecap="round"/>
</svg>`;

  async function saveFile() {
    const btn    = document.getElementById('btn-save');
    const editor = document.getElementById('mdEditor');
    if (!btn || !editor || btn.dataset.saving) return;

    const filePath = currentFile.path;

    if (!filePath) {
      // ModalManager is loaded after SaveManager; reference is lazy.
      ModalManager.showSaveAsModal();
      return;
    }

    const content = editor.value;

    btn.dataset.saving = '1';
    btn.disabled       = true;
    btn.innerHTML      = SPINNER_SVG;
    btn.title          = 'Saving…';

    try {
      await _backupBeforeOverwrite(filePath);
      const result = await window.electronAPI.writeFile(filePath, content);
      if (!result?.ok) throw new Error(result?.error || 'Unknown write error');

      markClean();
      _updateSidebarPreview(filePath, content);
      FileTreeManager.touchFile(filePath, _extractFirstLine(content));
      btn.innerHTML = FLOPPY_SVG;
      btn.title     = 'Saved';
      StatusBar.showToast(`Saved "${currentFile.name}" successfully.`);
      setTimeout(() => { btn.title = 'Save file (Ctrl+S)'; }, 1500);
    } catch (err) {
      console.error('[saveFile]', err);
      btn.innerHTML = FLOPPY_SVG;
      btn.title     = `Save failed: ${err.message}`;
      setTimeout(() => { btn.title = 'Save file (Ctrl+S)'; }, 2000);
      StatusBar.showToast(`Save failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      delete btn.dataset.saving;
    }
  }

  /* ── Export (PDF) ─────────────────────────────────────────────────── */

  /** Read local images via IPC and replace their src with base64 data URLs. */
  async function _embedLocalImages(html) {
    const filePath = currentFile.path;
    const dir = filePath
      ? filePath.replace(/[/\\][^/\\]+$/, '').replace(/\\/g, '\\')
      : null;

    const hits = [];
    const re = /<img([^>]*)\ssrc="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      hits.push({ index: m.index, length: m[0].length, attrs: m[1], src: m[2] });
    }

    for (let i = hits.length - 1; i >= 0; i--) {
      const { index, length, attrs, src } = hits[i];
      if (/^(data:|https?:)/i.test(src)) continue;

      // Resolve to an absolute Windows path for the IPC call
      let absPath;
      if (/^[a-zA-Z]:[/\\]/.test(src)) {
        absPath = src.replace(/\//g, '\\');
      } else if (/^local-file:\/\/\//i.test(src)) {
        absPath = decodeURIComponent(src.slice('local-file:///'.length)).replace(/\//g, '\\');
      } else if (dir) {
        absPath = dir + '\\' + src.replace(/\//g, '\\');
      } else {
        continue;
      }

      const result = await window.electronAPI.readFileBase64(absPath);
      if (!result) continue;
      html = html.slice(0, index)
        + `<img${attrs} src="data:${result.mime};base64,${result.base64}"`
        + html.slice(index + length);
    }
    return html;
  }

  async function exportFile() {
    const btn      = document.getElementById('btn-export');
    const editor   = document.getElementById('mdEditor');
    const md       = editor ? editor.value : '';

    if (!md.trim()) { StatusBar.showToast('Nothing to export — the document is empty.'); return; }

    const filename = currentFile.name || 'export.md';

    const bodyHtml = await _embedLocalImages(MarkdownRenderer.parseMarkdown(md));
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${MarkdownRenderer.escapeHtml(filename.replace(/\.md$/i, ''))}</title>
  <style>
    @page { size: A4; margin: 20mm 22mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.8; color: #1e293b; background: #fff;
      width: 100%; word-wrap: break-word; overflow-wrap: break-word;
    }
    h1, h2, h3, h4, h5, h6 {
      margin: 1.3em 0 0.4em; line-height: 1.3; font-weight: 600;
      page-break-after: avoid; word-wrap: break-word;
    }
    h1 { font-size: 24px;   color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: .3em; }
    h2 { font-size: 20px;   color: #3730a3; border-bottom: 1px solid #e2e8f0; padding-bottom: .2em; }
    h3 { font-size: 16px;   color: #0e7490; }
    h4 { font-size: 1em;    color: #065f46; }
    h5 { font-size: 0.93em; color: #92400e; }
    h6 { font-size: 0.93em; color: #991b1b; }
    p  { margin: .7em 0; word-wrap: break-word; overflow-wrap: break-word; }
    a  { color: #2563eb; text-decoration: underline; word-break: break-all; }
    ul, ol { margin: .7em 0 .7em 1.4em; }
    li { margin: .2em 0; }
    blockquote {
      border-left: 4px solid #94a3b8; margin: 1em 0; padding: .5em 1em;
      color: #475569; background: #f8fafc; border-radius: 0 6px 6px 0;
      word-wrap: break-word;
    }
    pre {
      background: #f8fafc; color: #1e293b; border: 1px solid #e2e8f0;
      padding: .85em 1em; border-radius: 8px; margin: 1em 0;
      font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.6;
      white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;
      word-break: break-all; overflow: hidden; page-break-inside: avoid;
    }
    code {
      background: #f1f5f9; color: #c7254e; padding: .15em .4em;
      border-radius: 4px; font-size: 13px;
      font-family: 'Courier New', Courier, monospace; word-break: break-all;
    }
    pre code { background: none; color: inherit; padding: 0; font-size: inherit; word-break: break-all; }
    table {
      border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px;
      table-layout: fixed; word-wrap: break-word;
    }
    th, td {
      border: 1px solid #cbd5e1; padding: .45em .7em; text-align: left;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    th { background: #f1f5f9; font-weight: 600; }
    tr:nth-child(even) td { background: #f8fafc; }
    hr  { border: none; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
    img { max-width: 100%; border-radius: 8px; display: block; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;

    const origTitle = btn ? btn.title : '';
    const origHTML  = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.title = 'Exporting…'; btn.innerHTML = SPINNER_SVG; }

    try {
      const result = await window.electronAPI.exportPdf(html, filename);
      if (result?.canceled) { if (btn) { btn.title = origTitle; btn.innerHTML = origHTML; } return; }
      if (!result?.ok) throw new Error(result?.error || 'Unknown error');
      if (btn) { btn.title = 'Exported'; btn.innerHTML = origHTML; }
      const pdfName = filename.replace(/\.md$/i, '') + '.pdf';
      StatusBar.showToast(`Exported "${pdfName}" successfully.`);
      setTimeout(() => { if (btn) { btn.title = origTitle; } }, 1800);
    } catch (err) {
      console.error('[exportFile]', err);
      if (btn) { btn.title = origTitle; btn.innerHTML = origHTML; }
      alert(`Export failed: ${err.message}`);
    } finally {
      if (btn) { btn.disabled = false; }
    }
  }

  return {
    isDirty,
    isBypassBeforeUnload,
    setBypassBeforeUnload,
    markDirty,
    markClean,
    silentSave,
    saveFile,
    exportFile,
    extractFirstLine: _extractFirstLine,
    initDraft,
    getDraft,
    hasDraft,
    clearDraft,
    saveDraftAs,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SaveManager };
}
