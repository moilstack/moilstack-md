/**
 * releaseNotice.js — notifies when a newer version is published on GitHub.
 * Just a link out to the release page; the app never downloads or installs
 * anything itself.
 */

document.addEventListener('DOMContentLoaded', () => {
  if (!window.electronAPI?.onReleaseAvailable) return;

  // The header's "Update" button stays until dismissed/updated — the toast
  // is just the initial nudge, so it auto-hides instead of sitting there.
  const AUTO_HIDE_DELAY = 8000;

  window.electronAPI.onReleaseAvailable(({ version, url }) => {
    const updateBtn = document.getElementById('btn-update-available');
    if (updateBtn) {
      updateBtn.title = `Version ${version} is available`;
      updateBtn.classList.remove('hidden');
      updateBtn.onclick = () => window.electronAPI.openExternal(url);
    }

    const el = document.createElement('div');
    el.id = 'release-notice';
    el.className = 'release-notice';

    const text = document.createElement('span');
    text.textContent = `Version ${version} is available.`;

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View Release';
    viewBtn.onclick = () => window.electronAPI.openExternal(url);

    let hideTimer = setTimeout(() => hide(), AUTO_HIDE_DELAY);

    function hide() {
      clearTimeout(hideTimer);
      el.classList.remove('release-notice--visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'release-notice__dismiss';
    dismissBtn.textContent = '×';
    dismissBtn.title = 'Dismiss';
    dismissBtn.onclick = () => hide();

    el.append(text, viewBtn, dismissBtn);
    document.body.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('release-notice--visible');
    }));
  });
});
