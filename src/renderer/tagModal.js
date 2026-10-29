/**
 * tagModal.js — "Add Tags…" editor context-menu action.
 *
 * Reads/writes the `tags:` field in the current file's YAML frontmatter,
 * using the same shapes the main process's _extractTags (src/main/ipc.js)
 * recognizes: inline array `tags: [a, b]`. Frontmatter tags are the only
 * tag source recognized anywhere in the app (no inline #hashtag fallback).
 */

const TagModal = (() => {
  const _overlay  = document.getElementById('tagModalOverlay');
  const _tagsBox  = document.getElementById('tagModalTags');
  const _saveBtn  = document.getElementById('btnSaveTags');
  const _closeBtn = document.getElementById('btnCloseTagModal');

  /** Split content into frontmatter lines and body lines, or null if none. */
  function _splitFrontmatter(content) {
    if (!content.startsWith('---')) return null;
    const lines = content.split('\n');
    if (lines[0].trim() !== '---') return null;
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { endIdx = i; break; }
    }
    if (endIdx === -1) return null;
    return { fmLines: lines.slice(1, endIdx), bodyLines: lines.slice(endIdx + 1) };
  }

  function _getExistingTags(fmLines) {
    for (let i = 0; i < fmLines.length; i++) {
      const line = fmLines[i];
      const inlineMatch = line.match(/^tags:\s*\[([^\]]*)\]\s*$/);
      if (inlineMatch) {
        return inlineMatch[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      }
      if (/^tags:\s*$/.test(line)) {
        const tags = [];
        let j = i + 1;
        while (j < fmLines.length && /^[ \t]*-[ \t]+/.test(fmLines[j])) {
          tags.push(fmLines[j].replace(/^[ \t]*-[ \t]+/, '').replace(/^['"]|['"]$/g, '').trim());
          j++;
        }
        return tags;
      }
    }
    return [];
  }

  /** Remove any existing `tags:` declaration (inline or list form) from frontmatter lines. */
  function _removeTagsLines(fmLines) {
    const out = [];
    let i = 0;
    while (i < fmLines.length) {
      const line = fmLines[i];
      if (/^tags:\s*\[[^\]]*\]\s*$/.test(line)) { i++; continue; }
      if (/^tags:\s*$/.test(line)) {
        i++;
        while (i < fmLines.length && /^[ \t]*-[ \t]+/.test(fmLines[i])) i++;
        continue;
      }
      out.push(line);
      i++;
    }
    return out;
  }

  function _applyTags(content, tags) {
    const parsed   = _splitFrontmatter(content);
    const tagsLine = tags.length ? `tags: [${tags.join(', ')}]` : null;

    if (parsed) {
      const fmLines = _removeTagsLines(parsed.fmLines);
      if (tagsLine) fmLines.push(tagsLine);
      if (fmLines.length === 0) return parsed.bodyLines.join('\n'); // frontmatter now empty — drop it
      return ['---', ...fmLines, '---', ...parsed.bodyLines].join('\n');
    }
    if (!tagsLine) return content; // nothing to add, no existing frontmatter
    return ['---', tagsLine, '---', '', content].join('\n');
  }

  const _title = _overlay?.querySelector('.label-modal__title');

  // Pill editor; suggestions are the tags already used in the opened folder
  const _input = _tagsBox ? TagInput.create({
    max: 5,
    getSuggestions: () => typeof RenameFromContent !== 'undefined' ? RenameFromContent.folderTags() : [],
    onSubmit: () => _save(),
  }) : null;
  _tagsBox?.appendChild(_input.el);
  let _targetPath = null;   // null → the file open in the editor

  function _hide() {
    _overlay?.classList.add('hidden');
    _targetPath = null;
  }

  /** Path of the file open in the editor (the Explorer's active item), or null. */
  function _activePath() {
    // The open file — not the Explorer highlight, which can briefly vanish while the list redraws
    try { if (typeof currentFile !== 'undefined' && currentFile?.path) return currentFile.path; } catch { /* not loaded */ }
    return document.querySelector('#file-list .file-item.active')?.dataset.path || null;
  }

  /** Existing frontmatter tags in a document's text. */
  function tagsIn(content) {
    const parsed = _splitFrontmatter((content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
    return parsed ? _getExistingTags(parsed.fmLines) : [];
  }

  /**
   * Open the modal.
   * @param {string[]} [suggested]  Extra tags (e.g. from AI) merged after the existing ones.
   * @param {string}   [filePath]   A file in the Explorer; defaults to the open file.
   */
  async function show(suggested = [], filePath = null) {
    const editor = document.getElementById('mdEditor');
    if (!editor || !_overlay || !_input) return;

    // A file other than the open one is read from (and saved to) disk
    _targetPath = filePath && filePath !== _activePath() ? filePath : null;
    let content = editor.value;
    if (_targetPath) {
      const res = await window.electronAPI?.readFile(_targetPath);
      if (!res) { StatusBar.showToast('Could not read that file.'); _targetPath = null; return; }
      content = res.content;
    }

    const existing = tagsIn(content);
    if (_title) {
      _title.textContent = filePath ? `Tags — ${filePath.split(/[\\/]/).pop()}` : 'Add Tags';
    }
    _input.setTags([...existing, ...suggested]);
    _overlay.classList.remove('hidden');
    _input.focus();
  }

  /**
   * Write `tags` into a file's frontmatter. The open file is changed in the
   * editor (so an unsaved buffer isn't overwritten); any other file on disk.
   * Returns { ok, error? }.
   */
  async function applyTagsToFile(filePath, tags) {
    tags = tags.map(t => t.trim()).filter(Boolean).slice(0, 5);
    if (filePath === _activePath()) {
      const editor = document.getElementById('mdEditor');
      const next = _applyTags(editor.value, tags);
      if (next !== editor.value) EditorCore.setEditorContentNative(next);
      return { ok: true };
    }
    const res = await window.electronAPI?.readFile(filePath);
    if (!res) return { ok: false, error: 'Could not read the file.' };
    const next = _applyTags(res.content, tags);
    if (next === res.content) return { ok: true };
    return await window.electronAPI?.writeFile(filePath, next) ?? { ok: false, error: 'Write failed.' };
  }

  async function _save() {
    const editor = document.getElementById('mdEditor');
    if (!editor) { _hide(); return; }

    const tags       = _input.getTags();

    if (_targetPath) {
      const path = _targetPath;
      const result = await applyTagsToFile(path, tags);
      _hide();
      if (!result?.ok) { StatusBar.showToast(result?.error || 'Could not save tags.'); return; }
      // Refresh so Root-only Explorer shows the new tags
      const folder = sessionStorage.getItem('lastFolder');
      if (folder) FileTreeManager.setActiveFolder(folder);
      return;
    }

    const oldContent = editor.value;
    const newContent = _applyTags(oldContent, tags);
    if (newContent !== oldContent) {
      // The tags line always lives in frontmatter (it must, to be recognized
      // as YAML frontmatter at all) — but that shouldn't yank the user's
      // cursor to the top of the file. Everything after the frontmatter
      // block (the "body") is untouched by _applyTags, so shift the caret by
      // however much the frontmatter's length changed, keeping it at the
      // same spot in the body rather than wherever setEditorContentNative
      // leaves it (end of the inserted text, as a side effect of the
      // whole-document replace).
      const cursorPos    = editor.selectionStart;
      const oldParsed    = _splitFrontmatter(oldContent);
      const oldBody      = oldParsed ? oldParsed.bodyLines.join('\n') : oldContent;
      const oldPrefixLen = oldContent.length - oldBody.length;
      const newPrefixLen = newContent.length - oldBody.length;

      EditorCore.setEditorContentNative(newContent);

      const newCursor = cursorPos >= oldPrefixLen
        ? cursorPos + (newPrefixLen - oldPrefixLen)
        : newPrefixLen; // cursor was inside the old frontmatter — land at body start
      editor.setSelectionRange(newCursor, newCursor);
    }
    _hide();
  }

  _saveBtn?.addEventListener('click', _save);
  _closeBtn?.addEventListener('click', _hide);
  // Enter in an empty box saves (TagInput onSubmit); Escape closes
  _overlay?.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_overlay.classList.contains('hidden')) { e.preventDefault(); _hide(); }
  });
  _overlay?.addEventListener('click', e => { if (e.target === _overlay) _hide(); });

  return { show, tagsIn, applyTagsToFile };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TagModal };
}
