# MoilStack .md (markdown) — Privacy-First Markdown AI Editor & Viewer

[![Version](https://img.shields.io/github/v/release/moilstack/moilstack-md?label=version&include_prereleases)](https://github.com/moilstack/moilstack-md/releases)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

An open-source desktop **Markdown AI editor** and standalone markdown viewer built with Electron. Write, edit, and view Markdown files with syntax highlighting, live split-pane preview, and an integrated local AI assistant — all running privately on your machine.

---

![MoilStack .md](assets/screenshot-editor.png)

## Download

Pre-built installers are available on the [Releases page](https://github.com/moilstack/moilstack-md/releases/latest).

| Platform | Format |
|---|---|
| Windows | NSIS installer, portable ZIP |

---

## Features

- **Dual-pane editor** — syntax-highlighted editor with Markdown preview (`Ctrl+\`` to toggle)
- **File explorer** — browse, create, rename, and open `.md` files from a folder
- **AI Assistant** — ask the AI to edit your document, answer questions, or improve your writing
- **Smart AI editing** — document edits are applied silently and instantly; informational answers stream as chat
- **Undo AI edits** — every AI document change is reversible with the Undo button or `Ctrl+Z`
- **Visual table builder** — insert Markdown tables with a point-and-click grid editor
- **File labels** — colour-tag files in the explorer for quick navigation
- **File backups** — automatic `.markflow/backups/` snapshots before every AI edit
- **Multi-model support** — connect any OpenAI-compatible API (Groq, OpenAI, Mistral, Together AI) or run Ollama locally
- **Export to PDF** — one-click export via native save dialog
- **Dark / light theme** — persisted across sessions
- **Configurable editor** — font size and font family settings

---
## Screens
![AI assistant editing](assets/screenshot-preview.png)
![AI assistant editing](assets/screenshot-ai-edit.png)
![Table builder](assets/screenshot-table-builder.png)


## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/)

### Install & Run

```bash
git clone https://github.com/moilstack/moilstack-md.git
cd moilstack-md
npm install
npm start
```

> `npm start` uses `nodemon` — the app auto-reloads when you change any file in `src/`.

### Build for Distribution

```bash
npm run package
```

Output goes to the `dist/` folder. Targets: NSIS/ZIP (Windows), DMG/ZIP (macOS), AppImage/DEB (Linux).

---

## AI Assistant Setup

MoilStack .md relies on the standard OpenAI Chat Completions API architectural design, allowing you to instantly deploy powerful cloud models or execute complex workflows completely offline.

### Flexible Deployment Options
* **Fully Offline & Private:** Protect sensitive information by running local text operations straight on your machine through **Ollama**.
* **High-Speed Cloud API Infrastructure:** Connect native accounts from **Google Gemini**, **Groq**, **OpenAI**, **Mistral**, or **Together AI**.

For definitive step-by-step setup guides, free tier account endpoint links, local model terminal scripts, and detailed performance matrices, see our dedicated [AI Configuration & Model Setup Guide](AI_SETUP.md).


## Using the AI Assistant

MoilStack .md acts as an interactive markdown AI editor, allowing you to seamlessly communicate text changes directly to your local workspace.

### Document Editing & Refinement
Simply ask the AI assistant to modify your active file text:
* "Fix the grammar and layout flow in this document"
* "Add a clean summary section right at the top"
* "Convert this raw text paragraph into a clear bulleted list"

When the AI assistant processes an edit, changes are applied silently and instantly into the editor pane. A structural summary of the modifications appears inside the chat window.

### Safety & Version Controls
* **Instant Undo:** Every single document modification made by the AI can be instantly reversed using the UI Undo button (↺) or by pressing `Ctrl+Z`.
* **Automatic Snapshots:** For absolute safety, MoilStack .md saves automatic file backups to the active directory's `<your-folder>/.markflow/backups/` directory before any AI processing occurs.
* **Scoped Selections:** Highlight specific sentences or code lines inside the editor pane before typing a prompt to limit the AI assistant's scope exclusively to that text selection.


## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save file |
| `Ctrl+Z` | Undo (AI edits first, then native undo) |
| `Ctrl+\`` | Toggle Edit / Preview mode |
| `Ctrl+O` | Open folder picker |
| `Ctrl+N` | New file in current folder |
| `Ctrl+F` | Find & replace |
| `Enter` | Send chat message |
| `Alt+Enter` | New line in chat input |
| `Escape` | Close any open modal or dropdown |

## File Backups

Every time the AI edits your document, MoilStack .md saves a backup to:

```
<your-folder>/.markflow/backups/
```

Files are named `<filename>_<timestamp>.md` and the last **10 backups per file** are kept automatically. Use these to recover from any unwanted AI changes.



## Contributing

Issues and pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — see [LICENSE](LICENSE) for details.

> The project name, logo, and visual branding assets are not open source. See [BRANDING.md](BRANDING.md) for the Trademark & Branding Policy.
