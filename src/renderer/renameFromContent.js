/**
 * renameFromContent.js — suggest filenames from what a file starts with.
 *
 * Only the first few KB of each file are read (file:read-head). The name
 * comes from, in order: frontmatter `title:`, the first heading, or the
 * first line of text. Or, with `useAI`, the active AI model reads that same
 * start of the file and proposes a short title.
 *
 * Tags are suggested alongside the name: existing frontmatter tags plus any
 * #hashtags near the top (or, with AI, tags the model proposes).
 *
 *  - renameFile(path)   → inline rename in the Explorer, prefilled, then tags
 *  - renameFolder(path) → review modal for every file directly in a folder
 *
 * FileOperations / FileTreeManager are loaded after this module; calls are lazy.
 */

const RenameFromContent = (() => {

  const HEAD_BYTES = 4096
  const MAX_WORDS  = 10
  const MAX_CHARS  = 80
  const AI_CHARS   = 2000   // how much of the file start the AI sees
  const MAX_TAGS   = 3      // suggested tags per file (existing tags are never dropped)

  /* ── Name suggestion ──────────────────────────────────────────────── */

  /** Strip inline Markdown so "**Q3** [plan](x)" reads as "Q3 plan". */
  function _plainText(line) {
    return line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links
      .replace(/<[^>]+>/g, '')                    // HTML tags
      .replace(/[*_`~]+/g, '')                    // emphasis / code
      .replace(/^\s*(?:[-+*]|\d+[.)]|>)\s+/, '')  // list / quote markers
      .replace(/^\s*\[[ xX]\]\s+/, '')            // task checkbox
      .trim()
  }

  /** Pick the best title text from the start of a file, or ''. */
  function _titleFrom(head) {
    let body = head.replace(/\r\n?/g, '\n')

    // Frontmatter: use `title:` if present, then skip past it
    const fm = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
    if (fm) {
      const t = fm[1].match(/^title:\s*(.+)$/m)
      if (t) {
        const title = t[1].trim().replace(/^(['"])(.*)\1$/, '$2')
        if (title) return title
      }
      body = body.slice(fm[0].length)
    }

    const lines = body.split('\n')
    let inFence = false
    let firstText = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
      if (inFence || !line.trim()) continue

      const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      if (atx) return _plainText(atx[1])

      // Setext heading: text followed by === or ---
      if (/^\s*(=+|-+)\s*$/.test(lines[i + 1] || '') && !/^\s*[-=*_]+\s*$/.test(line))
        return _plainText(line)

      if (!firstText && !/^\s*([-*_]\s*){3,}$/.test(line) && !/^\s*\|/.test(line)) {
        firstText = _plainText(line)
      }
    }
    return firstText
  }

  /** Turn title text into a safe filename stem ('' if nothing usable). */
  function _toStem(title) {
    let s = title
      .replace(/[\\/:|]+/g, ' - ')        // separators → readable dash
      .replace(/[*?"<>#\[\]{}^]+/g, '')   // characters filenames can't (or shouldn't) hold
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/(\s-\s)+/g, ' - ')
      .trim()

    const words = s.split(' ')
    if (words.length > MAX_WORDS) s = words.slice(0, MAX_WORDS).join(' ')
    if (s.length > MAX_CHARS)     s = s.slice(0, MAX_CHARS).replace(/\s+\S*$/, '')

    // No leading/trailing dots, dashes or spaces (hidden files, Windows quirks)
    return s.replace(/^[\s.\-]+|[\s.\-]+$/g, '')
  }

  /** Normalise a tag: lowercase, words joined by "-", no leading "#". */
  function _cleanTag(t) {
    return String(t).trim().replace(/^#+/, '').toLowerCase()
      .replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}\-\/]/gu, '').replace(/^-+|-+$/g, '')
  }

  /** Existing tags first (kept as written), then new ones normalised; no case-insensitive dupes. */
  function _mergeTags(existing, ...lists) {
    const out = [], seen = new Set()
    const add = t => { if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) } }
    existing.forEach(t => add(String(t).trim()))
    const cap = Math.max(MAX_TAGS, out.length)   // only new tags count against the cap
    // Keep a tag as-is if it is already a valid tag (e.g. reused "Work"),
    // otherwise normalise it
    lists.flat().forEach(t => {
      const raw = String(t).trim()
      add(raw && _cleanTag(raw) === raw.toLowerCase() ? raw : _cleanTag(raw))
    })
    return out.slice(0, cap)
  }

  /** #hashtags in the text (not headings, not inside code). */
  function _hashtagsFrom(head) {
    const tags = []
    let inFence = false
    for (const line of head.replace(/\r\n?/g, '\n').split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
      if (inFence) continue
      const text = line.replace(/`[^`]*`/g, '')
      for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}][\p{L}\p{N}_\-\/]{1,30})/gu)) tags.push(m[1])
    }
    return tags
  }

  function _ext(name) {
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i) : '.md'
  }

  /** The active AI model, or throws a user-readable Error if none is usable. */
  function _aiModel() {
    const model = typeof AIConfigManager !== 'undefined' ? AIConfigManager.getActiveModel() : null
    if (!model) throw new Error('No AI model configured. Open Settings (⚙) to add one.')
    if (AIConfigManager.validateModel(model).length)
      throw new Error('The selected AI model is not fully configured. Update it in Settings.')
    return model
  }

  /* ── Tag vocabulary: tags already used across the opened folder ───── */

  const VOCAB_MAX_FILES = 500   // files scanned (first 4 KB each)
  const VOCAB_MAX_TAGS  = 150   // most-used tags shown to the AI
  let _vocabCache = null        // { at, tags: Map<lower, { tag, count }> }

  function _allFiles(nodes, out = []) {
    for (const n of nodes) {
      if (n.type === 'file') out.push(n.path)
      else if (n.children) _allFiles(n.children, out)
    }
    return out
  }

  /** Map of every tag used in the opened folder (any depth), cached briefly. */
  async function _folderTags() {
    if (_vocabCache && Date.now() - _vocabCache.at < 30_000) return _vocabCache.tags
    const files = _allFiles(FileTreeManager.getCachedTree() ?? []).slice(0, VOCAB_MAX_FILES)
    const tags = new Map()
    const heads = await Promise.all(files.map(p => window.electronAPI?.readFileHead(p, HEAD_BYTES)))
    for (const h of heads) {
      for (const t of TagModal.tagsIn(h?.content || '')) {
        const k = t.toLowerCase()
        const e = tags.get(k)
        if (e) e.count++
        else tags.set(k, { tag: t, count: 1 })
      }
    }
    _vocabCache = { at: Date.now(), tags }
    return tags
  }

  /** Record tags just written, so later suggestions in the same pass reuse them. */
  function _learnTags(list) {
    if (!_vocabCache) return
    for (const t of list) {
      const k = t.toLowerCase()
      const e = _vocabCache.tags.get(k)
      if (e) e.count++
      else _vocabCache.tags.set(k, { tag: t, count: 1 })
    }
  }

  /** Ask the AI for a title and tags for this file start → { title, tags }. */
  async function _aiSuggest(head, fileName) {
    const vocab = await _folderTags()
    const known = [...vocab.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, VOCAB_MAX_TAGS)
      .map(e => e.tag)
    const model = _aiModel()
    const messages = [
      { role: 'system', content:
        'You name and tag files. Read the start of a document and reply with ONLY a ' +
        'JSON object, no code fence, no other text: {"title": "...", "tags": ["..."]}. ' +
        'title: a short descriptive title, 2 to 8 words, Title Case, no file extension, ' +
        'no punctuation at the end. tags: 2 to 3 short topic tags. If tags already used ' +
        'in this folder are listed, REUSE those exact tags whenever they fit the ' +
        'document; only invent a new tag (lowercase, one or two words joined by "-") ' +
        'when none of the existing ones fit.' },
      { role: 'user', content:
        `Current filename: ${fileName}\n\n` +
        `Tags already used in this folder: ${known.length ? known.join(', ') : '(none yet)'}\n\n` +
        `Start of the document:\n"""\n${head.slice(0, AI_CHARS)}\n"""` },
    ]
    const reply = (await aiService.complete(messages, model) || '').trim()
    const strip = t => String(t).replace(/^["'`*]+|["'`*.]+$/g, '').trim()

    // Prefer the JSON object; fall back to treating the first line as the title
    const json = reply.match(/\{[\s\S]*\}/)
    if (json) {
      try {
        const o = JSON.parse(json[0])
        // Use the folder's spelling of a tag the AI reused (e.g. "Work", not "work")
        const tags = (Array.isArray(o.tags) ? o.tags : [])
          .map(t => vocab.get(_cleanTag(t))?.tag || vocab.get(String(t).trim().toLowerCase())?.tag || t)
        return { title: strip(o.title || ''), tags }
      } catch { /* not valid JSON — fall through */ }
    }
    const line = reply.split('\n').map(l => l.trim()).find(Boolean) || ''
    return { title: strip(strip(line).replace(/^(title|filename)\s*:\s*/i, '')), tags: [] }
  }

  /**
   * Suggest a filename and tags for `filePath`.
   * → { name: string|null, tags: string[], existingTags: string[] } or null if unreadable.
   * With `useAI`, throws if the AI model is missing or the request fails.
   */
  async function suggest(filePath, { useAI = false } = {}) {
    const res = await window.electronAPI?.readFileHead(filePath, HEAD_BYTES)
    if (!res) return null
    const head = res.content || ''
    const fileName = filePath.split(/[\\/]/).pop()
    const existingTags = TagModal.tagsIn(head)
    if (useAI && !head.trim()) return { name: null, tags: existingTags, existingTags }

    let title, newTags
    if (useAI) ({ title, tags: newTags } = await _aiSuggest(head, fileName))
    else { title = _titleFrom(head); newTags = _hashtagsFrom(head) }

    const stem = _toStem(title)
    return {
      name: stem ? stem + _ext(fileName) : null,
      tags: _mergeTags(existingTags, newTags),
      existingTags,
    }
  }

  /** Just the suggested filename (or null). */
  async function suggestName(filePath, opts) {
    return (await suggest(filePath, opts))?.name ?? null
  }

  function _sameTags(a, b) {
    return a.length === b.length && a.every((t, i) => t === b[i])
  }

  /** Tags as typed in a row (trimmed, deduped; spelling kept). */
  function _parseTags(text) {
    return _mergeTags(text.split(','))
  }

  /** Add " (2)", " (3)"… until `name` isn't in `taken` (case-insensitive). */
  function _unique(name, taken) {
    if (!taken.has(name.toLowerCase())) return name
    const ext = _ext(name), stem = name.slice(0, -ext.length)
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  /**
   * Save tags into a file's frontmatter. The open file is changed in the
   * editor and then saved, so the disk copy (which a rename reopens) has them.
   */
  async function _writeTags(path, tags) {
    const isOpen = path === document.querySelector('#file-list .file-item.active')?.dataset.path
    const result = await TagModal.applyTagsToFile(path, tags)
    if (result?.ok) _learnTags(tags)
    if (result?.ok && isOpen) {
      SaveManager.markDirty()
      await SaveManager.silentSave()
    }
    return result ?? { ok: false }
  }

  /* ── Single file ──────────────────────────────────────────────────── */

  async function renameFile(filePath, { useAI = false } = {}) {
    _vocabCache = null   // re-read tags — files may have changed since last time
    const current = filePath.split(/[\\/]/).pop()
    const siblings = _filesIn(_dirOf(filePath)).map(f => f.name.toLowerCase())
    const taken = new Set(siblings.filter(n => n !== current.toLowerCase()))

    let suggested, result
    if (useAI) {
      const item = [...document.querySelectorAll('#file-list .file-item')].find(i => i.dataset.path === filePath)
      item?.classList.add('file-item--busy')
      StatusBar.showToast('Asking AI for a name…')
      try {
        result = await suggest(filePath, { useAI: true })
        suggested = result?.name
      } catch (err) {
        StatusBar.showToast(err.message || 'AI request failed.')
        return
      } finally {
        item?.classList.remove('file-item--busy')
      }
      if (!suggested) { StatusBar.showToast('The AI did not suggest a name.'); return }
    } else {
      result = await suggest(filePath)
      suggested = result?.name
    }
    if (suggested) suggested = _unique(suggested, taken)

    // When the name is confirmed, save the suggested tags straight into the
    // file (before the rename, so the reopened file already has them)
    const onConfirm = async path => {
      if (!result || _sameTags(result.tags, result.existingTags)) return
      const saved = await _writeTags(path, result.tags)
      StatusBar.showToast(saved.ok ? `Tags: ${result.tags.join(', ')}` : (saved.error || 'Could not save tags.'))
    }
    // Opens the normal inline rename box, prefilled — user can edit or Esc
    FileOperations.startInlineRename(filePath, suggested || current, onConfirm)
  }

  /* ── Folder ───────────────────────────────────────────────────────── */

  const _overlay  = document.getElementById('renameContentOverlay')
  const _list     = document.getElementById('renameContentList')
  const _summary  = document.getElementById('renameContentSummary')
  const _applyBtn = document.getElementById('btnApplyRenameContent')
  const _closeBtn = document.getElementById('btnCloseRenameContent')
  const _cancelBtn = document.getElementById('btnCancelRenameContent')
  const _aiBtn    = document.getElementById('btnAiRenameContent')
  let _rows = []
  let _busy = false
  let _aiRun = 0          // bumped to cancel an in-flight AI pass

  function _dirOf(p) { return p.replace(/[\\/][^\\/]*$/, '') }

  /** Files directly inside `folderPath`, from the Explorer's cached tree. */
  function _filesIn(folderPath) {
    const root = sessionStorage.getItem('lastFolder')
    const tree = FileTreeManager.getCachedTree() ?? []
    if (folderPath === root) return tree.filter(n => n.type === 'file')
    const find = nodes => {
      for (const n of nodes) {
        if (n.type !== 'folder') continue
        if (n.path === folderPath) return n.children ?? []
        const hit = n.children && find(n.children)
        if (hit) return hit
      }
      return null
    }
    return (find(tree) ?? []).filter(n => n.type === 'file')
  }

  const _renames  = r => !!r.input.value.trim() && r.input.value.trim() !== r.name
  const _retags   = r => !_sameTags(_parseTags(r.tagsInput.getTags().join(',')), r.existingTags)
  const _pending  = () => _rows.filter(r => r.check.checked && !r.input.disabled && (_renames(r) || _retags(r)))

  function _updateSummary() {
    const todo = _pending()
    const n = todo.filter(_renames).length, t = todo.filter(_retags).length
    const parts = []
    if (n) parts.push(n === 1 ? '1 file renamed' : `${n} files renamed`)
    if (t) parts.push(t === 1 ? 'tags updated on 1 file' : `tags updated on ${t} files`)
    _summary.textContent = parts.length ? `Will be: ${parts.join(', ')}` : 'Nothing to change'
    _applyBtn.disabled = todo.length === 0 || _busy
    if (_aiBtn) _aiBtn.disabled = !_rows.length || _busy
  }

  async function renameFolder(folderPath) {
    if (!_overlay) return
    _aiRun++
    _busy = false
    if (_aiBtn) _aiBtn.textContent = '✨ Suggest with AI'
    const files = _filesIn(folderPath)
    _list.innerHTML = ''
    _rows = []
    _summary.textContent = files.length ? 'Reading files…' : 'This folder has no Markdown or text files.'
    _applyBtn.disabled = true
    _overlay.classList.remove('hidden')
    if (!files.length) return

    // Every existing name counts as taken, so a suggestion never collides
    // with a file in the folder (no rename chains or swaps to get wrong).
    const taken = new Set(files.map(f => f.name.toLowerCase()))
    const suggestions = await Promise.all(files.map(f => suggest(f.path)))

    files.forEach((file, i) => {
      const s = suggestions[i] || { name: null, tags: [], existingTags: [] }
      let suggested = s.name
      if (suggested && suggested.toLowerCase() === file.name.toLowerCase()) suggested = file.name
      else if (suggested) { suggested = _unique(suggested, taken); taken.add(suggested.toLowerCase()) }

      const row = document.createElement('label')
      row.className = 'rename-content-row'

      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = (!!suggested && suggested !== file.name) || !_sameTags(s.tags, s.existingTags)

      const from = document.createElement('span')
      from.className = 'rename-content-row__from'
      from.textContent = file.name
      from.title = file.name

      const arrow = document.createElement('span')
      arrow.className = 'rename-content-row__arrow'
      arrow.textContent = '→'

      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'form-input rename-content-row__to'
      input.value = suggested || file.name
      input.placeholder = 'No title found'
      input.spellcheck = false
      if (!suggested) row.classList.add('rename-content-row--none')

      const tagsInput = TagInput.create({
        tags: s.tags,
        max: 5,
        compact: true,
        placeholder: 'No tags — type to add',
        getSuggestions: folderTags,
        onChange: () => { check.checked = true; row.dataset.tagsEdited = '1'; _updateSummary() },
      })
      tagsInput.el.classList.add('rename-content-row__tags')
      // The row is a <label>: stop clicks on pills from toggling its checkbox
      tagsInput.el.addEventListener('click', e => e.preventDefault())

      input.addEventListener('input', () => { check.checked = true; row.dataset.edited = '1'; _updateSummary() })
      check.addEventListener('change', _updateSummary)

      row.append(check, from, arrow, input, tagsInput.el)
      _list.appendChild(row)
      _rows.push({ path: file.path, name: file.name, existingTags: s.existingTags, check, input, tagsInput, row })
    })
    _updateSummary()
  }

  /**
   * Replace suggestions with AI ones, one file at a time (the AI service
   * handles a single request at a time). Rows the user typed in are kept.
   */
  async function _suggestWithAI() {
    if (_busy || !_rows.length) return
    _vocabCache = null
    try { _aiModel() } catch (err) { _summary.textContent = err.message; return }

    const run = ++_aiRun
    _busy = true
    _updateSummary()
    _aiBtn.textContent = 'Asking AI…'

    const taken = new Set(_rows.map(r => r.name.toLowerCase()))
    _rows.forEach(r => { if (r.row.dataset.edited) taken.add(r.input.value.trim().toLowerCase()) })

    const todo = _rows.filter(r => !r.row.dataset.edited && !r.input.disabled)
    let done = 0, failed = 0
    for (const r of todo) {
      if (run !== _aiRun) return            // modal closed or restarted
      _summary.textContent = `Asking AI… ${done + 1} of ${todo.length}`
      r.row.classList.add('rename-content-row--busy')
      try {
        const s = await suggest(r.path, { useAI: true })
        if (run !== _aiRun) return
        let name = s?.name
        if (s && !r.row.dataset.tagsEdited) {
          _learnTags(s.tags)   // later files in this pass can reuse these
          r.tagsInput.setTags(s.tags)
          if (!_sameTags(s.tags, r.existingTags)) r.check.checked = true
        }
        if (name && name.toLowerCase() !== r.name.toLowerCase()) {
          name = _unique(name, taken)
          taken.add(name.toLowerCase())
          r.input.value = name
          r.check.checked = true
          r.row.classList.remove('rename-content-row--none')
        }
      } catch (err) {
        failed++
        r.input.title = err.message || 'AI request failed'
        // A missing/broken model fails every file the same way — stop early
        if (/not (fully )?configured/i.test(err.message)) { _summary.textContent = err.message; break }
      } finally {
        r.row.classList.remove('rename-content-row--busy')
      }
      done++
    }

    if (run !== _aiRun) return
    _busy = false
    _aiBtn.textContent = '✨ Suggest with AI'
    _updateSummary()
    if (failed) _summary.textContent += ` (AI failed for ${failed} — kept their previous names)`
  }

  async function _apply() {
    if (_busy) return
    const todo = _pending()
    if (!todo.length) return
    _busy = true
    _applyBtn.disabled = true

    const activePath = document.querySelector('#file-list .file-item.active')?.dataset.path
    let newActivePath = null
    let failed = 0

    // One at a time so a failure is reported against the right row
    for (const r of todo) {
      r.row.classList.remove('rename-content-row--error')

      // Tags first (by the current path), then the rename
      if (_retags(r)) {
        const tagged = await _writeTags(r.path, _parseTags(r.tagsInput.getTags().join(',')))
        if (!tagged?.ok) {
          failed++
          r.row.classList.add('rename-content-row--error')
          r.tagsInput.el.title = tagged?.error || 'Could not save tags'
          continue
        }
      }
      if (!_renames(r)) {
        r.check.checked = false
        r.check.disabled = r.input.disabled = true
        r.tagsInput.setDisabled(true)
        r.row.classList.add('rename-content-row--done')
        continue
      }

      const result = await window.electronAPI?.renameFile(r.path, r.input.value.trim())
      if (result?.ok) {
        if (r.path === activePath) newActivePath = result.newPath
        r.check.checked = false
        r.check.disabled = true
        r.input.disabled = true
        r.tagsInput.setDisabled(true)
        r.row.classList.add('rename-content-row--done')
      } else {
        failed++
        r.row.classList.add('rename-content-row--error')
        r.input.title = result?.error || 'Rename failed'
      }
    }

    const folder = sessionStorage.getItem('lastFolder')
    if (folder) await FileTreeManager.setActiveFolder(folder)
    if (newActivePath) {
      for (const item of document.querySelectorAll('#file-list .file-item')) {
        if (item.dataset.path === newActivePath) { item.click(); break }
      }
    }

    _busy = false
    if (failed) {
      _summary.textContent = `${todo.length - failed} updated, ${failed} failed — hover a red row for the reason`
    } else {
      _hide()
    }
  }

  function _hide() {
    _aiRun++                 // stop any AI pass still running
    _busy = false
    if (_aiBtn) _aiBtn.textContent = '✨ Suggest with AI'
    _overlay?.classList.add('hidden')
    _list.innerHTML = ''
    _rows = []
  }

  _applyBtn?.addEventListener('click', _apply)
  _aiBtn?.addEventListener('click', _suggestWithAI)
  _closeBtn?.addEventListener('click', _hide)
  _cancelBtn?.addEventListener('click', _hide)
  _overlay?.addEventListener('click', e => { if (e.target === _overlay) _hide() })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_overlay?.classList.contains('hidden')) _hide()
  })

  /** Every tag used in the opened folder, most-used first (for autocomplete). */
  async function folderTags() {
    const vocab = await _folderTags()
    return [...vocab.values()].sort((a, b) => b.count - a.count).map(e => e.tag)
  }

  return { suggest, suggestName, renameFile, renameFolder, folderTags }
})()
