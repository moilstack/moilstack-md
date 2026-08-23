/**
 * sidebarManager.js — Explorer (left) sidebar toggle and AI Assistant
 * (bottom panel) expand/collapse.
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

  function setAIPanelExpanded(expanded, persist = true) {
    const panel  = document.getElementById('aiBottomPanel');
    const btn    = document.getElementById('btn-toggle-ai');
    const header = document.getElementById('chatHeader');
    if (!panel) return;
    panel.classList.toggle('ai-bottom-panel--collapsed', !expanded);
    if (btn) btn.classList.toggle('sidebar-toggle-btn--active', expanded);
    if (header) header.setAttribute('aria-expanded', String(expanded));
    if (persist) {
      localStorage.setItem('aiPanelExpanded', expanded ? '1' : '0');
    }
  }

  function initSidebarToggles() {
    const explorerVisible = localStorage.getItem('sidebar-explorer') !== 'hidden';
    const aiExpanded      = localStorage.getItem('aiPanelExpanded') === '1';

    setExplorerVisible(explorerVisible, false);
    setAIPanelExpanded(aiExpanded, false);

    document.getElementById('btn-toggle-explorer')?.addEventListener('click', () => {
      const sidebar = document.querySelector('.left-sidebar');
      setExplorerVisible(sidebar?.classList.contains('left-sidebar--hidden') ?? false);
    });

    document.getElementById('btn-toggle-ai')?.addEventListener('click', () => {
      const panel = document.getElementById('aiBottomPanel');
      setAIPanelExpanded(panel?.classList.contains('ai-bottom-panel--collapsed') ?? false);
    });

    document.getElementById('chatHeader')?.addEventListener('click', (e) => {
      if (e.target.closest('#btnModelPicker, #modelPickerDropdown, #btn-clear-chat')) return;
      const panel = document.getElementById('aiBottomPanel');
      setAIPanelExpanded(panel?.classList.contains('ai-bottom-panel--collapsed') ?? false);
    });
  }

  return { setExplorerVisible, setAIPanelExpanded, initSidebarToggles };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SidebarManager };
}
