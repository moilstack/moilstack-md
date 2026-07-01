const { contextBridge, ipcRenderer } = require('electron')

/**
 * Expose safe APIs to the renderer via contextBridge.
 * The renderer accesses these as window.electronAPI.*
 *
 * Only expose what the renderer strictly needs — never expose
 * raw ipcRenderer.on/send to avoid prototype-pollution attacks.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion: require('electron').ipcRenderer.sendSync('app:get-version'),

  // Open a native folder-picker dialog
  openFolder: () => ipcRenderer.invoke('folder:open'),

  // Open a native single-file picker (Markdown files only)
  openFile: () => ipcRenderer.invoke('file:open'),

  // Read the folder tree (folders + .md files, max 4 sub-levels)
  // options: { rootOnly?: boolean, withMeta?: boolean }
  readFolder: (folderPath, options) => ipcRenderer.invoke('folder:read', folderPath, options),

  // Create a new sub-folder inside an existing directory
  createFolder: (parentPath, folderName) =>
    ipcRenderer.invoke('folder:create', parentPath, folderName),

  // Read the content of a file
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  // Read a binary file as base64 (used by PDF export to embed local images)
  readFileBase64: (filePath) => ipcRenderer.invoke('file:read-base64', filePath),

  // Write content to a file
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),

  // Export rendered HTML as a PDF via the native save dialog
  exportPdf: (html, filename) => ipcRenderer.invoke('file:export-pdf', { html, filename }),

  // Prompt for a filename and create a new Markdown file on disk (fallback / no active folder)
  newFile: () => ipcRenderer.invoke('file:new'),

  // Create a new .md file directly inside an already-selected folder (no Save dialog)
  newFileInFolder: (folderPath, fileName) =>
    ipcRenderer.invoke('file:new-in-folder', folderPath, fileName),

  // Move a file into a different folder (same filename, new directory)
  moveFile: (filePath, targetFolderPath) =>
    ipcRenderer.invoke('file:move', filePath, targetFolderPath),

  // Rename a file on disk
  renameFile: (oldPath, newName) =>
    ipcRenderer.invoke('file:rename', oldPath, newName),

  // Move a file to the OS Recycle Bin
  trashFile: (filePath) => ipcRenderer.invoke('file:trash', filePath),

  // Reveal a file in the OS file manager (Explorer on Windows)
  showInExplorer: (filePath) =>
    ipcRenderer.invoke('file:show-in-explorer', filePath),

  // Write a backup snapshot before an AI edit is applied.
  // Saved to <userData>/backups/<folderName>-<hash>/  (last 10 per file)
  writeBackup: (filePath, content) =>
    ipcRenderer.invoke('backup:write', { filePath, content }),

  // ── Pinned Files ────────────────────────────────────────────────────
  // Stored in <userData>/pinned-files.json — no localStorage, no size limit.
  pins: {
    get:          (folderPath)           => ipcRenderer.invoke('pins:get',           { folderPath }),
    toggle:       (folderPath, filePath) => ipcRenderer.invoke('pins:toggle',        { folderPath, filePath }),
    removeFolder: (folderPath)           => ipcRenderer.invoke('pins:remove-folder', { folderPath }),
  },

  // ── File Labels ─────────────────────────────────────────────────────
  // Stored in <userData>/file-labels.json — { [filePath]: { text, color } }
  labels: {
    get: ()                      => ipcRenderer.invoke('labels:get'),
    set: (filePath, label)       => ipcRenderer.invoke('labels:set', { filePath, label }),
  },

  // ── AI Config CRUD ──────────────────────────────────────────────────
  aiConfig: {
    list:       ()     => ipcRenderer.invoke('ai-config:list'),
    create:     (data) => ipcRenderer.invoke('ai-config:create', data),
    update:     (data) => ipcRenderer.invoke('ai-config:update', data),
    delete:     (id)   => ipcRenderer.invoke('ai-config:delete', id),
    setDefault: (id)   => ipcRenderer.invoke('ai-config:set-default', id),
  },

  // ── Ollama ──────────────────────────────────────────────────────────
  ollama: {
    listModels: (host) => ipcRenderer.invoke('ollama:list-models', { host }),
  },

  // ── AI Streaming ─────────────────────────────────────────────────────
  // Fire the AI request (Ollama or API backend)
  askAI: (payload) => ipcRenderer.invoke('ai:ask', payload),

  // Register one-way event listeners for streaming tokens
  onAIToken: (cb) => ipcRenderer.on('ai:token', (_e, token) => cb(token)),
  onAIDone:  (cb) => ipcRenderer.on('ai:done',  (_e, data)  => cb(data)),
  onAIError: (cb) => ipcRenderer.on('ai:error', (_e, msg)   => cb(msg)),

  // Remove all streaming listeners — call before each new request to prevent
  // listener accumulation across multiple sendMessage() calls
  removeAIListeners: () => {
    ipcRenderer.removeAllListeners('ai:token')
    ipcRenderer.removeAllListeners('ai:done')
    ipcRenderer.removeAllListeners('ai:error')
  },

  // ── Window close guard ──────────────────────────────────────────────────
  // Called by the main process when the user chose "Save" in the unsaved-
  // changes dialog.  The renderer should save then call window.close().
  onSaveAndClose: (cb) => ipcRenderer.on('app:save-and-close', () => cb()),

  // ── OS file open ────────────────────────────────────────────────────────
  // Called by the main process when a .md file is opened from Windows Explorer
  // or the taskbar jump list.
  onOpenFileFromOS: (cb) =>
    ipcRenderer.on('file:open-from-os', (_event, filePath) => cb(filePath)),

  // ── OS folder open ──────────────────────────────────────────────────────
  // Called when the app is launched with --folder=<path> (e.g. from the
  // taskbar jump list "Recent" category).
  onOpenFolderFromOS: (cb) =>
    ipcRenderer.on('folder:open-from-os', (_event, folderPath) => cb(folderPath)),

  // ── New window ──────────────────────────────────────────────────────────
  // Ask the main process to open a new BrowserWindow instantly (no new
  // process — the existing Electron runtime creates the window directly).
  newWindow: () => ipcRenderer.invoke('app:new-window'),

  // Open a specific file in a brand-new window — sidebar hidden, file-only mode.
  // The file path is passed as a URL query param so the renderer can skip
  // folder restoration synchronously during DOMContentLoaded (no flash).
  openInNewWindow: (filePath) =>
    ipcRenderer.invoke('app:new-window', { filePath, singleFileMode: true }),

  // Search filenames and content within the active folder
  searchFiles: (folderPath, query) =>
    ipcRenderer.invoke('search:files', { folderPath, query }),

  // Open a URL in the default OS browser (http/https only)
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // ── Custom title-bar window controls ──────────────────────────────────────
  window: {
    minimize:          () => ipcRenderer.send('window:minimize'),
    toggleMaximize:    () => ipcRenderer.send('window:maximize'),
    close:             () => ipcRenderer.send('window:close'),
    isMaximized:       () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb) => ipcRenderer.on('window:maximized-change', (_e, isMax) => cb(isMax)),
  },

})
