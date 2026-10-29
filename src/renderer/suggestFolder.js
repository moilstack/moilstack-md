/**
 * suggestFolder.js — "Suggest Folder…" in the file right-click menu.
 *
 * The AI sees the opened folder's sub-folders (with a few file names in
 * each, for context) and the start of the file. The dialog shows two
 * options, each with a reason: the best existing folder (if any fits) and
 * a suggested new folder name. The AI's pick is marked Recommended; the
 * user can choose or edit either, then Move / Create & Move / Cancel.
 * Nothing moves without a click.
 *
 * Uses aiService.complete (its own IPC channel), so it never disturbs a chat.
 */

const SuggestFolder = (() => {

  const HEAD_BYTES       = 4096
  const AI_CHARS         = 2000
  const MAX_FOLDERS      = 150
  const SAMPLE_FILES     = 3       // file names listed per folder, for context

  let _overlay, _title, _body, _primary, _cancel
  let _run = 0                     // bumped to ignore replies after close / reopen
  let _ctx = null                  // { filePath, fileName, root, sep, folders, currentRel }

  /* ── Helpers ── */

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  }

  /** Every folder in the opened folder: [{ rel, files: [names] }], root first as rel ''. */
  function _folders(root, sep) {
    const out = [{ rel: '', files: [] }]
    const walk = (nodes, entry) => {
      for (const n of nodes || []) {
        if (n.type === 'file') { if (entry.files.length < SAMPLE_FILES) entry.files.push(n.name) }
        else if (n.type === 'folder') {
          const rel = n.path.slice(root.length + 1).split(sep).join('/')
          const child = { rel, files: [] }
          out.push(child)
          walk(n.children, child)
        }
      }
    }
    walk(FileTreeManager.getCachedTree() ?? [], out[0])
    return out.slice(0, MAX_FOLDERS)
  }

  /** Tidy a user/AI folder path: "a / b/" → "a/b", drop unsafe characters. */
  function _cleanRel(rel) {
    return String(rel || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(seg => seg.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/^\.+|\.+$/g, ''))
      .filter(seg => seg && seg !== '.' && seg !== '..')
      .join('/')
  }

  /** Existing folder matching `rel` (case-insensitive), or null. */
  function _existing(rel) {
    const k = rel.toLowerCase()
    return _ctx.folders.find(f => f.rel.toLowerCase() === k) || null
  }

  function _label(rel) { return rel || 'Top level (opened folder)' }

  /* ── AI ── */

  /**
   * Ask for BOTH the best existing folder (if any fits) and a new folder name.
   * → { existing: { rel, reason } | null, fresh: { rel, reason } | null, recommended: 'existing'|'new' }
   */
  async function _ask(head) {
    const model = typeof AIConfigManager !== 'undefined' ? AIConfigManager.getActiveModel() : null
    if (!model) throw new Error('No AI model configured. Open Settings (⚙) to add one.')
    if (AIConfigManager.validateModel(model).length)
      throw new Error('The selected AI model is not fully configured. Update it in Settings.')

    const list = _ctx.folders.map(f =>
      `- ${f.rel ? f.rel : '(top level)'}${f.files.length ? `  — e.g. ${f.files.join(', ')}` : '  — (empty)'}`
    ).join('\n')

    const messages = [
      { role: 'system', content:
        'You organise files into folders. Given the folders in a project and the start of one ' +
        'file, give TWO options for where the file should go:\n' +
        '1. "existing": the best EXISTING folder for it, copied exactly from the list ("" = top ' +
        'level). Use null only if no existing folder is a reasonable fit.\n' +
        '2. "new": a NEW folder that would suit it — a short Title Case name (1-3 words) that is ' +
        'not already in the list, at the top level or inside an existing folder (e.g. ' +
        '"Marketing/Launch"). Always give this.\n' +
        'Then set "recommended" to whichever of the two is better: "existing" or "new".\n' +
        'Reply with ONLY a JSON object, no code fence, no other text:\n' +
        '{"existing": {"folder": "relative/path", "reason": "one short sentence"}, ' +
        '"new": {"folder": "Folder Name", "reason": "one short sentence"}, "recommended": "existing"}' },
      { role: 'user', content:
        `Folders (relative to the opened folder):\n${list}\n\n` +
        `File: ${_ctx.fileName}  (currently in: ${_ctx.currentRel || '(top level)'})\n\n` +
        `Start of the file:\n"""\n${head.slice(0, AI_CHARS)}\n"""` },
    ]
    const reply = (await aiService.complete(messages, model) || '').trim()
    const json = reply.match(/\{[\s\S]*\}/)
    if (!json) throw new Error('The AI did not suggest a folder.')
    let o
    try { o = JSON.parse(json[0]) } catch { throw new Error('The AI reply could not be read.') }

    const pick = x => x && typeof x === 'object'
      ? { rel: _cleanRel(x.folder === '(top level)' ? '' : x.folder), reason: String(x.reason || '').trim() }
      : null
    let existing = pick(o.existing)
    let fresh = pick(o.new)

    // "existing" must really exist; a "new" name that already exists is an existing pick
    if (existing) existing = _existing(existing.rel) ? { ...existing, rel: _existing(existing.rel).rel } : null
    if (fresh && (!fresh.rel || _existing(fresh.rel))) {
      if (!existing && fresh.rel) existing = { ...fresh, rel: _existing(fresh.rel).rel }
      fresh = null
    }
    if (!existing && !fresh) throw new Error('The AI did not suggest a folder.')

    let recommended = o.recommended === 'new' ? 'new' : 'existing'
    if (recommended === 'existing' && !existing) recommended = 'new'
    if (recommended === 'new' && !fresh) recommended = 'existing'
    return { existing, fresh, recommended }
  }

  /* ── Dialog ── */

  function _build() {
    _overlay = document.createElement('div')
    _overlay.className = 'label-modal-overlay hidden suggest-folder'
    _overlay.setAttribute('role', 'dialog')
    _overlay.setAttribute('aria-modal', 'true')
    _overlay.innerHTML = `
      <div class="label-modal">
        <div class="label-modal__header">
          <span class="label-modal__title"></span>
          <button type="button" class="settings-close-btn" title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="label-modal__body">
          <div class="suggest-folder__body"></div>
          <div class="label-modal__actions">
            <button type="button" class="btn btn-outline btn-sm suggest-folder__cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm suggest-folder__primary">Move</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(_overlay)
    _title   = _overlay.querySelector('.label-modal__title')
    _body    = _overlay.querySelector('.suggest-folder__body')
    _primary = _overlay.querySelector('.suggest-folder__primary')
    _cancel  = _overlay.querySelector('.suggest-folder__cancel')

    _overlay.querySelector('.settings-close-btn').addEventListener('click', close)
    _cancel.addEventListener('click', close)
    _overlay.addEventListener('mousedown', e => { if (e.target === _overlay) close() })
    _overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !_primary.disabled) { e.preventDefault(); _primary.click() }
    })
    _primary.addEventListener('click', _apply)
  }

  function close() {
    _run++
    _overlay?.classList.add('hidden')
    _ctx = null
  }

  function _showLoading() {
    _body.innerHTML = `
      <p class="suggest-folder__hint">Looking at the file and your folders…</p>
      <span class="in-short__shimmer"></span><span class="in-short__shimmer in-short__shimmer--short"></span>`
    _primary.disabled = true
    _primary.textContent = 'Move'
  }

  function _showError(msg) {
    _body.innerHTML = `<p class="suggest-folder__error">${_esc(msg)}</p>`
    _primary.disabled = true
  }

  const FOLDER_SVG = `<svg class="suggest-folder__icon" width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.293 4H12.5A1 1 0 0 1 13.5 5v6a1 1 0 0 1-1 1h-10A1 1 0 0 1 1.5 11V3.5Z"
          stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`

  /** One selectable option card: an existing folder or a new folder name. */
  function _card(kind, opt, recommended) {
    const isExisting = kind === 'existing'
    const title = isExisting ? 'Move to an existing folder' : 'Create a new folder'
    const placeholder = isExisting ? 'No existing folder fits — pick one' : 'New folder name'
    const reason = opt?.reason || (isExisting && !opt ? 'None of your folders look like a good fit.' : '')
    return `
      <label class="suggest-folder__card" data-kind="${kind}">
        <input type="radio" name="suggestFolderChoice" value="${kind}" ${recommended ? 'checked' : ''}>
        <div class="suggest-folder__card-main">
          <div class="suggest-folder__card-head">
            <span class="suggest-folder__card-title">${title}</span>
            ${recommended ? '<span class="suggest-folder__badge is-rec">Recommended</span>' : ''}
          </div>
          <div class="suggest-folder__row">
            ${FOLDER_SVG}
            <input type="text" class="form-input suggest-folder__input" data-kind="${kind}"
                   ${isExisting ? 'list="suggestFolderList"' : ''} spellcheck="false"
                   placeholder="${placeholder}" aria-label="${title}">
          </div>
          ${reason ? `<p class="suggest-folder__reason">${_esc(reason)}</p>` : ''}
        </div>
      </label>`
  }

  function _showResult({ existing, fresh, recommended }) {
    const options = _ctx.folders.map(f => `<option value="${_esc(f.rel)}">${_esc(_label(f.rel))}</option>`).join('')
    _body.innerHTML = `
      ${_card('existing', existing, recommended === 'existing')}
      ${_card('new', fresh, recommended === 'new')}
      <datalist id="suggestFolderList">${options}</datalist>
      <p class="suggest-folder__status"></p>`

    const exIn = _body.querySelector('.suggest-folder__input[data-kind="existing"]')
    const newIn = _body.querySelector('.suggest-folder__input[data-kind="new"]')
    exIn.value = existing?.rel ?? ''
    newIn.value = fresh?.rel ?? ''

    for (const input of [exIn, newIn]) {
      // Typing (or focusing) a box selects its option
      const select = () => {
        _body.querySelector(`input[type=radio][value="${input.dataset.kind}"]`).checked = true
        _refreshState()
      }
      input.addEventListener('focus', select)
      input.addEventListener('input', select)
    }
    _body.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', _refreshState))
    _refreshState()
    _body.querySelector(`.suggest-folder__input[data-kind="${recommended}"]`)?.focus()
  }

  /** The folder (relative path) the selected option points at. */
  function _selectedRel() {
    const kind = _body.querySelector('input[type=radio]:checked')?.value || 'existing'
    const input = _body.querySelector(`.suggest-folder__input[data-kind="${kind}"]`)
    const rel = _cleanRel(input?.value)
    return { kind, rel: _existing(rel)?.rel ?? rel, empty: !input?.value.trim() }
  }

  /** Update the status line and primary button for the selected option. */
  function _refreshState() {
    const status = _body.querySelector('.suggest-folder__status')
    if (!status) return
    _body.querySelectorAll('.suggest-folder__card').forEach(c =>
      c.classList.toggle('is-selected', c.querySelector('input[type=radio]').checked))

    const { kind, rel, empty } = _selectedRel()
    const hit = _existing(rel)

    if (kind === 'new' && empty) {
      status.textContent = 'Type a name for the new folder.'
      _primary.disabled = true
      _primary.textContent = 'Create & Move'
    } else if (hit && hit.rel.toLowerCase() === _ctx.currentRel.toLowerCase()) {
      status.textContent = 'The file is already in this folder.'
      _primary.disabled = true
      _primary.textContent = 'Move'
    } else if (hit) {
      status.textContent = `Will move to ${_label(hit.rel)}.`
      _primary.disabled = false
      _primary.textContent = 'Move'
    } else {
      status.textContent = `Will create ${_label(rel)} and move the file there.`
      _primary.disabled = false
      _primary.textContent = 'Create & Move'
    }
  }

  /* ── Move / create ── */

  async function _apply() {
    if (!_ctx || _primary.disabled) return
    const ctx = _ctx
    const { rel } = _selectedRel()
    _primary.disabled = true

    // Create any missing folders, one level at a time
    let dir = ctx.root
    const opened = []                      // every level, so the Explorer shows the file
    for (const seg of rel ? rel.split('/') : []) {
      const next = dir + ctx.sep + seg
      opened.push(next)
      const known = ctx.folders.some(f => (ctx.root + (f.rel ? ctx.sep + f.rel.split('/').join(ctx.sep) : '')).toLowerCase() === next.toLowerCase())
      if (!known) {
        const res = await window.electronAPI?.createFolder(dir, seg)
        if (!res?.ok && !/already exists/i.test(res?.error || '')) {
          _body.querySelector('.suggest-folder__status').textContent = res?.error || 'Could not create the folder.'
          _primary.disabled = false
          return
        }
      }
      dir = next
    }

    const result = await window.electronAPI?.moveFile(ctx.filePath, dir)
    if (!result?.ok) {
      _body.querySelector('.suggest-folder__status').textContent = result?.error || 'Move failed.'
      _primary.disabled = false
      return
    }

    // Keep the open file pointing at its new location (same as drag-and-drop)
    if (typeof currentFile !== 'undefined' && currentFile.path === ctx.filePath) {
      const name = result.newPath.split(/[\\/]/).pop()
      currentFile = { name, path: result.newPath }
      StatusBar.updateFilename(name)
      StatusBar.updateChatContextFile(name)
    }

    close()
    opened.forEach(p => StorageManager.expandFolder(p))
    await FileTreeManager.setActiveFolder(ctx.root)
    FileTreeManager.restoreActiveItem()
    StatusBar.showToast(`Moved to ${_label(rel)}`)
  }

  /* ── Entry point ── */

  async function show(filePath) {
    const root = sessionStorage.getItem('lastFolder')
    if (!root || !filePath.startsWith(root)) {
      StatusBar.showToast('Open a folder in the Explorer first.')
      return
    }
    if (!_overlay) _build()
    const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
    const fileName = filePath.split(/[\\/]/).pop()
    const currentDir = filePath.slice(0, filePath.length - fileName.length - 1)
    _ctx = {
      filePath, fileName, root, sep,
      folders: _folders(root, sep),
      currentRel: currentDir.length > root.length ? currentDir.slice(root.length + 1).split(sep).join('/') : '',
    }

    const run = ++_run
    _title.textContent = `Suggest Folder — ${fileName}`
    _overlay.classList.remove('hidden')
    _showLoading()
    _cancel.focus()

    try {
      const head = (await window.electronAPI?.readFileHead(filePath, HEAD_BYTES))?.content || ''
      if (!head.trim()) throw new Error('This file is empty, so there is nothing to go on.')
      const suggestion = await _ask(head)
      if (run !== _run) return                 // dialog closed or reopened meanwhile
      _showResult(suggestion)
    } catch (err) {
      if (run !== _run) return
      _showError(err.message || 'The AI request failed.')
    }
  }

  return { show }
})()
