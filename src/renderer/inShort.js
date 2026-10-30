/**
 * inShort.js — "In short" banner at the top of Preview.
 *
 * When enabled (Settings → Editor → In Short Banner, on by default), opening a file shows a
 * one-or-two-sentence AI summary above the preview (key phrases in bold), with a loading shimmer
 * while it's generated.
 *
 * Safe with fast switching:
 *  - Waits briefly after a file opens before asking (flicking through files
 *    doesn't fire a request per file).
 *  - At most one request runs at a time; a reply for a file you've already
 *    left is cached but never shown on the wrong file.
 *  - Uses aiService.complete (its own IPC channel), so it never disturbs a
 *    chat reply that's streaming.
 *
 * Summaries are cached per file + content hash (also in localStorage), so
 * reopening an unchanged file shows its summary instantly with no AI call.
 *
 * The same AI call also suggests 2-3 topic tags, reusing tags already used
 * in the folder. Suggestions the file doesn't have yet show as "+ #tag"
 * chips under the summary; a click adds the tag to the file's frontmatter.
 * The hash ignores frontmatter, so adding tags doesn't trigger a new summary.
 */

const InShort = (() => {

  const SETTING_KEY = 'inShortBanner'          // 'on' | 'off' (default on)
  const CACHE_KEY   = 'inShortCache'
  const CACHE_MAX   = 200                      // files remembered
  const START_DELAY = 700                      // ms a file must stay open before we ask
  const MIN_CHARS   = 200                      // shorter documents don't need a summary
  const MAX_CHARS   = 12000                    // sent to the AI — the start is enough

  let _banner = null
  let _shownPath = undefined     // file the banner currently reflects
  let _timer = null
  let _inflight = null           // { path, hash } of the running request
  let _cache = _loadCache()

  /* ── Settings ── */

  function isEnabled() {
    try { return localStorage.getItem(SETTING_KEY) !== 'off' } catch { return true }
  }

  /* ── Cache (path → { hash, text, at }) ── */

  function _loadCache() {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))) }
    catch { return new Map() }
  }

  function _saveCache() {
    // Keep only the most recent CACHE_MAX entries
    const entries = [..._cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX)
    _cache = new Map(entries)
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries))) } catch { /* full — skip */ }
  }

  /** The document without its frontmatter (tags there shouldn't change the summary). */
  function _body(text) {
    return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
  }

  /** Normalise a tag: lowercase, words joined by "-", no leading "#". */
  function _cleanTag(t) {
    return String(t).trim().replace(/^#+/, '').toLowerCase()
      .replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}\-\/]/gu, '').replace(/^-+|-+$/g, '')
  }

  /** Tags in the open document's frontmatter. */
  function _fileTags() {
    return typeof TagModal !== 'undefined' ? TagModal.tagsIn(_currentText()) : []
  }

  /** Small, fast string hash (FNV-1a) — enough to notice a changed document. */
  function _hash(str) {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return (h >>> 0).toString(36) + ':' + str.length
  }

  /** A usable AI model is configured (otherwise the banner stays out of the way). */
  function _hasModel() {
    if (typeof AIConfigManager === 'undefined') return false
    const model = AIConfigManager.getActiveModel()
    return !!model && !AIConfigManager.validateModel(model).length
  }

    /* ── Current document ── */

  function _currentPath() {
    try { return typeof currentFile !== 'undefined' ? currentFile?.path || null : null } catch { return null }
  }

  function _currentText() {
    return document.getElementById('mdEditor')?.value || ''
  }

  /* ── Banner DOM ── */

  function _ensureBanner() {
    if (_banner) return _banner
    const pane = document.getElementById('previewPane')
    const content = document.getElementById('previewContent')
    if (!pane || !content) return null
    _banner = document.createElement('div')
    _banner.className = 'in-short hidden'
    _banner.setAttribute('role', 'note')
    _banner.setAttribute('aria-live', 'polite')
    _banner.innerHTML = `
      <div class="in-short__head">
        <span class="in-short__icon" aria-hidden="true">✨</span>
        <span class="in-short__title">In short</span>
        <button type="button" class="in-short__btn in-short__refresh" title="Summarize again" aria-label="Summarize again">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="in-short__btn in-short__close" title="Hide for this file" aria-label="Hide">×</button>
      </div>
      <div class="in-short__body"></div>
      <div class="in-short__tags hidden"></div>`
    pane.insertBefore(_banner, content)
    _banner.querySelector('.in-short__refresh').addEventListener('click', () => _request(true))
    _banner.querySelector('.in-short__close').addEventListener('click', () => {
      _banner.classList.add('hidden')
      _dismissed.add(_shownPath)
    })
    return _banner
  }

  const _dismissed = new Set()   // files hidden with × (this session only)

  function _hide() { _banner?.classList.add('hidden') }

  function _showLoading() {
    const b = _ensureBanner(); if (!b) return
    b.classList.remove('hidden', 'in-short--error')
    b.classList.add('in-short--loading')
    b.querySelector('.in-short__tags')?.classList.add('hidden')
    b.querySelector('.in-short__body').innerHTML =
      '<span class="in-short__shimmer"></span><span class="in-short__shimmer in-short__shimmer--short"></span>'
  }

  function _showText(text, tags = []) {
    const b = _ensureBanner(); if (!b) return
    b.classList.remove('hidden', 'in-short--loading', 'in-short--error')
    // Only **bold** is honoured; everything else is plain text (no HTML from the AI)
    const body = b.querySelector('.in-short__body')
    body.replaceChildren()
    text.split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (!part) return
      const bold = /^\*\*[^*]+\*\*$/.test(part)
      if (bold) {
        const strong = document.createElement('strong')
        strong.textContent = part.slice(2, -2)
        body.append(strong)
      } else body.append(document.createTextNode(part.replace(/\*/g, '')))
    })
    _renderTags(tags)
  }

  /** File's own tags, then "+ #tag" chips for suggestions it doesn't have yet. */
  function _renderTags(suggested) {
    const row = _banner?.querySelector('.in-short__tags')
    if (!row) return
    const have = _fileTags()
    const haveLower = new Set(have.map(t => t.toLowerCase()))
    const missing = suggested.filter(t => !haveLower.has(t.toLowerCase()))
    row.replaceChildren()
    row.classList.toggle('hidden', !have.length && !missing.length)
    if (!have.length && !missing.length) return

    const chip = (cls, text) => {
      const el = document.createElement('span')
      el.className = cls
      el.textContent = text
      return el
    }
    have.forEach(t => row.append(chip('in-short__tag', `#${t}`)))
    if (!missing.length) return

    row.append(chip('in-short__tags-label', have.length ? 'Suggested:' : 'Suggested tags:'))
    missing.forEach(t => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'in-short__tag in-short__tag--add'
      b.textContent = `+ #${t}`
      b.title = `Add #${t} to this file`
      b.addEventListener('click', () => _addTags([t], suggested))
      row.append(b)
    })
    if (missing.length > 1) {
      const all = document.createElement('button')
      all.type = 'button'
      all.className = 'in-short__add-all'
      all.textContent = 'Add all'
      all.addEventListener('click', () => _addTags(missing, suggested))
      row.append(all)
    }
  }

  /** Write tags into the open file's frontmatter and save it. */
  async function _addTags(add, suggested) {
    const path = _currentPath()
    if (!path || typeof TagModal === 'undefined') return
    const have = _fileTags()
    const next = [...have, ...add.filter(t => !have.some(h => h.toLowerCase() === t.toLowerCase()))]
    if (next.length > 5) {
      StatusBar.showToast('A file can have up to 5 tags. Remove one with Tags… first.')
      return
    }
    const res = await TagModal.applyTagsToFile(path, next)
    if (!res?.ok) { StatusBar.showToast(res?.error || 'Could not add the tag.'); return }
    SaveManager.markDirty()
    await SaveManager.silentSave()
    _renderTags(suggested)
    StatusBar.showToast(add.length > 1 ? `Added ${add.map(t => '#' + t).join(' ')}` : `Added #${add[0]}`)
  }

  function _showError(msg) {
    const b = _ensureBanner(); if (!b) return
    b.classList.remove('hidden', 'in-short--loading')
    b.classList.add('in-short--error')
    b.querySelector('.in-short__tags')?.classList.add('hidden')
    b.querySelector('.in-short__body').textContent = msg
  }

  /* ── Flow ── */

  const FORMAT = 2   // bump when the summary format changes, so old cached ones are redone

  /** Cached entry matches the document and is in the current format. */
  function _fresh(hit, hash) {
    return !!hit && hit.hash === hash && Array.isArray(hit.tags) && hit.v === FORMAT
  }

  /** Called whenever the preview re-renders: react only when the open file changes. */
  function _onPreviewRendered() {
    const path = _currentPath()
    if (path === _shownPath) return
    _shownPath = path
    clearTimeout(_timer)
    _hide()                                    // never leave the previous file's summary up

    if (!isEnabled() || !path || _dismissed.has(path) || !_hasModel()) return
    const text = _currentText()
    if (text.trim().length < MIN_CHARS) return

    const hit = _cache.get(path)
    if (_fresh(hit, _hash(_body(text)))) { _showText(hit.text, hit.tags); return }

    _showLoading()
    _timer = setTimeout(() => _request(false), START_DELAY)
  }

  /** Ask the AI for the current file's summary (unless one is already running). */
  async function _request(force) {
    const path = _currentPath()
    if (!isEnabled() || !path || path !== _shownPath) return
    const text = _currentText()
    const hash = _hash(_body(text))

    if (!force) {
      const hit = _cache.get(path)
      if (_fresh(hit, hash)) { _showText(hit.text, hit.tags); return }
    }
    if (_inflight) { _showLoading(); return }  // the running request re-checks when it finishes

    const model = typeof AIConfigManager !== 'undefined' ? AIConfigManager.getActiveModel() : null
    if (!model || AIConfigManager.validateModel(model).length) {
      // On by default, so stay quiet when no AI model is set up
      _hide()
      return
    }

    _showLoading()
    _inflight = { path, hash }
    const name = path.split(/[\\/]/).pop()
    // Tags already used in the folder, so the AI reuses them
    let known = []
    try { known = (await RenameFromContent.folderTags()).slice(0, 150) } catch { /* no folder */ }
    const vocab = new Map(known.map(t => [t.toLowerCase(), t]))
    const messages = [
      { role: 'system', content:
        'You write the "In short" line shown above a document and suggest its topic tags. ' +
        'Reply with ONLY a JSON object, no code fence, no other text: ' +
        '{"summary": "...", "tags": ["..."]}. summary: in plain, simple language, what the ' +
        'document is about and its main point in 1 or 2 short sentences, 20 to 35 words, no ' +
        '"In short:" label. Wrap the 2 or 3 most important phrases (1 to 4 words each) in ' +
        '**double asterisks**; no other Markdown. tags: 2 to 3 short topic tags. If tags already used ' +
        'in this folder are listed, REUSE those exact tags whenever they fit; only invent a ' +
        'new tag (lowercase, one or two words joined by "-") when none fit.' },
      { role: 'user', content:
        `Tags already used in this folder: ${known.length ? known.join(', ') : '(none yet)'}\n\n` +
        `Document "${name}":\n"""\n${_body(text).slice(0, MAX_CHARS)}\n"""` },
    ]

    let summary = null, tags = [], error = null
    try {
      const reply = (await aiService.complete(messages, model) || '').trim()
      const json = reply.match(/\{[\s\S]*\}/)
      let parsed = null
      if (json) { try { parsed = JSON.parse(json[0]) } catch { /* not JSON */ } }
      const clean = v => String(v).trim()
        .replace(/^in short\s*:\s*/i, '').replace(/^["'“”]+|["'“”]+$/g, '').trim()
      summary = clean(parsed ? parsed.summary || '' : reply)
      // Use the folder's spelling of a reused tag; otherwise normalise
      tags = [...new Set((Array.isArray(parsed?.tags) ? parsed.tags : [])
        .map(t => vocab.get(String(t).trim().toLowerCase()) || vocab.get(_cleanTag(t)) || _cleanTag(t))
        .filter(Boolean))].slice(0, 3)
      if (summary) {
        _cache.set(path, { hash, text: summary, tags, v: FORMAT, at: Date.now() })
        _saveCache()
      }
    } catch (err) {
      error = err.message || 'The AI request failed.'
    } finally {
      _inflight = null
    }

    // Only touch the banner if the user is still on the same, unchanged file
    if (_currentPath() === path && _shownPath === path) {
      if (summary) _showText(summary, tags)
      else _showError(error ? `Couldn't summarize: ${error}` : 'The AI returned no summary.')
    } else if (isEnabled() && _shownPath && !_dismissed.has(_shownPath)) {
      // User moved on while we waited — start the file they're on now
      _request(false)
    }
  }

  /** Settings changed: show or hide immediately. */
  function applySetting() {
    _shownPath = undefined
    if (!isEnabled()) { clearTimeout(_timer); _hide(); return }
    _onPreviewRendered()
  }

  function init() {
    const content = document.getElementById('previewContent')
    if (!content) return
    // Every preview render replaces previewContent's children — cheap signal
    // that a (possibly different) file is showing.
    let pending = false
    new MutationObserver(() => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => { pending = false; _onPreviewRendered() })
    }).observe(content, { childList: true })
    _onPreviewRendered()
  }

  return { init, applySetting, isEnabled }
})()
