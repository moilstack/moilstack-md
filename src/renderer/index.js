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
async function openFileByPath(filePath) {
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
  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
}

/**
 * Open a single .md file from the file picker (Ctrl+O or recent-items click).
 * Hides the explorer sidebar (no folder context), shows full path in header.
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

  SidebarManager.setExplorerVisible(false, false);

  const label = document.getElementById('header-folder-name');
  if (label) label.textContent = filePath;

  selectFile(null, filePath, content.split('\n').length, content.length);

  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  StorageManager.addRecentItem('file', filePath, fileName);
  WelcomeScreen.hideWelcomeScreen();
  ChatPanel.clearChat();
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

// Ctrl+N — new file
document.addEventListener('keydown', async e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    const savedFolder = sessionStorage.getItem('lastFolder');
    if (savedFolder) {
      FileOperations.showNewFileInput();
    } else {
      const result = await window.electronAPI?.openFolder();
      if (result?.folderPath) {
        await FileTreeManager.setActiveFolder(result.folderPath);
        FileOperations.showNewFileInput();
      }
    }
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

  const _version = window.electronAPI?.appVersion;
  if (_version) document.title = `MoilStack .md ${_version}`;

  const _openFileParam = new URLSearchParams(location.search).get('openFile');

  // Register OS IPC listeners before any awaits — did-finish-load fires while
  // the async DOMContentLoaded callback is suspended, so messages arrive early.
  if (window.electronAPI?.onOpenFileFromOS) {
    window.electronAPI.onOpenFileFromOS(async (filePath) => {
      SidebarManager.setExplorerVisible(true, false);
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      StorageManager.addRecentItem('file', filePath, fileName);
      await openFileByPath(filePath);
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

  WelcomeScreen.showWelcomeScreen();

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
    SidebarManager.setExplorerVisible(true, false);
    const _paramFileName = _openFileParam.split(/[\\/]/).pop() || _openFileParam;
    StorageManager.addRecentItem('file', _openFileParam, _paramFileName);
    await openFileByPath(_openFileParam);
  }

  if (!_openFileParam) ChatPanel.clearChat();
  ChatPanel.updateChatCount();
  ChatPanel.updateTokenEstimate();
  ChatPanel.updateFileSizeWarning();

  const startupMode = localStorage.getItem('startupMode') || 'preview';
  setMode(startupMode);

  // ── IPC: Save-and-close (user clicked "Save" in unsaved-changes dialog)
  window.electronAPI?.onSaveAndClose?.(async () => {
    await SaveManager.saveFile();
    if (!SaveManager.isDirty()) {
      SaveManager.setBypassBeforeUnload(true);
      window.close();
    }
  });

  // ── Window focus: refresh sidebar ─────────────────────────────────
  let _focusRefreshTimer = null;

  window.addEventListener('focus', () => {
    clearTimeout(_focusRefreshTimer);
    _focusRefreshTimer = setTimeout(async () => {
      const folderPath = sessionStorage.getItem('lastFolder');
      if (!folderPath) return;

      const prevFilePath = currentFile.path;
      await FileTreeManager.setActiveFolder(folderPath);

      if (prevFilePath) {
        if (FileTreeManager.fileExistsInTree(prevFilePath)) {
          FileTreeManager.restoreActiveItem();
        } else {
          _handleCurrentFileDeleted(prevFilePath);
        }
      }
    }, 300);
  });

});
