/**
 * sidebarManager.js — Explorer (left) and AI Assistant (right) sidebar toggles.
 */

const SidebarManager = (() => {

  function setExplorerVisible(visible, persist = true) {
    const sidebar = document.querySelector('.left-sidebar');
    const btn     = document.getElementById('btn-toggle-explorer');
    if (!sidebar) return;
    sidebar.classList.toggle('left-sidebar--hidden', !visible);
    if (btn) btn.classList.toggle('sidebar-toggle-btn--active', visible);
    if (persist) {
      localStorage.setItem('sidebar-explorer', visible ? 'visible' : 'hidden');
    }
  }

  function setAIVisible(visible, persist = true) {
    const sidebar = document.querySelector('.right-sidebar');
    const btn     = document.getElementById('btn-toggle-ai');
    if (!sidebar) return;
    sidebar.classList.toggle('right-sidebar--hidden', !visible);
    if (btn) btn.classList.toggle('sidebar-toggle-btn--active', visible);
    if (persist) {
      localStorage.setItem('sidebar-ai', visible ? 'visible' : 'hidden');
    }
  }

  function initSidebarToggles() {
    const explorerVisible = localStorage.getItem('sidebar-explorer') !== 'hidden';
    const aiVisible       = localStorage.getItem('sidebar-ai')       !== 'hidden';

    setExplorerVisible(explorerVisible, false);
    setAIVisible(aiVisible);

    document.getElementById('btn-toggle-explorer')?.addEventListener('click', () => {
      const sidebar = document.querySelector('.left-sidebar');
      setExplorerVisible(sidebar?.classList.contains('left-sidebar--hidden') ?? false);
    });

    document.getElementById('btn-toggle-ai')?.addEventListener('click', () => {
      const sidebar = document.querySelector('.right-sidebar');
      setAIVisible(sidebar?.classList.contains('right-sidebar--hidden') ?? false);
    });
  }

  return { setExplorerVisible, setAIVisible, initSidebarToggles };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SidebarManager };
}
