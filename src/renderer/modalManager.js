/**
 * modalManager.js — Save-As modal (and future modals).
 *
 * currentFile is a global var declared in index.js (resolved lazily at call time).
 */

const ModalManager = (() => {

  /* ── Save-As Modal ────────────────────────────────────────────────── */

  let _saveAsSelectedFolder = null;

  function _updateFolderDisplay(folderPath) {
    const el = document.getElementById('saveAsFolderDisplay');
    if (el) { el.textContent = folderPath; el.title = folderPath; }
  }

  function _showError(message) {
    const errEl   = document.getElementById('saveAsError');
    const inputEl = document.getElementById('saveAsFilename');
    if (errEl)   { errEl.textContent = message; errEl.classList.remove('hidden'); }
    if (inputEl) {
      inputEl.classList.add('save-as-filename--error');
      inputEl.addEventListener('animationend', () => {
        inputEl.classList.remove('save-as-filename--error');
      }, { once: true });
    }
  }

  function _hideError() {
    const errEl   = document.getElementById('saveAsError');
    const inputEl = document.getElementById('saveAsFilename');
    if (errEl)   { errEl.textContent = ''; errEl.classList.add('hidden'); }
    if (inputEl) inputEl.classList.remove('save-as-filename--error');
  }

  function closeSaveAsModal() {
    document.getElementById('saveAsOverlay')?.classList.add('hidden');
    _saveAsSelectedFolder = null;
    _hideError();
  }

  async function showSaveAsModal() {
    let folder = sessionStorage.getItem('lastFolder') || null;
    if (!folder) {
      const result = await window.electronAPI?.openFolder();
      if (!result?.folderPath) return;
      folder = result.folderPath;
      await FileTreeManager.setActiveFolder(folder);
    }
    _saveAsSelectedFolder = folder;
    _updateFolderDisplay(folder);

    const inputEl = document.getElementById('saveAsFilename');
    if (inputEl) {
      inputEl.value = 'untitled.md';
    }

    document.getElementById('saveAsOverlay')?.classList.remove('hidden');
    if (inputEl) {
      inputEl.focus();
      inputEl.setSelectionRange(0, 'untitled'.length);
    }
  }

  async function confirmSaveAs() {
    const confirmBtn = document.getElementById('btnSaveAsConfirm');
    const rawName    = document.getElementById('saveAsFilename')?.value.trim() ?? '';
    const folderPath = _saveAsSelectedFolder;
    const editor     = document.getElementById('mdEditor');

    if (!rawName)    { _showError('Please enter a filename.');       return; }
    if (!folderPath) { _showError('No folder selected. Click Browse…'); return; }

    const fileName = rawName.includes('.') ? rawName : rawName + '.md';

    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving…'; }

    try {
      const createResult = await window.electronAPI.newFileInFolder(folderPath, fileName);
      if (createResult?.error) { _showError(createResult.error); return; }
      if (!createResult?.filePath) { _showError('Could not create file.'); return; }

      const filePath = createResult.filePath;

      const writeResult = await window.electronAPI.writeFile(filePath, editor?.value ?? '');
      if (!writeResult?.ok) { _showError(writeResult?.error || 'Write failed.'); return; }

      await FileTreeManager.setActiveFolder(folderPath);

      const name = filePath.split(/[\\/]/).pop();
      currentFile = { name, path: filePath };
      StatusBar.updateFilename(name);
      StatusBar.updateChatContextFile(name);
      SaveManager.markClean();

      document.querySelectorAll('#file-list .file-item').forEach(item => {
        item.classList.toggle('active', item.dataset.path === filePath);
      });

      closeSaveAsModal();
    } finally {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Save'; }
    }
  }

  /* ── Event wiring ─────────────────────────────────────────────────── */

  (function wireSaveAsModal() {
    document.getElementById('btnCloseSaveAs')?.addEventListener('click',   closeSaveAsModal);
    document.getElementById('btnSaveAsCancel')?.addEventListener('click',  closeSaveAsModal);
    document.getElementById('btnSaveAsConfirm')?.addEventListener('click', confirmSaveAs);

    document.getElementById('btnSaveAsPickFolder')?.addEventListener('click', async () => {
      const result = await window.electronAPI?.openFolder();
      if (!result?.folderPath) return;
      _saveAsSelectedFolder = result.folderPath;
      await FileTreeManager.setActiveFolder(result.folderPath);
      _updateFolderDisplay(result.folderPath);
      _hideError();
    });

    document.getElementById('saveAsFilename')?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); confirmSaveAs(); }
      if (e.key === 'Escape') { e.preventDefault(); closeSaveAsModal(); }
      else _hideError();
    });
  })();

  return { showSaveAsModal, closeSaveAsModal };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ModalManager };
}
