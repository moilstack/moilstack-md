# MoilStack .md (markdown) — AI-Powered Markdown Editor with Version History

[![Version](https://img.shields.io/github/v/release/moilstack/moilstack-md?label=version&include_prereleases)](https://github.com/moilstack/moilstack-md/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)
![License](https://img.shields.io/badge/license-MIT-green)

An open-source desktop **Markdown AI editor** and standalone markdown viewer built with Electron. Write, edit, and view Markdown files with syntax highlighting, a live preview pane, and an integrated AI assistant — with the option to run everything privately on your machine.

![MoilStack .md](assets/04_moilstack-md_Preview-InShort.png)

## Download

Get the latest installer for Windows, macOS, or Linux from the [Releases page](https://github.com/moilstack/moilstack-md/releases/latest), or from the [Microsoft Store](https://apps.microsoft.com/detail/9pp0mrt5lrk5?hl=en-US&gl=AZ).

Windows SmartScreen warning or Linux launch issues? See the [Install Guide](INSTALL.md).

## Features

**Writing**
- **Edit, Preview and Split modes** — syntax-highlighted editor with live preview
- **Quick edit in Preview** — double-click a block to edit it in place (or keep Preview read-only, or tables-only)
- **Visual table builder** — create Markdown tables with a point-and-click grid
- **Export to PDF**, 11 light and dark themes, and configurable editor fonts

**AI**
- **✨ AI actions** — right-click selected text to fix grammar, improve, shorten, translate and more; use the toolbar ✨ AI button to summarize, add a table of contents, proofread, or suggest tags
- **Review before applying** — see changes highlighted, then Accept, Reject or Retry
- **AI Assistant chat** — ask questions about your document, get a plain-language Explain, or request any other change
- **In Short** — a one- or two-sentence AI summary at the top of Preview, with suggested tags
- **AI file helpers** — right-click a file to Rename with AI, Suggest Folder, or Identify Tasks
- **Any model** — OpenAI-compatible APIs (Groq, Gemini, OpenAI, Mistral…), Anthropic, Ollama (fully offline), or CLI tools like Claude Code

**Files**
- **File explorer** — Multi-level tree, Root-only, or Recent-only modes
- **Search** — across file names and content, with `#tag` search
- **Labels & tags** — colour-label files and add searchable frontmatter tags
- **Version History** — every save is backed up; browse and restore old versions
- **Pinned files** — keep your most-used files at the top of the Explorer
- **Safe by default** — every AI change can be undone with `Ctrl+Z`

**Tasks & Ideas**
- **Per-folder Tasks and Ideas** — stored as plain Markdown (`_tasks.md`, `_ideas.md`) in the folder
- **Grouped by date** — Overdue, Today, Tomorrow, This week, Next week, with priorities and `#tags`
- **Quick add** — type `!high`, `tomorrow` or `#tag` right in the task text
- **Identify Tasks (AI)** — pull the main pending tasks out of any note and add them in one go

## Screens

### Review AI changes before applying
![AI change shown as a diff with Accept, Reject and Retry](assets/08_moilstack-md_AI-Review.png)

### AI Assistant — Explain a document
![AI Assistant explaining a document](assets/05_moilstack-md_AI-Assistant.png)

### Tasks for a folder
![Tasks grouped by date](assets/07_moilstack-md_Tasks.png)

### AI helpers on right-click
![File right-click menu with Rename with AI, Suggest Folder and Identify Tasks](assets/06_moilstack-md_File-Menu.png)

## Documentation

### Installing
Installers are available for Windows (NSIS, portable ZIP, Microsoft Store), macOS (DMG, ZIP) and Linux (DEB, AppImage). The guide explains how to get past the Windows SmartScreen warning and how to fix AppImage launch errors on newer Linux distros.

→ [Install Guide](INSTALL.md)

### Connecting an AI model
MoilStack .md works with OpenAI-compatible APIs (Groq, Gemini, OpenAI, Mistral, Together AI), Anthropic's API, Ollama running locally or in the cloud, and installed CLI tools like Claude Code. A few starter models are added on first launch — just add an API key or log in to the CLI. Use Ollama to keep everything fully offline.

→ [AI Setup Guide](AI_SETUP.md)

### Using the app
Learn how to use the ✨ AI actions on selected text and whole documents, review and accept AI changes, chat with the AI Assistant, restore old versions of a file, and speed things up with keyboard shortcuts.

→ [User Guide](USER_GUIDE.md)

### Contributing
Issues and pull requests are welcome. The guide covers running the app from source, running tests, and building installers.

→ [Contributing Guide](CONTRIBUTING.md)

See the [Changelog](CHANGELOG.md) for what's new in each version.

## License

MIT — see [LICENSE](LICENSE). The project name, logo, and branding are not open source — see [BRANDING.md](BRANDING.md).
