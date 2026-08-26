/**
 * hamburgerMenu.js — Header hamburger-menu toggle and all menu-item handlers.
 *
 * openSingleFile and setMode are global functions declared in index.js (lazy references).
 */

const HamburgerMenu = (() => {

  const btnHamburger  = document.getElementById('btn-hamburger');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const hamburgerWrap = document.getElementById('hamburger-wrapper');

  function toggleHamburgerMenu() {
    const opening = hamburgerMenu?.classList.contains('hidden');
    hamburgerMenu?.classList.toggle('hidden', !opening);
    btnHamburger?.classList.toggle('hamburger-btn--open', opening);
    btnHamburger?.setAttribute('aria-expanded', String(opening));
  }

  function closeHamburgerMenu() {
    hamburgerMenu?.classList.add('hidden');
    btnHamburger?.classList.remove('hamburger-btn--open');
    btnHamburger?.setAttribute('aria-expanded', 'false');
  }

  btnHamburger?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHamburgerMenu();
  });

  document.addEventListener('click', (e) => {
    if (hamburgerWrap && !hamburgerWrap.contains(e.target)) closeHamburgerMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHamburgerMenu();
  });

  /* ── Menu items ───────────────────────────────────────────────────── */

  document.getElementById('hmenu-new')?.addEventListener('click', async () => {
    closeHamburgerMenu();
    await newUntitledFile();
  });

  document.getElementById('hmenu-new-explorer-file')?.addEventListener('click', async () => {
    closeHamburgerMenu();
    await FileOperations.triggerExplorerNewFile();
  });

  document.getElementById('hmenu-open-file')?.addEventListener('click', async () => {
    closeHamburgerMenu();
    const result = await window.electronAPI?.openFile();
    if (result?.filePath) await openSingleFile(result.filePath);
  });

  document.getElementById('hmenu-open-folder')?.addEventListener('click', async () => {
    closeHamburgerMenu();
    const result = await window.electronAPI?.openFolder();
    if (result?.folderPath) {
      SidebarManager.setExplorerVisible(true, false);
      const folderName = result.folderPath.split(/[\\/]/).filter(Boolean).pop() || result.folderPath;
      StorageManager.addRecentItem('folder', result.folderPath, folderName);
      FileTreeManager.setActiveFolder(result.folderPath);
    }
  });

  document.getElementById('hmenu-recents')?.addEventListener('click', () => {
    closeHamburgerMenu();
    WelcomeScreen.showWelcomeScreen();
  });

  document.getElementById('hmenu-save')?.addEventListener('click', () => {
    closeHamburgerMenu();
    SaveManager.saveFile();
  });

  document.getElementById('hmenu-export')?.addEventListener('click', () => {
    closeHamburgerMenu();
    SaveManager.exportFile();
  });

  document.getElementById('hmenu-toggle')?.addEventListener('click', () => {
    closeHamburgerMenu();
    setMode(currentMode === 'edit' ? 'preview' : 'edit');
  });

  document.getElementById('hmenu-new-instance')?.addEventListener('click', () => {
    closeHamburgerMenu();
    window.electronAPI?.newWindow?.();
  });

  document.getElementById('hmenu-find')?.addEventListener('click', () => {
    closeHamburgerMenu();
    FindReplaceWidget.openFindWidget(false);
  });

  document.getElementById('hmenu-replace')?.addEventListener('click', () => {
    closeHamburgerMenu();
    FindReplaceWidget.openFindWidget(true);
  });

  document.getElementById('hmenu-settings')?.addEventListener('click', () => {
    closeHamburgerMenu();
    document.getElementById('btnSettings')?.click();
  });

  /* ── "Explorer" label (sidebar header) — cycles Explorer Mode ──────── */
  const EXPLORER_MODES = [
    { value: 'root-only',   label: 'Root folder only' },
    { value: 'multi-level', label: 'Multi-level' },
    { value: 'custom',      label: 'Recent Only (no folder)' },
  ];

  function _cycleExplorerMode() {
    const current  = localStorage.getItem('explorerMode') || 'root-only';
    const idx      = EXPLORER_MODES.findIndex(m => m.value === current);
    const next     = EXPLORER_MODES[(idx + 1) % EXPLORER_MODES.length];

    localStorage.setItem('explorerMode', next.value);
    const explorerModeSel = document.getElementById('explorerMode');
    if (explorerModeSel) explorerModeSel.value = next.value;

    FileTreeManager.updateFolderToolbarButtons();
    FileTreeManager.refresh();
    RecentsPanel.applyExplorerMode();
    RecentsPanel.render();

    StatusBar.showToast(`Explorer mode: ${next.label}`);
  }
  const _sidebarExplorerLabel = document.getElementById('sidebarExplorerLabel');
  _sidebarExplorerLabel?.addEventListener('click', _cycleExplorerMode);
  _sidebarExplorerLabel?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _cycleExplorerMode(); }
  });

  /* ── Collapse All button (sidebar header) ─────────────────────────── */
  // Disabled in Root folder only mode, since that view has no sub-folders to
  // collapse (see FileTreeManager.updateFolderToolbarButtons).
  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    const rootOnly = (localStorage.getItem('explorerMode') || 'root-only') === 'root-only';
    if (rootOnly) return;
    FileTreeManager.collapseAll();
  });

  /* ── Open Folder button (sidebar header) ──────────────────────────── */
  document.getElementById('btn-open-folder')?.addEventListener('click', async () => {
    if (window.electronAPI?.openFolder) {
      const result = await window.electronAPI.openFolder();
      if (result?.folderPath) {
        SidebarManager.setExplorerVisible(true, false);
        const folderName = result.folderPath.split(/[\\/]/).filter(Boolean).pop() || result.folderPath;
        StorageManager.addRecentItem('folder', result.folderPath, folderName);
        FileTreeManager.setActiveFolder(result.folderPath);
      }
    }
  });

  return { closeHamburgerMenu };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HamburgerMenu };
}
