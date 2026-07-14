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
  const _input    = document.getElementById('tagModalInput');
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

  function _hide() {
    _overlay?.classList.add('hidden');
  }

  function show() {
    const editor = document.getElementById('mdEditor');
    if (!editor || !_overlay || !_input) return;

    const parsed   = _splitFrontmatter(editor.value);
    const existing = parsed ? _getExistingTags(parsed.fmLines) : [];
    _input.value = existing.join(', ');
    _overlay.classList.remove('hidden');
    _input.focus();
    _input.select();
  }

  function _save() {
    const editor = document.getElementById('mdEditor');
    if (!editor) { _hide(); return; }

    const tags       = _input.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);
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
  _input?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); _save(); }
    if (e.key === 'Escape') { e.preventDefault(); _hide(); }
  });
  _overlay?.addEventListener('click', e => { if (e.target === _overlay) _hide(); });

  return { show };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TagModal };
}
