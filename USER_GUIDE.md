# MoilStack .md — User Guide

- [AI features](#ai-features)
- [Version History](#version-history)
- [Keyboard shortcuts](#keyboard-shortcuts)

Setting up an AI model? See the [AI Setup Guide](AI_SETUP.md).

## AI features

### ✨ AI actions

- **Selected text** — select text (or place the cursor in a paragraph), right-click → **✨ AI**, and pick an action: Fix grammar, Improve writing, Make shorter / longer, Simplify, Tone, Translate, or Explain.
- **Custom prompt** — press `Ctrl+K` to tell the AI what to do with the selection.
- **Whole document** — click **✨ AI** in the toolbar: Summarize, Table of contents, Fix Markdown formatting, Proofread, Suggest tags, or Simplify.
- **In Preview** — double-click a block to edit it, then right-click for the same menu.

Results appear in the AI Assistant with changes highlighted (removed in red, added in green). Click **Accept** to apply, **Reject** to discard, or **Retry** for a new answer.

### AI Assistant chat

Open it with the round button in the bottom-right corner. Use it for anything the ✨ AI actions don't cover:

- "Fix the grammar and layout flow in this document"
- "Add a clean summary section right at the top"
- "Convert this paragraph into a bulleted list"

Use **Ask** mode for questions (the document isn't changed) and **Edit** mode for changes. Select text in the editor first to limit the AI to that selection. You can follow up on any result, e.g. "make it shorter".

### Safety

- **Undo** — every AI change can be undone with `Ctrl+Z` (or the Undo button in the chat).
- **Backups** — a backup is saved to the app's data folder (not your workspace) before any AI edit.

## Version History

Every save — `Ctrl+S`, autosave, or an AI edit — stores a version. The last **10 versions per file** are kept; empty or duplicate snapshots are skipped.

Right-click a file in the Explorer → **Version History…**:

- Versions are listed by date and time; click one to see its content.
- **Current** shows the file as it is now, for comparison.
- **Restore This Version** brings a version back (after a confirmation). The current content is backed up first, so nothing is lost.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save file |
| `Ctrl+Z` | Undo (including AI edits) |
| `Ctrl+K` | ✨ AI custom prompt for the selected text |
| `Ctrl+\`` | Switch Edit / Preview / Split |
| `Ctrl+O` | Open folder |
| `Ctrl+N` | New untitled file |
| `Ctrl+Shift+N` | New file in the Explorer's active folder |
| `Ctrl+F` | Find & replace |
| `Ctrl+Shift+F` | Search files and content |
| `Enter` / `Alt+Enter` | Send chat message / new line in chat |
| `Escape` | Close any open dialog or menu |
