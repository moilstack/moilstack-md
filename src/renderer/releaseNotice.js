/**
 * releaseNotice.js — notifies when a newer version is published on GitHub.
 * Just a link out to the release page; the app never downloads or installs
 * anything itself.
 */

document.addEventListener('DOMContentLoaded', () => {
  if (!window.electronAPI?.onReleaseAvailable) return;

  window.electronAPI.onReleaseAvailable(({ version, url }) => {
    const el = document.createElement('div');
    el.id = 'release-notice';
    el.className = 'release-notice';

    const text = document.createElement('span');
    text.textContent = `Version ${version} is available.`;

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View Release';
    viewBtn.onclick = () => window.electronAPI.openExternal(url);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'release-notice__dismiss';
    dismissBtn.textContent = '×';
    dismissBtn.title = 'Dismiss';
    dismissBtn.onclick = () => el.remove();

    el.append(text, viewBtn, dismissBtn);
    document.body.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('release-notice--visible');
    }));
  });
});
