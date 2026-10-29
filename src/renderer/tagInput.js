/**
 * tagInput.js — tag "pill" editor with autocomplete.
 *
 * Tags show as pills with a × to remove; a text box adds new ones
 * (Enter, comma or Tab). While typing, matching tags from `getSuggestions()`
 * (e.g. every tag already used in the folder) are offered in a dropdown, so
 * the same tag is reused rather than re-spelled.
 *
 *   const ti = TagInput.create({ tags, max, getSuggestions, onChange, onSubmit })
 *   container.appendChild(ti.el)
 *   ti.getTags()  // includes text typed but not yet turned into a pill
 */

const TagInput = (() => {

  const MAX_SUGGESTIONS = 8

  // One shared dropdown, attached to <body> so scrolling lists don't clip it
  const _menu = document.createElement('div')
  _menu.className = 'tag-input__menu hidden'
  _menu.setAttribute('role', 'listbox')
  document.body.appendChild(_menu)
  let _menuOwner = null

  function _cleanTag(t) {
    return String(t).trim().replace(/^#+/, '').replace(/,/g, '').replace(/\s+/g, '-')
  }

  /**
   * @param {object}   opts
   * @param {string[]} [opts.tags]            Initial tags
   * @param {number}   [opts.max]             Max tags (default 5)
   * @param {function} [opts.getSuggestions]  () => string[] | Promise<string[]>
   * @param {function} [opts.onChange]        (tags) => void, after any add/remove
   * @param {function} [opts.onSubmit]        Enter pressed in an empty box
   * @param {string}   [opts.placeholder]
   * @param {boolean}  [opts.compact]         Smaller variant for dense lists
   */
  function create(opts = {}) {
    const max = opts.max ?? 5
    let tags = []
    let disabled = false
    let pool = null          // suggestions, loaded on first focus
    let matches = []
    let highlighted = -1

    const el = document.createElement('div')
    el.className = 'tag-input' + (opts.compact ? ' tag-input--compact' : '')

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tag-input__field'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', 'Add a tag')
    el.appendChild(input)

    // Clicking the empty area of the box focuses the text field
    el.addEventListener('mousedown', e => {
      if (e.target === el) { e.preventDefault(); input.focus() }
    })

    function _render() {
      el.querySelectorAll('.tag-pill').forEach(p => p.remove())
      for (const tag of tags) {
        const pill = document.createElement('span')
        pill.className = 'tag-pill'
        pill.textContent = tag
        const x = document.createElement('button')
        x.type = 'button'
        x.className = 'tag-pill__remove'
        x.textContent = '×'
        x.title = `Remove "${tag}"`
        x.setAttribute('aria-label', `Remove tag ${tag}`)
        x.disabled = disabled
        x.addEventListener('mousedown', e => e.preventDefault())  // keep focus in the field
        x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); remove(tag) })
        pill.appendChild(x)
        el.insertBefore(pill, input)
      }
      const full = tags.length >= max
      input.disabled = disabled || full
      input.placeholder = full ? `Max ${max} tags`
        : tags.length ? 'Add tag…' : (opts.placeholder || 'Add tags…')
    }

    function _changed() { _render(); opts.onChange?.(getTags()) }

    function add(raw) {
      const tag = _cleanTag(raw)
      if (!tag || tags.length >= max) return false
      if (tags.some(t => t.toLowerCase() === tag.toLowerCase())) return false
      tags.push(tag)
      _changed()
      return true
    }

    function remove(tag) {
      tags = tags.filter(t => t !== tag)
      _changed()
      if (!disabled) input.focus()
    }

    /* ── Suggestions dropdown ── */

    function _hideMenu() {
      if (_menuOwner !== el) return
      _menu.classList.add('hidden')
      _menuOwner = null
      highlighted = -1
    }

    function _showMenu() {
      const q = input.value.trim().replace(/^#/, '').toLowerCase()
      const chosen = new Set(tags.map(t => t.toLowerCase()))
      const avail = (pool || []).filter(t => !chosen.has(t.toLowerCase()))
      // Prefix matches first, then other substring matches
      matches = q
        ? [...avail.filter(t => t.toLowerCase().startsWith(q)),
           ...avail.filter(t => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))]
        : avail
      matches = matches.slice(0, MAX_SUGGESTIONS)

      // Only while typing — an empty box shows no list, so the folder's
      // tags aren't mistaken for this file's own tags
      if (!q || !matches.length || input.disabled || document.activeElement !== input) {
        _hideMenu()
        return
      }
      _menuOwner = el
      highlighted = Math.min(highlighted, matches.length - 1)
      _menu.innerHTML = ''
      matches.forEach((t, i) => {
        const opt = document.createElement('div')
        opt.className = 'tag-input__option' + (i === highlighted ? ' tag-input__option--active' : '')
        opt.setAttribute('role', 'option')
        opt.textContent = t
        opt.addEventListener('mousedown', e => {
          e.preventDefault()
          input.value = ''
          add(t)
          _showMenu()
        })
        _menu.appendChild(opt)
      })
      const r = el.getBoundingClientRect()
      _menu.style.left = `${r.left}px`
      _menu.style.minWidth = `${Math.min(r.width, 260)}px`
      _menu.classList.remove('hidden')
      // Open upwards if there's no room below
      const below = window.innerHeight - r.bottom
      _menu.style.top = below < _menu.offsetHeight + 8
        ? `${r.top - _menu.offsetHeight - 4}px`
        : `${r.bottom + 4}px`
    }

    async function _loadPool() {
      if (pool || !opts.getSuggestions) return
      try { pool = (await opts.getSuggestions()) || [] } catch { pool = [] }
      if (document.activeElement === input) _showMenu()
    }

    input.addEventListener('focus', () => _loadPool())
    input.addEventListener('blur', () => {
      _hideMenu()
      // Turn leftover text into a pill so it isn't lost
      if (input.value.trim() && add(input.value)) input.value = ''
    })
    input.addEventListener('input', () => {
      if (input.value.includes(',')) {
        input.value.split(',').slice(0, -1).forEach(add)
        input.value = input.value.split(',').pop().trimStart()
      }
      highlighted = -1
      _showMenu()
    })

    input.addEventListener('keydown', e => {
      const menuOpen = _menuOwner === el && matches.length
      if (e.key === 'ArrowDown' && menuOpen) {
        e.preventDefault(); highlighted = (highlighted + 1) % matches.length; _showMenu()
      } else if (e.key === 'ArrowUp' && menuOpen) {
        e.preventDefault(); highlighted = (highlighted - 1 + matches.length) % matches.length; _showMenu()
      } else if (e.key === 'Enter' || (e.key === 'Tab' && input.value.trim())) {
        const pick = menuOpen && highlighted >= 0 ? matches[highlighted] : input.value
        if (pick.trim()) {
          e.preventDefault(); e.stopPropagation()
          add(pick)
          input.value = ''
          highlighted = -1
          _showMenu()
        } else if (e.key === 'Enter' && opts.onSubmit) {
          e.preventDefault(); e.stopPropagation()
          opts.onSubmit()
        }
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        e.preventDefault()
        remove(tags[tags.length - 1])
      } else if (e.key === 'Escape' && menuOpen) {
        e.preventDefault(); e.stopPropagation()
        _hideMenu()
      }
    })

    function getTags() {
      const pending = _cleanTag(input.value)
      return pending && tags.length < max && !tags.some(t => t.toLowerCase() === pending.toLowerCase())
        ? [...tags, pending] : [...tags]
    }

    function setTags(list) {
      tags = []
      pool = null   // re-fetch suggestions next time (tags may have changed)
      for (const t of list || []) {
        const c = _cleanTag(t)
        if (c && tags.length < max && !tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c)
      }
      input.value = ''
      _render()
    }

    function setDisabled(v) {
      disabled = !!v
      el.classList.toggle('tag-input--disabled', disabled)
      _render()
    }

    setTags(opts.tags)

    return { el, input, getTags, setTags, setDisabled, focus: () => input.focus() }
  }

  window.addEventListener('resize', () => { _menu.classList.add('hidden'); _menuOwner = null })
  document.addEventListener('scroll', e => {
    if (_menu.contains(e.target)) return
    _menu.classList.add('hidden'); _menuOwner = null
  }, true)

  return { create }
})()
