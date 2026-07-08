/**
 * AI Config Manager — renderer-side controller.
 *
 * Manages the Settings modal (AI Config section) and the model-picker
 * dropdown in the chat header. All persistence is delegated to the main
 * process via window.electronAPI.aiConfig / window.electronAPI.ollama.
 *
 * Exposed as window.AIConfigManager for DOMContentLoaded wiring.
 */

const AIConfigManager = (() => {

  /* ── State ─────────────────────────────────────────────────────────── */
  let models    = []   // cached model array from IPC
  let editingId = null // null = adding new; string = editing existing

  /* ── Tiny HTML-escape (avoids coupling to index.js's escapeHtml) ───── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /* ══════════════════════════════════════════════════════════════════════
     Init
     ════════════════════════════════════════════════════════════════════ */

  async function init() {
    await loadModels()
    applyActiveModel()
    _initEditorFont()
    _wireEvents()
  }

  /* ══════════════════════════════════════════════════════════════════════
     Model loading / active-model tracking
     ════════════════════════════════════════════════════════════════════ */

  async function loadModels() {
    try {
      models = await window.electronAPI.aiConfig.list()
    } catch (e) {
      console.error('[AIConfig] Failed to load models:', e)
      models = []
    }
  }

  /**
   * Return the currently "active" model:
   *   1. The model whose id is stored in localStorage as 'activeModelId'
   *   2. The model flagged is_default in the config
   *   3. The first model in the list
   *   4. null (no models configured)
   */
  function getActiveModel() {
    const savedId = localStorage.getItem('activeModelId')
    if (savedId) {
      const found = models.find(m => m.id === savedId)
      if (found) return found
    }
    return models.find(m => m.is_default) || models[0] || null
  }

  /** Update the model-badge label in the chat header and toggle the AI welcome screen. */
  function applyActiveModel() {
    const model = getActiveModel()

    // Update the model badge text in the chat header
    const label = document.getElementById('activeModelLabel')
    if (label) label.textContent = model ? model.label : 'No model'

    // Show the welcome / no-model screen when nothing is configured
    _applyWelcomeScreen()
  }

  /**
   * Show the AI welcome screen when no models are configured;
   * hide it (and restore normal chat interaction) when at least one exists.
   */
  function _applyWelcomeScreen() {
    const screen    = document.getElementById('aiWelcomeScreen')
    const inputArea = document.querySelector('.chat-input-area')
    const clearBtn  = document.getElementById('btn-clear-chat')
    const pickerBtn = document.getElementById('btnModelPicker')

    const hasModels = models.length > 0

    if (screen)    screen.classList.toggle('hidden', hasModels)
    if (inputArea) inputArea.classList.toggle('hidden', !hasModels)
    if (clearBtn)  clearBtn.classList.toggle('hidden', !hasModels)
    if (pickerBtn) {
      // Keep picker visible but dim it when no models are available
      pickerBtn.disabled = !hasModels
      pickerBtn.style.opacity = hasModels ? '' : '0.45'
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Settings modal — open / close / render
     ════════════════════════════════════════════════════════════════════ */

  async function openSettings() {
    await loadModels()
    _renderModelList()
    document.getElementById('settingsOverlay').classList.remove('hidden')
  }

  function closeSettings() {
    document.getElementById('settingsOverlay').classList.add('hidden')
  }

  /** Render the list of model cards inside #modelConfigList. */
  function _renderModelList() {
    const list = document.getElementById('modelConfigList')
    if (!list) return

    if (!models.length) {
      list.innerHTML = '<p class="model-list-empty">No models configured yet. Click <strong>Add Model</strong> to get started.</p>'
      return
    }

    list.innerHTML = models.map(m => `
      <div class="model-card">
        <div class="model-card-top">
          <div class="model-card-info">
            <span class="model-card-label">${esc(m.label)}</span>
            <span class="type-badge type-badge--${esc(m.type)}">${m.type.toUpperCase()}</span>
            ${m.is_default ? '<span class="default-badge">default</span>' : ''}
          </div>
          <div class="model-card-actions">
            ${!m.is_default
              ? `<button class="model-action-btn" data-action="set-default" data-id="${esc(m.id)}" title="Set as default">★</button>`
              : ''}
            <button class="model-action-btn" data-action="edit"   data-id="${esc(m.id)}" title="Edit">✎</button>
            <button class="model-action-btn model-action-btn--danger" data-action="delete" data-id="${esc(m.id)}" title="Delete">🗑</button>
          </div>
        </div>
        <div class="model-card-detail">${_modelDetail(m)}</div>
      </div>
    `).join('')
  }

  /** One-line summary of the model's key property (base URL / model name). */
  function _modelDetail(m) {
    if (m.type === 'ollama') {
      const parts = [m.base_url, m.model_name].filter(Boolean)
      return parts.map(esc).join(' · ')
    }
    if (m.type === 'api') {
      const parts = [m.base_url, m.model_name].filter(Boolean)
      return parts.map(esc).join(' · ')
    }
    return ''
  }

  /* ══════════════════════════════════════════════════════════════════════
     Add / Edit modal
     ════════════════════════════════════════════════════════════════════ */

  function openAdd() {
    editingId = null
    _resetModalForm()
    document.getElementById('modelModalTitle').textContent = 'Add Model'
    document.querySelectorAll('input[name="modelType"]').forEach(r => {
      r.disabled = false
    })
    document.getElementById('typeSelectorGroup').classList.remove('hidden')
    document.getElementById('modelModalOverlay').classList.remove('hidden')
  }

  function openEdit(id) {
    const model = models.find(m => m.id === id)
    if (!model) return

    editingId = id
    document.getElementById('modelModalTitle').textContent = 'Edit Model'

    // Lock type to current value (cannot change after creation)
    document.querySelectorAll('input[name="modelType"]').forEach(r => {
      r.checked  = r.value === model.type
      r.disabled = true
    })
    // Hide type selector row when editing (type is fixed)
    document.getElementById('typeSelectorGroup').classList.add('hidden')

    document.getElementById('modelLabel').value      = model.label      || ''
    document.getElementById('modelIsDefault').checked = !!model.is_default

    _updateTypeHint(model.type)

    if (model.type === 'ollama') {
      _showFields('ollama')
      document.getElementById('modelBaseUrl').value = model.base_url || 'http://localhost:11434'
      const sel = document.getElementById('modelName')
      sel.innerHTML = ''
      if (model.model_name) {
        const opt = document.createElement('option')
        opt.value       = model.model_name
        opt.textContent = model.model_name
        sel.appendChild(opt)
      } else {
        sel.innerHTML = '<option value="">— click Detect —</option>'
      }
    } else if (model.type === 'api') {
      _showFields('api')
      document.getElementById('modelApiBaseUrl').value    = model.base_url   || ''
      document.getElementById('modelApiModelName').value  = model.model_name || ''
      document.getElementById('modelApiKey').value        = model.api_key    || ''
    }

    document.getElementById('modelModalOverlay').classList.remove('hidden')
  }

  function closeModelModal() {
    document.getElementById('modelModalOverlay').classList.add('hidden')
    editingId = null
  }

  function _resetModalForm() {
    // Default selection: API (first option)
    document.querySelectorAll('input[name="modelType"]').forEach(r => {
      r.checked  = r.value === 'api'
      r.disabled = false
    })
    document.getElementById('modelLabel').value         = ''
    document.getElementById('modelBaseUrl').value       = 'http://localhost:11434'
    document.getElementById('modelName').innerHTML      = '<option value="">— click Detect —</option>'
    document.getElementById('modelApiBaseUrl').value    = ''
    document.getElementById('modelApiModelName').value  = ''
    document.getElementById('modelApiKey').value        = ''
    // Reset API key field to hidden (password) mode
    const apiKeyInput = document.getElementById('modelApiKey')
    if (apiKeyInput) apiKeyInput.type = 'password'
    document.getElementById('modelIsDefault').checked = (models.length === 0)
    _showFields('api')
    _updateTypeHint('api')
  }

  /** Show the fields section for the selected type; hide the others. */
  function _showFields(type) {
    document.getElementById('ollamaFields').classList.toggle('hidden', type !== 'ollama')
    document.getElementById('apiFields').classList.toggle('hidden',    type !== 'api')
  }

  /** Update the contextual hint text below the type radio buttons. */
  function _updateTypeHint(type) {
    const hint = document.getElementById('modelTypeHint')
    if (!hint) return
    if (type === 'api') {
      hint.className = 'form-type-hint form-type-hint--api'
      hint.innerHTML = 'Compatible with any <strong>OpenAI-compatible API</strong> — Groq (free tier), OpenAI, Together AI, Mistral, and more. Set the Base URL to the provider\'s endpoint and paste your API key below.'
    } else if (type === 'ollama') {
      hint.className = 'form-type-hint form-type-hint--ollama'
      hint.innerHTML = 'Runs locally — no API key needed. Requires <strong>Ollama</strong> to be installed and running.'
    } else {
      hint.className = 'form-type-hint'
      hint.innerHTML = ''
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     CRUD operations
     ════════════════════════════════════════════════════════════════════ */

  async function saveModel() {
    const type  = document.querySelector('input[name="modelType"]:checked')?.value || 'api'
    const label = document.getElementById('modelLabel').value.trim()

    if (!label) {
      alert('Please enter a label for the model.')
      document.getElementById('modelLabel').focus()
      return
    }

    const data = {
      label,
      type,
      is_default: document.getElementById('modelIsDefault').checked,
    }

    if (type === 'ollama') {
      data.base_url    = document.getElementById('modelBaseUrl').value.trim() || 'http://localhost:11434'
      data.model_name  = document.getElementById('modelName').value           || null
    } else if (type === 'api') {
      const apiBase = document.getElementById('modelApiBaseUrl').value.trim()
      if (!apiBase) {
        alert('Please enter a Base URL for the API.')
        document.getElementById('modelApiBaseUrl').focus()
        return
      }
      data.base_url   = apiBase
      data.model_name = document.getElementById('modelApiModelName').value.trim() || null
      data.api_key    = document.getElementById('modelApiKey').value.trim()       || null
    }

    const btn = document.getElementById('btnSaveModel')
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…' }

    try {
      if (editingId) {
        data.id = editingId
        await window.electronAPI.aiConfig.update(data)
      } else {
        await window.electronAPI.aiConfig.create(data)
      }
      await loadModels()
      _renderModelList()
      applyActiveModel()
      closeModelModal()
    } catch (e) {
      console.error('[AIConfig] Save failed:', e)
      alert('Failed to save model: ' + e.message)
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save' }
    }
  }

  async function deleteModel(id) {
    const model = models.find(m => m.id === id)
    if (!model) return
    if (!confirm(`Delete "${model.label}"?`)) return

    try {
      await window.electronAPI.aiConfig.delete(id)
      // Clear activeModelId if this was the selected model
      if (localStorage.getItem('activeModelId') === id) {
        localStorage.removeItem('activeModelId')
      }
      await loadModels()
      _renderModelList()
      applyActiveModel()
    } catch (e) {
      console.error('[AIConfig] Delete failed:', e)
      alert('Failed to delete model: ' + e.message)
    }
  }

  async function setDefault(id) {
    try {
      await window.electronAPI.aiConfig.setDefault(id)
      await loadModels()
      _renderModelList()
      applyActiveModel()
    } catch (e) {
      console.error('[AIConfig] Set default failed:', e)
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Ollama model detection
     ════════════════════════════════════════════════════════════════════ */

  async function detectOllamaModels() {
    const btn     = document.getElementById('btnDetectOllama')
    const baseUrl = document.getElementById('modelBaseUrl').value.trim() || 'http://localhost:11434'
    const sel     = document.getElementById('modelName')

    if (btn) { btn.disabled = true; btn.textContent = 'Detecting…' }

    try {
      const names = await window.electronAPI.ollama.listModels(baseUrl)
      sel.innerHTML = ''
      if (!names || !names.length) {
        sel.innerHTML = '<option value="">No models found</option>'
      } else {
        names.forEach(name => {
          const opt       = document.createElement('option')
          opt.value       = name
          opt.textContent = name
          sel.appendChild(opt)
        })
      }
    } catch (e) {
      console.error('[AIConfig] Ollama detect failed:', e)
      sel.innerHTML = '<option value="">Failed to connect</option>'
      alert('Could not reach Ollama at ' + baseUrl + '.\nIs Ollama running?')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Detect' }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Model-picker dropdown (in the AI chat header)
     ════════════════════════════════════════════════════════════════════ */

  function toggleModelPicker() {
    const dropdown = document.getElementById('modelPickerDropdown')
    if (!dropdown) return
    if (dropdown.classList.contains('hidden')) {
      _renderPickerList()
      dropdown.classList.remove('hidden')
    } else {
      dropdown.classList.add('hidden')
    }
  }

  function closeModelPicker() {
    document.getElementById('modelPickerDropdown')?.classList.add('hidden')
  }

  function _renderPickerList() {
    const list = document.getElementById('modelPickerList')
    if (!list) return

    const active = getActiveModel()

    if (!models.length) {
      list.innerHTML = '<div class="picker-empty">No models configured.<br>Add one in Settings.</div>'
      return
    }

    list.innerHTML = models.map(m => `
      <div class="picker-item ${active && active.id === m.id ? 'picker-item--active' : ''}"
           data-picker-id="${esc(m.id)}">
        <span class="picker-item-label">${esc(m.label)}</span>
        <span class="type-badge type-badge--${esc(m.type)}">${m.type.toUpperCase()}</span>
      </div>
    `).join('')
  }

  function selectModel(id) {
    localStorage.setItem('activeModelId', id)
    applyActiveModel()
    closeModelPicker()
  }

  /* ══════════════════════════════════════════════════════════════════════
     Event wiring (called once from init)
     ════════════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════════
     Editor font settings — size + family
     ════════════════════════════════════════════════════════════════════ */

  const FONT_SIZE_MIN = 10
  const FONT_SIZE_MAX = 24

  /** Read persisted font preferences and apply them on startup. */
  function _initEditorFont() {
    const savedSize   = parseInt(localStorage.getItem('editorFontSize')   || '13', 10)
    const savedFamily = localStorage.getItem('editorFontFamily') || ''

    _applyFontSize(savedSize, false)   // false = don't re-save (already stored)

    if (savedFamily) {
      _applyFontFamily(savedFamily, false)
      const sel = document.getElementById('editorFontFamily')
      if (sel) sel.value = savedFamily
    }

    // Seed the startup-mode selector with the saved preference (default: preview)
    const savedStartupMode = localStorage.getItem('startupMode') || 'preview'
    const startupModeSel   = document.getElementById('startupMode')
    if (startupModeSel) startupModeSel.value = savedStartupMode

    // Seed the explorer-mode selector with the saved preference (default: multi-level)
    const savedExplorerMode = localStorage.getItem('explorerMode') || 'multi-level'
    const explorerModeSel   = document.getElementById('explorerMode')
    if (explorerModeSel) explorerModeSel.value = savedExplorerMode

    // Seed the launch-behavior selector with the saved preference (default: untitled)
    const savedLaunchBehavior = localStorage.getItem('launchBehavior') || 'untitled'
    const launchBehaviorSel   = document.getElementById('launchBehavior')
    if (launchBehaviorSel) launchBehaviorSel.value = savedLaunchBehavior
  }

  /**
   * Change font size by `delta` steps (±1) and persist.
   * @param {number} delta  +1 to increase, -1 to decrease
   */
  function _changeFontSize(delta) {
    const current = parseInt(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--editor-font-size') || '13',
      10
    )
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta))
    _applyFontSize(next, true)
  }

  /**
   * Apply a font size (px number) to the editor and update the display badge.
   * @param {number}  size    Font size in px
   * @param {boolean} persist Whether to save to localStorage
   */
  function _applyFontSize(size, persist = true) {
    size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size))
    document.documentElement.style.setProperty('--editor-font-size', `${size}px`)

    const badge = document.getElementById('fontSizeValue')
    if (badge) badge.textContent = size

    // Invalidate the canvas ruler so line numbers re-measure with the new size
    if (typeof window.invalidateEditorRuler === 'function') window.invalidateEditorRuler()

    if (persist) localStorage.setItem('editorFontSize', size)
  }

  /**
   * Apply a font-family string to the editor elements and preview strip.
   * @param {string}  family  CSS font-family value
   * @param {boolean} persist Whether to save to localStorage
   */
  function _applyFontFamily(family, persist = true) {
    const targets = [
      document.querySelector('.editor-wrapper'),
      document.getElementById('editor-highlight'),
      document.getElementById('mdEditor'),
      document.getElementById('line-numbers'),
      document.getElementById('editorFontPreview'),
    ]
    targets.forEach(el => { if (el) el.style.fontFamily = family })

    // Invalidate the canvas ruler — font metrics have changed
    if (typeof window.invalidateEditorRuler === 'function') window.invalidateEditorRuler()

    if (persist) localStorage.setItem('editorFontFamily', family)
  }

  function _wireEvents() {

    /* Settings gear button */
    document.getElementById('btnSettings')?.addEventListener('click', openSettings)

    /* AI welcome screen — "Add a model" CTA button */
    document.getElementById('btnAiWelcomeAddModel')?.addEventListener('click', () => {
      openSettings()
      // Switch straight to the AI tab inside settings
      const aiTab = document.querySelector('[data-settings-panel="ai"]')
      if (aiTab) {
        aiTab.click()
      }
    })

    /* Close settings panel */
    document.getElementById('btnCloseSettings')?.addEventListener('click', closeSettings)
    // Backdrop click intentionally disabled — use the ✕ button to close

    /* Add model */
    document.getElementById('btnAddModel')?.addEventListener('click', openAdd)

    /* Close model modal */
    document.getElementById('btnCloseModelModal')?.addEventListener('click', closeModelModal)
    // Backdrop click intentionally disabled — use the ✕ button to close
    document.getElementById('btnCancelModel')?.addEventListener('click', closeModelModal)

    /* Save model */
    document.getElementById('btnSaveModel')?.addEventListener('click', saveModel)

    /* Type radio → switch visible fields + update contextual hint */
    document.querySelectorAll('input[name="modelType"]').forEach(r => {
      r.addEventListener('change', () => {
        _showFields(r.value)
        _updateTypeHint(r.value)
      })
    })

    /* Ollama detect */
    document.getElementById('btnDetectOllama')?.addEventListener('click', detectOllamaModels)

    /* API key show / hide toggle */
    document.getElementById('btnToggleApiKey')?.addEventListener('click', () => {
      const input = document.getElementById('modelApiKey')
      const icon  = document.getElementById('apiKeyEyeIcon')
      if (!input) return
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      // Swap eye icon to eye-off when key is visible
      icon.innerHTML = isHidden
        ? `<path d="M17.94 17.94A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.06-5.94"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           <path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           <line x1="1" y1="1" x2="23" y2="23"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
        : `<path d="M1 12C1 12 5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12Z"
               stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
           <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`
    })

    /* Model card actions — delegated listener on the list container */
    document.getElementById('modelConfigList')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]')
      if (!btn) return
      const { action, id } = btn.dataset
      if (action === 'edit')        openEdit(id)
      else if (action === 'delete') deleteModel(id)
      else if (action === 'set-default') setDefault(id)
    })

    /* Model picker trigger */
    document.getElementById('btnModelPicker')?.addEventListener('click', e => {
      e.stopPropagation()
      toggleModelPicker()
    })

    /* Model picker list — delegated listener */
    document.getElementById('modelPickerList')?.addEventListener('click', e => {
      const item = e.target.closest('[data-picker-id]')
      if (item) selectModel(item.dataset.pickerId)
    })

    /* Manage models → open settings */
    document.getElementById('btnManageModels')?.addEventListener('click', () => {
      closeModelPicker()
      openSettings()
    })

    /* Close picker when clicking outside */
    document.addEventListener('click', e => {
      const dropdown = document.getElementById('modelPickerDropdown')
      const trigger  = document.getElementById('btnModelPicker')
      if (!dropdown || dropdown.classList.contains('hidden')) return
      if (!dropdown.contains(e.target) && e.target !== trigger && !trigger?.contains(e.target)) {
        closeModelPicker()
      }
    })

    /* Escape closes any open overlay */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return
      closeModelPicker()
      // Only close the innermost open modal
      const modelModal = document.getElementById('modelModalOverlay')
      if (!modelModal?.classList.contains('hidden')) { closeModelModal(); return }
      closeSettings()
    })

    /* ── Settings nav — tab switching ─────────────────────────────── */
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        // Activate nav item
        document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        // Show matching pane, hide others
        const target = btn.dataset.settingsPanel
        document.querySelectorAll('.settings-pane').forEach(pane => {
          pane.classList.toggle('hidden', pane.id !== `settingsPane-${target}`)
        })
      })
    })

    /* ── Editor font size stepper ─────────────────────────────────── */
    document.getElementById('btnFontSizeDown')?.addEventListener('click', () => {
      _changeFontSize(-1)
    })
    document.getElementById('btnFontSizeUp')?.addEventListener('click', () => {
      _changeFontSize(+1)
    })

    /* ── Editor font family selector ──────────────────────────────── */
    document.getElementById('editorFontFamily')?.addEventListener('change', e => {
      _applyFontFamily(e.target.value)
    })

    /* ── Startup mode selector ────────────────────────────────────── */
    document.getElementById('startupMode')?.addEventListener('change', e => {
      localStorage.setItem('startupMode', e.target.value)
    })

    /* ── Explorer mode selector ────────────────────────────────────── */
    document.getElementById('explorerMode')?.addEventListener('change', e => {
      localStorage.setItem('explorerMode', e.target.value)
      FileTreeManager.updateFolderToolbarButtons()
      FileTreeManager.refresh()
      RecentsPanel.applyExplorerMode()
      RecentsPanel.render()
    })

    /* ── Launch behavior selector ─────────────────────────────────── */
    document.getElementById('launchBehavior')?.addEventListener('change', e => {
      localStorage.setItem('launchBehavior', e.target.value)
    })
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  return {
    init,
    openSettings,
    closeSettings,
    openEdit,
    deleteModel,
    setDefault,
    selectModel,
    getActiveModel,
  }

})()

/* Kick off on DOMContentLoaded (runs after index.js's own listener). */
document.addEventListener('DOMContentLoaded', () => {
  AIConfigManager.init()
})
