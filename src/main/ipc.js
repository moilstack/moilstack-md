const { ipcMain, dialog, BrowserWindow, app, shell, safeStorage } = require('electron')
const fs     = require('fs/promises')
const path   = require('path')
const os     = require('os')
const http   = require('http')
const https  = require('https')
const crypto = require('crypto')

/* ── AI Config helpers ──────────────────────────────────────────────────
   Non-sensitive model metadata (label, type, base_url, model_name, flags)
   is stored as JSON in the OS user-data directory, which is always writable
   (unlike the exe directory, which requires elevation on a standard Windows
   install into Program Files).

   API keys are stored separately as OS-encrypted binary blobs using
   Electron's safeStorage API (Windows DPAPI / macOS Keychain / Linux
   libsecret).  The JSON file never contains a plaintext key.

   Resolved path (both dev and production):
     <userData>/ai-config.json   e.g. %APPDATA%\MoilStack .md\ai-config.json
     <userData>/key-<id>.bin     one file per model that has a key
   ──────────────────────────────────────────────────────────────────── */

/** Absolute path to the model-metadata JSON file. */
function getConfigPath() {
  return path.join(app.getPath('userData'), 'ai-config.json')
}

/** Absolute path to the encrypted key blob for a given model id. */
function getKeyPath(modelId) {
  return path.join(app.getPath('userData'), `key-${modelId}.bin`)
}

/**
 * Encrypt `apiKey` with the OS keychain and write it to disk.
 * No-op when safeStorage is unavailable (e.g. headless CI) or the key is empty.
 */
async function saveModelKey(modelId, apiKey) {
  if (!apiKey || !safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(apiKey)
  await fs.writeFile(getKeyPath(modelId), encrypted)
}

/**
 * Read and decrypt the key for `modelId`.
 * Returns the plaintext string, or null when the file is absent or decryption fails.
 */
async function loadModelKey(modelId) {
  try {
    const buf = await fs.readFile(getKeyPath(modelId))
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

/** Remove the encrypted key file for a deleted model (best-effort). */
async function deleteModelKey(modelId) {
  await fs.unlink(getKeyPath(modelId)).catch(() => {})
}

/** Read ai-config.json; if missing/corrupt return a default seeded config. */
async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    // First run — empty config; user will add a model via Settings
    return { models: [] }
  }
}

/** Persist the config object to disk. */
async function writeConfig(config) {
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

/**
 * HTTP/HTTPS POST that streams response body chunks to onChunk(Buffer).
 * Returns a Promise that resolves when the response stream ends.
 * Used for Ollama NDJSON and OpenAI-compatible SSE streaming.
 */
function postStream(urlStr, body, headers, onChunk) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http
    const url = new URL(urlStr)
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }
    const req = mod.request(opts, (res) => {
      res.on('data',  onChunk)
      res.on('end',   resolve)
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, () => req.destroy(new Error('AI request timed out')))
    req.write(body)
    req.end()
  })
}

/** Simple HTTP/HTTPS JSON fetch for the main process (no fetch polyfill needed). */
function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http
    const req = mod.get(urlStr, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Invalid JSON from server')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('Request timed out')) })
  })
}

/**
 * Extract a plain-text first line from file content.
 * Skips YAML frontmatter and strips basic Markdown syntax.
 */
function _extractFirstLine(content) {
  let text = content
  if (text.startsWith('---')) {
    const fmEnd = text.indexOf('\n---', 3)
    if (fmEnd !== -1) text = text.slice(fmEnd + 4)
  }
  for (const line of text.split('\n')) {
    const stripped = line
      .replace(/^#+\s*/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim()
    if (stripped) return stripped.slice(0, 100)
  }
  return ''
}

/**
 * Extract up to 5 tags from file content.
 * Checks YAML frontmatter `tags:` first, then inline `#hashtag` patterns.
 */
function _extractTags(content) {
  const tags = new Set()
  const sample = content.slice(0, 2000)

  if (sample.startsWith('---')) {
    const fmEnd = sample.indexOf('\n---', 3)
    if (fmEnd !== -1) {
      const fm = sample.slice(3, fmEnd)
      const inlineMatch = fm.match(/^tags:\s*\[([^\]]+)\]/m)
      if (inlineMatch) {
        for (const t of inlineMatch[1].split(',')) {
          const tag = t.trim().replace(/^['"]|['"]$/g, '')
          if (tag) tags.add(tag)
        }
      }
      if (tags.size === 0) {
        const listMatch = fm.match(/^tags:\s*\n((?:[ \t]*-[ \t]+.+\n?)+)/m)
        if (listMatch) {
          for (const line of listMatch[1].split('\n')) {
            const tag = line.replace(/^[ \t]*-[ \t]+/, '').replace(/^['"]|['"]$/g, '').trim()
            if (tag) tags.add(tag)
          }
        }
      }
    }
  }

  if (tags.size === 0) {
    const re = /(?<=\s)#([a-zA-Z][a-zA-Z0-9_-]{1,20})/g
    let m
    while ((m = re.exec(sample)) !== null && tags.size < 5) tags.add(m[1])
  }

  return [...tags].slice(0, 5)
}

/**
 * Register all IPC handlers for the main process.
 * Called once during app startup from index.js.
 *
 * Pattern:
 *   ipcMain.handle('channel-name', async (event, ...args) => { ... })
 *
 * The matching invoke call lives in src/preload/index.js via contextBridge.
 */
function registerIpcHandlers() {

  // Sync IPC: renderer reads app version during preload initialisation
  ipcMain.on('app:get-version', (event) => { event.returnValue = app.getVersion() })

  // ── Custom title-bar window controls ──────────────────────────────────────
  ipcMain.on('window:minimize',  (e) => { BrowserWindow.fromWebContents(e.sender)?.minimize() })
  ipcMain.on('window:maximize',  (e) => { const w = BrowserWindow.fromWebContents(e.sender); w?.isMaximized() ? w.restore() : w.maximize() })
  ipcMain.on('window:close',     (e) => { BrowserWindow.fromWebContents(e.sender)?.close() })
  ipcMain.handle('window:is-maximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false)

  // Open a URL in the default OS browser — only http/https allowed
  ipcMain.handle('shell:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  // Set the Windows taskbar jump list with the "New Instance" task.
  updateJumpList()

  /**
   * folder:open — show a native folder-picker dialog.
   *
   * Returns { folderPath: string } with the selected directory,
   * or null when the user cancels.
   */
  ipcMain.handle('folder:open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open Folder',
      properties: ['openDirectory'],
    })

    if (canceled || !filePaths.length) return null

    return { folderPath: filePaths[0] }
  })

  /**
   * file:open — show a native single-file picker filtered to Markdown files.
   *
   * Returns { filePath: string } with the selected file path,
   * or null when the user cancels.
   */
  ipcMain.handle('file:open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open File',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown & Text', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (canceled || !filePaths.length) return null
    return { filePath: filePaths[0] }
  })

  /**
   * folder:read — return a tree of folders (max 4 sub-levels) and .md/.txt files.
   *
   * Options:
   *   rootOnly  {boolean} — only return files at depth 0; no sub-folders
   *   withMeta  {boolean} — attach modified (ms), firstLine, and tags to each file
   *
   * Each node: { type:'file'|'folder', name, path, children?, modified?, firstLine?, tags? }
   * Folders are sorted before files; both groups are alphabetical.
   * Returns { entries: TreeNode[] } or null on error.
   */
  ipcMain.handle('folder:read', async (_event, folderPath, options = {}) => {
    const { rootOnly = false, withMeta = false } = options

    async function readEntries(dirPath, depth) {
      try {
        const raw = await fs.readdir(dirPath, { withFileTypes: true })
        const entries = []
        for (const e of raw) {
          if (e.name.startsWith('.')) continue
          const fullPath = path.join(dirPath, e.name)
          if (!rootOnly && e.isDirectory() && depth < 4) {
            const children = await readEntries(fullPath, depth + 1)
            entries.push({ type: 'folder', name: e.name, path: fullPath, children })
          } else if (e.isFile() && /\.(md|markdown|txt)$/i.test(e.name)) {
            const node = { type: 'file', name: e.name, path: fullPath }
            if (withMeta) {
              try {
                const stat = await fs.stat(fullPath)
                node.modified = stat.mtimeMs
                const raw = await fs.readFile(fullPath, 'utf8')
                node.firstLine = _extractFirstLine(raw)
                node.tags = _extractTags(raw)
              } catch { /* skip meta on unreadable file */ }
            }
            entries.push(node)
          }
        }
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        return entries
      } catch {
        return []
      }
    }
    try {
      const entries = await readEntries(folderPath, 0)
      return { entries }
    } catch {
      return null
    }
  })

  /**
   * folder:create — create a new sub-folder inside an existing directory.
   *
   * Returns { ok: true, folderPath: string } on success,
   *         { error: string } on failure.
   */
  ipcMain.handle('folder:create', async (_event, parentPath, folderName) => {
    if (!parentPath || !folderName) return { error: 'Missing path or name.' }
    const safeName = path.basename(folderName.trim())
    if (!safeName) return { error: 'Invalid folder name.' }
    const newPath = path.join(parentPath, safeName)
    try {
      await fs.mkdir(newPath, { recursive: false })
      return { ok: true, folderPath: newPath }
    } catch (err) {
      if (err.code === 'EEXIST') return { error: `"${safeName}" already exists.` }
      return { error: err.message }
    }
  })

  /**
   * file:read-base64 — read a binary file and return it as a base64 string.
   *
   * Returns { base64: string, mime: string } or null on error.
   * Used by the PDF export to embed local images as data URLs.
   */
  ipcMain.handle('file:read-base64', async (_event, filePath) => {
    try {
      const buf  = await fs.readFile(filePath)
      const ext  = path.extname(filePath).slice(1).toLowerCase()
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                     gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png'
      return { base64: buf.toString('base64'), mime }
    } catch {
      return null
    }
  })

  /**
   * file:read — read the contents of a file from disk.
   *
   * Returns { content: string } or null on error.
   */
  ipcMain.handle('file:read', async (_event, filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return { content }
    } catch {
      return null
    }
  })

  /**
   * file:export-pdf — render HTML in a hidden window and export as PDF.
   *
   * Accepts { html, filename }.
   * Returns { ok: true } on success, { ok: false, canceled: true } if the user
   * cancels, or { ok: false, error: string } on failure.
   */
  ipcMain.handle('file:export-pdf', async (event, { html, filename }) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    // Ask where to save the PDF
    const defaultName = (filename || 'export').replace(/\.md$/i, '') + '.pdf'
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export as PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }

    // Write HTML to a temp file so the hidden window can load it
    const tmpFile = path.join(os.tmpdir(), 'markflow-export.html')
    await fs.writeFile(tmpFile, html, 'utf8')

    const hidden = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    try {
      await hidden.loadFile(tmpFile)
      const pdfBuffer = await hidden.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'none' },  // margins are handled by @page CSS
      })
      await fs.writeFile(filePath, pdfBuffer)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      hidden.close()
      await fs.unlink(tmpFile).catch(() => {})
    }
  })

  /**
   * file:write — write content to an existing file path on disk.
   *
   * Returns { ok: true } on success, or { ok: false, error: string } on failure.
   */
  ipcMain.handle('file:write', async (_event, filePath, content) => {
    try {
      await fs.writeFile(filePath, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /**
   * file:new — show a native Save dialog, then create an empty .md file.
   * Used as a fallback when no folder is active.
   *
   * Returns { filePath: string } on success, or null when the user cancels.
   */
  ipcMain.handle('file:new', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'New File',
      defaultPath: 'untitled.md',
      filters: [
        { name: 'Markdown & Text', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (canceled || !filePath) return null

    // Create the file only if it doesn't already exist
    try {
      await fs.writeFile(filePath, '', { flag: 'wx' }) // 'wx' → fail if exists
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      // File already exists — open it without overwriting
    }

    return { filePath }
  })

  /**
   * file:new-in-folder — create an empty .md file directly inside a known folder.
   * Called when the user already has an active folder open; no Save dialog is shown.
   *
   * @param {string} folderPath  Absolute path to the target directory.
   * @param {string} fileName    Desired filename (extension appended if absent).
   * Returns { filePath: string } on success,
   *         { error: string }   if the name is invalid or the file already exists,
   *         null on unexpected failure.
   */
  ipcMain.handle('file:new-in-folder', async (_event, folderPath, fileName) => {
    if (!folderPath || !fileName) return { error: 'Missing folder or filename.' }

    // Sanitise: strip path separators so callers can't escape the folder
    const safeName = path.basename(fileName.trim())
    if (!safeName) return { error: 'Invalid filename.' }

    // Append .md if the user didn't include an extension
    const finalName = /\.[a-zA-Z0-9]+$/.test(safeName) ? safeName : `${safeName}.md`
    const filePath  = path.join(folderPath, finalName)

    try {
      await fs.writeFile(filePath, '', { flag: 'wx' }) // 'wx' → fail if exists
      return { filePath }
    } catch (err) {
      if (err.code === 'EEXIST') return { error: `"${finalName}" already exists.` }
      return { error: err.message }
    }
  })

  /**
   * file:move — move a file into a different folder, keeping its filename.
   * Returns { ok: true, newPath: string } or { ok: false, error: string }.
   */
  ipcMain.handle('file:move', async (_event, filePath, targetFolderPath) => {
    try {
      const fileName = path.basename(filePath)
      const newPath  = path.join(targetFolderPath, fileName)
      if (filePath === newPath) return { ok: true, newPath }
      await fs.rename(filePath, newPath)
      return { ok: true, newPath }
    } catch (err) {
      if (err.code === 'EEXIST') return { ok: false, error: 'A file with that name already exists in the target folder.' }
      return { ok: false, error: err.message }
    }
  })

  /**
   * file:rename — rename a file on disk.
   * Returns { ok: true, newPath: string } or { ok: false, error: string }.
   */
  ipcMain.handle('file:rename', async (_event, oldPath, newName) => {
    try {
      const dir     = path.dirname(oldPath)
      const safeName = path.basename(newName.trim())
      if (!safeName) return { ok: false, error: 'Invalid filename.' }
      const finalName = /\.[a-zA-Z0-9]+$/.test(safeName) ? safeName : `${safeName}.md`
      const newPath  = path.join(dir, finalName)
      await fs.rename(oldPath, newPath)
      return { ok: true, newPath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /**
   * file:show-in-explorer — reveal a file in the OS file manager.
   */
  ipcMain.handle('file:show-in-explorer', async (_event, filePath) => {
    shell.showItemInFolder(filePath)
    return { ok: true }
  })

  /**
   * file:trash — move a file to the OS Recycle Bin.
   */
  ipcMain.handle('file:trash', async (_event, filePath) => {
    try {
      await shell.trashItem(filePath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /**
   * search:files — full-text + filename search across a folder tree.
   *
   * Args: { folderPath: string, query: string }
   * Returns: { results: SearchResult[] }
   *   SearchResult: { filePath, fileName, snippet, matchType: 'name'|'content' }
   * Caps at 30 results. Skips hidden files and non-text files.
   */
  ipcMain.handle('search:files', async (_event, { folderPath, query }) => {
    if (!folderPath || !query) return { results: [] }
    const q = query.toLowerCase()
    const results = []

    async function walk(dir) {
      if (results.length >= 30) return
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) }
      catch { return }

      for (const e of entries) {
        if (results.length >= 30) break
        if (e.name.startsWith('.')) continue
        const fullPath = path.join(dir, e.name)
        if (e.isDirectory()) {
          await walk(fullPath)
        } else if (e.isFile() && /\.(md|markdown|txt)$/i.test(e.name)) {
          const nameMatch = e.name.toLowerCase().includes(q)
          let content = ''
          try { content = await fs.readFile(fullPath, 'utf8') } catch { continue }
          const contentMatch = content.toLowerCase().includes(q)
          if (!nameMatch && !contentMatch) continue

          let snippet = ''
          if (contentMatch) {
            const idx = content.toLowerCase().indexOf(q)
            const lineStart = content.lastIndexOf('\n', idx) + 1
            const lineEnd   = content.indexOf('\n', idx)
            snippet = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
          } else {
            snippet = content.split('\n').find(l => l.trim()) || ''
          }
          snippet = snippet.replace(/^#+\s*/, '').slice(0, 120)

          results.push({
            filePath:  fullPath,
            fileName:  e.name,
            snippet,
            matchType: nameMatch ? 'name' : 'content',
          })
        }
      }
    }

    await walk(folderPath)
    return { results }
  })

  /* ── AI Config CRUD ─────────────────────────────────────────────────
     All handlers read/write ai-config.json in userData.
     ──────────────────────────────────────────────────────────────── */

  /** ai-config:list — return all model configs with decrypted api_key hydrated. */
  ipcMain.handle('ai-config:list', async () => {
    const config = await readConfig()
    return Promise.all(
      (config.models || []).map(async m => ({
        ...m,
        api_key: await loadModelKey(m.id),
      }))
    )
  })

  /** ai-config:create — add a new model config. */
  ipcMain.handle('ai-config:create', async (_e, data) => {
    const config = await readConfig()
    // If this new model is the default, clear everyone else's flag
    if (data.is_default) {
      config.models.forEach(m => { m.is_default = false })
    }
    const id = crypto.randomUUID()

    // Encrypt the API key separately; never write it into the JSON file
    await saveModelKey(id, data.api_key || null)

    const newModel = {
      id,
      label:      data.label,
      type:       data.type || 'api',
      base_url:   data.base_url   || null,
      model_name: data.model_name || null,
      // api_key intentionally omitted — stored encrypted in key-<id>.bin
      is_default: !!data.is_default,
      created_at: new Date().toISOString(),
    }
    config.models.push(newModel)
    await writeConfig(config)

    // Return the full object (with key) so the renderer can use it immediately
    return { ...newModel, api_key: data.api_key || null }
  })

  /** ai-config:update — replace an existing model config by id. */
  ipcMain.handle('ai-config:update', async (_e, data) => {
    const config = await readConfig()
    const idx = config.models.findIndex(m => m.id === data.id)
    if (idx === -1) throw new Error(`Model ${data.id} not found`)
    if (data.is_default) {
      config.models.forEach(m => { m.is_default = false })
    }

    // Re-encrypt the key when the caller supplied a new value (even empty string
    // means "clear the key").  Undefined means "leave the existing key alone".
    let resolvedKey
    if (data.api_key !== undefined) {
      await saveModelKey(data.id, data.api_key || null)
      resolvedKey = data.api_key || null
    } else {
      resolvedKey = await loadModelKey(data.id)
    }

    config.models[idx] = {
      ...config.models[idx],
      label:      data.label,
      base_url:   data.base_url   || null,
      model_name: data.model_name || null,
      // api_key intentionally omitted — stored encrypted in key-<id>.bin
      is_default: !!data.is_default,
      updated_at: new Date().toISOString(),
    }
    await writeConfig(config)

    // Return the full object (with key) so the renderer stays in sync
    return { ...config.models[idx], api_key: resolvedKey }
  })

  /** ai-config:delete — remove a model config by id. */
  ipcMain.handle('ai-config:delete', async (_e, id) => {
    const config = await readConfig()
    config.models = config.models.filter(m => m.id !== id)
    await writeConfig(config)
    await deleteModelKey(id)   // remove the encrypted key file too
    return { success: true }
  })

  /** ai-config:set-default — mark one model as default, clear the rest. */
  ipcMain.handle('ai-config:set-default', async (_e, id) => {
    const config = await readConfig()
    config.models.forEach(m => { m.is_default = m.id === id })
    await writeConfig(config)
    return config.models.find(m => m.id === id) || null
  })

  /* ── Pinned Files ────────────────────────────────────────────────────
     Stored in <userData>/pinned-files.json as { [folderPath]: filePath[] }.
     pins:get          — return the pinned list for one folder
     pins:toggle       — pin or unpin a file; returns true if now pinned
     pins:remove-folder — drop all pins for a folder (called on folder close)
     ──────────────────────────────────────────────────────────────── */
  const _pinsPath = () => path.join(app.getPath('userData'), 'pinned-files.json')

  async function _readPinsMap() {
    try { return JSON.parse(await fs.readFile(_pinsPath(), 'utf8')) }
    catch { return {} }
  }

  async function _writePinsMap(map) {
    await fs.writeFile(_pinsPath(), JSON.stringify(map, null, 2), 'utf8')
  }

  ipcMain.handle('pins:get', async (_e, { folderPath }) => {
    const map = await _readPinsMap()
    return map[folderPath] || []
  })

  ipcMain.handle('pins:toggle', async (_e, { folderPath, filePath }) => {
    const map    = await _readPinsMap()
    const pinned = map[folderPath] || []
    const idx    = pinned.indexOf(filePath)
    if (idx === -1) {
      map[folderPath] = [...pinned, filePath]
    } else {
      map[folderPath] = pinned.filter(p => p !== filePath)
      if (map[folderPath].length === 0) delete map[folderPath]
    }
    await _writePinsMap(map)
    return idx === -1 // true = now pinned
  })

  ipcMain.handle('pins:remove-folder', async (_e, { folderPath }) => {
    const map = await _readPinsMap()
    delete map[folderPath]
    await _writePinsMap(map)
    return { ok: true }
  })

  /* ── File Labels ─────────────────────────────────────────────────────
     Stored in <userData>/file-labels.json as { [filePath]: { text, color } }.
     labels:get — return the full label map
     labels:set — set or clear label for one file
     ──────────────────────────────────────────────────────────────────── */
  const _labelsPath = () => path.join(app.getPath('userData'), 'file-labels.json')

  async function _readLabelsMap() {
    try { return JSON.parse(await fs.readFile(_labelsPath(), 'utf8')) }
    catch { return {} }
  }

  async function _writeLabelsMap(map) {
    await fs.writeFile(_labelsPath(), JSON.stringify(map, null, 2), 'utf8')
  }

  ipcMain.handle('labels:get', async () => {
    return _readLabelsMap()
  })

  ipcMain.handle('labels:set', async (_e, { filePath, label }) => {
    const map = await _readLabelsMap()
    if (label) {
      map[filePath] = label   // { text: string, color: string }
    } else {
      delete map[filePath]
    }
    await _writeLabelsMap(map)
    return { ok: true }
  })

  /* ── Backup ──────────────────────────────────────────────────────────
     backup:write — snapshot the current file content before an AI edit.
     Stored under <userData>/backups/<folderName>-<hash8>/ to avoid
     cluttering the user's workspace with .markflow directories.
     Keeps the 10 most recent backups per file; older ones are pruned.
     ──────────────────────────────────────────────────────────────── */
  ipcMain.handle('backup:write', async (_e, { filePath, content }) => {
    try {
      const folderPath = path.dirname(filePath)
      const folderKey  = path.basename(folderPath) + '-' +
                         crypto.createHash('sha1').update(folderPath).digest('hex').slice(0, 8)
      const dir        = path.join(app.getPath('userData'), 'backups', folderKey)
      await fs.mkdir(dir, { recursive: true })

      const ext        = path.extname(filePath) || '.md'
      const basename   = path.basename(filePath, ext)
      const timestamp  = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(dir, `${basename}_${timestamp}${ext}`)
      await fs.writeFile(backupPath, content, 'utf8')

      // Prune: keep only the 10 most recent backups for this file
      const all  = await fs.readdir(dir)
      const mine = all
        .filter(f => f.startsWith(basename + '_') && f.endsWith(ext))
        .sort()  // ISO timestamps sort correctly as strings
      for (const old of mine.slice(0, Math.max(0, mine.length - 10))) {
        await fs.unlink(path.join(dir, old)).catch(() => {})
      }

      return { ok: true, backupPath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /* ── Ollama ──────────────────────────────────────────────────────────
     ollama:list-models — fetch the list of models from a running Ollama server.
     ──────────────────────────────────────────────────────────────── */

  ipcMain.handle('ollama:list-models', async (_e, { host } = {}) => {
    const base = (host || 'http://localhost:11434').replace(/\/$/, '')
    const data = await fetchJson(`${base}/api/tags`)
    // Ollama returns { models: [{ name, ... }, ...] }
    return (data.models || []).map(m => m.name).filter(Boolean)
  })

  /* ── AI: ask ──────────────────────────────────────────────────────────
     Dispatch to the correct backend and stream tokens back to the renderer.
     Payload: { model: ModelConfig, messages: Array<{role, content}> }
     ──────────────────────────────────────────────────────────────────── */
  ipcMain.handle('ai:ask', async (event, { model, messages }) => {
    // Guard: don't send to a destroyed webContents (window may close mid-stream)
    const send = (channel, data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data)
    }

    try {
      if (model.type === 'ollama') {
        await _handleOllama(model, messages, send)
      } else if (model.type === 'api') {
        await _handleApi(model, messages, send)
      } else {
        throw new Error(`Model type "${model.type}" is not supported in this version`)
      }
      send('ai:done', {})
    } catch (err) {
      console.error('[ai:ask]', err)
      send('ai:error', err.message || String(err))
    }
  })

}

/* ── Private AI dispatch helpers ──────────────────────────────────────────
   Called from the ai:ask handler above.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Stream a response from a local Ollama server.
 * Uses the /api/chat endpoint with stream:true (NDJSON response).
 */
async function _handleOllama(model, messages, send) {
  const base = (model.base_url || 'http://localhost:11434').replace(/\/$/, '')
  const url  = base + '/api/chat'
  const body = JSON.stringify({
    model:    model.model_name,
    messages: messages,
    stream:   true,
  })

  let buffer = ''

  await postStream(url, body, {}, (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    // Retain any incomplete trailing fragment for the next chunk
    buffer = lines.pop()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        // Ollama NDJSON: { message: { role, content }, done: bool }
        const token = parsed?.message?.content
        if (token) send('ai:token', token)
      } catch {
        // Partial JSON fragment — will be completed in the next chunk
      }
    }
  })

  // Flush any remaining buffer after stream ends
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim())
      const token  = parsed?.message?.content
      if (token) send('ai:token', token)
    } catch { /* ignore incomplete final fragment */ }
  }
}

/**
 * Stream a response from an OpenAI-compatible API endpoint.
 * Uses the /chat/completions endpoint with stream:true (SSE response).
 */
async function _handleApi(model, messages, send) {
  const base = (model.base_url || '').replace(/\/$/, '')
  const url  = base + '/chat/completions'
  const body = JSON.stringify({
    model:    model.model_name,
    messages: messages,
    stream:   true,
  })

  const extraHeaders = {}
  if (model.api_key) extraHeaders['Authorization'] = `Bearer ${model.api_key}`

  let buffer = ''

  await postStream(url, body, extraHeaders, (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed === 'data: [DONE]') continue  // SSE stream terminator
      if (!trimmed.startsWith('data: ')) continue
      try {
        const json  = JSON.parse(trimmed.slice(6)) // strip 'data: ' prefix
        const token = json?.choices?.[0]?.delta?.content
        if (token) send('ai:token', token)
      } catch { /* partial SSE line — skip */ }
    }
  })
}

/* ── Windows Jump List ───────────────────────────────────────────────────────
   Adds a "New Instance" task to the taskbar icon right-click menu.
   ──────────────────────────────────────────────────────────────────────── */

function updateJumpList() {
  if (process.platform !== 'win32') return

  // In dev the program is the Electron binary; pass the app path as the first
  // argument so a new process boots this project correctly.
  const program = process.execPath
  const appArg  = app.isPackaged ? '' : `"${app.getAppPath()}"`

  app.setJumpList([{
    type:  'tasks',
    items: [{
      type:        'task',
      title:       'New Instance',
      description: 'Open a new MoilStack .md window',
      program,
      args:        appArg,
      iconPath:    program,
      iconIndex:   0,
    }],
  }])
}

module.exports = { registerIpcHandlers, updateJumpList }
