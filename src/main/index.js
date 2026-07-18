const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net } = require('electron')
const path = require('path')
const fs   = require('fs')
const { registerIpcHandlers, updateJumpList } = require('./ipc')
const { startReleaseCheck } = require('./releaseCheck')

// ── Window state persistence ───────────────────────────────────────────────
// Stored in <userData>/window-state.json so it survives app restarts.
// Reads happen synchronously at startup (before the event loop is busy).

function _winStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(_winStatePath(), 'utf8')
    const { width, height } = JSON.parse(raw)
    if (Number.isInteger(width) && width > 200 &&
        Number.isInteger(height) && height > 100) {
      return { width, height }
    }
  } catch { /* first run or corrupt file — fall through to defaults */ }
  return { width: 1440, height: 900 }
}

function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized()) return
  const { width, height } = win.getBounds()
  try { fs.writeFileSync(_winStatePath(), JSON.stringify({ width, height }), 'utf8') }
  catch { /* ignore write errors */ }
}

// ── Windows App User Model ID ──────────────────────────────────────────────
// Must be set before any window is created. Tells Windows to group taskbar
// buttons under this ID (not the generic "Electron" label) and is required
// for jump lists and notifications to work correctly.
app.setAppUserModelId('com.moilstack.markdown')

// ── Separate dev vs production userData ───────────────────────────────────
// In development, Electron uses the same userData path as the installed app
// (%APPDATA%\MoilStack .md). Appending '-dev' keeps configs isolated so
// development data never leaks into the production install and vice versa.
if (!app.isPackaged) {
  app.setPath('userData', app.getPath('userData') + '-dev')
}

// ── Single-instance lock ───────────────────────────────────────────────────
// Only ONE Electron process runs at a time. When a second launch is attempted
// (e.g. "New Instance" from the jump list, or double-clicking a .md file),
// the second process hands its argv to the first and exits immediately.
// The first process then opens a new BrowserWindow — much faster than a full
// cold start because the runtime is already loaded.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Parse launch arguments and return { filePath, folderPath }.
   *
   * Recognised forms:
   *   path/to/file.md          → filePath
   *   --folder="path/to/dir"   → folderPath  (launched from jump list recent)
   *
   * @param   {string[]} argv
   * @returns {{ filePath: string|null, folderPath: string|null }}
   */
  function getArgsFromArgv(argv) {
    let filePath = null, folderPath = null
    for (const arg of argv.slice(1)) {
      if (arg.startsWith('--folder=')) {
        folderPath = arg.slice('--folder='.length).replace(/^"|"$/g, '')
      } else if (!arg.startsWith('-') && /\.(md|markdown|txt)$/i.test(arg)) {
        filePath = arg
      }
    }
    return { filePath, folderPath }
  }

  // ── Window factory ──────────────────────────────────────────────────────────

  /**
   * Create a new BrowserWindow.
   * @param {{ filePath?: string, folderPath?: string }} [args]
   */
  function createWindow(args = {}) {
    // If there's an existing window, cascade the new one 40 px down-right so
    // it's immediately obvious it's a separate window and not the same one.
    let x, y
    const allWins = BrowserWindow.getAllWindows()
    if (allWins.length > 0) {
      const [cx, cy] = allWins[allWins.length - 1].getPosition()
      x = cx + 40
      y = cy + 40
    }

    // Only restore saved size for the very first window; subsequent windows
    // (opened via second-instance or New Instance) use the default size.
    const { width, height } = allWins.length === 0 ? loadWindowState() : { width: 1440, height: 900 }

    const win = new BrowserWindow({
      width,
      height,
      ...(x !== undefined ? { x, y } : {}),
      title: 'MoilStack .md',
      icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      frame: false,
      // Matches the dark theme's --bg so there's no white flash before the
      // page paints. The window itself stays hidden until the renderer
      // reports it has finished its startup UI work (see 'renderer:ready'
      // in ipc.js) — 'ready-to-show' alone only guarantees a first paint,
      // not that theme/sidebar-state/folder-listing JS has run, so relying
      // on it left a brief flash of half-initialised UI.
      backgroundColor: '#282c34',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Safety net: if the renderer never sends 'renderer:ready' (e.g. a
    // startup script error), show the window anyway so it isn't stuck hidden.
    win.once('ready-to-show', () => {
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.show()
      }, 2000)
    })

    // Forward maximize/unmaximize events so the renderer can update the button icon
    win.on('maximize',   () => win.webContents.send('window:maximized-change', true))
    win.on('unmaximize', () => win.webContents.send('window:maximized-change', false))

    // ── Persist window size on resize (debounced, first window only) ─────
    if (allWins.length === 0) {
      let _resizeTimer = null
      win.on('resize', () => {
        clearTimeout(_resizeTimer)
        _resizeTimer = setTimeout(() => saveWindowState(win), 500)
      })
    }

    // Deny all attempts to open new windows from within the renderer
    // (target="_blank" links, window.open calls). Links are handled by the
    // preview click handler which routes http/https to shell.openExternal.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // Always embed the file path as a URL query param so the renderer can read
    // it synchronously during DOMContentLoaded — this prevents the race condition
    // where the async savedFolder restore runs concurrently with the IPC open and
    // overwrites the correct folder. The folder open case still uses IPC because
    // there is no equivalent query param path for it.
    const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html')
    if (args.filePath) {
      win.loadFile(htmlPath, { query: { openFile: args.filePath } })
    } else {
      win.loadFile(htmlPath)
    }

    // ── Unsaved-changes guard ─────────────────────────────────────────────
    // Button indices:  0 = Save   1 = Discard   2 = Cancel
    // event.preventDefault() on will-prevent-unload is synchronous-only in
    // Electron — calling it after an await has no effect. Instead we send IPC
    // messages so the renderer can set the bypass flag and call window.close().
    win.webContents.on('will-prevent-unload', (event) => {
      // Prevent the default "keep window open" so we can manage close ourselves.
      event.preventDefault()
      dialog.showMessageBox(win, {
        type:      'warning',
        buttons:   ['Save', 'Discard changes', 'Cancel'],
        defaultId: 0,
        cancelId:  2,
        title:     'Unsaved changes',
        message:   'You have unsaved changes.',
        detail:    'Save before closing, or discard and lose your work?',
      }).then(({ response }) => {
        if (response === 0) {
          win.webContents.send('app:save-and-close')
        } else if (response === 1) {
          win.webContents.send('app:discard-and-close')
        }
        // response === 2 (Cancel): do nothing → window stays open
      })
    })

    // ── Send startup folder once the renderer is ready ───────────────────
    // (file opens are handled via query param above — no IPC needed)
    if (args.folderPath) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('folder:open-from-os', args.folderPath)
      })
    }

    return win
  }

  // ── Second-instance handler ─────────────────────────────────────────────────
  // Fires on THIS (already-running) process when any new launch is attempted.
  // Instead of focusing the existing window, we open a fresh BrowserWindow —
  // near-instant because the Electron runtime is already loaded.
  app.on('second-instance', (_event, argv) => {
    const args = getArgsFromArgv(argv)
    createWindow(args)
  })

  // ── App lifecycle ───────────────────────────────────────────────────────────

  app.whenReady().then(() => {
    // Serve local filesystem files via local-file:// so the renderer can load
    // images from arbitrary paths without being blocked by web security.
    // URL format: local-file:///D:/path/to/image.png
    protocol.handle('local-file', (request) => {
      const { pathname } = new URL(request.url)
      return net.fetch('file://' + pathname)
    })

    Menu.setApplicationMenu(null)
    registerIpcHandlers()

    // IPC: open a new window from the renderer (hamburger "New Instance" button,
    //      or "Open in New Window" from the file context menu).
    // Accepts an optional args object: { filePath?, folderPath? }
    ipcMain.handle('app:new-window', (_e, args) => { createWindow(args || {}) })

    // First window — pass any file/folder from the CLI args
    createWindow(getArgsFromArgv(process.argv))

    startReleaseCheck()

    app.on('activate', () => {
      // macOS: re-create a window when dock icon is clicked and no windows exist
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
