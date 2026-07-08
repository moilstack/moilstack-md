/**
 * index.js — Renderer entry point: shared state, orchestration, and init.
 *
 * All feature modules are loaded before this file (see index.html script order).
 * Using `var` for shared state so modules can resolve these as globals at call time.
 */

/* ── Shared state (globals accessible by all modules) ─────────────── */

// jshint ignore:start
var currentFile    = { name: 'untitled.md', path: null };
var mdEditor       = document.getElementById('mdEditor');
var previewContent = document.getElementById('previewContent');
var currentMode    = 'edit';
// jshint ignore:end

/* ── Edit / Preview mode toggle ───────────────────────────────────── */

const toggleEditBtn    = document.getElementById('editBtn');
const togglePreviewBtn = document.getElementById('previewBtn');

function setMode(mode) {
  currentMode = mode;
  const editorPane  = document.getElementById('editorPane');
  const previewPane = document.getElementById('previewPane');

  if (mode === 'edit') {
    editorPane.classList.remove('hidden');
    previewPane.classList.add('hidden');
    toggleEditBtn.classList.add('active');
    togglePreviewBtn.classList.remove('active');
    if (mdEditor) {
      mdEditor.focus();
      requestAnimationFrame(() => {
        mdEditor.scrollTop = 0;
        mdEditor.setSelectionRange(0, 0);
      });
    }
  } else {
    editorPane.classList.add('hidden');
    previewPane.classList.remove('hidden');
    toggleEditBtn.classList.remove('active');
    togglePreviewBtn.classList.add('active');
    EditorCore.renderMarkdown();
  }
}

if (toggleEditBtn)    toggleEditBtn.addEventListener('click',    () => setMode('edit'));
if (togglePreviewBtn) togglePreviewBtn.addEventListener('click', () => setMode('preview'));

/* ── Status bar / file selection ──────────────────────────────────── */

/**
 * Mark a file as active: update sidebar highlight, currentFile, status bar,
 * and AI context label.
 */
function selectFile(el, filePath, lines, chars) {
  document.querySelectorAll('.file-item.active').forEach(f => f.classList.remove('active'));
  if (el) el.classList.add('active');

  const name = filePath.split(/[\\/]/).pop() || filePath;
  currentFile = { name, path: filePath };

  StatusBar.updateFilename(name);
  StatusBar.updateStats(lines, chars);
  StatusBar.updateChatContextFile(name);
}

/* ── File open: OS / path-based ───────────────────────────────────── */

/**
 * Open a .md file from an absolute path (OS double-click or second-instance forward).
 * Switches the sidebar folder when needed, highlights the file, resets the chat.
 */
async function openFileByPath(filePath, { addToRecents = false } = {}) {
  if (!filePath) return;

  await SaveManager.silentSave();

  const lastSep    = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const folderPath = lastSep > 0 ? filePath.substring(0, lastSep) : '';
  const currentFolder = sessionStorage.getItem('lastFolder');

  const insideCurrent = currentFolder && (
    filePath.startsWith(currentFolder + '/') ||
    filePath.startsWith(currentFolder + '\\')
  );
  if (folderPath && !insideCurrent) {
    await FileTreeManager.setActiveFolder(folderPath);
  }

  const result = await window.electronAPI?.readFile(filePath);
  if (!result) { console.warn('[openFileByPath] could not read file:', filePath); return; }
  const content = result.content ?? '';

  if (mdEditor) {
    EditorCore.clearAiUndoStack();
    mdEditor.value     = content;
    mdEditor.scrollTop = 0;
    mdEditor.setSelectionRange(0, 0);
    const gutter = document.getElementById('line-numbers');
    if (gutter) gutter.scrollTop = 0;
    EditorCore.updateHighlight();
    EditorCore.triggerUpdate();
  }
  SaveManager.markClean();

  // Expand any collapsed ancestor folders so the file is visible in the tree
  if (currentFolder && insideCurrent) {
    const sep      = filePath.includes('\\') ? '\\' : '/';
    const relative = filePath.slice(currentFolder.length).replace(/^[/\\]/, '');
    const parts    = relative.split(/[/\\]/);
    parts.pop(); // strip filename
    let anyExpanded = false;
    let cursor = currentFolder;
    for (const part of parts) {
      cursor += sep + part;
      if (StorageManager.isFolderCollapsed(cursor)) {
        StorageManager.expandFolder(cursor);
        anyExpanded = true;
      }
    }
    if (anyExpanded) await FileTreeManager.renderFileTree();
  }

  const list = document.getElementById('file-list');
  let matchedItem = null;
  if (list) {
    for (const item of list.querySelectorAll('.file-item')) {
      const isMatch = item.dataset.path === filePath;
      item.classList.toggle('active', isMatch);
      if (isMatch) { matchedItem = item; item.scrollIntoView({ block: 'nearest' }); }
    }
  }

  const lines = content.split('\n').length;
  selectFile(matchedItem, filePath, lines, content.length);
  // Not added to Recent Files by default — openFileByPath is shared by
  // search results and in-document link clicks too. Only true "opened from
  // outside the app" callers (Windows Explorer / OS open) pass addToRecents.
  if (addToRecents) {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    StorageManager.addRecentItem('file', filePath, name, SaveManager.extractFirstLine(content));
  }
  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  RecentsPanel.render();
}

/**
 * Open a file from the "Recent Files" sidebar section. Unlike openFileByPath,
 * this never touches the active folder/tree — recent files are reachable
 * regardless of which folder (if any) is currently open.
 */
async function openRecentFile(filePath) {
  if (!filePath) return;

  await SaveManager.silentSave();

  const result = await window.electronAPI?.readFile(filePath);
  if (!result) {
    StatusBar.showToast('File not found — removed from Recent Files.');
    StorageManager.removeRecentItem(filePath);
    RecentsPanel.render();
    return;
  }
  const content = result.content ?? '';

  if (mdEditor) {
    EditorCore.clearAiUndoStack();
    mdEditor.value     = content;
    mdEditor.scrollTop = 0;
    mdEditor.setSelectionRange(0, 0);
    const gutter = document.getElementById('line-numbers');
    if (gutter) gutter.scrollTop = 0;
    EditorCore.updateHighlight();
    EditorCore.triggerUpdate();
  }
  SaveManager.markClean();

  const name = filePath.split(/[\\/]/).pop() || filePath;
  currentFile = { name, path: filePath };
  StatusBar.updateFilename(name);
  StatusBar.updateChatContextFile(name);
  StorageManager.addRecentItem('file', filePath, name, SaveManager.extractFirstLine(content));

  const list = document.getElementById('file-list');
  if (list) {
    for (const item of list.querySelectorAll('.file-item')) {
      item.classList.toggle('active', item.dataset.path === filePath);
    }
  }

  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  RecentsPanel.render();
}

/**
 * Restore the persisted untitled draft into the editor (from the "Recent
 * Files" section's draft row) after having switched away to another file.
 */
async function restoreDraftFile() {
  if (currentFile.path) {
    await SaveManager.silentSave();
  }

  const draft = SaveManager.getDraft();

  if (mdEditor) {
    EditorCore.clearAiUndoStack();
    mdEditor.value     = draft;
    mdEditor.scrollTop = 0;
    mdEditor.setSelectionRange(0, 0);
    const gutter = document.getElementById('line-numbers');
    if (gutter) gutter.scrollTop = 0;
    EditorCore.updateHighlight();
    EditorCore.updateStats();
    EditorCore.triggerUpdate();
  }

  document.querySelectorAll('.file-item.active').forEach(f => f.classList.remove('active'));

  currentFile = { name: 'untitled.md', path: null };
  StatusBar.updateFilename('untitled.md');
  StatusBar.updateChatContextFile('untitled.md');
  SaveManager.markDirty();

  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  setMode('edit');
  RecentsPanel.render();
}

/**
 * Open a single .md file from the file picker (Ctrl+O or recent-items click).
 * This file isn't necessarily related to whatever folder was open before —
 * shows the full path in the header, but keeps the sidebar visible (Recent
 * Files is where this file is reachable) rather than hiding it.
 */
async function openSingleFile(filePath) {
  if (!filePath) return;

  await SaveManager.silentSave();

  const result = await window.electronAPI?.readFile(filePath);
  if (!result) { console.warn('[openSingleFile] could not read file:', filePath); return; }
  const content = result.content ?? '';

  if (mdEditor) {
    EditorCore.clearAiUndoStack();
    mdEditor.value     = content;
    mdEditor.scrollTop = 0;
    mdEditor.setSelectionRange(0, 0);
    const gutter = document.getElementById('line-numbers');
    if (gutter) gutter.scrollTop = 0;
    EditorCore.updateHighlight();
    EditorCore.triggerUpdate();
  }
  SaveManager.markClean();

  SidebarManager.setExplorerVisible(true, true);

  const label = document.getElementById('header-folder-name');
  if (label) label.textContent = filePath;

  selectFile(null, filePath, content.split('\n').length, content.length);

  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  StorageManager.addRecentItem('file', filePath, fileName, SaveManager.extractFirstLine(content));
  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  RecentsPanel.render();
}

/**
 * Reset the editor to a blank untitled buffer. Assumes the caller has already
 * handled whatever was there before (saved, discarded, or it was already
 * empty) — this just performs the reset.
 */
function _resetToBlankUntitled() {
  if (mdEditor) {
    EditorCore.clearAiUndoStack();
    mdEditor.value     = '';
    mdEditor.scrollTop = 0;
    mdEditor.setSelectionRange(0, 0);
    const gutter = document.getElementById('line-numbers');
    if (gutter) gutter.scrollTop = 0;
    EditorCore.updateHighlight();
    EditorCore.updateStats();
    EditorCore.triggerUpdate();
  }

  document.querySelectorAll('.file-item.active').forEach(f => f.classList.remove('active'));

  currentFile = { name: 'untitled.md', path: null };
  StatusBar.updateFilename('untitled.md');
  StatusBar.updateChatContextFile('untitled.md');
  SaveManager.markClean();
  SaveManager.clearDraft();
}

/**
 * Start a fresh in-memory, unsaved document (Ctrl+N).
 * Unlike the explorer's "New File" (which creates a file inside a folder and
 * needs the sidebar visible), this has no folder/explorer dependency at all —
 * it works identically whether or not a folder is open or the sidebar is shown.
 */
async function newUntitledFile() {
  if (currentFile.path) {
    // Existing saved file with unsaved edits — auto-save silently, same as
    // switching to another file elsewhere in the app.
    await SaveManager.silentSave();

    // There's only one untitled slot at a time. If an earlier untitled
    // buffer was switched away from and left abandoned in Recent Files with
    // real content, starting a new blank one would otherwise silently wipe
    // it — ask first.
    if (SaveManager.hasDraft() && SaveManager.getDraft()) {
      const choice = await window.electronAPI?.confirmUnsaved();
      if (choice === 'cancel' || !choice) return;
      if (choice === 'save') {
        const ok = await SaveManager.saveDraftAs();
        if (!ok) return;
      }
    }
  } else if (SaveManager.isDirty()) {
    // Unsaved untitled buffer — there's no file to silently save to, so ask
    // before discarding its content.
    const choice = await window.electronAPI?.confirmUnsaved();
    if (choice === 'cancel' || !choice) return;
    if (choice === 'save') {
      await SaveManager.saveFile(); // opens the native Save-As dialog
      if (SaveManager.isDirty()) return; // user cancelled the save dialog — abort
    }
  }

  _resetToBlankUntitled();

  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  setMode('edit');
  RecentsPanel.render();
}

/**
 * Discard the untitled buffer that's *currently loaded* in the editor, from
 * the Recent Files draft row's × button (after the confirm dialog already
 * approved it). Distinct from newUntitledFile — the caller has already
 * decided to discard, so this never re-prompts.
 */
function discardLiveUntitledDraft() {
  _resetToBlankUntitled();
  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
  RecentsPanel.render();
}

/* ── Handle deleted/moved file ────────────────────────────────────── */

function _handleCurrentFileDeleted(deletedPath) {
  const name = deletedPath.split(/[\\/]/).pop() || deletedPath;
  currentFile = { name: 'untitled.md', path: null };
  StatusBar.updateFilename('untitled.md');
  StatusBar.updateChatContextFile('untitled.md');
  SaveManager.markClean();
  StatusBar.showToast(`"${name}" was deleted or moved outside the app`);
}

/* ── Global keyboard shortcuts ────────────────────────────────────── */

// Ctrl+S — save
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); SaveManager.saveFile(); }
});

// Ctrl+` — toggle edit / preview
document.addEventListener('keydown', e => {
  if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setMode(currentMode === 'edit' ? 'preview' : 'edit');
  }
});

// Ctrl+O — open file
document.addEventListener('keydown', async e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    const result = await window.electronAPI?.openFile();
    if (result?.filePath) await openSingleFile(result.filePath);
  }
});

// Ctrl+N — new untitled file (notepad-style; no folder or sidebar required)
document.addEventListener('keydown', async e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    await newUntitledFile();
  }
});

/* ── Window close guards ──────────────────────────────────────────── */

// Block close when unsaved — triggers Electron's will-prevent-unload
window.addEventListener('beforeunload', (e) => {
  if (SaveManager.isDirty() && !SaveManager.isBypassBeforeUnload()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Fire-and-forget silent save on every close (Electron drains IPC before teardown)
window.addEventListener('beforeunload', () => { SaveManager.silentSave(); });

/* ── Editor selection → AI chat ───────────────────────────────────── */

if (mdEditor) {
  document.addEventListener('selectionchange', () => {
    if (document.activeElement !== mdEditor) return;
    ChatPanel.captureEditorSelection();
  });
}

/* ── Welcome screen: Escape to dismiss ───────────────────────────── */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentFile.path) {
    const screen = document.getElementById('welcome-screen');
    if (screen && !screen.classList.contains('hidden')) WelcomeScreen.hideWelcomeScreen();
  }
});

/* ── Preview: link click handler ─────────────────────────────────── */
// Intercepts all anchor clicks in the preview pane.
// http/https → default OS browser via shell.openExternal
// .md/.markdown/.txt → open in editor, resolved relative to current file

if (previewContent) {
  previewContent.addEventListener('click', async (e) => {
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    e.preventDefault();

    const href = anchor.getAttribute('href');
    if (/^https?:\/\//i.test(href)) {
      await window.electronAPI.openExternal(href);
    } else if (/\.(md|markdown|txt)$/i.test(href)) {
      const currentPath = currentFile.path;
      if (!currentPath) return;
      const sep = currentPath.includes('\\') ? '\\' : '/';
      const dir = currentPath.replace(/[/\\][^/\\]+$/, '');
      const normalized = href.replace(/\//g, sep).replace(/^\.[\\/]/, '');
      await openFileByPath(dir + sep + normalized);
    }
  });
}

/* ── Toolbar button listeners ─────────────────────────────────────── */

document.getElementById('theme-toggle')?.addEventListener('click', ThemeManager.toggleTheme);
document.getElementById('btn-save')?.addEventListener('click',     SaveManager.saveFile);
document.getElementById('btn-export')?.addEventListener('click',   SaveManager.exportFile);

/* ═══════════════════════════════════════════════════════════════════
   DOMContentLoaded — initialise all modules
   ═══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  ThemeManager.applyStoredTheme();
  SidebarManager.initSidebarToggles();
  SearchPanel.init();
  FileTreeManager.initFolderDropdown();
  RecentsPanel.applyExplorerMode();

  const _version = window.electronAPI?.appVersion;
  if (_version) document.title = `MoilStack .md ${_version}`;

  const _openFileParam = new URLSearchParams(location.search).get('openFile');

  // Register OS IPC listeners before any awaits — did-finish-load fires while
  // the async DOMContentLoaded callback is suspended, so messages arrive early.
  if (window.electronAPI?.onOpenFileFromOS) {
    window.electronAPI.onOpenFileFromOS(async (filePath) => {
      SidebarManager.setExplorerVisible(true, true);
      await openFileByPath(filePath, { addToRecents: true });
    });
  }

  // ── IPC: OS folder open (taskbar jump list) ───────────────────────
  if (window.electronAPI?.onOpenFolderFromOS) {
    window.electronAPI.onOpenFolderFromOS(async (folderPath) => {
      SidebarManager.setExplorerVisible(true, false);
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
      StorageManager.addRecentItem('folder', folderPath, folderName);
      await FileTreeManager.setActiveFolder(folderPath);
    });
  }

  // ── Welcome screen quick-action buttons ──────────────────────────
  document.getElementById('welcome-btn-open-folder')?.addEventListener('click', async () => {
    const result = await window.electronAPI?.openFolder();
    if (result?.folderPath) {
      SidebarManager.setExplorerVisible(true, false);
      const folderName = result.folderPath.split(/[\\/]/).filter(Boolean).pop() || result.folderPath;
      StorageManager.addRecentItem('folder', result.folderPath, folderName);
      await FileTreeManager.setActiveFolder(result.folderPath);
    }
  });

  document.getElementById('welcome-btn-open-file')?.addEventListener('click', async () => {
    const result = await window.electronAPI?.openFile();
    if (result?.filePath) await openSingleFile(result.filePath);
  });

  document.getElementById('welcome-close-btn')?.addEventListener('click', () => {
    WelcomeScreen.hideWelcomeScreen();
  });

  const launchBehavior = localStorage.getItem('launchBehavior') || 'recents';
  // An unsaved draft from a previous session outranks both the Recents screen
  // and the "start blank" preference — there's real work to hand back.
  const _pendingDraft  = _openFileParam ? '' : SaveManager.getDraft();

  if (!_openFileParam && !_pendingDraft && launchBehavior !== 'untitled') {
    WelcomeScreen.showWelcomeScreen();
  }

  const savedFolder = sessionStorage.getItem('lastFolder') || localStorage.getItem('lastFolder');
  if (savedFolder && !_openFileParam) await FileTreeManager.setActiveFolder(savedFolder);

  StatusBar.updateFilename(currentFile.name);

  // ── EditorCore init ───────────────────────────────────────────────
  EditorCore.init({
    getEditor:          () => mdEditor,
    getPreviewContent:  () => previewContent,
    markDirty:          SaveManager.markDirty,
    saveFile:           SaveManager.saveFile,
    getCurrentFilePath: () => currentFile.path,
    onEditorInput:      () => FindReplaceWidget.resyncIfOpen(),
    getFindState:       () => FindReplaceWidget.getFindState(),
  });

  // ── ChatPanel init — must run BEFORE EditorCore.updateStats() ─────
  StatusBar.updateChatContextFile(currentFile.name);

  ChatPanel.init({
    getEditor:                () => document.getElementById('mdEditor'),
    getCurrentFile:           () => currentFile,
    escapeHtml:               MarkdownRenderer.escapeHtml,
    setEditorContentUndoable: EditorCore.setEditorContentUndoable,
    saveFile:                 SaveManager.saveFile,
    updateStats:              EditorCore.updateStats,
    updateHighlight:          EditorCore.updateHighlight,
    triggerUpdate:            EditorCore.triggerUpdate,
    syncRuler:                EditorCore.syncRuler,
    visualRowsForLine:        EditorCore.visualRowsForLine,
    getRulerCtx:              EditorCore.getRulerCtx,
    getRulerWidth:            EditorCore.getRulerWidth,
    getRulerLineH:            EditorCore.getRulerLineH,
  });

  EditorCore.updateStats();

  if (_openFileParam) {
    // Opened via "Open in New Window" (Explorer context menu) or Windows
    // Explorer/file association. This file isn't necessarily related to
    // whatever folder was open before — persist the sidebar as visible
    // (Recent Files is where this file is reachable) rather than hiding it;
    // it now only closes if the user explicitly toggles it via the header icon.
    SidebarManager.setExplorerVisible(true, true);
    await openFileByPath(_openFileParam, { addToRecents: true });
  } else if (_pendingDraft) {
    await newUntitledFile();
    if (mdEditor) {
      mdEditor.value = _pendingDraft;
      EditorCore.updateHighlight();
      EditorCore.updateStats();
      EditorCore.triggerUpdate();
    }
    SaveManager.markDirty();
    StatusBar.showToast('Restored unsaved draft from your last session.');
  } else if (launchBehavior === 'untitled') {
    await newUntitledFile();
  }

  if (!_openFileParam) ChatPanel.clearChat();
  ChatPanel.updateChatCount();
  ChatPanel.updateTokenEstimate();
  ChatPanel.updateFileSizeWarning();

  // A fresh untitled launch or a restored draft always opens in edit mode
  // (newUntitledFile already set this) — the Startup Mode preference only
  // applies when an existing file was opened.
  if (_openFileParam || (!_pendingDraft && launchBehavior !== 'untitled')) {
    const startupMode = localStorage.getItem('startupMode') || 'preview';
    setMode(startupMode);
  }

  // ── IPC: Save-and-close (user clicked "Save" in unsaved-changes dialog)
  window.electronAPI?.onSaveAndClose?.(async () => {
    await SaveManager.saveFile();
    if (!SaveManager.isDirty()) {
      SaveManager.setBypassBeforeUnload(true);
      window.close();
    }
  });

  // ── Custom title-bar window controls ──────────────────────────────
  const _wcMinimize = document.getElementById('wc-minimize');
  const _wcMaximize = document.getElementById('wc-maximize');
  const _wcClose    = document.getElementById('wc-close');

  if (_wcMinimize) _wcMinimize.addEventListener('click', () => window.electronAPI?.window?.minimize())
  if (_wcClose)    _wcClose.addEventListener('click',    () => window.electronAPI?.window?.close())
  if (_wcMaximize) {
    _wcMaximize.addEventListener('click', () => window.electronAPI?.window?.toggleMaximize())

    const MAXIMIZE_ICON = `<rect x="0.6" y="0.6" width="8.8" height="8.8" rx="0.5" stroke="currentColor" stroke-width="1.2"/>`
    const RESTORE_ICON  = `<rect x="2" y="0.6" width="7.4" height="7.4" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
      <polyline points="2,2 0.6,2 0.6,9.4 8,9.4 8,8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`

    function _updateMaximizeIcon(isMax) {
      const icon = document.getElementById('wc-maximize-icon')
      if (icon) icon.innerHTML = isMax ? RESTORE_ICON : MAXIMIZE_ICON
      _wcMaximize.title = isMax ? 'Restore' : 'Maximize'
      _wcMaximize.setAttribute('aria-label', isMax ? 'Restore window' : 'Maximize window')
    }

    const _isMax = await window.electronAPI?.window?.isMaximized()
    _updateMaximizeIcon(_isMax)
    window.electronAPI?.window?.onMaximizedChange(_updateMaximizeIcon)
  }

  // ── Window focus: refresh sidebar ─────────────────────────────────
  let _focusRefreshTimer = null;

  window.addEventListener('focus', () => {
    clearTimeout(_focusRefreshTimer);
    _focusRefreshTimer = setTimeout(async () => {
      const folderPath = sessionStorage.getItem('lastFolder');
      if (!folderPath) return;

      const prevFilePath = currentFile.path;
      await FileTreeManager.setActiveFolder(folderPath);

      // Only treat a missing tree entry as "deleted" when the open file was
      // actually supposed to live inside the active folder. A file saved,
      // opened, or reopened from elsewhere (Save-As to another location,
      // Ctrl+O, a Recent Files entry from a different folder) is correctly
      // absent from this tree — that's not a deletion.
      const insideActiveFolder = prevFilePath && (
        prevFilePath.startsWith(folderPath + '/') ||
        prevFilePath.startsWith(folderPath + '\\')
      );

      if (insideActiveFolder) {
        if (FileTreeManager.fileExistsInTree(prevFilePath)) {
          FileTreeManager.restoreActiveItem();
        } else {
          _handleCurrentFileDeleted(prevFilePath);
        }
      }
    }, 300);
  });

  RecentsPanel.render();

  // ── Startup UI work is done — show the window now ──────────────────
  window.electronAPI?.notifyReady?.();

});
