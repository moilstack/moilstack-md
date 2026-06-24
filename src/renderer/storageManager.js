/**
 * storageManager.js — All localStorage/IPC-backed persistence.
 * Owns: recent items, pinned files, folder collapse state.
 */

const StorageManager = (() => {

  const RECENT_ITEMS_KEY  = 'recentItems';
  const RECENT_MAX        = 10;
  const FOLDER_COLLAPSE_KEY = 'folderTreeCollapsed';

  /* ── Recent Items ─────────────────────────────────────────────────── */

  function getRecentItems() {
    try { return JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) || '[]'); }
    catch { return []; }
  }

  function addRecentItem(type, itemPath, name) {
    let items = getRecentItems();
    items = items.filter(i => i.path !== itemPath);
    items.unshift({ type, path: itemPath, name, timestamp: Date.now() });
    items = items.slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
  }

  function clearRecentItems() {
    localStorage.removeItem(RECENT_ITEMS_KEY);
  }

  function getRecentFolders() {
    return getRecentItems().filter(i => i.type === 'folder');
  }

  /* ── Pinned Files ─────────────────────────────────────────────────── */

  async function getPinnedForFolder(folderPath) {
    return window.electronAPI?.pins.get(folderPath) ?? [];
  }

  async function togglePinFile(folderPath, filePath) {
    return window.electronAPI?.pins.toggle(folderPath, filePath) ?? false;
  }

  /* ── Folder Collapse State ────────────────────────────────────────── */

  function _getCollapseMap() {
    try { return JSON.parse(localStorage.getItem(FOLDER_COLLAPSE_KEY) || '{}'); }
    catch { return {}; }
  }

  function isFolderCollapsed(folderPath) {
    return !!_getCollapseMap()[folderPath];
  }

  function toggleFolderCollapse(folderPath) {
    const map = _getCollapseMap();
    if (map[folderPath]) delete map[folderPath];
    else map[folderPath] = true;
    localStorage.setItem(FOLDER_COLLAPSE_KEY, JSON.stringify(map));
  }

  /** Remove a folder from the collapsed set (used after a file drop). */
  function expandFolder(folderPath) {
    const map = _getCollapseMap();
    delete map[folderPath];
    localStorage.setItem(FOLDER_COLLAPSE_KEY, JSON.stringify(map));
  }

  /**
   * Mark every folder in the given tree as collapsed.
   * @param {Array} entries  Root-level file-tree entries (_cachedTree).
   */
  function collapseAllFolders(entries) {
    if (!entries) return;
    const map = {};
    function markAll(ents) {
      for (const e of ents) {
        if (e.type === 'folder') {
          map[e.path] = true;
          if (e.children) markAll(e.children);
        }
      }
    }
    markAll(entries);
    localStorage.setItem(FOLDER_COLLAPSE_KEY, JSON.stringify(map));
  }

  return {
    getRecentItems,
    addRecentItem,
    clearRecentItems,
    getRecentFolders,
    getPinnedForFolder,
    togglePinFile,
    isFolderCollapsed,
    toggleFolderCollapse,
    expandFolder,
    collapseAllFolders,
    FOLDER_COLLAPSE_KEY,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageManager };
}
