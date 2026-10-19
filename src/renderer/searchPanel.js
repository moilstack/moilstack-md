/**
 * searchPanel.js — global search dialog (filename + content + tags)
 *
 * Clicking the header search box (or Ctrl+Shift+F) opens a dialog with a
 * search box and every tag used in the opened folder as clickable chips.
 *
 *  - Text (3+ chars) searches filenames and content via search:files IPC.
 *  - Selected tags (multi-select) filter to files with ANY of them, or ALL
 *    of them via the Any/All switch (tags come from the Explorer's cached
 *    tree, which carries each file's frontmatter tags).
 *  - Both together: text matches that also have the selected tags.
 *
 * Selecting a result opens the file via openFileByPath (defined in index.js).
 */

const SearchPanel = (() => {
  const MIN_CHARS   = 3
  const DEBOUNCE_MS = 250
  const MAX_RESULTS = 50

  let _debounceTimer = null
  let _activeIndex   = -1
  let _results       = []
  let _selectedTags  = new Set()   // lowercase
  let _matchAll      = false       // false: file has any selected tag; true: all of them
  let _searchRun     = 0

  let _trigger, _overlay, _input, _tagsWrap, _tagsRow, _list, _status

  function _esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  }

  function _highlight(text, query) {
    if (!query) return _esc(text)
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return _esc(text)
    return (
      _esc(text.slice(0, idx)) +
      '<mark>' + _esc(text.slice(idx, idx + query.length)) + '</mark>' +
      _esc(text.slice(idx + query.length))
    )
  }

  function _isCustomMode() {
    return (localStorage.getItem('explorerMode') || 'multi-level') === 'custom'
  }

  /* ── Folder files + tags (from the Explorer's cached tree) ────────── */

  function _treeFiles() {
    const out = []
    const walk = nodes => {
      for (const n of nodes || []) {
        if (n.type === 'file') out.push(n)
        else if (n.children) walk(n.children)
      }
    }
    walk(typeof FileTreeManager !== 'undefined' ? FileTreeManager.getCachedTree() : [])
    return out
  }

  /** [{ tag, count }] most-used first. */
  function _folderTags() {
    const map = new Map()
    for (const f of _treeFiles()) {
      for (const t of f.tags || []) {
        const k = t.toLowerCase()
        const e = map.get(k)
        if (e) e.count++
        else map.set(k, { tag: t, count: 1 })
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  function _tagsByPath() {
    const m = new Map()
    for (const f of _treeFiles()) m.set(f.path, f.tags || [])
    return m
  }

  function _hasSelectedTags(tags) {
    const have = new Set((tags || []).map(t => t.toLowerCase()))
    const sel = [..._selectedTags]
    return _matchAll ? sel.every(t => have.has(t)) : sel.some(t => have.has(t))
  }

  /* ── Rendering ─────────────────────────────────────────────────────── */

  function _renderTags() {
    const tags = _isCustomMode() ? [] : _folderTags()
    _tagsWrap.classList.toggle('hidden', !tags.length)
    _tagsRow.innerHTML = ''
    for (const { tag, count } of tags) {
      const on = _selectedTags.has(tag.toLowerCase())
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'search-tag' + (on ? ' search-tag--on' : '')
      chip.setAttribute('aria-pressed', String(on))
      chip.innerHTML = `#${_esc(tag)} <span class="search-tag__count">${count}</span>`
      chip.addEventListener('click', () => {
        const k = tag.toLowerCase()
        if (_selectedTags.has(k)) _selectedTags.delete(k)
        else _selectedTags.add(k)
        _renderTags()
        _run()
        _input.focus()
      })
      _tagsRow.appendChild(chip)
    }
    // Any/All switch — only meaningful once 2+ tags are picked
    if (_selectedTags.size > 1) {
      const mode = document.createElement('div')
      mode.className = 'search-tag-mode'
      mode.setAttribute('role', 'group')
      mode.setAttribute('aria-label', 'Match')
      for (const [all, label, tip] of [[false, 'Any', 'Files with any selected tag'],
                                       [true,  'All', 'Files with every selected tag']]) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.title = tip
        b.className = 'search-tag-mode__btn' + (_matchAll === all ? ' is-on' : '')
        b.setAttribute('aria-pressed', String(_matchAll === all))
        b.addEventListener('click', () => { _matchAll = all; _renderTags(); _run(); _input.focus() })
        mode.appendChild(b)
      }
      _tagsRow.appendChild(mode)
    }
    if (_selectedTags.size) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'search-tag search-tag--clear'
      clear.textContent = 'Clear'
      clear.addEventListener('click', () => { _selectedTags.clear(); _renderTags(); _run(); _input.focus() })
      _tagsRow.appendChild(clear)
    }
  }

  function _renderResults(results, query, emptyText) {
    _results     = results
    _activeIndex = -1
    _list.innerHTML = ''
    _status.textContent = results.length
      ? `${results.length}${results.length >= MAX_RESULTS ? '+' : ''} result${results.length === 1 ? '' : 's'}`
      : ''

    if (!results.length) {
      if (emptyText) _list.innerHTML = `<div class="search-no-results">${_esc(emptyText)}</div>`
      return
    }

    const tagsOf = _tagsByPath()
    results.forEach((r, i) => {
      const item = document.createElement('div')
      item.className = 'search-result-item'
      item.setAttribute('role', 'option')
      item.dataset.index = i

      const tags = tagsOf.get(r.filePath) || []
      const tagsHTML = tags.length
        ? `<span class="search-result-item__tags">${tags.map(t =>
            `<span class="search-result-item__tag${_selectedTags.has(t.toLowerCase()) ? ' is-on' : ''}">#${_esc(t)}</span>`).join('')}</span>`
        : ''
      const snippet = r.matchType === 'tag' ? '' : (r.snippet || '')

      item.innerHTML = `
        <span class="search-result-item__name">${_highlight(r.fileName, query)}</span>
        ${snippet ? `<span class="search-result-item__snippet">${_highlight(snippet, query)}</span>` : ''}
        ${tagsHTML}
      `
      item.addEventListener('mousedown', e => { e.preventDefault(); _open(r.filePath) })
      item.addEventListener('mousemove', () => { if (_activeIndex !== i) _setActive(i) })
      _list.appendChild(item)
    })
  }

  function _setActive(index) {
    const items = _list.querySelectorAll('.search-result-item')
    items.forEach(el => el.classList.remove('active'))
    _activeIndex = Math.max(-1, Math.min(index, items.length - 1))
    if (_activeIndex >= 0) {
      items[_activeIndex].classList.add('active')
      items[_activeIndex].scrollIntoView({ block: 'nearest' })
    }
  }

  /* ── Searching ─────────────────────────────────────────────────────── */

  async function _textSearch(query) {
    if (_isCustomMode()) {
      // No folder tree in Custom mode — search the Recent Files list instead.
      const filePaths = StorageManager.getRecentItems()
        .filter(i => i.type === 'file')
        .map(i => i.path)
      if (!filePaths.length) return { results: [], empty: 'No recent files' }
      const { results } = await window.electronAPI.searchRecentFiles(filePaths, query)
      return { results }
    }
    const folderPath = sessionStorage.getItem('lastFolder')
    if (!folderPath) return { results: [], empty: 'No folder open' }
    const { results } = await window.electronAPI.searchFiles(folderPath, query)
    return { results }
  }

  async function _run() {
    clearTimeout(_debounceTimer)
    const run = ++_searchRun
    const q = _input.value.trim()
    const textOn = q.length >= MIN_CHARS

    // Tags only → list every file carrying all selected tags
    if (!textOn) {
      if (!_selectedTags.size) {
        _renderResults([], '', q ? `Type at least ${MIN_CHARS} characters, or pick a tag` : '')
        return
      }
      const results = _treeFiles()
        .filter(f => _hasSelectedTags(f.tags))
        .slice(0, MAX_RESULTS)
        .map(f => ({ filePath: f.path, fileName: f.name, snippet: '', matchType: 'tag' }))
      _renderResults(results, '', _matchAll ? 'No files have all the selected tags' : 'No files have these tags')
      return
    }

    _debounceTimer = setTimeout(async () => {
      try {
        const { results, empty } = await _textSearch(q)
        if (run !== _searchRun) return               // a newer search started
        const tagsOf = _tagsByPath()
        const filtered = _selectedTags.size
          ? results.filter(r => _hasSelectedTags(tagsOf.get(r.filePath)))
          : results
        _renderResults(filtered.slice(0, MAX_RESULTS), q.replace(/^(#|tag:)\s*/, ''),
          empty || (_selectedTags.size ? 'No matches with the selected tags' : 'No results found'))
      } catch (err) {
        console.error('[SearchPanel] search failed', err)
      }
    }, DEBOUNCE_MS)
  }

  /* ── Dialog open / close ───────────────────────────────────────────── */

  function _open(filePath) {
    close()
    if (typeof openFileByPath === 'function') openFileByPath(filePath)
  }

  function open() {
    if (!_overlay) return
    _overlay.classList.remove('hidden')
    _renderTags()
    _input.focus()
    _input.select()
    _run()
  }

  function close() {
    if (!_overlay || _overlay.classList.contains('hidden')) return
    _overlay.classList.add('hidden')
    clearTimeout(_debounceTimer)
    _searchRun++
    _trigger?.blur()
  }

  function _buildDialog() {
    _overlay = document.createElement('div')
    _overlay.className = 'search-dialog-overlay hidden'
    _overlay.innerHTML = `
      <div class="search-dialog" role="dialog" aria-modal="true" aria-label="Search files">
        <div class="search-dialog__bar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input class="search-dialog__input" type="text" placeholder="Search file names and content…"
                 autocomplete="off" spellcheck="false" aria-label="Search">
          <span class="search-dialog__status"></span>
          <kbd class="header-search__kbd">Esc</kbd>
        </div>
        <div class="search-dialog__tags">
          <div class="search-dialog__label">Tags</div>
          <div class="search-dialog__tag-row"></div>
        </div>
        <div class="search-dialog__results" role="listbox"></div>
      </div>`
    document.body.appendChild(_overlay)

    _input    = _overlay.querySelector('.search-dialog__input')
    _tagsWrap = _overlay.querySelector('.search-dialog__tags')
    _tagsRow  = _overlay.querySelector('.search-dialog__tag-row')
    _list     = _overlay.querySelector('.search-dialog__results')
    _status   = _overlay.querySelector('.search-dialog__status')

    _overlay.addEventListener('mousedown', e => { if (e.target === _overlay) close() })
    _input.addEventListener('input', _run)
    _input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _setActive(_activeIndex + 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _setActive(_activeIndex - 1) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const r = _results[_activeIndex >= 0 ? _activeIndex : 0]
        if (r) _open(r.filePath)
      }
      else if (e.key === 'Backspace' && !_input.value && _selectedTags.size) {
        // Backspace in an empty box drops the last selected tag
        _selectedTags.delete([..._selectedTags].pop())
        _renderTags()
        _run()
      }
    })
    _overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    })
  }

  function init() {
    _trigger = document.getElementById('header-search-input')
    if (!_trigger) return
    _buildDialog()

    // The header box is just a trigger now — the dialog does the searching
    _trigger.readOnly = true
    _trigger.addEventListener('mousedown', e => { e.preventDefault(); open() })
    _trigger.addEventListener('focus', () => { _trigger.blur(); open() })
    _trigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
    })

    // Ctrl+Shift+F opens the dialog
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        open()
      }
    })
  }

  return { init, open, close }
})()
