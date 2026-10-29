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

  /* ── Explorer resize (drag the divider) ───────────────────────────── */

  const SIDEBAR_MIN     = 180;
  const SIDEBAR_DEFAULT = 280;
  const MAIN_MIN        = 360;   // always leave this much for the editor/preview

  function _clampWidth(w) {
    const max = Math.max(SIDEBAR_MIN, window.innerWidth - MAIN_MIN);
    return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, w)));
  }

  function setSidebarWidth(w, persist = true) {
    const width = _clampWidth(w);
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    if (persist) localStorage.setItem('sidebarWidth', width);
    // Editor ruler / line wrapping depend on the editor's width
    if (typeof window.invalidateEditorRuler === 'function') window.invalidateEditorRuler();
  }

  (function _initResizer() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.querySelector('.left-sidebar');
    if (!resizer || !sidebar) return;

    resizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebar.getBoundingClientRect().width;
      resizer.setPointerCapture(e.pointerId);
      document.body.classList.add('is-resizing-sidebar');

      const onMove = ev => setSidebarWidth(startW + ev.clientX - startX, false);
      const onUp = ev => {
        resizer.releasePointerCapture(ev.pointerId);
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        resizer.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-resizing-sidebar');
        setSidebarWidth(sidebar.getBoundingClientRect().width, true);
      };
      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
      resizer.addEventListener('pointercancel', onUp);
    });

    resizer.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR_DEFAULT));

    // Keyboard: ←/→ nudge by 16px (Shift: 64px)
    resizer.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowLeft' ? -1 : 1);
      setSidebarWidth(sidebar.getBoundingClientRect().width + step);
    });

    // Re-clamp a saved width that no longer fits a smaller window
    window.addEventListener('resize', () => {
      const saved = parseInt(localStorage.getItem('sidebarWidth') || '', 10);
      if (saved) setSidebarWidth(saved, false);
    });
  })();

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
