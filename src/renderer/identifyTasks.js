/**
 * identifyTasks.js — "Identify Tasks (AI)…" in the file right-click menu.
 *
 * The AI reads the file and lists the pending tasks it finds (action items,
 * unchecked checkboxes, TODOs, follow-ups). The dialog shows each one as an
 * editable row — text, priority, target date, tags — with a checkbox to pick
 * it. "Add to Tasks" appends the picked ones to the opened folder's _tasks.md,
 * each with a "From: <file>" note. Nothing is added without a click.
 *
 * Uses aiService.complete (its own IPC channel), so it never disturbs a chat.
 */

const IdentifyTasks = (() => {

  const AI_CHARS  = 12000
  const MAX_TASKS = 5

  let _overlay, _title, _body, _primary, _cancel
  let _run = 0                     // bumped to ignore replies after close / reopen
  let _ctx = null                  // { filePath, fileName, root, tasks: [...] }

  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  }

  const _isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null
  const _cleanTag = t => String(t || '').replace(/^#/, '').replace(/[^\p{L}\p{N}_/-]/gu, '').slice(0, 30)

  /* ── Content ── */

  async function _content(filePath) {
    // An open file may have unsaved edits — use what's in the editor
    if (typeof currentFile !== 'undefined' && currentFile.path === filePath && typeof mdEditor !== 'undefined' && mdEditor)
      return mdEditor.value
    return (await window.electronAPI?.readFile(filePath))?.content || ''
  }

  /* ── AI ── */

  async function _ask(text) {
    const model = typeof AIConfigManager !== 'undefined' ? AIConfigManager.getActiveModel() : null
    if (!model) throw new Error('No AI model configured. Open Settings (⚙) to add one.')
    if (AIConfigManager.validateModel(model).length)
      throw new Error('The selected AI model is not fully configured. Update it in Settings.')

    const messages = [
      { role: 'system', content:
        'You find pending tasks in a Markdown note. A task is something someone still has to do: ' +
        'unchecked checkboxes ("- [ ]"), TODO/FIXME lines, action items, follow-ups, promises ' +
        '("I will send…"), deadlines. Skip anything already done (checked boxes, "done", past tense).\n' +
        `Return only the ${MAX_TASKS} or fewer MAIN tasks that matter most, most important first. ` +
        'Combine related or small steps into one broader task (e.g. several App Store Connect ' +
        'fields → "Complete the App Store Connect listing"); leave out minor or obvious sub-steps. ' +
        'Fewer, weightier tasks are better than many small ones. For each:\n' +
        '- "text": a short, clear, actionable task starting with a verb (max ~12 words)\n' +
        '- "priority": "high", "med" or "low"\n' +
        `- "due": a target date as YYYY-MM-DD if the note states or clearly implies one (today is ${_flToday()}), else null\n` +
        '- "tags": 0-2 short lowercase tags without #\n' +
        '- "source": the short phrase from the note it came from (max ~15 words)\n' +
        'Reply with ONLY a JSON object, no code fence, no other text:\n' +
        '{"tasks": [{"text": "...", "priority": "med", "due": null, "tags": [], "source": "..."}]}\n' +
        'If there are no pending tasks, reply {"tasks": []}.' },
      { role: 'user', content: `File: ${_ctx.fileName}\n\n"""\n${text.slice(0, AI_CHARS)}\n"""` },
    ]
    const reply = (await aiService.complete(messages, model) || '').trim()
    const json = reply.match(/\{[\s\S]*\}/)
    if (!json) throw new Error('The AI reply could not be read.')
    let o
    try { o = JSON.parse(json[0]) } catch { throw new Error('The AI reply could not be read.') }
    return (Array.isArray(o.tasks) ? o.tasks : [])
      .filter(t => t && String(t.text || '').trim())
      .slice(0, MAX_TASKS)
      .map(t => ({
        pick: false,
        text: String(t.text).replace(/\s+/g, ' ').trim(),
        priority: ['high', 'med', 'low'].includes(t.priority) ? t.priority : 'med',
        due: _isoDate(t.due),
        tags: (Array.isArray(t.tags) ? t.tags : []).map(_cleanTag).filter(Boolean).slice(0, 3),
        source: String(t.source || '').trim(),
      }))
  }

  /* ── Dialog ── */

  function _build() {
    _overlay = document.createElement('div')
    _overlay.className = 'label-modal-overlay hidden identify-tasks'
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
          <div class="identify-tasks__body"></div>
          <div class="label-modal__actions">
            <button type="button" class="btn btn-outline btn-sm identify-tasks__cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm identify-tasks__primary">Add to Tasks</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(_overlay)
    _title   = _overlay.querySelector('.label-modal__title')
    _body    = _overlay.querySelector('.identify-tasks__body')
    _primary = _overlay.querySelector('.identify-tasks__primary')
    _cancel  = _overlay.querySelector('.identify-tasks__cancel')

    _overlay.querySelector('.settings-close-btn').addEventListener('click', close)
    _cancel.addEventListener('click', close)
    _overlay.addEventListener('mousedown', e => { if (e.target === _overlay) close() })
    _overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
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
      <p class="identify-tasks__hint">Reading the file for pending tasks…</p>
      <span class="in-short__shimmer"></span><span class="in-short__shimmer in-short__shimmer--short"></span>`
    _primary.disabled = true
  }

  function _showMessage(msg) {
    _body.innerHTML = `<p class="identify-tasks__hint">${_esc(msg)}</p>`
    _primary.disabled = true
  }

  function _updatePrimary() {
    const n = _ctx ? _ctx.tasks.filter(t => t.pick && t.text.trim()).length : 0
    _primary.disabled = n === 0
    _primary.textContent = n ? `Add ${n} to Tasks` : 'Add to Tasks'
  }

  /** Grow a task box to fit its text (one line at least). */
  function _autosize(ta) {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'   // no border, so no extra pixels
  }

  /** Quiet one-line summary shown on a picked row: "High · No date · #tag". */
  function _summary(t) {
    const prio = { high: 'High', med: 'Med', low: 'Low' }[t.priority]
    const due  = t.due ? _flFmtDate(t.due) : 'No date'
    return [prio, due, ...t.tags.map(x => '#' + x)].join(' · ')
  }

  function _row(t, i) {
    const opt = p => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${{ high: 'High', med: 'Med', low: 'Low' }[p]}</option>`
    return `
      <div class="identify-tasks__item${t.pick ? '' : ' is-off'}" data-i="${i}">
        <input type="checkbox" class="identify-tasks__pick" ${t.pick ? 'checked' : ''} aria-label="Add this task">
        <div class="identify-tasks__main">
          <textarea class="identify-tasks__text" rows="1" aria-label="Task">${_esc(t.text)}</textarea>
          ${t.source ? `<p class="identify-tasks__source" title="From the note">“${_esc(t.source)}”</p>` : ''}
          <p class="identify-tasks__summary">${_esc(_summary(t))}</p>
          <div class="identify-tasks__meta">
            <select class="identify-tasks__chip identify-tasks__prio identify-tasks__prio--${t.priority}" aria-label="Priority">${opt('high')}${opt('med')}${opt('low')}</select>
            <input type="date" class="identify-tasks__chip identify-tasks__due" value="${_esc(t.due || '')}" aria-label="Target date">
            <input type="text" class="identify-tasks__chip identify-tasks__tags" value="${_esc(t.tags.map(x => '#' + x).join(' '))}" placeholder="#tags" aria-label="Tags">
          </div>
        </div>
      </div>`
  }

  function _showResult() {
    const tasks = _ctx.tasks
    if (!tasks.length) { _showMessage('No pending tasks found in this file.'); return }
    _body.innerHTML = `
      <div class="identify-tasks__bar">
        <span class="identify-tasks__hint">Found ${tasks.length} pending task${tasks.length === 1 ? '' : 's'}. Pick the ones to add. Hover a picked task to set its priority, date or tags.</span>
        <button type="button" class="fl-chip-btn identify-tasks__all">Select all</button>
      </div>
      <div class="identify-tasks__list">${tasks.map(_row).join('')}</div>`

    const allBtn = _body.querySelector('.identify-tasks__all')
    const syncAll = () => { allBtn.textContent = tasks.every(t => t.pick) ? 'Select none' : 'Select all' }
    allBtn.addEventListener('click', () => {
      const on = !tasks.every(t => t.pick)
      tasks.forEach(t => { t.pick = on })
      _body.querySelectorAll('.identify-tasks__item').forEach(el => {
        el.classList.toggle('is-off', !on)
        el.querySelector('.identify-tasks__pick').checked = on
      })
      syncAll(); _updatePrimary()
    })

    _body.querySelectorAll('.identify-tasks__item').forEach(el => {
      const t = tasks[+el.dataset.i]
      const pick = el.querySelector('.identify-tasks__pick')
      pick.addEventListener('change', () => { t.pick = pick.checked; el.classList.toggle('is-off', !t.pick); syncAll(); _updatePrimary() })
      const ta = el.querySelector('.identify-tasks__text')
      ta.addEventListener('input', () => { t.text = ta.value.replace(/\n/g, ' '); _autosize(ta); _updatePrimary() })
      ta.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault() })  // a task is one line
      _autosize(ta)
      const sum = el.querySelector('.identify-tasks__summary')
      const resum = () => { sum.textContent = _summary(t) }
      el.querySelector('.identify-tasks__prio').addEventListener('change', e => {
        t.priority = e.target.value
        e.target.className = `identify-tasks__chip identify-tasks__prio identify-tasks__prio--${t.priority}`
        resum()
      })
      el.querySelector('.identify-tasks__due').addEventListener('change', e => { t.due = _isoDate(e.target.value); resum() })
      el.querySelector('.identify-tasks__tags').addEventListener('input', e => {
        t.tags = e.target.value.split(/[\s,]+/).map(_cleanTag).filter(Boolean); resum()
      })
    })
    _updatePrimary()
  }

  async function _apply() {
    const ctx = _ctx
    if (!ctx) return
    const picked = ctx.tasks.filter(t => t.pick && t.text.trim())
    if (!picked.length) return
    _primary.disabled = true
    try {
      for (const t of picked) {
        await Tasks.addItem({
          text: t.text.replace(/\s+/g, ' ').trim(),
          done: false,
          priority: t.priority,
          due: t.due,
          tags: [...new Set(t.tags)],
          created: _flToday(),
          completed: null,
        }, _noteLines(`From: ${ctx.fileName}`), ctx.root)
      }
      close()
      StatusBar.showToast(`Added ${picked.length} task${picked.length === 1 ? '' : 's'} to Tasks.`)
    } catch (err) {
      _primary.disabled = false
      StatusBar.showToast(`Could not add tasks: ${err.message}`)
    }
  }

  async function show(filePath) {
    const root = sessionStorage.getItem('lastFolder')
    if (!root || !filePath.startsWith(root)) {
      StatusBar.showToast('Open a folder in the Explorer first.')
      return
    }
    if (!_overlay) _build()
    const fileName = filePath.split(/[\\/]/).pop()
    _ctx = { filePath, fileName, root, tasks: [] }

    const run = ++_run
    _title.textContent = `Identify Tasks — ${fileName}`
    _overlay.classList.remove('hidden')
    _showLoading()
    _cancel.focus()

    try {
      const text = await _content(filePath)
      if (!text.trim()) throw new Error('This file is empty, so there are no tasks to find.')
      const tasks = await _ask(text)
      if (run !== _run) return                 // dialog closed or reopened meanwhile
      _ctx.tasks = tasks
      _showResult()
    } catch (err) {
      if (run !== _run) return
      _showMessage(err.message || String(err))
    }
  }

  return { show, close }
})()
