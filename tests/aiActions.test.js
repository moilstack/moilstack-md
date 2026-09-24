/**
 * AI actions: pure helpers for range resolution, prompt building,
 * response parsing and word diffing.
 */

'use strict';

const { AIActions } = require('../src/renderer/aiActions.js');

describe('resolveRange', () => {
  const text = 'para one\nstill one\n\npara two';

  test('uses the selection when there is one', () => {
    expect(AIActions.resolveRange(text, 2, 6)).toEqual({ start: 2, end: 6 });
  });

  test('expands a caret to its paragraph', () => {
    const r = AIActions.resolveRange(text, 12, 12);
    expect(text.slice(r.start, r.end)).toBe('para one\nstill one');
    const r2 = AIActions.resolveRange(text, text.length, text.length);
    expect(text.slice(r2.start, r2.end)).toBe('para two');
  });

  test('returns null on a blank line', () => {
    expect(AIActions.resolveRange(text, 19, 19)).toBeNull();
  });
});

describe('buildActionMessages', () => {
  test('includes selection, context and the action prompt', () => {
    const action = AIActions.getAction('fix-grammar');
    const text = 'before\nTARGET\nafter';
    const msgs = AIActions.buildActionMessages(action, {
      text, start: 7, end: 13, filename: 'a.md',
    });
    expect(msgs[0].content).toContain('=== SELECTED TEXT ===\nTARGET\n');
    expect(msgs[0].content).toContain('before');
    expect(msgs[0].content).toContain('<BLOCK_EDIT>');
    expect(msgs[1].content).toBe(action.prompt);
  });

  test('input actions prefill the chat instead of prompting the model', () => {
    expect(AIActions.getAction('translate')).toMatchObject({ chatPrefill: 'Translate this into ' });
    expect(AIActions.getAction('custom').prompt).toBeUndefined();
  });

  test('show-only actions do not ask for BLOCK_EDIT', () => {
    const msgs = AIActions.buildActionMessages(AIActions.getAction('explain'), {
      text: 'x', start: 0, end: 1,
    });
    expect(msgs[0].content).not.toContain('<BLOCK_EDIT>');
  });
});

describe('extractResult', () => {
  test('reads BLOCK_EDIT tags', () => {
    expect(AIActions.extractResult('noise <BLOCK_EDIT>\nHello\n</BLOCK_EDIT>', 'replace')).toBe('Hello');
  });

  test('falls back to the bare reply without fences', () => {
    expect(AIActions.extractResult('```md\nHi there\n```', 'replace')).toBe('Hi there');
    expect(AIActions.extractResult('  plain  ', 'replace')).toBe('plain');
  });
});

describe('matchWhitespace', () => {
  test('keeps the original surrounding whitespace', () => {
    expect(AIActions.matchWhitespace('  old text\n\n', 'new text\n')).toBe('  new text\n\n');
  });
});

describe('diffWords', () => {
  test('marks deleted and added words', () => {
    expect(AIActions.diffWords('the cat sat', 'the dog sat')).toEqual([
      { type: 'same', text: 'the ' },
      { type: 'del',  text: 'cat' },
      { type: 'add',  text: 'dog' },
      { type: 'same', text: ' sat' },
    ]);
  });

  test('gives up on very large inputs', () => {
    const big = 'w '.repeat(2000);
    expect(AIActions.diffWords(big, big)).toBeNull();
  });
});

describe('document actions', () => {
  test('actionsFor splits selection and document actions', () => {
    expect(AIActions.actionsFor('selection').every(a => a.scope === 'selection')).toBe(true);
    expect(AIActions.actionsFor('document').map(a => a.id)).toContain('doc-proofread');
  });

  test('insertionPoint skips frontmatter and the H1 title', () => {
    const text = '---\ntags: [a]\n---\n\n# Title\n\nBody';
    expect(text.slice(AIActions.insertionPoint(text))).toBe('Body');
    expect(AIActions.insertionPoint('Body only')).toBe(0);
    expect(AIActions.insertionPoint('# Title')).toBe(7);
  });

  test('padBlock separates the inserted block with blank lines', () => {
    const text = '# T\n\nBody';
    const at = AIActions.insertionPoint(text);
    expect(text.slice(0, at) + AIActions.padBlock(text, '> tl;dr', at) + text.slice(at))
      .toBe('# T\n\n> tl;dr\n\nBody');
    expect('# T' + AIActions.padBlock('# T', 'X', 3)).toBe('# T\n\nX\n');
  });

  test('buildToc lists H2–H4 with renderer-style slugs and skips code', () => {
    const md = '# Title\n## Intro\n```\n## not a heading\n```\n### Set up *fast*\n## Intro';
    expect(AIActions.buildToc(md)).toBe(
      '## Table of Contents\n\n- [Intro](#intro)\n  - [Set up *fast*](#set-up-fast)\n- [Intro](#intro-1)');
    expect(AIActions.buildToc('just text')).toBe('');
  });

  test('document replace prompt asks for the complete document', () => {
    const msgs = AIActions.buildActionMessages(AIActions.getAction('doc-format'), {
      text: '# A', start: 0, end: 3,
    });
    expect(msgs[0].content).toContain('=== DOCUMENT ===\n# A\n');
    expect(msgs[0].content).toContain('complete revised document');
  });

  test('parseTags cleans and limits tags', () => {
    expect(AIActions.parseTags('API, #Auth , "design"\nweb dev, api, a, b, c'))
      .toEqual(['api', 'auth', 'design', 'web-dev', 'a']);
  });

  test('parseSuggestions tolerates fences and drops junk', () => {
    const raw = 'Here you go:\n```json\n[{"original":"teh","suggestion":"the","reason":"typo"},' +
      '{"original":"same","suggestion":"same"},{"foo":1}]\n```';
    expect(AIActions.parseSuggestions(raw)).toEqual([{ original: 'teh', suggestion: 'the', reason: 'typo' }]);
    expect(() => AIActions.parseSuggestions('no list here')).toThrow();
  });

  test('diffLines groups changed lines', () => {
    expect(AIActions.diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'same', lines: ['a'] },
      { type: 'del',  lines: ['b'] },
      { type: 'add',  lines: ['B'] },
      { type: 'same', lines: ['c'] },
    ]);
  });
});
