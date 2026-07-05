/**
 * fileTreeManager.js — Sidebar file-tree rendering, drag-drop, folder navigation.
 *
 * EditorCore, ChatPanel, and selectFile (index.js) are resolved lazily at call time.
 */

const FileTreeManager = (() => {

  /* ── Private state ────────────────────────────────────────────────── */

  let _cachedTree = null;

  /* ── SVG templates ────────────────────────────────────────────────── */

  const FILE_ICON_SVG = `<svg class="icon-file" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

  // Markdown file — document with a ↓ arrow (nod to the M↓ markdown logo)
  const MD_ICON_SVG = `<svg class="icon-file icon-file--md" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M6 5.5v3M4.5 7l1.5 1.5L7.5 7" stroke="currentColor" stroke-width="1"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  // Plain-text file — document with three text lines inside
  const TXT_ICON_SVG = `<svg class="icon-file icon-file--txt" width="12" height="12" viewBox="0 0 12 12" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 2 1.5Z"
        stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M7.5 1.5V4H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M3.5 5.5h5M3.5 7h5M3.5 8.5h3" stroke="currentColor" stroke-width="0.9"
        stroke-linecap="round"/>
</svg>`;

  function _fileIconSVG(fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot !== -1 ? fileName.slice(dot).toLowerCase() : '';
    if (ext === '.md')  return MD_ICON_SVG;
    if (ext === '.txt') return TXT_ICON_SVG;
    return FILE_ICON_SVG;
  }

  const FOLDER_ICON_SVG = `<svg class="icon-folder" width="13" height="13" viewBox="0 0 15 15" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.293 4H12.5A1 1 0 0 1 13.5 5v6a1 1 0 0 1-1 1h-10A1 1 0 0 1 1.5 11V3.5Z"
        stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

  const PIN_ICON_SVG = (pinned) => `
  <svg class="pin-icon" width="11" height="11" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2l2.4 6H20l-4.8 3.6 1.8 6L12 14l-5 3.6 1.8-6L4 8h5.6L12 2z"
          stroke="currentColor" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

  /* ── HTML builders ────────────────────────────────────────────────── */

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _extractFirstLine(content) {
    let text = content;
    if (text.startsWith('---')) {
      const fmEnd = text.indexOf('\n---', 3);
      if (fmEnd !== -1) text = text.slice(fmEnd + 4);
    }
    for (const line of text.split('\n')) {
      const stripped = line
        .replace(/^#+\s*/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (stripped) return stripped.slice(0, 100);
    }
    return '';
  }

  function _fileItemHTML(filePath, fileName, pinned, depth, firstLine) {
    const escapedPath = filePath.replace(/"/g, '&quot;');
    const indent = (depth || 0) * 12;
    if (firstLine) {
      return `
      <div class="file-item file-item--pinned file-item--with-preview"
           draggable="true"
           data-path="${escapedPath}" title="${escapedPath}"
           style="padding-left:${14 + indent}px">
        <div class="file-item__tree-row">
          ${_fileIconSVG(fileName)}
          <span>${fileName}</span>
          <button class="file-pin-btn file-pin-btn--active"
                  data-pin-path="${escapedPath}"
                  title="Unpin file" aria-pressed="true">
            ${PIN_ICON_SVG(true)}
          </button>
        </div>
        <div class="file-item__tree-preview">${_escHtml(firstLine)}</div>
      </div>`;
    }
    return `
      <div class="file-item${pinned ? ' file-item--pinned' : ''}"
           draggable="true"
           data-path="${escapedPath}" title="${escapedPath}"
           style="padding-left:${14 + indent}px">
        ${_fileIconSVG(fileName)}
        <span>${fileName}</span>
        <button class="file-pin-btn${pinned ? ' file-pin-btn--active' : ''}"
                data-pin-path="${escapedPath}"
                title="${pinned ? 'Unpin file' : 'Pin file'}"
                aria-pressed="${pinned}">
          ${PIN_ICON_SVG(pinned)}
        </button>
      </div>`;
  }

  function _flatFileItemHTML(file, pinned, label) {
    const escapedPath = file.path.replace(/"/g, '&quot;');
    const tags = file.tags || [];
    const preview = file.firstLine || '';
    const tagsHTML = tags.map(t => `<span class="file-tag">${_escHtml('#' + t)}</span>`).join('');
    const labelDot = label
      ? `<svg class="file-item__label-dot" width="8" height="8" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="${label.color}"/></svg>`
      : '';
    return `
      <div class="file-item file-item--flat${pinned ? ' file-item--pinned' : ''}"
           draggable="true"
           data-path="${escapedPath}" title="${escapedPath}">
        <div class="file-item__main">
          ${_fileIconSVG(file.name)}
          <span class="file-item__name">${file.name}</span>
          ${labelDot}
          ${tagsHTML ? `<div class="file-item__tags">${tagsHTML}</div>` : ''}
          <button class="file-pin-btn${pinned ? ' file-pin-btn--active' : ''}"
                  data-pin-path="${escapedPath}"
                  title="${pinned ? 'Unpin file' : 'Pin file'}"
                  aria-pressed="${pinned}">
            ${PIN_ICON_SVG(pinned)}
          </button>
        </div>
        ${preview ? `<div class="file-item__preview"><span>${_escHtml(preview)}</span></div>` : ''}
      </div>`;
  }

  function _folderRowHTML(node, depth) {
    const escapedPath = node.path.replace(/"/g, '&quot;');
    const indent = depth * 12;
    const collapsed = StorageManager.isFolderCollapsed(node.path);
    return `
      <div class="folder-row${collapsed ? '' : ' open'}"
           data-folder-path="${escapedPath}"
           data-depth="${depth}"
           style="padding-left:${8 + indent}px"
           title="${escapedPath}">
        <svg class="folder-row__chevron" width="10" height="10" viewBox="0 0 10 10"
             fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.4"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${FOLDER_ICON_SVG}
        <span class="folder-row__name">${node.name}</span>
      </div>`;
  }

  const MAX_FOLDER_DEPTH = 4; // 0-based: shows five levels (0 → 1 → 2 → 3 → 4)

  function _getExplorerMode() {
    return localStorage.getItem('explorerMode') || 'multi-level';
  }

  function _dayStart(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function _renderRootOnlyView(entries, pinnedPaths, labelsMap) {
    const sorted = entries.slice().sort((a, b) => (b.modified || 0) - (a.modified || 0));

    const now = Date.now();
    const today     = _dayStart(now);
    const yesterday = _dayStart(now - 86400000);
    const weekStart = _dayStart(now - (new Date().getDay() * 86400000));

    const GROUP_ORDER = ['Today', 'Yesterday', 'This Week'];
    const groups = {};

    for (const file of sorted) {
      let group;
      if (!file.modified) {
        group = 'Older';
      } else {
        const d = _dayStart(file.modified);
        if (d >= today)       group = 'Today';
        else if (d >= yesterday) group = 'Yesterday';
        else if (d >= weekStart) group = 'This Week';
        else group = new Date(file.modified).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      }
      if (!groups[group]) groups[group] = [];
      groups[group].push(file);
    }

    const orderedGroups = [
      ...GROUP_ORDER.filter(g => groups[g]),
      ...Object.keys(groups).filter(g => !GROUP_ORDER.includes(g)),
    ];

    let html = '';
    for (const group of orderedGroups) {
      html += `<div class="file-date-group-header">${group}</div>`;
      for (const file of groups[group]) {
        html += _flatFileItemHTML(file, pinnedPaths.has(file.path), labelsMap[file.path]);
      }
    }
    return html;
  }

  function _renderTreeEntries(entries, depth, pinnedPaths) {
    let html = '';
    for (const entry of entries) {
      if (entry.type === 'folder') {
        html += _folderRowHTML(entry, depth);
        if (!StorageManager.isFolderCollapsed(entry.path) && entry.children && depth < MAX_FOLDER_DEPTH) {
          html += _renderTreeEntries(entry.children, depth + 1, pinnedPaths);
        }
      } else {
        html += _fileItemHTML(entry.path, entry.name, pinnedPaths.has(entry.path), depth);
      }
    }
    return html;
  }

  function _collectFiles(entries) {
    const result = [];
    for (const e of entries) {
      if (e.type === 'file') result.push(e);
      else if (e.type === 'folder' && e.children) result.push(..._collectFiles(e.children));
    }
    return result;
  }

  /* ── Restore active item after re-render ──────────────────────────── */

  function restoreActiveItem() {
    if (!currentFile?.path) return;
    const list = document.getElementById('file-list');
    for (const item of list?.querySelectorAll('.file-item') ?? []) {
      if (item.dataset.path === currentFile.path) {
        item.classList.add('active');
        break;
      }
    }
  }

  /* ── Public helpers ───────────────────────────────────────────────── */

  function getCachedTree()               { return _cachedTree; }
  function fileExistsInTree(filePath)    {
    return _collectFiles(_cachedTree ?? []).some(f => f.path === filePath);
  }

  function collapseAll() {
    StorageManager.collapseAllFolders(_cachedTree);
    renderFileTree();
    restoreActiveItem();
  }

  function touchFile(filePath, firstLine) {
    const file = _collectFiles(_cachedTree ?? []).find(f => f.path === filePath);
    if (file) {
      file.modified = Date.now();
      if (firstLine !== undefined) file.firstLine = firstLine;
      renderFileTree();
      restoreActiveItem();
    }
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  async function renderFileTree() {
    const list = document.getElementById('file-list');
    if (!list) return;

    const entries = _cachedTree;
    if (!entries || entries.length === 0) {
      list.innerHTML = '<span class="file-list__empty">No files in this folder</span>';
      return;
    }

    const folderPath  = sessionStorage.getItem('lastFolder') || '';
    const [pinnedPaths, labelsMap] = await Promise.all([
      StorageManager.getPinnedForFolder(folderPath).then(p => new Set(p)),
      window.electronAPI?.labels?.get().catch(() => ({})) ?? Promise.resolve({}),
    ]);
    const pinnedFiles = _collectFiles(entries).filter(f => pinnedPaths.has(f.path));

    let html = '';

    const rootOnly = _getExplorerMode() === 'root-only';

    let pinnedFirstLines = {};
    if (!rootOnly && pinnedFiles.length > 0) {
      const reads = await Promise.all(
        pinnedFiles.map(f => window.electronAPI?.readFile(f.path).catch(() => null))
      );
      pinnedFiles.forEach((f, i) => {
        const content = reads[i]?.content;
        if (content) pinnedFirstLines[f.path] = _extractFirstLine(content);
      });
    }

    if (pinnedFiles.length > 0) {
      html += `<div class="file-list-section-header">Pinned</div>`;
      html += pinnedFiles.map(f => rootOnly
        ? _flatFileItemHTML(f, true, labelsMap[f.path])
        : _fileItemHTML(f.path, f.name, true, 0, pinnedFirstLines[f.path])
      ).join('');
    }

    if (rootOnly) {
      if (pinnedFiles.length > 0) {
        html += `<div class="file-list-section-header file-list-section-header--files">Files</div>`;
      }
      html += _renderRootOnlyView(entries, pinnedPaths, labelsMap);
    } else {
      if (pinnedFiles.length > 0) {
        html += `<div class="file-list-section-header file-list-section-header--files">Files</div>`;
      }
      html += _renderTreeEntries(entries, 0, pinnedPaths);
    }
    list.innerHTML = html;

    /* ── Folder rows: collapse toggle + context menu ────────────────── */
    list.querySelectorAll('.folder-row').forEach(row => {
      row.addEventListener('click', () => {
        StorageManager.toggleFolderCollapse(row.dataset.folderPath);
        renderFileTree();
        restoreActiveItem();
      });
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        ContextMenus.showFolderCtxMenu(
          row.dataset.folderPath,
          parseInt(row.dataset.depth, 10),
          e.clientX, e.clientY
        );
      });
    });

    /* ── Pin button ─────────────────────────────────────────────────── */
    list.querySelectorAll('.file-pin-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await StorageManager.togglePinFile(folderPath, btn.dataset.pinPath);
        await renderFileTree();
        restoreActiveItem();
      });
    });

    /* ── File click — open in editor ────────────────────────────────── */
    list.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', async () => {
        if (item.classList.contains('active')) return;
        await SaveManager.silentSave();

        list.querySelectorAll('.file-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const filePath = item.dataset.path;
        const result   = await window.electronAPI?.readFile(filePath);
        const content  = result?.content ?? '';

        const editor = document.getElementById('mdEditor');
        if (editor) {
          EditorCore.clearAiUndoStack();
          editor.value     = content;
          editor.scrollTop = 0;
          const gutter = document.getElementById('line-numbers');
          if (gutter) gutter.scrollTop = 0;
          EditorCore.updateHighlight();
          EditorCore.triggerUpdate();
        }
        SaveManager.markClean();

        const lines = content.split('\n').length;
        selectFile(item, filePath, lines, content.length);
        WelcomeScreen.hideWelcomeScreen();
        ChatPanel.clearChat();
      });

      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        ContextMenus.showFileCtxMenu(item.dataset.path, e.clientX, e.clientY);
      });
    });

    /* ── Drag-and-drop: move files between folders ──────────────────── */
    let _draggedPath = null;

    list.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        _draggedPath = item.dataset.path;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', _draggedPath);
        setTimeout(() => item.classList.add('file-item--dragging'), 0);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('file-item--dragging');
        _draggedPath = null;
      });
    });

    // Drop target: folder rows
    list.querySelectorAll('.folder-row').forEach(row => {
      row.addEventListener('dragover', e => {
        if (!_draggedPath) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('folder-row--drag-over');
      });
      row.addEventListener('dragleave', e => {
        if (!row.contains(e.relatedTarget)) row.classList.remove('folder-row--drag-over');
      });
      row.addEventListener('drop', async e => {
        e.preventDefault();
        row.classList.remove('folder-row--drag-over');
        const src = e.dataTransfer.getData('text/plain') || _draggedPath;
        const dst = row.dataset.folderPath;
        if (!src || !dst) return;

        const srcDir = src.replace(/[\\/][^\\/]+$/, '');
        if (srcDir === dst) return;

        const result = await window.electronAPI?.moveFile(src, dst);
        if (!result?.ok) { StatusBar.showToast(result?.error || 'Move failed'); return; }

        if (currentFile.path === src) {
          const name = result.newPath.split(/[\\/]/).pop();
          currentFile = { name, path: result.newPath };
          StatusBar.updateFilename(name);
          StatusBar.updateChatContextFile(name);
        }

        StorageManager.expandFolder(dst);
        await setActiveFolder(sessionStorage.getItem('lastFolder'));
        restoreActiveItem();
      });
    });

    // Drop target: "Files" section header → root folder
    list.querySelectorAll('.file-list-section-header--files').forEach(header => {
      header.addEventListener('dragover', e => {
        if (!_draggedPath) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        header.classList.add('folder-row--drag-over');
      });
      header.addEventListener('dragleave', e => {
        if (!header.contains(e.relatedTarget)) header.classList.remove('folder-row--drag-over');
      });
      header.addEventListener('drop', async e => {
        e.preventDefault();
        header.classList.remove('folder-row--drag-over');
        const src = e.dataTransfer.getData('text/plain') || _draggedPath;
        const dst = sessionStorage.getItem('lastFolder');
        if (!src || !dst) return;

        const srcDir = src.replace(/[\\/][^\\/]+$/, '');
        if (srcDir === dst) return;

        const result = await window.electronAPI?.moveFile(src, dst);
        if (!result?.ok) { StatusBar.showToast(result?.error || 'Move failed'); return; }

        if (currentFile.path === src) {
          const name = result.newPath.split(/[\\/]/).pop();
          currentFile = { name, path: result.newPath };
          StatusBar.updateFilename(name);
          StatusBar.updateChatContextFile(name);
        }

        await setActiveFolder(dst);
        restoreActiveItem();
      });
    });
  }

  /* ── Set active folder ────────────────────────────────────────────── */

  async function setActiveFolder(folderPath) {
    const label = document.getElementById('header-folder-name');
    if (label) label.textContent = folderPath;
    localStorage.setItem('lastFolder', folderPath);
    sessionStorage.setItem('lastFolder', folderPath);

    if (window.electronAPI?.readFolder) {
      const rootOnly = _getExplorerMode() === 'root-only';
      const result = await window.electronAPI.readFolder(folderPath, { rootOnly, withMeta: rootOnly });
      _cachedTree = result?.entries ?? [];
      await renderFileTree();
    }
  }

  async function refresh() {
    const folderPath = sessionStorage.getItem('lastFolder');
    if (folderPath) await setActiveFolder(folderPath);
  }

  /* ── Recent-folders dropdown on the header button ─────────────── */

  function initFolderDropdown() {
    const btn      = document.getElementById('header-folder-path');
    const dropdown = document.getElementById('folder-recent-dropdown');
    if (!btn || !dropdown) return;

    function _populateDropdown() {
      const folders = StorageManager.getRecentFolders();
      dropdown.innerHTML = '';

      if (!folders.length) {
        const empty = document.createElement('div');
        empty.className = 'folder-recent-empty';
        empty.textContent = 'No recent folders';
        dropdown.appendChild(empty);
        return;
      }

      folders.forEach(item => {
        const row = document.createElement('button');
        row.className = 'folder-recent-item';
        row.setAttribute('role', 'menuitem');
        row.setAttribute('title', item.path);

        row.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 15 15" fill="none"
               xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.293 4H12.5A1 1 0 0 1 13.5 5v6a1 1 0 0 1-1 1h-10A1 1 0 0 1 1.5 11V3.5Z"
                  stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:4px;">
            <span class="folder-recent-item__name">${item.name}</span>
            <span class="folder-recent-item__path">${item.path}</span>
          </div>`;

        row.addEventListener('click', async () => {
          _closeDropdown();
          await setActiveFolder(item.path);
        });

        dropdown.appendChild(row);
      });
    }

    function _openDropdown() {
      _populateDropdown();
      dropdown.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }

    function _closeDropdown() {
      dropdown.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.classList.contains('hidden');
      if (isOpen) _closeDropdown();
      else _openDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.classList.contains('hidden') &&
          !dropdown.contains(e.target) &&
          e.target !== btn) {
        _closeDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
        _closeDropdown();
        btn.focus();
      }
    });
  }

  return {
    renderFileTree,
    setActiveFolder,
    restoreActiveItem,
    collapseAll,
    getCachedTree,
    fileExistsInTree,
    refresh,
    touchFile,
    initFolderDropdown,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FileTreeManager };
}
