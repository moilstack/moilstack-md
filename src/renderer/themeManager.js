/**
 * themeManager.js — Light / Dim / Dark theme cycling and persistence.
 */

const ThemeManager = (() => {

  const THEME_ORDER = ['light', 'dim', 'dark'];

  const ICONS = {
    light: `<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    dim: `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
<path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor"/>`,
    dark: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
  stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"/>`,
  };

  const LABELS = { light: 'Light', dim: 'Dim', dark: 'Dark' };

  // The toggle button always advertises the theme a click will switch TO.
  function nextTheme(current) {
    const idx = THEME_ORDER.indexOf(current);
    return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
  }

  function updateToggleUI(current) {
    const target = nextTheme(current);
    const label  = document.getElementById('theme-label');
    const icon   = document.getElementById('theme-icon');
    if (label) label.textContent = LABELS[target];
    if (icon)  icon.innerHTML    = ICONS[target];
  }

  function toggleTheme() {
    const html    = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const newTheme = nextTheme(current);

    document.body.classList.add('theme-transitioning');
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    updateToggleUI(newTheme);

    // EditorCore is loaded after this module; reference is lazy (resolved at call time).
    EditorCore.updateHighlight();

    setTimeout(() => document.body.classList.remove('theme-transitioning'), 250);
  }

  function applyStoredTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateToggleUI(saved);
  }

  return { toggleTheme, applyStoredTheme };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager };
}
