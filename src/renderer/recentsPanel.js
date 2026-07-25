/**
 * recentsPanel.js — "Recent Files" section at the bottom of the Explorer sidebar.
 *
 * Shows two kinds of rows:
 *   1. The unsaved untitled draft (if one exists and isn't the buffer currently
 *      loaded in the editor) — the way back to it after switching to another file.
 *   2. Recently opened/saved files (global — not filtered to the active folder),
 *      via StorageManager's existing recent-items store.
 *
 * currentFile is a global var declared in index.js (resolved lazily at call time).
 */

const RecentsPanel = (() => {

  const COLLAPSE_KEY = 'recentsSectionCollapsed';
  const MAX_VISIBLE_ROWS = 5;

  const CLOSE_ICON_SVG = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M1 1l7 7M8 1 1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

  const DRAFT_ICON_SVG = `<svg class="icon-file" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" stroke-dasharray="1.6 1.4"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

  const FILE_ICON_SVG = `<svg class="icon-file" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

  const MD_ICON_SVG = `<svg class="icon-file icon-file--md" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M6 5.5v3M4.5 7l1.5 1.5L7.5 7" stroke="currentColor" stroke-width="1"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  const TXT_ICON_SVG = `<svg class="icon-file icon-file--txt" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M3.5 5.5h5M3.5 7h5M3.5 8.5h3" stroke="currentColor" stroke-width="0.9"
        stroke-linecap="round"/>
</svg>`;

  function _fileIconSVG(fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot !== -1 ? fileName.slice(dot).toLowerCase() : '';
    if (ext === '.md')  return MD_ICON_SVG;
    if (ext === '.txt') return TXT_ICON_SVG;
    return FILE_ICON_SVG;
  }

  function _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function _isCustomMode() {
    return (localStorage.getItem('explorerMode') || 'multi-level') === 'custom';
  }

  /**
   * Builds one row. `withPreview` switches between the plain single-line
   * layout (Multi-level/Root-only) and the two-line icon+name+preview
   * layout (Custom mode) — kept as distinct markup rather than always
   * including the preview wrapper, so the single-line case stays exactly
   * the flat structure it always was.
   */
  function _rowHTML({ iconSvg, name, dataAttrs, extraClass, closeRole, closePath, closeTitle, preview, withPreview }) {
    const attrs = dataAttrs || '';
    if (!withPreview) {
      return `
        <div class="file-item recents-item${extraClass}" ${attrs}>
          ${iconSvg}
          <span>${_escHtml(name)}</span>
          <button class="file-pin-btn recents-close-btn" data-role="${closeRole}"${closePath ? ` data-path="${closePath}"` : ''} title="${closeTitle}">
            ${CLOSE_ICON_SVG}
          </button>
        </div>`;
    }
    return `
      <div class="file-item file-item--flat recents-item${extraClass}" ${attrs}>
        <div class="file-item__main">
          ${iconSvg}
          <span class="file-item__name">${_escHtml(name)}</span>
          <button class="file-pin-btn recents-close-btn" data-role="${closeRole}"${closePath ? ` data-path="${closePath}"` : ''} title="${closeTitle}">
            ${CLOSE_ICON_SVG}
          </button>
        </div>
        ${preview ? `<div class="file-item__preview"><span>${_escHtml(preview)}</span></div>` : ''}
      </div>`;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const listEl  = document.getElementById('recents-list');
    const countEl = document.getElementById('recents-count');
    if (!listEl || !countEl) return;

    // The buffer currently loaded in the editor is untitled — show it live,
    // whether or not it has been typed into yet.
    const isLive   = !currentFile.path;
    // Pinned unconditionally (not just while a draft exists) so there's
    // always a one-click way back to a blank document, even right after
    // Save-As clears the draft and points currentFile at the saved path.
    const showDraft = true;

    // Content-preview second line only in Custom mode (no folder tree to
    // provide that context) — Multi-level/Root-only stay single-line.
    const withPreview = _isCustomMode();

    const recentItems = StorageManager.getRecentItems().filter(i => i.type === 'file');

    const count = (showDraft ? 1 : 0) + recentItems.length;
    countEl.textContent = String(count);

    if (count === 0) {
      listEl.innerHTML = `<span class="recents-empty">Nothing here yet</span>`;
      return;
    }

    let html = '';

    if (showDraft) {
      const draftPreview = withPreview
        ? SaveManager.extractFirstLine(isLive ? (document.getElementById('mdEditor')?.value ?? '') : SaveManager.getDraft())
        : '';
      html += _rowHTML({
        iconSvg: DRAFT_ICON_SVG,
        name: 'Untitled (unsaved)',
        dataAttrs: `data-role="draft" title="Unsaved draft"`,
        extraClass: isLive ? ' active' : '',
        closeRole: 'draft-close',
        closeTitle: 'Discard or save draft',
        preview: draftPreview,
        withPreview,
      });
    }

    for (const item of recentItems) {
      const escapedPath = item.path.replace(/"/g, '&quot;');
      const isActive    = item.path === currentFile.path;
      html += _rowHTML({
        iconSvg: _fileIconSVG(item.name),
        name: item.name,
        dataAttrs: `data-path="${escapedPath}" title="${escapedPath}"`,
        extraClass: isActive ? ' active' : '',
        closeRole: 'recent-close',
        closePath: escapedPath,
        closeTitle: 'Remove from Recent Files',
        preview: withPreview ? (item.preview || '') : '',
        withPreview,
      });
    }

    listEl.innerHTML = html;
    listEl.classList.toggle('recents-list--scroll', count > MAX_VISIBLE_ROWS);
    // In Custom mode the list fills the whole sidebar via CSS flex (see
    // .left-sidebar--custom .recents-list) — no fixed row cap there. The
    // 5-row cap only applies to the accordion in Multi-level/Root-only mode.
    listEl.style.maxHeight = (!withPreview && count > MAX_VISIBLE_ROWS)
      ? `${MAX_VISIBLE_ROWS * 28}px`
      : '';
  }

  /* ── Explorer-mode wiring (hide folder tree entirely in Custom mode) ── */

  function applyExplorerMode() {
    const sidebar    = document.querySelector('.left-sidebar');
    const folderWrap = document.querySelector('.app-header__folder-wrap');
    const custom  = _isCustomMode();
    if (sidebar) sidebar.classList.toggle('left-sidebar--custom', custom);
    if (folderWrap) folderWrap.classList.toggle('hidden', custom);
    if (custom) setCollapsed(false);
  }

  /* ── Collapse state ──────────────────────────────────────────────── */

  function setCollapsed(collapsed) {
    const section = document.getElementById('recents-section');
    const header  = document.getElementById('recents-header');
    if (!section || !header) return;
    section.classList.toggle('recents-section--collapsed', collapsed);
    header.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }

  /* ── Event wiring ─────────────────────────────────────────────────── */

  document.getElementById('recents-header')?.addEventListener('click', () => {
    if (_isCustomMode()) return; // always expanded — it's the only way to open a file
    const section = document.getElementById('recents-section');
    setCollapsed(!section?.classList.contains('recents-section--collapsed'));
  });

  document.getElementById('recents-list')?.addEventListener('click', async e => {
    const closeBtn = e.target.closest('.recents-close-btn');
    if (closeBtn) {
      e.stopPropagation();
      if (closeBtn.dataset.role === 'draft-close') {
        const isLive      = !currentFile.path;
        const liveContent = isLive ? (document.getElementById('mdEditor')?.value ?? '') : '';
        const hasContent  = isLive ? liveContent.length > 0 : !!SaveManager.getDraft();

        if (!hasContent) {
          // Nothing typed yet — nothing to lose, just reset silently.
          if (!isLive) SaveManager.clearDraft();
          else window.discardLiveUntitledDraft?.();
          render();
          return;
        }

        const choice = await window.electronAPI?.confirmUnsaved();
        if (choice === 'cancel' || !choice) return;

        if (choice === 'save') {
          if (isLive) {
            await SaveManager.saveFile(); // opens the native Save-As dialog on the live buffer
            if (SaveManager.isDirty()) return; // cancelled — keep the buffer as-is
          } else {
            const ok = await SaveManager.saveDraftAs();
            if (!ok) return; // cancelled or failed — keep the draft
          }
        } else if (choice === 'discard') {
          if (isLive) window.discardLiveUntitledDraft?.();
          else SaveManager.clearDraft();
        }
        render();
      } else if (closeBtn.dataset.role === 'recent-close') {
        StorageManager.removeRecentItem(closeBtn.dataset.path);
        render();
      }
      return;
    }

    const row = e.target.closest('.recents-item');
    if (!row) return;

    // Clicking the active draft row while the welcome screen is up should
    // dismiss it and switch to edit mode — the row is "active" because the
    // untitled buffer is already loaded, but the overlay is hiding the editor.
    if (row.classList.contains('active')) {
      if (row.dataset.role === 'draft') {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) {
          WelcomeScreen.hideWelcomeScreen();
          setMode('edit');
        }
      }
      return;
    }

    if (row.dataset.role === 'draft') {
      if (SaveManager.hasDraft()) {
        await window.restoreDraftFile?.();   // real persisted content — restore it
      } else {
        // Nothing persisted — fresh blank buffer. newUntitledFile() forces edit
        // mode for its "create a new file" callers (menu/Ctrl+N); here we're
        // just navigating back to the (already blank) untitled tab, so restore
        // whatever mode was active rather than resetting it.
        const prevMode = currentMode;
        await window.newUntitledFile?.();
        setMode(prevMode);
      }
    } else if (row.dataset.path) {
      await window.openRecentFile?.(row.dataset.path);
    }
  });

  // Restore collapsed state on load
  if ((localStorage.getItem(COLLAPSE_KEY) || '0') === '1') setCollapsed(true);

  return { render, applyExplorerMode, setCollapsed };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RecentsPanel };
}
