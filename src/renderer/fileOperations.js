/**
 * fileOperations.js — Inline rename, new-file input, and new-folder prompt.
 *
 * FileTreeManager is loaded after this module; all cross-calls are lazy.
 */

const FileOperations = (() => {

  /* ── Inline rename ────────────────────────────────────────────────── */

  function startInlineRename(filePath) {
    const list = document.getElementById('file-list');
    if (!list) return;

    let targetItem = null;
    for (const item of list.querySelectorAll('.file-item')) {
      if (item.dataset.path === filePath) { targetItem = item; break; }
    }
    if (!targetItem) return;

    const nameSpan = targetItem.querySelector('span');
    if (!nameSpan) return;

    const originalName = nameSpan.textContent;

    const input = document.createElement('input');
    input.type         = 'text';
    input.className    = 'file-rename-input';
    input.value        = originalName;
    input.spellcheck   = false;
    input.autocomplete = 'off';
    nameSpan.replaceWith(input);

    const dotIdx = originalName.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : originalName.length);
    input.focus();

    async function confirmRename() {
      const newName = input.value.trim();
      input.removeEventListener('blur',    onBlur);
      input.removeEventListener('keydown', onKey);

      if (!newName || newName === originalName) {
        input.replaceWith(nameSpan);
        return;
      }

      const result = await window.electronAPI?.renameFile(filePath, newName);
      if (!result?.ok) {
        input.classList.add('file-rename-input--error');
        input.title = result?.error || 'Rename failed';
        setTimeout(() => { input.replaceWith(nameSpan); }, 1800);
        return;
      }

      const wasActive  = targetItem.classList.contains('active');
      const folderPath = sessionStorage.getItem('lastFolder');
      if (folderPath) await FileTreeManager.setActiveFolder(folderPath);

      if (wasActive) {
        const newFileList = document.getElementById('file-list');
        for (const item of newFileList?.querySelectorAll('.file-item') ?? []) {
          if (item.dataset.path === result.newPath) { item.click(); break; }
        }
      }
    }

    function cancelRename() {
      input.removeEventListener('blur',    onBlur);
      input.removeEventListener('keydown', onKey);
      input.replaceWith(nameSpan);
    }

    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); confirmRename(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    }

    function onBlur() {
      setTimeout(() => { if (document.activeElement !== input) confirmRename(); }, 100);
    }

    input.addEventListener('keydown', onKey);
    input.addEventListener('blur',    onBlur);
  }

  /* ── New folder prompt ────────────────────────────────────────────── */

  function promptNewFolder(parentPath) {
    const list = document.getElementById('file-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'new-section-input-row';
    row.innerHTML = `
      <svg class="icon-folder" width="12" height="12" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.293 4H12.5A1 1 0 0 1 13.5 5v6a1 1 0 0 1-1 1h-10A1 1 0 0 1 1.5 11V3.5Z"
              stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
      <input type="text" class="new-section-input" placeholder="Folder name…"
             autocomplete="off" spellcheck="false" maxlength="60">`;

    list.prepend(row);
    const input = row.querySelector('input');
    input.focus();

    const confirm = async () => {
      const name = input.value.trim();
      row.remove();
      if (!name) return;
      const result = await window.electronAPI?.createFolder(parentPath, name);
      if (result?.error) { StatusBar.showToast(result.error); return; }
      const rootFolder = sessionStorage.getItem('lastFolder');
      if (rootFolder) await FileTreeManager.setActiveFolder(rootFolder);
    };

    input.addEventListener('blur', confirm);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { row.remove(); }
    });
  }

  // New Folder button in sidebar header
  document.getElementById('btn-new-folder')?.addEventListener('click', () => {
    const folderPath = sessionStorage.getItem('lastFolder');
    if (!folderPath) return;
    promptNewFolder(folderPath);
  });

  /* ── New file input ───────────────────────────────────────────────── */

  const newFileRow   = document.getElementById('new-file-row');
  const newFileInput = document.getElementById('new-file-input');
  let _newFileTargetPath = null;

  function showNewFileInput(targetFolderPath) {
    _newFileTargetPath = targetFolderPath || null;
    if (!newFileRow || !newFileInput) return;
    newFileInput.value = '';
    newFileRow.classList.remove('hidden');
    newFileInput.focus();
  }

  function hideNewFileInput() {
    if (!newFileRow) return;
    newFileRow.classList.add('hidden');
    if (newFileInput) newFileInput.value = '';
  }

  async function confirmNewFile() {
    const name = newFileInput ? newFileInput.value.trim() : '';
    if (!name) { hideNewFileInput(); return; }

    const folderPath = _newFileTargetPath || sessionStorage.getItem('lastFolder');
    _newFileTargetPath = null;
    if (!folderPath) { hideNewFileInput(); return; }

    const result = await window.electronAPI?.newFileInFolder(folderPath, name);

    if (result?.error) {
      if (newFileInput) {
        newFileInput.placeholder = result.error;
        newFileInput.value = '';
        newFileInput.classList.add('new-file-input--error');
        setTimeout(() => {
          if (newFileInput) {
            newFileInput.placeholder = 'filename.md';
            newFileInput.classList.remove('new-file-input--error');
          }
        }, 2000);
      }
      return;
    }

    hideNewFileInput();

    if (result?.filePath) {
      const rootFolder = sessionStorage.getItem('lastFolder') || folderPath;
      await FileTreeManager.setActiveFolder(rootFolder);

      const fileList = document.getElementById('file-list');
      let newItem = null;
      if (fileList) {
        for (const item of fileList.querySelectorAll('.file-item')) {
          if (item.dataset.path === result.filePath) { newItem = item; break; }
        }
      }
      if (newItem) {
        newItem.click();
        setMode('edit');
      }
    }
  }

  if (newFileInput) {
    newFileInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); confirmNewFile(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideNewFileInput(); }
    });

    newFileInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!newFileRow?.classList.contains('hidden') &&
            document.activeElement !== newFileInput) {
          hideNewFileInput();
        }
      }, 150);
    });
  }

  document.getElementById('btn-new-file')?.addEventListener('click', async () => {
    const savedFolder = sessionStorage.getItem('lastFolder');
    if (savedFolder) {
      showNewFileInput();
    } else {
      const result = await window.electronAPI?.openFolder();
      if (result?.folderPath) {
        await FileTreeManager.setActiveFolder(result.folderPath);
        showNewFileInput();
      }
    }
  });

  return {
    startInlineRename,
    promptNewFolder,
    showNewFileInput,
    hideNewFileInput,
    confirmNewFile,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FileOperations };
}
