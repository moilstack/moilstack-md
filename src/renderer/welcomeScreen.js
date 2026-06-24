/**
 * welcomeScreen.js — Welcome / recent-items overlay.
 */

const WelcomeScreen = (() => {

  const FOLDER_ICON = `<svg class="icon-folder" width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.293 4H12.5A1 1 0 0 1 13.5 5v6a1 1 0 0 1-1 1h-10A1 1 0 0 1 1.5 11V3.5Z"
          stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;

  const FILE_ICON = `<svg class="icon-file" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
          stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  </svg>`;

  function showWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    if (!screen) return;

    const closeBtn = document.getElementById('welcome-close-btn');
    if (closeBtn) {
      closeBtn.classList.toggle('hidden', !currentFile.path);
    }

    const listEl = document.getElementById('welcome-recent-list');
    if (listEl) {
      const items = StorageManager.getRecentItems();
      if (items.length === 0) {
        listEl.innerHTML =
          '<li class="welcome-recent-empty">No recent folders or files yet</li>';
      } else {
        listEl.innerHTML = items.map(item => {
          const icon = item.type === 'folder' ? FOLDER_ICON : FILE_ICON;
          return `<li class="welcome-recent-item"
                      data-type="${item.type}"
                      data-path="${item.path.replace(/"/g, '&quot;')}"
                      title="${item.path.replace(/"/g, '&quot;')}">
                    ${icon}
                    <span class="welcome-recent-item__name">${item.name}</span>
                    <span class="welcome-recent-item__path">${item.path}</span>
                  </li>`;
        }).join('');

        listEl.querySelectorAll('.welcome-recent-item').forEach(li => {
          li.addEventListener('click', async () => {
            const { type, path } = li.dataset;
            if (type === 'folder') {
              SidebarManager.setExplorerVisible(true, false);
              await FileTreeManager.setActiveFolder(path);
              showWelcomeScreen();
            } else {
              // openSingleFile is a global function declared in index.js
              await openSingleFile(path);
            }
          });
        });
      }
    }

    const clearBtn = document.getElementById('btn-clear-recents');
    if (clearBtn) {
      const hasItems = StorageManager.getRecentItems().length > 0;
      clearBtn.classList.toggle('hidden', !hasItems);
      clearBtn.onclick = () => {
        StorageManager.clearRecentItems();
        showWelcomeScreen();
      };
    }

    screen.classList.remove('hidden');
  }

  function hideWelcomeScreen() {
    document.getElementById('welcome-screen')?.classList.add('hidden');
  }

  return { showWelcomeScreen, hideWelcomeScreen };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WelcomeScreen };
}
