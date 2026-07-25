/**
 * versionHistoryModal.js — "Version History…" file context-menu action.
 *
 * Lists the rolling backup snapshots kept by backup:write/backup:list
 * (src/main/ipc.js) for a given file — every overwrite (AI edit, save,
 * autosave, restore) lands in the same store, no distinction is made
 * between them — in a left sidebar; clicking one shows its text and
 * restore controls in the right pane.
 */

const VersionHistoryModal = (() => {
  const _overlay          = document.getElementById('versionHistoryOverlay');
  const _closeBtn         = document.getElementById('btnCloseVersionHistory');
  const _list             = document.getElementById('vhList');
  const _empty            = document.getElementById('vhEmpty');
  const _placeholder      = document.getElementById('vhPlaceholder');
  const _detail           = document.getElementById('vhDetail');
  const _previewMeta      = document.getElementById('vhPreviewMeta');
  const _previewContent   = document.getElementById('vhPreviewContent');
  const _restoreActions   = document.getElementById('vhRestoreActions');
  const _restoreBtn       = document.getElementById('btnVhRestore');
  const _restoreConfirm   = document.getElementById('vhRestoreConfirm');
  const _restoreCancelBtn = document.getElementById('btnVhRestoreCancel');
  const _restoreOkBtn     = document.getElementById('btnVhRestoreConfirm');

  let _filePath      = null;
  let _activeItem    = null;
  let _activeContent = null;
  let _activeRow     = null;

  function _dayLabel(date) {
    const now = new Date();
    const d0  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const t0  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((t0 - d0) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function _renderCurrentRow(currentContent) {
    const groupEl = document.createElement('div');
    groupEl.className = 'vh-group-label';
    groupEl.textContent = 'Current';
    _list.appendChild(groupEl);

    const item = { isCurrent: true, content: currentContent };
    const row  = document.createElement('button');
    row.type = 'button';
    row.className = 'vh-row';
    row.innerHTML = `<span class="vh-row-time vh-row-time--current">This file right now</span>`;
    row.addEventListener('click', () => _selectRow(row, item));
    _list.appendChild(row);
    return { row, item };
  }

  function _renderList(items, currentContent) {
    _list.innerHTML = '';
    _activeRow = null;
    const current = _renderCurrentRow(currentContent);

    if (!items.length) {
      _empty.classList.remove('hidden');
    } else {
      _empty.classList.add('hidden');
    }

    let lastGroup = null;
    for (const item of items) {
      const date  = new Date(item.timestamp);
      const group = _dayLabel(date);
      if (group !== lastGroup) {
        const groupEl = document.createElement('div');
        groupEl.className = 'vh-group-label';
        groupEl.textContent = group;
        _list.appendChild(groupEl);
        lastGroup = group;
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vh-row';
      row.innerHTML = `<span class="vh-row-time">${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>`;
      row.addEventListener('click', () => _selectRow(row, item));
      _list.appendChild(row);
    }

    return current;
  }

  function _resetRestoreState() {
    _restoreActions?.classList.remove('hidden');
    _restoreConfirm?.classList.add('hidden');
    if (_restoreBtn) _restoreBtn.disabled = false;
  }

  function _selectRow(row, item) {
    _activeRow?.classList.remove('vh-row--active');
    row.classList.add('vh-row--active');
    _activeRow = row;
    _showPreview(item);
  }

  async function _showPreview(item) {
    _activeItem    = item;
    _activeContent = null;
    _resetRestoreState();

    _placeholder?.classList.add('hidden');
    _detail?.classList.remove('hidden');

    if (item.isCurrent) {
      _previewMeta.textContent = 'The current content of this file — nothing to restore.';
      _activeContent = item.content;
      _previewContent.textContent = item.content || 'This file is empty.';
      if (_restoreBtn) _restoreBtn.disabled = true;
      return;
    }

    _previewContent.textContent = 'Loading…';
    _previewMeta.textContent = new Date(item.timestamp).toLocaleString();

    const result = await window.electronAPI.readBackup(item.backupPath);
    if (item !== _activeItem) return; // a newer selection has since superseded this load
    if (!result?.ok) {
      _previewContent.textContent = 'Failed to load this version.';
      return;
    }
    _activeContent = result.content;
    // Raw markdown source, styled like the editor — easier to scan and compare
    // than a fully rendered preview, and denser (more text visible per screen).
    _previewContent.textContent = result.content || 'This version is empty.';
  }

  function _resetDetail() {
    _detail?.classList.add('hidden');
    _placeholder?.classList.remove('hidden');
    _activeItem    = null;
    _activeContent = null;
    _activeRow?.classList.remove('vh-row--active');
    _activeRow     = null;
  }

  function _hide() {
    _overlay?.classList.add('hidden');
    _filePath = null;
    _resetDetail();
  }

  async function _getCurrentContent(filePath) {
    const isOpenFile = typeof currentFile !== 'undefined' && currentFile?.path === filePath;
    if (isOpenFile) {
      const editor = document.getElementById('mdEditor');
      return editor ? editor.value : '';
    }
    const result = await window.electronAPI.readFile(filePath);
    return result?.content ?? '';
  }

  async function show(filePath) {
    if (!_overlay || !filePath) return;
    _filePath = filePath;
    _resetDetail();
    _list.innerHTML = '';
    _empty.classList.add('hidden');
    _overlay.classList.remove('hidden');

    const [currentContent, result] = await Promise.all([
      _getCurrentContent(filePath),
      window.electronAPI.listBackups(filePath),
    ]);
    const current = _renderList(result?.items || [], currentContent);
    if (current) _selectRow(current.row, current.item);
  }

  async function _confirmRestore() {
    const filePath = _filePath;
    const content   = _activeContent;
    if (!filePath || content == null || _activeItem?.isCurrent) { _hide(); return; }

    const isOpenFile = typeof currentFile !== 'undefined' && currentFile?.path === filePath;

    try {
      if (isOpenFile) {
        const editor = document.getElementById('mdEditor');
        await window.electronAPI.writeBackup(filePath, editor.value).catch(() => {});
        EditorCore.setEditorContentNative(content);
      } else {
        const existing = await window.electronAPI.readFile(filePath);
        if (existing?.content !== undefined) {
          await window.electronAPI.writeBackup(filePath, existing.content).catch(() => {});
        }
        const result = await window.electronAPI.writeFile(filePath, content);
        if (!result?.ok) throw new Error(result?.error || 'Restore failed.');
      }
      StatusBar.showToast('Version restored.');
    } catch (err) {
      StatusBar.showToast(err.message || 'Restore failed.');
    }
    _hide();
  }

  _closeBtn?.addEventListener('click', _hide);
  _overlay?.addEventListener('click', e => { if (e.target === _overlay) _hide(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_overlay?.classList.contains('hidden')) _hide();
  });

  _restoreBtn?.addEventListener('click', () => {
    _restoreActions?.classList.add('hidden');
    _restoreConfirm?.classList.remove('hidden');
  });
  _restoreCancelBtn?.addEventListener('click', _resetRestoreState);
  _restoreOkBtn?.addEventListener('click', _confirmRestore);

  return { show };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VersionHistoryModal };
}
