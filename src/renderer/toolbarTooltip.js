/**
 * toolbarTooltip.js — styled, fast tooltips for the editor toolbar buttons.
 *
 * Reads each button's `title` on hover/focus (so titles that change at
 * runtime stay correct), hides it to suppress the slow native tooltip, and
 * shows a themed bubble below the button instead.
 */
(() => {
  const toolbar = document.querySelector('.editor-toolbar')
  if (!toolbar) return

  const tip = document.createElement('div')
  tip.className = 'toolbar-tooltip'
  tip.setAttribute('role', 'tooltip')
  document.body.appendChild(tip)

  let current = null

  function show(btn) {
    const text = btn.getAttribute('title') || btn.dataset.tooltipTitle
    if (!text) return
    current = btn
    btn.dataset.tooltipTitle = text
    btn.removeAttribute('title')
    tip.textContent = text
    tip.classList.add('toolbar-tooltip--visible')

    const r = btn.getBoundingClientRect()
    const w = tip.offsetWidth
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))
    tip.style.left = `${left}px`
    tip.style.top  = `${r.bottom + 6}px`
  }

  function hide() {
    if (!current) return
    // Restore the title unless code changed it while we were hovering
    if (!current.hasAttribute('title')) current.setAttribute('title', current.dataset.tooltipTitle)
    delete current.dataset.tooltipTitle
    current = null
    tip.classList.remove('toolbar-tooltip--visible')
  }

  const target = e => e.target.closest?.('.editor-toolbar button')

  toolbar.addEventListener('mouseover', e => { const b = target(e); if (b && b !== current) { hide(); show(b) } })
  toolbar.addEventListener('mouseout',  e => { if (current && !current.contains(e.relatedTarget)) hide() })
  toolbar.addEventListener('focusin',   e => { const b = target(e); if (b) { hide(); show(b) } })
  toolbar.addEventListener('focusout',  hide)
  toolbar.addEventListener('mousedown', hide)
})()
