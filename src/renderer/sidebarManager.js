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
    const fab    = document.getElementById('btn-toggle-ai');
    const header = document.getElementById('chatHeader');
    if (!panel) return;
    panel.classList.toggle('ai-bottom-panel--collapsed', !expanded);
    if (fab) {
      fab.classList.toggle('ai-fab--active', expanded);
      fab.setAttribute('aria-expanded', String(expanded));
      fab.title = expanded ? 'Close AI Assistant' : 'Open AI Assistant';
    }
    if (header) header.setAttribute('aria-expanded', String(expanded));
    if (persist) {
      localStorage.setItem('aiPanelExpanded', expanded ? '1' : '0');
    }
  }

  function initSidebarToggles() {
    const explorerVisible = localStorage.getItem('sidebar-explorer') !== 'hidden';
    // The AI popup always starts closed — it's a floating widget, not a
    // persistent panel, so re-opening it on every launch would be surprising.
    setExplorerVisible(explorerVisible, false);
    setAIPanelExpanded(false, false);

    document.getElementById('btn-toggle-explorer')?.addEventListener('click', () => {
      const sidebar = document.querySelector('.left-sidebar');
      setExplorerVisible(sidebar?.classList.contains('left-sidebar--hidden') ?? false);
    });

    document.getElementById('btn-toggle-ai')?.addEventListener('click', () => {
      const panel = document.getElementById('aiBottomPanel');
      setAIPanelExpanded(panel?.classList.contains('ai-bottom-panel--collapsed') ?? false);
    });

    document.getElementById('btn-close-ai')?.addEventListener('click', () => {
      setAIPanelExpanded(false);
    });
  }

  return { setExplorerVisible, setAIPanelExpanded, initSidebarToggles };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SidebarManager };
}
