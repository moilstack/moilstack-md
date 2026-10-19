/**
 * themeInit.js — sets the theme attribute before the page paints.
 *
 * Loaded synchronously in <head>, ahead of <body>, so the browser never
 * paints a frame with the wrong theme colors. themeManager.js (loaded later,
 * at the bottom of the page) re-applies the same value and updates the
 * toggle button's label/icon once the DOM for those exists.
 */
(function () {
  var saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  // Saved Explorer width (set by dragging the divider — sidebarManager.js)
  var sidebarWidth = parseInt(localStorage.getItem('sidebarWidth') || '', 10);
  if (sidebarWidth) document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
  document.documentElement.setAttribute(
    'data-preview-width', localStorage.getItem('previewWidth') || 'readable');
})();
