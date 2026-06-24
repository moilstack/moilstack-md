/**
 * contextMenus.js — Editor, file, and folder right-click context menus.
 *
 * FileOperations is loaded after this module; all cross-calls are lazy (inside handlers).
 */

const ContextMenus = (() => {

  /* ── Editor context menu ──────────────────────────────────────────── */

  const ctxMenu   = document.getElementById('ctx-menu');
  const _editorEl = document.getElementById('mdEditor');

  function showCtxMenu(x, y) {
    if (!ctxMenu) return;
    ctxMenu.classList.add('visible');
    const mw = ctxMenu.offsetWidth  || 200;
    const mh = ctxMenu.offsetHeight || 300;
    ctxMenu.style.left = `${Math.max(0, Math.min(x, window.innerWidth  - mw - 6))}px`;
    ctxMenu.style.top  = `${Math.max(0, Math.min(y, window.innerHeight - mh - 6))}px`;
  }

  function hideCtxMenu() {
    ctxMenu?.classList.remove('visible');
  }

  if (_editorEl) {
    _editorEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY);
    });
  }

  ctxMenu?.querySelectorAll('[data-action]').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const action = EditorCore.TOOLBAR_ACTIONS[item.dataset.action];
      if (action) action();
      hideCtxMenu();
    });
  });

  document.addEventListener('click',   e => { if (!ctxMenu?.contains(e.target)) hideCtxMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

  /* ── File context menu ────────────────────────────────────────────── */

  const fileCtxMenu = document.getElementById('file-ctx-menu');
  let _fileCtxTarget = null;

  function showFileCtxMenu(filePath, x, y) {
    if (!fileCtxMenu) return;
    _fileCtxTarget = filePath;
    const isRootOnly = (localStorage.getItem('explorerMode') || 'multi-level') === 'root-only';
    const labelBtn   = fileCtxMenu.querySelector('[data-file-action="label"]');
    const labelDivider = labelBtn?.previousElementSibling;
    if (labelBtn)   labelBtn.style.display   = isRootOnly ? '' : 'none';
    if (labelDivider && labelDivider.classList.contains('file-ctx-divider'))
      labelDivider.style.display = isRootOnly ? '' : 'none';
    fileCtxMenu.classList.add('visible');
    const mw = fileCtxMenu.offsetWidth  || 180;
    const mh = fileCtxMenu.offsetHeight || 80;
    fileCtxMenu.style.left = `${Math.min(x, window.innerWidth  - mw - 6)}px`;
    fileCtxMenu.style.top  = `${Math.min(y, window.innerHeight - mh - 6)}px`;
  }

  function hideFileCtxMenu() {
    fileCtxMenu?.classList.remove('visible');
    _fileCtxTarget = null;
  }

  fileCtxMenu?.querySelectorAll('[data-file-action]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      const action   = btn.dataset.fileAction;
      const filePath = _fileCtxTarget;
      hideFileCtxMenu();
      if (!filePath) return;

      if (action === 'open-in-new-window') {
        window.electronAPI?.openInNewWindow(filePath);
      } else if (action === 'open-in-explorer') {
        window.electronAPI?.showInExplorer(filePath);
      } else if (action === 'rename') {
        FileOperations.startInlineRename(filePath);
      } else if (action === 'delete') {
        ContextMenus.showDeleteConfirm(filePath);
      } else if (action === 'label') {
        LabelModal.show(filePath);
      }
    });
  });

  /* ── Folder context menu ──────────────────────────────────────────── */

  const folderCtxMenuEl = document.getElementById('folder-ctx-menu');
  let _folderCtxTarget  = null;
  let _folderCtxDepth   = 0;

  function _isFolderEmpty(folderPath) {
    function _find(nodes) {
      for (const n of nodes) {
        if (n.type === 'folder' && n.path === folderPath)
          return !n.children || n.children.length === 0;
        if (n.type === 'folder' && n.children) {
          const result = _find(n.children);
          if (result !== null) return result;
        }
      }
      return null;
    }
    const tree = FileTreeManager.getCachedTree() ?? [];
    return _find(tree) ?? false;
  }

  function showFolderCtxMenu(folderPath, depth, x, y) {
    if (!folderCtxMenuEl) return;
    _folderCtxTarget = folderPath;
    _folderCtxDepth  = depth;

    const subBtn = folderCtxMenuEl.querySelector('[data-folder-action="new-subfolder"]');
    if (subBtn) subBtn.classList.toggle('hidden', depth >= 4);

    const isEmpty = _isFolderEmpty(folderPath);
    const delBtn      = document.getElementById('folder-ctx-delete-btn');
    const delDivider  = document.getElementById('folder-ctx-delete-divider');
    if (delBtn)     delBtn.classList.toggle('hidden', !isEmpty);
    if (delDivider) delDivider.classList.toggle('hidden', !isEmpty);

    folderCtxMenuEl.classList.add('visible');
    const mw = folderCtxMenuEl.offsetWidth  || 180;
    const mh = folderCtxMenuEl.offsetHeight || 100;
    folderCtxMenuEl.style.left = `${Math.min(x, window.innerWidth  - mw - 6)}px`;
    folderCtxMenuEl.style.top  = `${Math.min(y, window.innerHeight - mh - 6)}px`;
  }

  function hideFolderCtxMenu() {
    folderCtxMenuEl?.classList.remove('visible');
    _folderCtxTarget = null;
  }

  folderCtxMenuEl?.querySelectorAll('[data-folder-action]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      const action     = btn.dataset.folderAction;
      const folderPath = _folderCtxTarget;
      hideFolderCtxMenu();
      if (!folderPath) return;

      if (action === 'open-in-explorer') {
        window.electronAPI?.showInExplorer(folderPath);
      } else if (action === 'new-file-here') {
        FileOperations.showNewFileInput(folderPath);
      } else if (action === 'new-subfolder') {
        FileOperations.promptNewFolder(folderPath);
      } else if (action === 'delete-folder') {
        ContextMenus.showDeleteConfirm(folderPath, 'folder');
      }
    });
  });

  /* ── Delete confirmation modal ────────────────────────────────────── */

  const _deleteOverlay   = document.getElementById('deleteConfirmOverlay');
  const _deleteFileName  = document.getElementById('deleteConfirmFileName');
  const _deleteDetail    = document.getElementById('deleteConfirmDetail');
  const _deleteNote      = document.getElementById('deleteConfirmNote');
  let   _deleteTarget    = null;
  let   _deleteType      = 'file'; // 'file' | 'folder'

  function showDeleteConfirm(targetPath, type = 'file') {
    _deleteTarget = targetPath;
    _deleteType   = type;
    const name = targetPath.split(/[\\/]/).pop();
    if (_deleteFileName) _deleteFileName.textContent = name;
    if (_deleteDetail) {
      _deleteDetail.textContent = type === 'folder'
        ? 'is an empty folder and will be sent to the Recycle Bin.'
        : 'will be sent to the Recycle Bin and can be restored from there.';
    }
    if (_deleteNote) {
      _deleteNote.textContent = 'Note: On network drives the item may be permanently deleted.';
    }
    _deleteOverlay?.classList.remove('hidden');
  }

  function _hideDeleteConfirm() {
    _deleteOverlay?.classList.add('hidden');
    _deleteTarget = null;
  }

  async function _confirmDelete() {
    const targetPath = _deleteTarget;
    const type       = _deleteType;
    _hideDeleteConfirm();
    if (!targetPath) return;

    const result = await window.electronAPI?.trashFile(targetPath);
    if (!result?.ok) {
      StatusBar.showToast(result?.error || `Failed to delete ${type}.`);
      return;
    }

    const rootFolder = sessionStorage.getItem('lastFolder');
    if (type === 'file' && typeof currentFile !== 'undefined' && currentFile?.path === targetPath) {
      const editor = document.getElementById('mdEditor');
      if (editor) editor.value = '';
      window.currentFile = { name: 'untitled.md', path: null };
      StatusBar.updateFilename('');
      WelcomeScreen.showWelcomeScreen();
    }
    if (rootFolder) await FileTreeManager.setActiveFolder(rootFolder);
    StatusBar.showToast(`${type === 'folder' ? 'Folder' : 'File'} moved to Recycle Bin.`);
  }

  document.getElementById('btnCloseDeleteConfirm')?.addEventListener('click', _hideDeleteConfirm);
  document.getElementById('btnDeleteCancel')?.addEventListener('click',       _hideDeleteConfirm);
  document.getElementById('btnDeleteConfirm')?.addEventListener('click',      _confirmDelete);
  _deleteOverlay?.addEventListener('click', e => { if (e.target === _deleteOverlay) _hideDeleteConfirm(); });

  /* ── Shared dismiss handlers ──────────────────────────────────────── */

  document.addEventListener('click', e => {
    if (!fileCtxMenu?.contains(e.target))     hideFileCtxMenu();
    if (!folderCtxMenuEl?.contains(e.target)) hideFolderCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideFileCtxMenu(); hideFolderCtxMenu(); _hideDeleteConfirm(); }
  });

  return {
    showCtxMenu,
    hideCtxMenu,
    showFileCtxMenu,
    hideFileCtxMenu,
    showFolderCtxMenu,
    hideFolderCtxMenu,
    showDeleteConfirm,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ContextMenus };
}

/* ── Label Modal ──────────────────────────────────────────────────────────
   Opened via right-click → "Label…" on any file item.
   ─────────────────────────────────────────────────────────────────────── */

const LabelModal = (() => {
  const _overlay    = document.getElementById('labelModalOverlay');
  const _swatches   = document.getElementById('labelColorSwatches');
  const _saveBtn    = document.getElementById('btnSaveLabel');
  const _removeBtn  = document.getElementById('btnRemoveLabel');
  const _closeBtn   = document.getElementById('btnCloseLabelModal');

  let _filePath     = null;
  let _selectedColor = '#3b82f6';   // default: blue

  function _selectColor(color) {
    _selectedColor = color;
    _swatches?.querySelectorAll('.label-swatch').forEach(s => {
      s.classList.toggle('label-swatch--active', s.dataset.color === color);
    });
  }

  function _hide() {
    _overlay?.classList.add('hidden');
    _filePath = null;
  }

  async function show(filePath) {
    _filePath = filePath;

    const allLabels = await window.electronAPI?.labels?.get() ?? {};
    const current   = allLabels[filePath];
    _selectColor(current?.color ?? '#3b82f6');

    _removeBtn?.classList.toggle('hidden', !current);
    _overlay?.classList.remove('hidden');
  }

  // Swatch clicks
  _swatches?.querySelectorAll('.label-swatch').forEach(s => {
    s.addEventListener('click', () => _selectColor(s.dataset.color));
  });

  // Save
  _saveBtn?.addEventListener('click', async () => {
    if (!_filePath) return;
    await window.electronAPI?.labels?.set(_filePath, { color: _selectedColor });
    _hide();
    await FileTreeManager.renderFileTree();
    FileTreeManager.restoreActiveItem();
  });

  // Remove
  _removeBtn?.addEventListener('click', async () => {
    if (!_filePath) return;
    await window.electronAPI?.labels?.set(_filePath, null);
    _hide();
    await FileTreeManager.renderFileTree();
    FileTreeManager.restoreActiveItem();
  });

  // Close
  _closeBtn?.addEventListener('click', _hide);
  _overlay?.addEventListener('click', e => { if (e.target === _overlay) _hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !_overlay?.classList.contains('hidden')) _hide(); });

  return { show };
})();
