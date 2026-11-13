/**
 * scratchNotes.js — the Scratchpad as a grid of quick-note cards.
 *
 * Clicking "Scratchpad" in Recent Files opens a view over the editor with
 * one card per note: a title (the first line) and a few rendered lines.
 * Clicking a card expands it full-width with Copy, Copy as Markdown, Edit,
 * Save as file…, Pin and Delete. Edit loads the note into the normal
 * untitled editor buffer, so every editor feature works on it; typing there
 * keeps the note up to date.
 *
 * Notes live in <userData>/backups/scratch-notes.json (main process,
 * notes:read / notes:write), never in the user's folders. The untitled
 * draft still works as before; it is simply "the note being edited".
 */

const ScratchNotes = (() => {

  const EDITING_KEY = 'scratchEditingId'
  const PREVIEW_CHARS = 600
  const SAVE_DELAY = 400

  let _notes = []
  let _loaded = false
  let _editingId = null
  let _expandedId = null
  let _view = null
  let _bar = null                // bar above the editor while a note is being edited
  let _saveTimer = null
  let _inputTimer = null

  /* ── Helpers ── */

  const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  const _newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const _byId = id => _notes.find(n => n.id === id)
  const _isLiveUntitled = () => typeof currentFile !== 'undefined' && !currentFile.path
  const _isShown = () => !!_view && !_view.classList.contains('hidden')
  const _blank = t => !t || !t.trim() || t === window.SCRATCHPAD_TEMPLATE

  /** Card title: the first non-empty line without Markdown heading / list markers. */
  function _title(text) {
    const line = (text || '').split('\n').find(l => l.trim()) || ''
    return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, '').replace(/[*_`]/g, '').trim() || 'Untitled note'
  }

  /** Everything after the title line. */
  function _body(text) {
    const lines = (text || '').split('\n')
    const i = lines.findIndex(l => l.trim())
    return i < 0 ? '' : lines.slice(i + 1).join('\n').trim()
  }

  function _ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  // parseMarkdown escapes raw text before adding tags, so its output is safe to insert
  const _md = text => (typeof MarkdownRenderer !== 'undefined' ? MarkdownRenderer.parseMarkdown(text) : _esc(text))
    .replace(/ data-line(-end)?="[^"]*"/g, '')

  /* ── Storage ── */

  async function _load() {
    const res = await window.electronAPI?.notes?.read?.()
    _notes = res?.notes || []
    try { _editingId = localStorage.getItem(EDITING_KEY) } catch { _editingId = null }
    if (_editingId && !_byId(_editingId)) _setEditing(null)

    // First run with notes: the existing Scratchpad text becomes the first card
    if (res && !res.exists) {
      const draft = SaveManager.getDraft()
      if (!_blank(draft)) {
        const n = { id: _newId(), text: draft, updated: Date.now(), pinned: false }
        _notes.push(n)
        _setEditing(n.id)
      }
      _saveNow()
    }

    // Launch opens a fresh page, not the last note: keep any leftover
    // Scratchpad text as a card, then let go of the draft.
    const draft = SaveManager.getDraft()
    if (!_blank(draft) && !_notes.some(n => n.text === draft)) {
      _notes.push({ id: _newId(), text: draft, updated: Date.now(), pinned: false })
      _saveNow()
    }
    if (SaveManager.hasDraft()) SaveManager.clearDraft()   // also clears the editing note
    _loaded = true
  }

  function _save() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(_saveNow, SAVE_DELAY)
  }

  function _saveNow() {
    clearTimeout(_saveTimer)
    _saveTimer = null
    window.electronAPI?.notes?.write?.(_notes)
  }

  function _setEditing(id) {
    _editingId = id
    try { id ? localStorage.setItem(EDITING_KEY, id) : localStorage.removeItem(EDITING_KEY) } catch { /* ignore */ }
    _updateBar()
  }

  /* ── "Back to Scratchpad" bar above the editor ── */

  function _buildBar() {
    _bar = document.createElement('div')
    _bar.className = 'scratch-bar hidden'
    _bar.innerHTML = `
      <button type="button" class="scratch-bar__back" title="Back to the Scratchpad (Esc)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Scratchpad
      </button>
      <span class="scratch-bar__sep">/</span>
      <span class="scratch-bar__title"></span>
      <span class="scratch-bar__status">Saved automatically</span>
      <span class="scratch-view__spacer"></span>
      <button type="button" class="scratch-btn" data-bar="copy" title="Copy the Markdown source">Copy</button>
      <button type="button" class="scratch-btn" data-bar="save" title="Save this note as a file in a folder">Save as file…</button>
      <button type="button" class="scratch-btn scratch-btn--primary" data-bar="done" title="Back to the Scratchpad">Done</button>`
    document.getElementById('editorArea')?.before(_bar)
    const back = () => { const id = _editingId; open().then(() => { if (id && _byId(id)) { _expandedId = id; _render() } }) }
    _bar.querySelector('.scratch-bar__back').addEventListener('click', back)
    _bar.querySelector('[data-bar="done"]').addEventListener('click', back)
    _bar.querySelector('[data-bar="copy"]').addEventListener('click', () => { _syncFromEditor(); const n = _byId(_editingId); if (n) _copy(n, true) })
    _bar.querySelector('[data-bar="save"]').addEventListener('click', () => { _syncFromEditor(); const n = _byId(_editingId); if (n) _saveAsFile(n) })
  }

  /** Show the bar while the untitled buffer is a note, with its current title. */
  function _updateBar() {
    if (!_bar) { if (!document.getElementById('editorArea')) return; _buildBar() }
    const n = _editingId && _byId(_editingId)
    const show = !!n && _isLiveUntitled()
    _bar.classList.toggle('hidden', !show)
    if (show) _bar.querySelector('.scratch-bar__title').textContent = _title(n.text)
  }

  /** Copy the live untitled buffer into the note it belongs to (or start one). */
  function _syncFromEditor() {
    if (!_loaded || !_isLiveUntitled() || typeof mdEditor === 'undefined' || !mdEditor) return
    const text = mdEditor.value
    const n = _editingId && _byId(_editingId)
    if (n) {
      if (n.text !== text) { n.text = text; n.updated = Date.now(); _save(); _updateBar() }
    } else if (!_blank(text)) {
      const fresh = { id: _newId(), text, updated: Date.now(), pinned: false }
      _notes.push(fresh)
      _setEditing(fresh.id)
      _save()
    }
  }

  /* ── Actions ── */

  async function _edit(id) {
    const n = _byId(id)
    if (!n) return
    _syncFromEditor()                    // keep the note being edited now
    _setEditing(id)
    SaveManager.setDraft(n.text)
    close()
    await window.restoreDraftFile?.(n.text)
    _updateBar()
    if (typeof currentMode !== 'undefined' && currentMode === 'preview' && !n.text.trim()) setMode('edit')
    mdEditor?.focus()
  }

  function _newNote(text = '') {
    const n = { id: _newId(), text, updated: Date.now(), pinned: false }
    _notes.push(n)
    _saveNow()
    return n
  }

  async function _pasteAsNote() {
    let text = ''
    try { text = await navigator.clipboard.readText() } catch { /* not allowed */ }
    if (!text.trim()) { StatusBar.showToast('The clipboard has no text to paste.'); return }
    const n = _newNote(text)
    _expandedId = n.id
    _render()
    StatusBar.showToast('Pasted as a new note.')
  }

  async function _copy(n, asMarkdown) {
    let text = n.text
    if (!asMarkdown) {
      const tmp = document.createElement('div')
      tmp.innerHTML = _md(n.text)
      tmp.querySelectorAll('.code-copy-btn').forEach(b => b.remove())
      text = tmp.innerText.trim()
    }
    try {
      await navigator.clipboard.writeText(text)
      StatusBar.showToast(asMarkdown ? 'Copied as Markdown.' : 'Copied.')
    } catch {
      StatusBar.showToast('Could not copy to the clipboard.')
    }
  }

  async function _saveAsFile(n) {
    if (!n.text.trim()) { StatusBar.showToast('This note is empty.'); return }
    const folder = sessionStorage.getItem('lastFolder') || null
    const result = await window.electronAPI?.newFile(SaveManager.suggestFilename(n.text), folder)
    if (!result?.filePath) return
    const res = await window.electronAPI.writeFile(result.filePath, n.text)
    if (!res?.ok) { StatusBar.showToast(res?.error || 'Save failed.'); return }
    const name = result.filePath.split(/[\\/]/).pop()
    StorageManager.addRecentItem('file', result.filePath, name, SaveManager.extractFirstLine(n.text))
    if (typeof FileTreeManager !== 'undefined') FileTreeManager.refresh?.()
    RecentsPanel.render()
    StatusBar.showToast(`Saved as "${name}". The note stays in the Scratchpad.`)
  }

  function _delete(n) {
    const i = _notes.indexOf(n)
    if (i < 0) return
    _notes.splice(i, 1)
    if (_expandedId === n.id) _expandedId = null
    const wasEditing = _editingId === n.id
    if (wasEditing) {
      _setEditing(null)
      // Its text is still in the editor buffer — start that over too
      if (_isLiveUntitled()) window.discardLiveUntitledDraft?.()
      else SaveManager.clearDraft()
    }
    _saveNow()
    _render()
    StatusBar.showToast('Note deleted.', {
      action: { label: 'Undo', onClick: () => { _notes.splice(i, 0, n); _saveNow(); _render() } },
    })
  }

  /* ── View ── */

  function _build() {
    _view = document.createElement('div')
    _view.className = 'scratch-view hidden'
    _view.setAttribute('role', 'region')
    _view.setAttribute('aria-label', 'Scratchpad')
    _view.innerHTML = `
      <div class="scratch-view__inner">
        <div class="scratch-view__header">
          <h1 class="scratch-view__title">Scratchpad</h1>
          <span class="scratch-view__hint">Quick notes, kept automatically — never saved to your folders</span>
          <span class="scratch-view__spacer"></span>
          <button type="button" class="btn btn-outline btn-sm scratch-paste">Paste as note</button>
          <button type="button" class="btn btn-primary btn-sm scratch-new">+ New note</button>
        </div>
        <div class="scratch-grid"></div>
      </div>`
    document.querySelector('.main-content').append(_view)

    _view.querySelector('.scratch-new').addEventListener('click', () => _edit(_newNote().id))
    _view.querySelector('.scratch-paste').addEventListener('click', _pasteAsNote)
    _view.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (_expandedId) { _expandedId = null; _render() } else close()
    })

    const grid = _view.querySelector('.scratch-grid')
    grid.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]')
      const card = e.target.closest('[data-id]')
      const n = card && _byId(card.dataset.id)
      if (!n) return
      if (btn) {
        e.stopPropagation()
        const act = btn.dataset.act
        if (act === 'copy') _copy(n, false)
        else if (act === 'copy-md') _copy(n, true)
        else if (act === 'edit') _edit(n.id)
        else if (act === 'save') _saveAsFile(n)
        else if (act === 'pin') { n.pinned = !n.pinned; _saveNow(); _render() }
        else if (act === 'delete') _delete(n)
        else if (act === 'collapse') { _expandedId = null; _render() }
        return
      }
      // Let links and code-copy buttons inside the rendered note work as usual
      if (e.target.closest('a, .code-copy-btn')) return
      if (_expandedId !== n.id) { _expandedId = n.id; _render() }
    })
    grid.addEventListener('dblclick', e => {
      const card = e.target.closest('.scratch-card--open')
      if (card) _edit(card.dataset.id)
    })
    grid.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return
      const card = e.target.closest('[data-id]')
      if (card && _expandedId !== card.dataset.id) { _expandedId = card.dataset.id; _render() }
    })
  }

  const PIN_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2ZM8 8.5V14" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`

  function _cardHTML(n) {
    const open = n.id === _expandedId
    const editing = n.id === _editingId && _isLiveUntitled()
    const badges = (n.pinned ? `<span class="scratch-card__pin" title="Pinned">${PIN_SVG}</span>` : '')
      + (editing ? '<span class="scratch-card__badge">Editing</span>' : '')
    if (!open) {
      const body = _body(n.text).slice(0, PREVIEW_CHARS)
      return `
        <article class="scratch-card" data-id="${n.id}" tabindex="0" title="Click to expand">
          <div class="scratch-card__head"><h3 class="scratch-card__title">${_esc(_title(n.text))}</h3>${badges}</div>
          <div class="scratch-card__preview preview-content">${body ? _md(body) : '<p class="scratch-card__empty">Empty note</p>'}</div>
          <div class="scratch-card__foot">${_ago(n.updated)}</div>
        </article>`
    }
    return `
      <article class="scratch-card scratch-card--open" data-id="${n.id}" tabindex="0">
        <div class="scratch-card__head">
          <h3 class="scratch-card__title">${_esc(_title(n.text))}</h3>${badges}
          <span class="scratch-view__spacer"></span>
          <div class="scratch-card__actions">
            <button type="button" class="scratch-btn" data-act="copy" title="Copy the text">Copy</button>
            <button type="button" class="scratch-btn" data-act="copy-md" title="Copy the Markdown source">Copy as Markdown</button>
            <button type="button" class="scratch-btn scratch-btn--primary" data-act="edit" title="Open in the editor (or double-click)">Edit</button>
            <button type="button" class="scratch-btn" data-act="save" title="Save this note as a file in a folder">Save as file…</button>
            <button type="button" class="scratch-btn" data-act="pin">${n.pinned ? 'Unpin' : 'Pin'}</button>
            <button type="button" class="scratch-btn scratch-btn--danger" data-act="delete">Delete</button>
            <button type="button" class="scratch-btn scratch-btn--icon" data-act="collapse" title="Collapse (Esc)" aria-label="Collapse">✕</button>
          </div>
        </div>
        <div class="scratch-card__full preview-content">${n.text.trim() ? _md(n.text) : '<p class="scratch-card__empty">Empty note — click Edit to write.</p>'}</div>
        <div class="scratch-card__foot">Updated ${_ago(n.updated)}</div>
      </article>`
  }

  function _render() {
    if (!_view) return
    const grid = _view.querySelector('.scratch-grid')
    const sorted = [..._notes].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated))
    grid.innerHTML = sorted.length
      ? sorted.map(_cardHTML).join('')
      : `<div class="scratch-empty">
           <p>No notes yet.</p>
           <p>Use <b>+ New note</b> to write, or <b>Paste as note</b> to drop in whatever you copied.</p>
         </div>`
    const open = grid.querySelector('.scratch-card--open')
    if (open) { open.scrollIntoView({ block: 'nearest' }); open.focus({ preventScroll: true }) }
  }

  /* ── Public ── */

  async function open() {
    if (!_loaded) await _load()
    _syncFromEditor()
    if (!_view) _build()
    if (typeof FolderLists !== 'undefined') FolderLists.hideAllExcept(null)
    if (typeof WelcomeScreen !== 'undefined') WelcomeScreen.hideWelcomeScreen()
    _render()
    _view.classList.remove('hidden')
    if (!_view.querySelector('.scratch-card--open')) _view.querySelector('.scratch-new').focus()
  }

  function close() {
    _view?.classList.add('hidden')
    _updateBar()
  }

  /** The untitled buffer was reset or discarded: it no longer belongs to a note. */
  function detach() { _setEditing(null) }

  async function init() {
    await _load()
    _updateBar()
    // Esc in the editor of a note goes back to the Scratchpad (unless something else uses it)
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.defaultPrevented || _isShown() || !_bar || _bar.classList.contains('hidden')) return
      if (document.querySelector('.label-modal-overlay:not(.hidden), .settings-overlay:not(.hidden), .quick-edit')) return
      if (document.activeElement !== mdEditor && !document.getElementById('editorArea')?.contains(document.activeElement)) return
      e.preventDefault()
      _bar.querySelector('.scratch-bar__back').click()
    })
    if (typeof mdEditor !== 'undefined' && mdEditor) {
      mdEditor.addEventListener('input', () => {
        clearTimeout(_inputTimer)
        _inputTimer = setTimeout(_syncFromEditor, SAVE_DELAY)
      })
    }
    // Last edits before quitting
    window.addEventListener('beforeunload', () => { _syncFromEditor(); if (_saveTimer) _saveNow() })
  }

  return { init, open, close, detach, isShown: () => _isShown(), refreshBar: () => _updateBar() }
})()

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScratchNotes }
}
