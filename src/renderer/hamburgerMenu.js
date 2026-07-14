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

  /* ── Collapse All button (sidebar header) ─────────────────────────── */
  // Disabled in Root folder only mode, since that view has no sub-folders to
  // collapse (see FileTreeManager.updateFolderToolbarButtons).
  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    const rootOnly = (localStorage.getItem('explorerMode') || 'multi-level') === 'root-only';
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
