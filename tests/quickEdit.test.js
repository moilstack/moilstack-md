/**
 * @jest-environment jsdom
 *
 * Preview quick edit: block source ranges from the renderer + patch helpers.
 */

'use strict';

// katex is a browser global in the app; the renderer only touches it for math.
global.katex = { renderToString: s => s };

const { MarkdownRenderer } = require('../src/renderer/markdownRenderer.js');
const { QuickEdit }        = require('../src/renderer/quickEdit.js');

/** Render `md` and return the top-level blocks as {tag, start, end}. */
function blocks(md) {
  const div = document.createElement('div');
  div.innerHTML = MarkdownRenderer.parseMarkdown(md);
  return Array.from(div.children).map(el => {
    const l = el.hasAttribute('data-line-end') ? el : el.querySelector('[data-line-end]');
    return l && {
      tag:   l.tagName,
      start: +l.getAttribute('data-line'),
      end:   +l.getAttribute('data-line-end'),
    };
  });
}

describe('renderer data-line-end', () => {
  test('single-line and multi-line blocks map to exact source lines', () => {
    const md = ['# Title', '', 'line a', 'line b', '', '- x', '- y', '  - z', '', '> q1', '> q2'].join('\n');
    expect(blocks(md)).toEqual([
      { tag: 'H1',         start: 0, end: 0 },
      { tag: 'P',          start: 2, end: 3 },
      { tag: 'UL',         start: 5, end: 7 },
      { tag: 'BLOCKQUOTE', start: 9, end: 10 },
    ]);
  });

  test('fenced code block spans the fences', () => {
    const md = ['intro', '', '```js', 'a', '', 'b', '```', '', 'after'].join('\n');
    expect(blocks(md)).toEqual([
      { tag: 'P',   start: 0, end: 0 },
      { tag: 'PRE', start: 2, end: 6 },
      { tag: 'P',   start: 8, end: 8 },
    ]);
  });

  test('table spans header through last row; frontmatter shifts lines', () => {
    const md = ['---', 'tags: [a]', '---', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'tail'].join('\n');
    expect(blocks(md)).toEqual([
      { tag: 'TABLE', start: 3, end: 5 },
      { tag: 'P',     start: 7, end: 7 },
    ]);
  });
});

describe('QuickEdit patch helpers', () => {
  const text = 'one\ntwo\nthree\nfour';

  test('lineRange excludes the trailing newline', () => {
    expect(QuickEdit.lineRange(text, 1, 2)).toEqual({ start: 4, end: 13 });
    expect(text.slice(4, 13)).toBe('two\nthree');
    expect(QuickEdit.lineRange(text, 3, 3)).toEqual({ start: 14, end: 18 });
    expect(QuickEdit.lineRange(text, 9, 9)).toBeNull();
  });

  test('blockPatch replaces the block in place', () => {
    const p = QuickEdit.blockPatch(text, 1, 2, 'TWO');
    expect(text.slice(0, p.start) + p.replacement + text.slice(p.end)).toBe('one\nTWO\nfour');
  });

  test('empty replacement removes the block without leaving a gap', () => {
    const apply = (t, s, e) => {
      const p = QuickEdit.blockPatch(t, s, e, '');
      return t.slice(0, p.start) + t.slice(p.end);
    };
    expect(apply(text, 1, 1)).toBe('one\nthree\nfour');
    expect(apply(text, 3, 3)).toBe('one\ntwo\nthree');
    expect(apply('solo', 0, 0)).toBe('');
  });
});
