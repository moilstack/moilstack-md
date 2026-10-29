/**
 * themeManager.js — theme picker dropdown (with hover preview) and persistence.
 */

const ThemeManager = (() => {

  // Light themes first, then dark — the order shown in the theme menu
  const THEME_ORDER = [
    'light', 'ivory-slate', 'xcode-light', 'github-light', 'one-light', 'paper',
    'dim', 'nord', 'forest', 'midnight', 'dark',
  ];

  const ICONS = {
    light: `<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    'ivory-slate': `<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="1.5 2"/>`,
    'xcode-light': `<rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="2"/>
<path d="M10 9l-3 3 3 3M14 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    dim: `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
<path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor"/>`,
    dark: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
  stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"/>`,
  };

  const LABELS = {
    light: 'Light', 'ivory-slate': 'Ivory & Slate', 'xcode-light': 'Xcode Light',
    'github-light': 'GitHub Light', 'one-light': 'One Light', paper: 'Paper',
    dim: 'Dim', nord: 'Nord', forest: 'Forest', midnight: 'Midnight', dark: 'Dark',
  };

  // New themes reuse an existing icon: sun for light, moon for dark
  const DARK_THEMES = new Set(['dim', 'nord', 'forest', 'midnight', 'dark']);

  // Swatch colours: [background, sidebar, accent] — mirrors the tokens in styles.css
  const SWATCHES = {
    light:         ['#ffffff', '#f8f9fb', '#4f46e5'],
    'ivory-slate': ['#fffdf7', '#f7f5ed', '#2f5d82'],
    'xcode-light': ['#ffffff', '#f5f5f7', '#0b57d0'],
    dim:           ['#3b414c', '#3b414c', '#61afef'],
    'github-light':['#ffffff', '#f6f8fa', '#0969da'],
    'one-light':   ['#fafafa', '#eaeaeb', '#4078f2'],
    paper:         ['#ffffff', '#f7f7f5', '#2383e2'],
    nord:          ['#2e3440', '#292e39', '#88c0d0'],
    forest:        ['#1f2622', '#1a201c', '#7fb685'],
    midnight:      ['#0a0a0b', '#000000', '#2dd4bf'],
    dark:          ['#282c34', '#21252b', '#c678dd'],
  };

  const _html = document.documentElement;
  let _menu = null;
  let _committed = null;   // the saved theme (marked ✓ in the menu)

  function _current() { return _html.getAttribute('data-theme') || 'dark'; }

  /** The button shows the current theme (not the next one) plus a caret. */
  function updateToggleUI(current) {
    const label = document.getElementById('theme-label');
    const icon  = document.getElementById('theme-icon');
    if (label) label.textContent = LABELS[current] || current;
    if (icon)  icon.innerHTML    = ICONS[current] || (DARK_THEMES.has(current) ? ICONS.dark : ICONS.light);
  }

  function _setAttr(theme) {
    _html.setAttribute('data-theme', theme);
    // EditorCore is loaded after this module; reference is lazy (resolved at call time).
    if (typeof EditorCore !== 'undefined') EditorCore.updateHighlight();
  }

  /** Apply and save a theme, with the usual short colour fade. */
  function setTheme(theme) {
    if (!LABELS[theme]) return;
    document.body.classList.add('theme-transitioning');
    _setAttr(theme);
    localStorage.setItem('theme', theme);
    _committed = theme;
    updateToggleUI(theme);
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 250);
  }

  /* ── Dropdown ── */

  function _buildMenu() {
    _menu = document.createElement('div');
    _menu.className = 'theme-menu hidden';
    _menu.setAttribute('role', 'menu');
    _menu.setAttribute('aria-label', 'Theme');
    for (const theme of THEME_ORDER) {
      if (theme === 'dim') {
        const sep = document.createElement('div');
        sep.className = 'theme-menu__sep';
        sep.setAttribute('role', 'separator');
        _menu.appendChild(sep);
      }
      const [bg, side, accent] = SWATCHES[theme];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'theme-menu__item';
      item.dataset.themeId = theme;   // not data-theme — that would apply the theme's colours to the item
      item.setAttribute('role', 'menuitemradio');
      item.innerHTML =
        `<span class="theme-menu__swatch" aria-hidden="true">` +
          `<i style="background:${side}"></i><i style="background:${bg}"></i><i style="background:${accent}"></i>` +
        `</span>` +
        `<span class="theme-menu__name">${LABELS[theme]}</span>` +
        `<svg class="theme-menu__check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">` +
          `<path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      // The app keeps its current theme until an item is clicked (no hover preview)
      item.addEventListener('mouseenter', () => item.focus());
      item.addEventListener('click', () => { setTheme(theme); closeMenu(); });
      _menu.appendChild(item);
    }
    _menu.addEventListener('keydown', e => {
      const items = [..._menu.querySelectorAll('.theme-menu__item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement?.click(); }
      else if (e.key === 'Tab') { closeMenu(); }
    });
    document.body.appendChild(_menu);
  }

  function openMenu() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    if (!_menu) _buildMenu();
    _committed = _current();
    for (const item of _menu.querySelectorAll('.theme-menu__item')) {
      const on = item.dataset.themeId === _committed;
      item.classList.toggle('is-current', on);
      item.setAttribute('aria-checked', String(on));
    }
    _menu.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    _menu.style.top  = `${r.bottom + 6}px`;
    _menu.style.left = `${Math.max(8, r.right - _menu.offsetWidth)}px`;   // right-aligned to the button
    btn.setAttribute('aria-expanded', 'true');
    _menu.querySelector('.is-current')?.focus();
  }

  /** @param {boolean} [refocus] return focus to the button (keyboard close) */
  function closeMenu(refocus = false) {
    if (!_menu || _menu.classList.contains('hidden')) return;
    _menu.classList.add('hidden');
    const btn = document.getElementById('theme-toggle');
    btn?.setAttribute('aria-expanded', 'false');
    if (refocus) btn?.focus();
  }

  function toggleTheme() {
    if (_menu && !_menu.classList.contains('hidden')) closeMenu();
    else openMenu();
  }

  document.addEventListener('mousedown', e => {
    if (!_menu || _menu.classList.contains('hidden')) return;
    if (_menu.contains(e.target) || e.target.closest?.('#theme-toggle')) return;
    closeMenu();
  });
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('blur', () => closeMenu());

  function applyStoredTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    const theme = LABELS[saved] ? saved : 'dark';
    _html.setAttribute('data-theme', theme);
    updateToggleUI(theme);
    const btn = document.getElementById('theme-toggle');
    btn?.setAttribute('aria-haspopup', 'menu');
    btn?.setAttribute('aria-expanded', 'false');
  }

  return { toggleTheme, applyStoredTheme, setTheme, openMenu, closeMenu };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager };
}
