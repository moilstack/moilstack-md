/**
 * themeManager.js — Light / Dark theme toggle and persistence.
 */

const ThemeManager = (() => {

  const MOON_SVG = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
  stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"/>`;

  const SUN_SVG = `<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;

  function toggleTheme() {
    const html     = document.documentElement;
    const isDark   = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    document.body.classList.add('theme-transitioning');
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    const label = document.getElementById('theme-label');
    const icon  = document.getElementById('theme-icon');
    if (label) label.textContent = isDark ? 'Dark' : 'Light';
    if (icon)  icon.innerHTML    = isDark ? MOON_SVG : SUN_SVG;

    // EditorCore is loaded after this module; reference is lazy (resolved at call time).
    EditorCore.updateHighlight();

    setTimeout(() => document.body.classList.remove('theme-transitioning'), 250);
  }

  function applyStoredTheme() {
    const saved = localStorage.getItem('theme');
    if (!saved) return;
    const html = document.documentElement;
    html.setAttribute('data-theme', saved);
    if (saved === 'dark') {
      const label = document.getElementById('theme-label');
      const icon  = document.getElementById('theme-icon');
      if (label) label.textContent = 'Light';
      if (icon)  icon.innerHTML    = SUN_SVG;
    }
  }

  return { toggleTheme, applyStoredTheme };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager };
}
