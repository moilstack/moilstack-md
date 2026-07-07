/**
 * modalManager.js — Save-As via the native OS Save dialog.
 *
 * currentFile is a global var declared in index.js (resolved lazily at call time).
 */

const ModalManager = (() => {

  /** Derive a filesystem-safe default filename from the document's first line of text. */
  function _suggestFilename() {
    const raw  = SaveManager.extractFirstLine(document.getElementById('mdEditor')?.value ?? '');
    const safe = raw.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
    return safe || 'untitled';
  }

  /**
   * Save-As — opens the native Save dialog pre-pointed at the active folder
   * (or the OS default location if none is open) with a filename suggested
   * from the document's first line of text.
   */
  async function showSaveAsModal() {
    const folder = sessionStorage.getItem('lastFolder') || null;
    const result = await window.electronAPI?.newFile(_suggestFilename(), folder);
    if (!result?.filePath) return;

    const editor  = document.getElementById('mdEditor');
    const content = editor?.value ?? '';

    const writeResult = await window.electronAPI.writeFile(result.filePath, content);
    if (!writeResult?.ok) { StatusBar.showToast(writeResult?.error || 'Save failed.'); return; }

    const filePath = result.filePath;

    // Only re-point the explorer at the saved-into folder if it's the one
    // already active (or none was active) — saving somewhere you merely
    // browsed to for this one file shouldn't yank the sidebar away from
    // what you were viewing.
    const savedFolder  = filePath.replace(/[\\/][^\\/]+$/, '');
    const activeFolder = sessionStorage.getItem('lastFolder');
    if (!activeFolder || activeFolder === savedFolder) {
      await FileTreeManager.setActiveFolder(savedFolder);
    }

    const name = filePath.split(/[\\/]/).pop();
    currentFile = { name, path: filePath };
    StatusBar.updateFilename(name);
    StatusBar.updateChatContextFile(name);
    SaveManager.markClean();
    SaveManager.clearDraft();

    document.querySelectorAll('#file-list .file-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === filePath);
    });
  }

  return { showSaveAsModal };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ModalManager };
}
