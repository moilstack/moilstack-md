/**
 * searchPanel.js — global header search (filename + content)
 *
 * Wires the #header-search-input box to search:files IPC.
 * Renders results in #search-results-dropdown.
 * Selecting a result opens the file via openFileByPath (defined in index.js).
 */

const SearchPanel = (() => {
  const MIN_CHARS   = 3
  const DEBOUNCE_MS = 280

  let _debounceTimer = null
  let _activeIndex   = -1
  let _results       = []

  // ── DOM refs (resolved after DOMContentLoaded) ──────────────────────
  let _input, _dropdown

  function _highlight(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return _esc(text)
    return (
      _esc(text.slice(0, idx)) +
      '<mark>' + _esc(text.slice(idx, idx + query.length)) + '</mark>' +
      _esc(text.slice(idx + query.length))
    )
  }

  function _esc(str) {
    return str.replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  }

  function _render(results, query) {
    _results     = results
    _activeIndex = -1
    _dropdown.innerHTML = ''

    if (!results.length) {
      _dropdown.innerHTML = '<div class="search-no-results">No results found</div>'
      _dropdown.classList.remove('hidden')
      return
    }

    results.forEach((r, i) => {
      const item = document.createElement('div')
      item.className = 'search-result-item'
      item.setAttribute('role', 'option')
      item.dataset.index = i

      const nameHL    = _highlight(r.fileName, query)
      const snippetHL = r.snippet ? _highlight(r.snippet, query) : ''

      item.innerHTML = `
        <span class="search-result-item__name">${nameHL}</span>
        ${snippetHL ? `<span class="search-result-item__snippet">${snippetHL}</span>` : ''}
      `
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()        // keep input focused
        _open(r.filePath)
      })
      _dropdown.appendChild(item)
    })

    _dropdown.classList.remove('hidden')
  }

  function _setActive(index) {
    const items = _dropdown.querySelectorAll('.search-result-item')
    items.forEach(el => el.classList.remove('active'))
    _activeIndex = Math.max(-1, Math.min(index, items.length - 1))
    if (_activeIndex >= 0) {
      items[_activeIndex].classList.add('active')
      items[_activeIndex].scrollIntoView({ block: 'nearest' })
    }
  }

  function _open(filePath) {
    _close()
    if (typeof openFileByPath === 'function') {
      openFileByPath(filePath)
    }
  }

  function _close() {
    _dropdown.classList.add('hidden')
    _dropdown.innerHTML = ''
    _results     = []
    _activeIndex = -1
  }

  async function _doSearch(query) {
    const folderPath = sessionStorage.getItem('lastFolder')
    if (!folderPath) {
      _dropdown.innerHTML = '<div class="search-no-results">No folder open</div>'
      _dropdown.classList.remove('hidden')
      return
    }
    try {
      const { results } = await window.electronAPI.searchFiles(folderPath, query)
      _render(results, query)
    } catch (err) {
      console.error('[SearchPanel] search failed', err)
    }
  }

  function init() {
    _input    = document.getElementById('header-search-input')
    _dropdown = document.getElementById('search-results-dropdown')
    if (!_input || !_dropdown) return

    // Trigger search on input
    _input.addEventListener('input', () => {
      clearTimeout(_debounceTimer)
      const q = _input.value.trim()
      if (q.length < MIN_CHARS) { _close(); return }
      _debounceTimer = setTimeout(() => _doSearch(q), DEBOUNCE_MS)
    })

    // Keyboard navigation
    _input.addEventListener('keydown', (e) => {
      if (_dropdown.classList.contains('hidden')) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        _setActive(_activeIndex + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        _setActive(_activeIndex - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (_activeIndex >= 0 && _results[_activeIndex]) {
          _open(_results[_activeIndex].filePath)
        }
      } else if (e.key === 'Escape') {
        _close()
        _input.blur()
      }
    })

    // Close when focus leaves the search area
    _input.addEventListener('blur', () => {
      setTimeout(_close, 150)
    })

    // Ctrl+Shift+F focuses the search box
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        _input.focus()
        _input.select()
      }
    })
  }

  return { init }
})()
