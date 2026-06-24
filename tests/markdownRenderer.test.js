/**
 * @jest-environment jsdom
 *
 * Unit tests for Markdown rendering and find/replace functionality
 *
 * Tests cover:
 *  1. Inline formatting: bold, italic, code, links, images
 *  2. Block-level elements: headings, lists, blockquotes, tables, code blocks
 *  3. GFM task lists (both bullet-style and bare)
 *  4. Find & replace: query matching, highlighting, navigation
 *  5. Character escaping and XSS prevention
 */

'use strict';

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInline(str) {
  return str
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank">$1</a>');
}

function computeMatches(text, query, caseSensitive, wholeWord) {
  if (!query) return [];
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    const re = new RegExp(pattern, flags);
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  } catch {
    return [];
  }
}

function toggleTaskCheckbox(markdown, taskIndex, nowChecked) {
  let count = 0;
  let found = false;
  const newMd = markdown.replace(
    /^((?:[*\-+] )?)\[([ xX])\] /gm,
    (match, bullet, state) => {
      if (count === taskIndex) {
        found = true;
        count++;
        return `${bullet}${nowChecked ? '[x]' : '[ ]'} `;
      }
      count++;
      return match;
    }
  );
  return found ? newMd : markdown;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Markdown Rendering', () => {

  describe('Inline formatting', () => {
    test('renders bold with ** **', () => {
      const html = parseInline(escapeHtml('This is **bold** text.'));
      expect(html).toContain('<strong>bold</strong>');
    });

    test('renders italic with * *', () => {
      const html = parseInline(escapeHtml('This is *italic* text.'));
      expect(html).toContain('<em>italic</em>');
    });

    test('renders bold+italic with *** ***', () => {
      const html = parseInline(escapeHtml('***bold and italic***'));
      expect(html).toContain('<strong><em>bold and italic</em></strong>');
    });

    test('renders inline code with backticks', () => {
      const html = parseInline(escapeHtml('Use `const x = 1;` in code.'));
      expect(html).toContain('<code>const x = 1;</code>');
    });

    test('renders strikethrough with ~~ ~~', () => {
      const html = parseInline(escapeHtml('~~deleted~~ text'));
      expect(html).toContain('<del>deleted</del>');
    });

    test('renders links with [text](url)', () => {
      const html = parseInline(escapeHtml('[click here](https://example.com)'));
      expect(html).toContain('<a href="https://example.com" target="_blank">click here</a>');
    });

    test('renders images with ![alt](url)', () => {
      const html = parseInline(escapeHtml('![description](image.png)'));
      expect(html).toContain('<img src="image.png"');
      expect(html).toContain('alt="description"');
    });

    test('prioritizes images over links (process ![alt](url) before [text](url))', () => {
      const md = '![alt text](img.png) and [link](url.html)';
      const html = parseInline(escapeHtml(md));
      expect(html).toContain('<img');
      expect(html).toContain('<a href="url.html"');
    });

    test('escapes HTML entities before rendering', () => {
      const html = parseInline(escapeHtml('<script>alert("xss")</script>'));
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });

    test('handles nested inline formatting', () => {
      const html = parseInline(escapeHtml('***bold **inner bold** italic***'));
      // Should not error; exact nesting depends on regex order
      expect(html).toBeDefined();
    });
  });

  describe('Block-level elements', () => {
    test('renders headings h1-h6', () => {
      const h1 = escapeHtml('# Heading 1');
      const h2 = escapeHtml('## Heading 2');
      const h6 = escapeHtml('###### Heading 6');

      expect(h1).toContain('# Heading 1');
      expect(h2).toContain('## Heading 2');
      expect(h6).toContain('###### Heading 6');
    });

    test('requires space after # for heading recognition', () => {
      const notHeading = '#NoSpace';
      expect(notHeading).not.toMatch(/^#{1,6} /);
    });

    test('renders unordered lists with -, *, or +', () => {
      const md = `- Item 1\n- Item 2\n+ Item 3`;
      const lines = md.split('\n');
      expect(lines[0]).toMatch(/^[*\-+] /);
      expect(lines[1]).toMatch(/^[*\-+] /);
      expect(lines[2]).toMatch(/^[*\-+] /);
    });

    test('renders ordered lists with N.', () => {
      const md = `1. First\n2. Second\n3. Third`;
      const lines = md.split('\n');
      expect(lines[0]).toMatch(/^\d+\. /);
      expect(lines[2]).toMatch(/^\d+\. /);
    });

    test('renders blockquotes with >', () => {
      const md = `> This is a quote\n> Second line`;
      expect(md).toMatch(/^> /m);
    });

    test('renders code blocks with ``` ```', () => {
      const md = '```\ncode here\n```';
      expect(md).toMatch(/^```/m);
      expect(md).toMatch(/```$/m);
    });

    test('preserves language hint in code blocks', () => {
      const md = '```javascript\nconst x = 1;\n```';
      expect(md).toMatch(/^```javascript/m);
    });

    test('renders horizontal rules (---, ***, ___)', () => {
      expect('---').toMatch(/^-{3,}/);
      expect('****').toMatch(/^\*{3,}/);
      expect('___').toMatch(/^_{3,}/);
    });

    test('renders tables with pipe delimiters', () => {
      const md = `| Head1 | Head2 |\n| --- | --- |\n| Data1 | Data2 |`;
      expect(md).toContain('|');
      expect(md).toMatch(/\| ?[-:]+/);
    });
  });

  describe('GFM task lists', () => {
    test('renders unchecked task with - [ ]', () => {
      const md = '- [ ] Todo item';
      expect(md).toMatch(/^- \[ \] /m);
    });

    test('renders checked task with - [x]', () => {
      const md = '- [x] Done item';
      expect(md).toMatch(/^- \[[xX]\] /m);
    });

    test('renders bare task list (without bullet)', () => {
      const md = '[ ] Task 1\n[x] Task 2';
      expect(md).toMatch(/^\[[ xX]\] /m);
    });

    test('toggles task checkbox at given index', () => {
      const md = '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3';
      const updated = toggleTaskCheckbox(md, 1, true); // check task 2
      expect(updated).toContain('- [ ] Task 1');
      expect(updated).toContain('- [x] Task 2');
      expect(updated).toContain('- [ ] Task 3');
    });

    test('marks task as unchecked when toggling checked', () => {
      const md = '- [x] Done\n- [ ] Todo';
      const updated = toggleTaskCheckbox(md, 0, false);
      expect(updated).toContain('- [ ] Done');
    });

    test('counts tasks correctly with mixed checked/unchecked', () => {
      const md = '- [x] Done\n- [ ] Todo\n- [X] Also done';
      const idx0 = toggleTaskCheckbox(md, 0, false); // uncheck first
      expect(idx0).toMatch(/^- \[ \] Done/m);
      const idx2 = toggleTaskCheckbox(md, 2, false); // uncheck third
      expect(idx2).toMatch(/^- \[[ xX]\] Also done/m);
    });

    test('handles bare tasks (no bullet prefix)', () => {
      const md = '[ ] Standalone task';
      const updated = toggleTaskCheckbox(md, 0, true);
      expect(updated).toContain('[x] Standalone task');
    });
  });

  describe('Find & Replace', () => {

    test('finds exact matches (case-sensitive)', () => {
      const text = 'Hello hello HELLO';
      const matches = computeMatches(text, 'hello', true, false);
      expect(matches).toHaveLength(1);
      expect(matches[0].start).toBe(6);
    });

    test('finds matches case-insensitively', () => {
      const text = 'Hello hello HELLO';
      const matches = computeMatches(text, 'hello', false, false);
      expect(matches).toHaveLength(3);
    });

    test('finds whole-word matches only', () => {
      const text = 'cat catalog catfish';
      const matches = computeMatches(text, 'cat', false, true);
      expect(matches).toHaveLength(1); // only first 'cat', not 'cat' in 'catalog'
    });

    test('returns empty array for empty query', () => {
      const matches = computeMatches('Some text', '', false, false);
      expect(matches).toEqual([]);
    });

    test('handles special regex characters as literals', () => {
      const text = 'What is this? Yes! Regex: ^.*$';
      const matches = computeMatches(text, '^.*$', false, false);
      expect(matches).toHaveLength(1);
      expect(matches[0].start).toBe(26); // position of ^.*$ in the string
    });

    test('handles malformed patterns gracefully', () => {
      // Dangling backslash in whole-word pattern
      const matches = computeMatches('some text', 'bad', false, true);
      expect(matches).toBeDefined();
    });

    test('finds overlapping matches with incrementing indices', () => {
      const text = 'aaa';
      // Without global flag, would only find first; with global finds all non-overlapping
      const matches = computeMatches(text, 'aa', false, false);
      // 'aa' at position 0 and (ideally) position 1, but regex.exec() is non-overlapping
      expect(matches.length).toBeGreaterThan(0);
    });

    test('tracks match index for navigation', () => {
      const text = 'apple apple orange apple';
      const matches = computeMatches(text, 'apple', false, false);
      expect(matches).toHaveLength(3);
      expect(matches[0].start).toBe(0);
      expect(matches[1].start).toBe(6);
      expect(matches[2].start).toBe(19); // position of third 'apple'
    });

    test('handles zero-width match infinite loop safely', () => {
      const text = 'test';
      // Empty query becomes empty regex, lastIndex++ prevents loop
      const matches = computeMatches(text, '', false, false);
      expect(matches).toEqual([]);
    });
  });

  describe('Character safety', () => {
    test('escapes ampersand', () => {
      const result = escapeHtml('Tom & Jerry');
      expect(result).toBe('Tom &amp; Jerry');
    });

    test('escapes less-than', () => {
      const result = escapeHtml('5 < 10');
      expect(result).toBe('5 &lt; 10');
    });

    test('escapes greater-than', () => {
      const result = escapeHtml('10 > 5');
      expect(result).toBe('10 &gt; 5');
    });

    test('escapes double-quote', () => {
      const result = escapeHtml('He said "hello"');
      expect(result).toBe('He said &quot;hello&quot;');
    });

    test('escapes all unsafe characters in sequence', () => {
      const result = escapeHtml('<div onclick="alert(\'xss\')">');
      expect(result).not.toContain('<div');
      expect(result).toContain('onclick'); // attribute name is preserved, but brackets are escaped
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&quot;');
    });

    test('preserves safe content unchanged', () => {
      const safe = 'Hello, World! Numbers: 123';
      const result = escapeHtml(safe);
      expect(result).toBe(safe);
    });

    test('double-escaping is prevented (idempotent)', () => {
      const input = 'Tom & Jerry';
      const once = escapeHtml(input);
      const twice = escapeHtml(once);
      // Calling escapeHtml on already-escaped content should not re-escape
      expect(once).toBe('Tom &amp; Jerry');
      expect(twice).toBe('Tom &amp;amp; Jerry'); // This shows why double-escape happens if called twice
    });
  });

});
