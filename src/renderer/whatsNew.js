/**
 * whatsNew.js — "What's new" link in the status bar and the release-notes dialog.
 *
 * On the first run of a new version (an update, not a fresh install) a
 * "What's new" link shows next to the version number for that session only;
 * the next launch hides it again. Clicking the link, or the version number at
 * any time, opens this version's section of CHANGELOG.md in a dialog.
 */

const WhatsNew = (() => {

  const SEEN_KEY = 'lastRunVersion'
  // Set to true to preview the pill on every run (development only)
  const ALWAYS_SHOW = false

  let _overlay, _body, _title

  function _build() {
    _overlay = document.createElement('div')
    _overlay.className = 'label-modal-overlay hidden whats-new'
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
          <div class="whats-new__body preview-content"></div>
          <div class="label-modal__actions">
            <button type="button" class="btn btn-primary btn-sm whats-new__ok">Got it</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(_overlay)
    _title = _overlay.querySelector('.label-modal__title')
    _body  = _overlay.querySelector('.whats-new__body')
    _overlay.querySelector('.settings-close-btn').addEventListener('click', close)
    _overlay.querySelector('.whats-new__ok').addEventListener('click', close)
    _overlay.addEventListener('mousedown', e => { if (e.target === _overlay) close() })
    _overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close() } })
  }

  function close() { _overlay?.classList.add('hidden') }

  async function show() {
    const version = window.electronAPI?.appVersion
    if (!_overlay) _build()
    _title.textContent = `What's new in ${version ? 'v' + version : 'this version'}`
    _body.innerHTML = '<p class="whats-new__msg">Loading…</p>'
    _overlay.classList.remove('hidden')
    _overlay.querySelector('.whats-new__ok').focus()

    const res = await window.electronAPI?.getReleaseNotes?.(version)
    if (res?.ok && res.notes) {
      // parseMarkdown escapes raw text before adding tags, so this is safe to insert
      _body.innerHTML = MarkdownRenderer.parseMarkdown(res.notes)
    } else {
      _body.innerHTML = `<p class="whats-new__msg"></p>`
      _body.firstChild.textContent = res?.error || 'Release notes are not available.'
    }
  }

  function init() {
    const version = window.electronAPI?.appVersion
    const link = document.getElementById('sbWhatsNew')
    const ver  = document.getElementById('sbVersion')
    ver?.addEventListener('click', show)
    link?.addEventListener('click', show)
    if (!version) return

    let last = null, usedBefore = false
    try {
      last = localStorage.getItem(SEEN_KEY)
      // Versions before 1.1.8 never stored SEEN_KEY, so an empty key alone
      // can't tell an update from a fresh install: recent files mean the app
      // has been used before.
      usedBefore = !!localStorage.getItem('recentItems')
    } catch { /* storage unavailable */ }
    // Show only on the first run after an update; a fresh install just
    // records the version.
    if (ALWAYS_SHOW || (last ? last !== version : usedBefore)) link?.classList.remove('hidden')
    try { localStorage.setItem(SEEN_KEY, version) } catch { /* ignore */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  return { show, close }
})()
