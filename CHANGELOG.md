# Changelog

All notable new features and critical fixes for MoilStack .md.

---

## [Unreleased]

### Fixed
- **Editor toolbar buttons** — bold, italic, links, headings, lists, quotes, code blocks, and horizontal rules now insert text using a more modern, reliable method, so the syntax highlighting and "unsaved changes" indicator always stay accurate
- **Table Builder** — inserting or updating a table now uses the same more reliable text-insertion method
- **Copy AI response** — the "Copy" button on AI chat replies now relies solely on the system clipboard API for a more consistent copy experience
- **Save / export error messages** — failures now show as a small toast notification instead of a disruptive popup dialog
- Renamed a leftover temporary file that still used the app's old name ("MarkFlow") to use the correct "MoilStack" name
- **Dark theme on first launch** — the app now opens in dark mode by default when no theme preference has been set yet, instead of light mode
- **Flash of light theme on launch** — fixed a brief flash of the light theme before the dark theme appeared when starting the app
- **Startup flicker** — the app window no longer briefly shows an unstyled, oversized version of the toolbar icons while it finishes loading; the window now stays hidden until everything is fully rendered

---

## [1.0.0-beta.2] - 2026-07-05

### Changed
- **Custom title bar** — the app now has its own title bar that matches the app's theme, with minimize, maximize, and close buttons built into the header
- **Dark theme — One Half Dark Amethyst** — the dark theme has been refreshed with a new color palette: deeper charcoal background, warm light-gray text, and a violet accent color; headings in the editor and preview each have their own distinct color
- **Recent folders dropdown** — the recent folders list is easier to read, with more spacing between entries, larger text, and a slightly wider dropdown

---

## [1.0.0-beta.1] - 2026-06-22

### Added
- **Recent folders dropdown** — the folder path in the header is now a clickable button; clicking it opens a dropdown listing the last 10 unique folders (most recent first) for quick switching without going through the hamburger menu
- Recent folder list capacity increased from 5 to 10 entries

### Fixed
- **Task list nested items** — sub-items (`- [ ]` with indented children) now render on their own line below the parent item, matching the behaviour of normal nested ordered/unordered lists; previously they appeared appended inline at the end of the parent label
- **Strikethrough inside task items** — `~~text~~` inside a checkbox item no longer wraps to a new line; all inline formatting (bold, italic, strikethrough, code) is now contained in a single flex child so it flows correctly
- **First-line preview after first save** — in Root folder access mode, a newly created file now shows its first line of content in the sidebar immediately after the first save, without needing to minimize/restore the window
- **Editor scrollbar** — the scrollbar in the editor (Edit mode) is now visible; it had been explicitly hidden via CSS
- **Editor scroll position** — switching to Edit mode now always restores the editor to the top of the document; previously, navigating between files in Preview mode then switching to Edit mode caused the editor to scroll to the bottom of the document
- **OS file open (Windows Explorer double-click)** — opening a file directly from Windows Explorer now switches the sidebar to show the files in that file's parent folder and highlights the file in the tree; previously the sidebar kept showing the previously opened folder

---

## [0.5.0] - 2026-06-14

### Added
- **Visual Table Builder** — right-click context menu → "Table…" opens a modal (80 % of the window) to build Markdown tables without typing pipe syntax by hand
  - Column names and alignment are edited directly in the grid header row; click the **L / C / R** badge on any column to cycle between left, center, and right alignment
  - Data cells use auto-expanding text areas — each cell grows as you type, no manual resizing needed
  - **Tab** moves focus to the next cell; pressing **Tab** on the last cell of the last row automatically appends a new row
  - **+** button at the end of the header row adds a new column; **×** on any column header or row removes it
  - Selecting an existing Markdown table before right-clicking opens the modal pre-filled with the table's data — **Save** replaces the original selection in-place; **Insert** (no prior selection) inserts at the cursor with proper newline padding
  - Modal stays open when clicking outside — closes only via **Cancel**, the **×** header button, or **Escape**
- **File labels** — right-click any file and choose "Label…" to attach a short 3-character label (e.g. WRK, PRD, DEV) with a choice of 8 predefined colors; stored in `<userData>/file-labels.json`, no file content is modified
- Label badge is displayed on the preview line of each flat file card (root-only mode), right-aligned next to the content preview; a small colored dot appears next to filenames in multi-level tree mode
- **Explorer mode setting** — Settings → Explorer lets you switch between two sidebar layouts:
  - *Multi-level*: full collapsible folder tree (default)
  - *Root folder only*: flat list grouped by date (Today / Yesterday / This Week / Month Year) with per-file content preview and tag chips
- **Editor appearance settings** — Settings → Editor exposes:
  - Font size stepper (10–24 px, persisted across sessions)
  - Font family selector (JetBrains Mono, Fira Code, Cascadia Code, Consolas, Courier New, System Monospace)
  - Startup mode (open in Edit or Preview on launch)
  - Live font preview strip that updates as you change settings
- **Window state persistence** — window size and position are saved on close and restored on next launch

### Fixed
- Explorer list no longer stays stale after saving a file — the modified timestamp is updated in the cache immediately so the file re-sorts into the correct date group (Today / Yesterday / This Week) without requiring the app to be restarted

---

## [0.4.0] - 2026-06-08

### Added
- **Global search** — header search box (Ctrl+Shift+F) searches filenames and file content across the open folder
- Results dropdown shows filename + matching content line with query highlighted
- Keyboard navigation in results (↑ / ↓ to move, Enter to open, Escape to dismiss)
- Search triggers after 3 characters with debounce; caps at 30 results

### Fixed
- Selecting a file from search results no longer re-roots the Explorer to the file's immediate parent folder
- Collapsed ancestor folders now automatically expand when a file is opened from search, and the file is correctly highlighted in the tree

---

## [0.3.0] - 2026-06-08

### Added
- **File trash** — move files to the OS Recycle Bin from the context menu
- Header layout redesigned to 3-column grid with search box centered and folder path inline next to the app name
- Explorer section header height aligned with AI Assistant header (42 px with divider)

---

## [0.2.0] - 2026-05-10

### Added
- **Ask / Edit mode toggle** — switch the AI Assistant between Ask (chat) and Edit (apply changes to editor) modes
- **Find & Replace widget** — inline find and replace inside the editor (Ctrl+F / Ctrl+H)
- Markdown table parsing improvements and smarter text insertion in the editor

### Fixed
- Checkbox rendering in Markdown preview and editor sync

---

## [0.1.0] - Initial development build

### Added
- Markdown editor with live preview (Edit / Preview toggle)
- Explorer sidebar with file tree, drag-and-drop, and collapsible folders
- AI Assistant panel with model configuration and streaming responses
- Backup snapshot before AI edits are applied
- Pinned files section in the Explorer
- New Instance and Open in New Window support
- Export to PDF
- Hamburger menu with keyboard shortcuts
- **Sidebar toggles** — independently show/hide the Explorer and AI Assistant panels
- Startup mode preference (restore last sidebar state on launch)
- Recent items management in the hamburger menu

### Fixed
- Folder selection dialog, OS file open via Windows Explorer, and preview typography regressions
- Overlay scroll position now stays in sync with the editor
- Scrollbars hidden inside the editor pane for a cleaner look