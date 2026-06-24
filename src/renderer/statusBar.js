/**
 * statusBar.js — Bottom status bar helpers and toast notifications.
 */

const StatusBar = (() => {

  function updateFilename(name) {
    const el = document.getElementById('sbFilename');
    if (el) el.textContent = name;
  }

  function updateStats(lines, chars) {
    const lEl = document.getElementById('sbLines');
    const cEl = document.getElementById('sbChars');
    if (lEl) lEl.textContent = `${lines} lines`;
    if (cEl) cEl.textContent = `${chars.toLocaleString()} chars`;
  }

  function updateChatContextFile(name) {
    const el = document.getElementById('chatContextFile');
    if (el) el.textContent = name;
  }

  /**
   * Show a brief, non-intrusive toast at the bottom of the window.
   * Auto-dismisses after 4 seconds.
   */
  function showToast(message) {
    document.getElementById('focus-toast')?.remove();

    const toast = document.createElement('div');
    toast.id        = 'focus-toast';
    toast.className = 'focus-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      toast.classList.add('focus-toast--visible');
    }));

    const SHOW_MS = 4000;
    const FADE_MS = 200;
    setTimeout(() => {
      toast.classList.remove('focus-toast--visible');
      setTimeout(() => toast.remove(), FADE_MS);
    }, SHOW_MS);
  }

  return { updateFilename, updateStats, updateChatContextFile, showToast };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StatusBar };
}
