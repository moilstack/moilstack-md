# Changelog

All notable new features and critical fixes for MoilStack .md.

---

## [Unreleased]

### Added
- **Version History panel** — right-click any file → "Version History…" to browse and restore prior backup snapshots.
- **"Update" indicator in the header** — an "Update" button next to Toggle Explorer/AI Assistant appears when a newer GitHub release is published.

### Changed
- **Automatic backups now cover every save, not just AI edits** — manual saves and autosave both snapshot the prior content first.
- **New-release toast repositioned and auto-hides** — moved to bottom-center and now fades out on its own after a few seconds.

### Fixed
- **File preview stripping non-frontmatter text** — a leading `---`…`---` block is now only treated as YAML frontmatter if it actually contains YAML.
- **Explorer tag pills not updating immediately after save** — saving now refreshes the sidebar's `#tag` pills right away instead of requiring a minimize/restore.
- **Pre-update untitled drafts orphaned by the new file-backed draft storage** — a one-time migration recovers any draft left behind in `localStorage` from before the update.

---

## [1.1.0] - 2026-07-18

### Added
- **Copy / Paste in the editor context menu** — added as a new group at the top, above the formatting options, with `Ctrl C` / `Ctrl V` shown as hints
- **Ctrl+Shift+N — New File (Explorer)** — creates a file on disk in the active Explorer folder (prompting to open a folder first if none is active), distinct from Ctrl+N's in-memory untitled buffer; also added to the hamburger menu
- **File tagging** — right-click → "Add Tags…" opens a small modal to add/edit a file's tags, stored in its YAML frontmatter (`tags: [work, project]`); pre-fills with existing tags and preserves cursor position in the document body when saved
  - Tags are shown as `#tag` pills next to filenames in Root folder only Explorer mode
  - Search by tag with `#tag` or `tag:name` in the header search box — works across Multi-level, Root-only, and Custom (Recents) explorer modes, matching only real frontmatter tags rather than plain text
  - Settings → File Explorer now explains the frontmatter format and search syntax directly in the Explorer Mode description
- **Quick jump to Explorer settings** — clicking the "Explorer" label in the sidebar header (now shown with a small gear icon) opens Settings, switches to the Explorer tab, and scrolls to/highlights the Explorer Mode row
- **Remove recent folders** — a hover-revealed × button now lets you remove a folder from the recents list without switching to it first, in both the Welcome screen's Recents list and the header folder-path dropdown

### Changed
- **Editor context menu decluttered** — removed Bullet List and Numbered List (they only ever applied to the first level and behaved inconsistently on nested lists) and Divider/horizontal-rule; users can still type Markdown list/`---` syntax directly
- **File tags are frontmatter-only** — dropped the inline `#hashtag`-in-body fallback for tag detection (it produced false positives from URLs, anchors, and code); a file's tags now only come from an explicit `tags:` field in YAML frontmatter
- **Image toolbar/context-menu action** — selected text now becomes the image's alt text (`![alt](url)`), matching how the Link action already worked, instead of incorrectly becoming the image path

### Fixed
- **Ctrl+Z not undoing context-menu formatting actions** — Bold, Italic, Strikethrough, headings, lists, blockquote, code block, and table insert now push an undo snapshot before editing, so Ctrl+Z correctly reverts them (previously these used a text-insertion method that the browser's native undo history didn't track)
- **Long tag lists squeezing the filename out of view** — in Root folder only Explorer mode, a file with several tags could shrink its filename down to nothing; the filename now keeps a minimum width and the tag list clips instead
- **"Untitled (unsaved)" row disappearing after Save As** — the Recent Files sidebar now always shows an "Untitled (unsaved)" row, so there's a one-click way back to a blank document after saving instead of having to press Ctrl+N again

---

## [1.0.1] - 2026-07-08

### Added
- **Notepad-style untitled files** — Ctrl+N now creates an in-memory untitled document that works regardless of whether a folder is open or the Explorer sidebar is visible
- **Save As uses the native OS dialog** — saving an untitled file now opens the system Save dialog directly, pre-pointed at the active folder with a filename suggested from the document's first line of text, instead of a custom in-app modal
- **"On Launch" setting** — Settings → Editor lets you choose whether the app opens to the Recents screen or straight into a new untitled file
- **"Custom (no folder)" Explorer mode** — Settings → File Explorer adds a third mode that hides the folder tree entirely; Recent Files becomes the sidebar's only content and the sole way to reopen something
- **Recent Files section** — a new section at the bottom of the Explorer sidebar tracks the current untitled draft plus files opened via Ctrl+N, Windows Explorer, or the "Open in New Window" context-menu action; entries persist until removed with the row's × button (hover to reveal), independent of which folder is currently active
  - Capped at 5 visible rows with a scrollbar beyond that, plus a count badge
  - Multi-level / Root folder only modes show it as a collapsible accordion with single-line icon+filename rows
  - Custom mode shows it full-height with a second-line content preview per row

### Fixed
- **Ctrl+N silently discarding unsaved content** — pressing Ctrl+N with unsaved text in the current untitled buffer now prompts Save / Discard / Cancel instead of clearing it
- **Unsaved untitled files lost on close** — closing the window (or switching to another file) without saving now persists the untitled buffer as a recoverable draft, restored automatically (with a toast) the next time the app opens
- **Save As changing the Explorer's active folder** — picking a different folder in the Save dialog no longer navigates the sidebar away from the folder you were browsing
- **False "file was deleted or moved outside the app" notification** — this could incorrectly fire right after saving or opening a file that lives outside the currently active folder (e.g. Save As to another location); the check now only applies to files that are actually supposed to be inside the active folder's tree
- **Sidebar hiding on single-file opens** — opening a file via Ctrl+O, the "Open File" button, Windows Explorer, or "Open in New Window" from the context menu no longer hides or resets the Explorer sidebar; it now stays visible until explicitly toggled off from the header icon
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