/**
 * aiActions.js — Shared "AI action" layer for one-shot AI edits.
 *
 * Every one-click AI feature (editor right-click ✨ AI, Ctrl+K, the toolbar
 * ✨ AI menu, and later Quick Edit) is a config entry in ACTIONS:
 *
 *   { id, label, scope, apply, prompt?, chatPrefill?, local? }
 *     scope  — 'selection' (selected text, or the paragraph at the caret)
 *              'document'  (the whole file)
 *     apply  — 'replace'     (diff with Accept/Reject, then swap the range)
 *              'insert-top'  (preview with Accept/Reject, then insert below the title)
 *              'show-only'   (plain answer, document untouched)
 *              'suggestions' (proofread list, each applied individually)
 *              'tags'        (suggested tags handed to the Add Tags dialog)
 *     prompt — instruction sent to the model.
 *     chatPrefill — instead of calling the model, put this text in the AI
 *              Assistant's input so the user finishes the request in their
 *              own words (Translate…, Custom prompt…).
 *     local  — (text) => string; computed without the model (e.g. the TOC).
 *
 * run(id) captures the range, asks the model, and shows the result as a turn
 * in the AI Assistant (ChatPanel.beginActionTurn/endActionTurn). Accepting
 * applies the edit through EditorCore.replaceRangeNative so Ctrl+Z undoes it
 * natively.
 *
 * Loaded as a plain <script> tag (no bundler); exposes window.AIActions.
 * The pure helpers are exported via CommonJS for Jest.
 */

const AIActions = (() => {

  const ACTIONS = [
    // ── Selection actions (editor right-click → ✨ AI) ──────────────────
    { id: 'fix-grammar',  label: 'Fix grammar & spelling', scope: 'selection', apply: 'replace',
      prompt: 'Fix grammar, spelling and punctuation. Change nothing else.' },
    { id: 'improve',      label: 'Improve writing',        scope: 'selection', apply: 'replace',
      prompt: 'Improve clarity and flow while keeping the meaning, voice and length roughly the same.' },
    { id: 'shorten',      label: 'Make shorter',           scope: 'selection', apply: 'replace',
      prompt: 'Make this more concise. Keep every key point.' },
    { id: 'expand',       label: 'Make longer',            scope: 'selection', apply: 'replace',
      prompt: 'Expand this with more detail and explanation, in the same style.' },
    { id: 'simplify',     label: 'Simplify language',      scope: 'selection', apply: 'replace',
      prompt: 'Rewrite in plain, simple language that a non-expert can follow.' },
    { id: 'tone-formal',  label: 'Tone: formal',           scope: 'selection', apply: 'replace',
      prompt: 'Rewrite in a formal, professional tone.' },
    { id: 'tone-casual',  label: 'Tone: casual',           scope: 'selection', apply: 'replace',
      prompt: 'Rewrite in a friendly, casual tone.' },
    { id: 'translate',    label: 'Translate…',             scope: 'selection',
      chatPrefill: 'Translate this into ' },
    { id: 'explain',      label: 'Explain',                scope: 'selection', apply: 'show-only',
      prompt: 'Explain what this text means in a few short sentences.' },
    { id: 'custom',       label: 'Custom prompt…',         scope: 'selection',
      chatPrefill: '' },

    // ── Document actions (toolbar ✨ AI) ─────────────
    { id: 'doc-summary',  label: 'Summarize (TL;DR at top)', scope: 'document', apply: 'insert-top',
      prompt: 'Write a TL;DR of this document in 1–3 sentences. Output ONLY a single Markdown ' +
              'blockquote that starts with "> **TL;DR:** ".' },
    { id: 'doc-toc',      label: 'Generate table of contents', scope: 'document', apply: 'insert-top',
      local: text => buildToc(text) },
    { id: 'doc-format',   label: 'Fix Markdown formatting', scope: 'document', apply: 'replace',
      prompt: 'Fix Markdown formatting ONLY — do not change any wording. Use one H1 and no skipped ' +
              'heading levels, consistent list markers and indentation, a blank line around headings, ' +
              'lists, tables and code blocks, a language on code fences where it is obvious, and ' +
              'valid table syntax.' },
    { id: 'doc-proofread', label: 'Proofread', scope: 'document', apply: 'suggestions',
      prompt: 'Proofread this document for spelling, grammar, punctuation and clarity problems.' },
    { id: 'doc-tags',     label: 'Suggest tags', scope: 'document', apply: 'tags',
      prompt: 'Suggest up to 5 short, lowercase topic tags for this document.' },
    { id: 'doc-simplify', label: 'Simplify for readability', scope: 'document', apply: 'replace',
      prompt: 'Rewrite the prose in plain, simple language with shorter sentences. Keep every ' +
              'heading, list, table, link and code block, and keep all facts.' },
  ];

  const CONTEXT_LINES   = 20;      // lines of surrounding context sent each side
  const DIFF_MAX_TOKENS = 1500;    // above this, skip the word diff (O(n·m))
  const DIFF_MAX_LINES  = 4000;    // same guard for the line diff
  const DOC_MAX_CHARS   = 80000;   // ≈ 20k tokens — keeps document actions inside every model's window
  const MAX_SUGGESTIONS = 30;

  let _deps = {};
  let _job  = null; // see run()

  /* ═══════════════════════════════════════════════════════════════════
     Pure helpers (no DOM)
     ═══════════════════════════════════════════════════════════════════ */

  function getAction(id) {
    return ACTIONS.find(a => a.id === id) || null;
  }

  function actionsFor(scope) {
    return ACTIONS.filter(a => a.scope === scope);
  }

  /**
   * Range to act on: the selection if there is one, otherwise the paragraph
   * (run of non-blank lines) around the caret. Returns null on a blank line.
   */
  function resolveRange(text, selStart, selEnd) {
    if (selStart !== selEnd) return { start: selStart, end: selEnd };

    const lines = text.split('\n');
    let offset = 0, idx = 0;
    for (; idx < lines.length; idx++) {
      if (selStart <= offset + lines[idx].length) break;
      offset += lines[idx].length + 1;
    }
    if (idx >= lines.length || !lines[idx].trim()) return null;

    let first = idx, last = idx;
    while (first > 0 && lines[first - 1].trim()) first--;
    while (last < lines.length - 1 && lines[last + 1].trim()) last++;

    const start = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
    const end   = start + lines.slice(first, last + 1).join('\n').length;
    return { start, end };
  }

  /**
   * Offset where "top of document" content goes: after YAML frontmatter and
   * the first H1 (if the document opens with one), skipping blank lines.
   */
  function insertionPoint(text) {
    const lines = text.split('\n');
    let i = 0;
    if (lines[0] && lines[0].trim() === '---') {
      const close = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
      if (close !== -1) i = close + 1;
    }
    while (i < lines.length && !lines[i].trim()) i++;
    if (i < lines.length && /^#\s/.test(lines[i])) {
      i++;
      while (i < lines.length && !lines[i].trim()) i++;
    }
    return Math.min(text.length, lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0));
  }

  /** Wrap a block so it sits on its own with a blank line on each side. */
  function padBlock(text, block, at) {
    const before = text.slice(0, at);
    const after  = text.slice(at);
    const lead   = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail  = !after  ? '\n' : after.startsWith('\n') ? '\n' : '\n\n';
    return lead + block.trim() + trail;
  }

  /** GitHub-style slug, matching MarkdownRenderer's heading ids. */
  function _slug(raw, seen) {
    let s = raw
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim().toLowerCase()
      .replace(/[^\wÀ-￿\- ]/g, '')
      .trim().replace(/\s+/g, '-') || 'section';
    const n = seen.get(s) || 0;
    seen.set(s, n + 1);
    return n === 0 ? s : `${s}-${n}`;
  }

  /** Markdown TOC for H2–H4 (H1 is the title), ignoring fenced code. */
  function buildToc(text) {
    const seen = new Map();
    const items = [];
    let fence = null;
    for (const line of text.split('\n')) {
      const f = line.match(/^\s*(```|~~~)/);
      if (f) { fence = fence === f[1] ? null : (fence || f[1]); continue; }
      if (fence) continue;
      const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!h) continue;
      const id = _slug(h[2], seen);          // count every heading so suffixes match the renderer
      const level = h[1].length;
      if (level < 2 || level > 4 || /^table of contents$/i.test(h[2].trim())) continue;
      const label = h[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      items.push(`${'  '.repeat(level - 2)}- [${label}](#${id})`);
    }
    return items.length ? `## Table of Contents\n\n${items.join('\n')}` : '';
  }

  function _outputFormat(action) {
    const doc = action.scope === 'document';
    switch (action.apply) {
      case 'show-only':
        return ['Reply as short plain text. Do not rewrite the text.'];
      case 'insert-top':
        return ['Reply with ONLY the Markdown to insert. No explanations, no code fences.'];
      case 'tags':
        return ['Reply with ONLY a comma-separated list of tags, e.g. "api, auth, design". Nothing else.'];
      case 'suggestions':
        return [
          'Reply with ONLY a JSON array (no code fences, no prose), at most ' + MAX_SUGGESTIONS + ' items:',
          '[{"original": "exact text copied from the document", "suggestion": "corrected text", "reason": "short reason"}]',
          '- "original" MUST be copied verbatim from the document and be short (a phrase or one sentence).',
          '- Reply [] if there is nothing to fix.',
        ];
      default:
        return [
          'Your ENTIRE response MUST be:',
          '<BLOCK_EDIT>',
          doc ? '[the complete revised document — every section, not only the changed parts]'
              : '[replacement for the selected text only]',
          '</BLOCK_EDIT>',
          '- Preserve Markdown syntax (headings, lists, links, code) unless told otherwise.',
          '- No explanations, no code fences around the result.',
        ];
    }
  }

  /** System + user messages for a one-shot action on text[start, end). */
  function buildActionMessages(action, { text, start, end, filename }) {
    const name = filename || 'untitled.md';
    let body;

    if (action.scope === 'document') {
      body = [
        'You are a writing assistant embedded in a Markdown editor called MoilStack .md.',
        `The user is working on "${name}". The full document follows.`,
        '',
        '=== DOCUMENT ===',
        text,
        '=== END DOCUMENT ===',
      ];
    } else {
      const before = text.slice(0, start).split('\n').slice(-CONTEXT_LINES).join('\n');
      const after  = text.slice(end).split('\n').slice(0, CONTEXT_LINES).join('\n');
      body = [
        'You are a writing assistant embedded in a Markdown editor called MoilStack .md.',
        `The user is editing "${name}" and selected a passage.`,
        'Surrounding context is given for understanding only — never repeat or edit it.',
        '',
        ...(before.trim() ? ['=== CONTEXT BEFORE ===', before, '=== END CONTEXT BEFORE ===', ''] : []),
        '=== SELECTED TEXT ===',
        text.slice(start, end),
        '=== END SELECTED TEXT ===',
        ...(after.trim() ? ['', '=== CONTEXT AFTER ===', after, '=== END CONTEXT AFTER ==='] : []),
      ];
    }

    const system = [...body, '', '=== OUTPUT FORMAT — OBEY EXACTLY ===', ..._outputFormat(action)].join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user',   content: action.prompt },
    ];
  }

  function _stripFence(s) {
    const t = s.trim();
    const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
    return m ? m[1] : t;
  }

  /** Pull the result out of a model response for the given apply mode. */
  function extractResult(response, apply) {
    const raw = response || '';
    if (apply === 'show-only' || apply === 'insert-top') return _stripFence(raw);
    if (apply === 'tags') return parseTags(raw);
    if (apply === 'suggestions') return parseSuggestions(raw);
    const tag = raw.match(/<(BLOCK_EDIT|DOC_EDIT)>\n?([\s\S]*?)\n?<\/\1>/);
    if (tag) return tag[2];
    // Small models sometimes skip the tags — fall back to the bare reply.
    return _stripFence(raw);
  }

  /** "api, Auth,#design" → ['api', 'auth', 'design'] (max 5, deduped). */
  function parseTags(raw) {
    const tags = _stripFence(raw).split(/[,\n]/)
      .map(t => t.trim().replace(/^[-*#"'\s]+|["'.\s]+$/g, '').toLowerCase().replace(/\s+/g, '-'))
      .filter(t => t && t.length <= 30);
    return [...new Set(tags)].slice(0, 5);
  }

  /** Parse the proofread JSON array, tolerating fences and stray prose. */
  function parseSuggestions(raw) {
    const s = _stripFence(raw);
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a === -1 || b <= a) throw new Error('The model did not return a list of suggestions. Try again or use a larger model.');
    let list;
    try { list = JSON.parse(s.slice(a, b + 1)); }
    catch { throw new Error('Could not read the suggestions the model returned. Try again.'); }
    return (Array.isArray(list) ? list : [])
      .filter(x => x && typeof x.original === 'string' && typeof x.suggestion === 'string'
        && x.original && x.original !== x.suggestion)
      .slice(0, MAX_SUGGESTIONS)
      .map(x => ({ original: x.original, suggestion: x.suggestion, reason: String(x.reason || '') }));
  }

  /** Keep the original's leading/trailing whitespace so edits don't eat blank lines. */
  function matchWhitespace(original, replacement) {
    const lead  = original.match(/^\s*/)[0];
    const trail = original.match(/\s*$/)[0];
    return lead + replacement.trim() + trail;
  }

  /** LCS diff of two token arrays → merged [{ type: 'same'|'del'|'add', text }]. */
  function _diff(A, B, join) {
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    const push = (type, t) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += join + t;
      else out.push({ type, text: t });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j])                     { push('same', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
      else                                   push('add', B[j++]);
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('add', B[j++]);
    return out;
  }

  /**
   * Word-level diff: [{ type, text }]. Returns null when the inputs are too
   * large for the O(n·m) table.
   */
  function diffWords(a, b) {
    const A = a.split(/(\s+)/).filter(Boolean);
    const B = b.split(/(\s+)/).filter(Boolean);
    if (A.length > DIFF_MAX_TOKENS || B.length > DIFF_MAX_TOKENS) return null;
    return _diff(A, B, '');
  }

  /**
   * Line-level diff for whole documents: [{ type, lines: string[] }].
   * Returns null when the documents are too large.
   */
  function diffLines(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    if (A.length > DIFF_MAX_LINES || B.length > DIFF_MAX_LINES) return null;
    return _diff(A, B, '\n').map(p => ({ type: p.type, lines: p.text.split('\n') }));
  }

  /* ═══════════════════════════════════════════════════════════════════
     Result rendering (inside the AI Assistant bubble)
     ═══════════════════════════════════════════════════════════════════ */

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _lineLabel(text, start, end) {
    const a = text.slice(0, start).split('\n').length;
    const b = a + text.slice(start, end).replace(/\n$/, '').split('\n').length - 1;
    return a === b ? `Line ${a}` : `Lines ${a}–${b}`;
  }

  /** Replace the AI bubble's content for the current job. */
  function _show(html) {
    const b = _job.turn.bubbleEl;
    b.classList.remove('bubble--waiting');
    b.innerHTML = `<div class="ai-chat-result">${html}</div>`;
    ChatPanel.scrollToBottom();
  }

  function _actions(buttons) {
    return `<div class="ai-card__actions">${buttons}</div>`;
  }

  const BTN_RETRY  = '<button class="ai-card__btn" data-ai-card="retry" title="Try again">↻ Retry</button>';
  const BTN_REJECT = '<button class="ai-card__btn" data-ai-card="reject">Reject</button>';
  const BTN_ACCEPT = '<button class="ai-card__btn ai-card__btn--primary" data-ai-card="accept">Accept</button>';

  function _renderDocDiff(original, result) {
    const parts = diffLines(original, result);
    if (!parts) {
      return `<div class="ai-card__diff">${_esc(result)}</div>`;
    }
    const changed = parts.filter(p => p.type !== 'same');
    if (!changed.length) return '<div class="ai-card__note">No changes — the document already looks good.</div>';

    const add = changed.filter(p => p.type === 'add').reduce((n, p) => n + p.lines.length, 0);
    const del = changed.filter(p => p.type === 'del').reduce((n, p) => n + p.lines.length, 0);
    const line = (cls, sign, l) => `<div class="ai-line${cls}"><span>${sign}</span>${_esc(l) || ' '}</div>`;
    // Show changed lines with one line of context; collapse long unchanged runs.
    const rows = parts.map((p, k) => {
      if (p.type !== 'same') {
        return p.lines.map(l => line(` ai-line--${p.type}`, p.type === 'add' ? '+' : '−', l)).join('');
      }
      const ls = p.lines;
      const head = k > 0 ? ls.slice(0, 1) : [];
      const tail = k < parts.length - 1 ? ls.slice(-1) : [];
      if (ls.length <= head.length + tail.length + 1) return ls.map(l => line('', ' ', l)).join('');
      return [...head.map(l => line('', ' ', l)),
              `<div class="ai-line ai-line--gap">⋯ ${ls.length - head.length - tail.length} unchanged lines</div>`,
              ...tail.map(l => line('', ' ', l))].join('');
    }).join('');
    return `<div class="ai-card__stat"><span class="ai-diff--add">+${add}</span> <span class="ai-diff--del-n">−${del}</span> lines</div>
      <div class="ai-card__diff ai-card__diff--lines">${rows}</div>`;
  }

  function _renderResult() {
    const { action, original, result } = _job;

    if (action.apply === 'show-only') {
      // A plain chat reply with the chat's own Copy button.
      const { row, bubbleEl } = _job.turn;
      bubbleEl.classList.remove('bubble--waiting');
      bubbleEl.textContent = result;
      row.dataset.aiText = result;
      row.insertAdjacentHTML('beforeend',
        '<div class="bubble-actions"><button class="bubble-action-btn copy-btn">Copy</button></div>');
      return;
    }

    if (action.apply === 'insert-top') {
      return _show(`<div class="ai-card__note">Will be inserted below the title:</div>
        <div class="ai-card__diff"><span class="ai-diff--add">${_esc(result)}</span></div>` +
        _actions((action.local ? '' : BTN_RETRY) + BTN_REJECT + BTN_ACCEPT));
    }

    if (action.apply === 'tags') {
      return _show(`<div class="ai-card__note">Suggested tags:</div>
        <div class="ai-card__tags">${result.map(t => `<span class="ai-tag">${_esc(t)}</span>`).join('')}</div>` +
        _actions(BTN_RETRY + BTN_REJECT +
          '<button class="ai-card__btn ai-card__btn--primary" data-ai-card="accept">Review & add…</button>'));
    }

    if (action.apply === 'suggestions') {
      if (!result.length) {
        return _show('<div class="ai-card__note">✓ No problems found.</div>' +
          _actions('<button class="ai-card__btn ai-card__btn--primary" data-ai-card="reject">Done</button>'));
      }
      const items = result.map((s, i) => `
        <div class="ai-sugg${s.done ? ' ai-sugg--done' : ''}" data-index="${i}">
          <div class="ai-sugg__text"><span class="ai-diff--del">${_esc(s.original)}</span> → <span class="ai-diff--add">${_esc(s.suggestion)}</span></div>
          ${s.reason ? `<div class="ai-sugg__reason">${_esc(s.reason)}</div>` : ''}
          <div class="ai-sugg__btns">${s.done
            ? `<span class="ai-sugg__state">${s.done === 'applied' ? '✓ Applied' : s.done === 'missing' ? 'Text not found' : 'Skipped'}</span>`
            : `<button class="ai-card__btn" data-ai-card="skip" data-index="${i}">Skip</button>
               <button class="ai-card__btn ai-card__btn--primary" data-ai-card="apply-one" data-index="${i}">Apply</button>`}
          </div>
        </div>`).join('');
      const left = result.filter(s => !s.done).length;
      return _show(`<div class="ai-card__stat">${result.length} suggestion${result.length === 1 ? '' : 's'}${left !== result.length ? ` · ${left} left` : ''}</div>
        <div class="ai-card__list">${items}</div>` +
        _actions(BTN_RETRY + '<button class="ai-card__btn" data-ai-card="reject">Close</button>' +
          (left ? '<button class="ai-card__btn ai-card__btn--primary" data-ai-card="apply-all">Apply all</button>' : '')));
    }

    // replace
    let body;
    if (action.scope === 'document') {
      body = _renderDocDiff(original, result);
    } else {
      const parts = diffWords(original, result);
      body = parts
        ? `<div class="ai-card__diff">${parts.map(p =>
            p.type === 'same' ? _esc(p.text)
              : `<span class="ai-diff--${p.type}">${_esc(p.text)}</span>`).join('')}</div>`
        : `<div class="ai-card__diff"><span class="ai-diff--del">${_esc(original)}</span>\n\n<span class="ai-diff--add">${_esc(result)}</span></div>`;
    }
    _show(body + _actions(BTN_RETRY + BTN_REJECT + BTN_ACCEPT));
  }

  function _renderError(msg) {
    _show(`<div class="ai-card__error">⚠ ${_esc(msg)}</div>` + _actions(
      (_job.action.local ? '' : BTN_RETRY) +
      '<button class="ai-card__btn ai-card__btn--primary" data-ai-card="reject">Close</button>'));
  }

  /**
   * Finish the current job: remove the bubble's buttons and leave a status
   * line (e.g. "✓ Applied").
   */
  function _close(status = '') {
    const b = _job.turn.bubbleEl;
    if (_job.action.apply === 'suggestions' && Array.isArray(_job.result) && _job.result.every(x => x.done)) status = 'Done';
    b.querySelectorAll('.ai-card__actions, .ai-sugg__btns button').forEach(n => n.remove());
    if (status) b.insertAdjacentHTML('beforeend', `<div class="ai-chat-status">${_esc(status)}</div>`);
    _job = null;
  }

  function _onBubbleClick(e) {
    const btn = e.target.closest('[data-ai-card]');
    if (!btn) return;
    const act = btn.dataset.aiCard;
    if (act === 'accept') _accept();
    else if (act === 'reject') _close(_job.action.apply === 'suggestions' ? 'Done' : 'Discarded');
    else if (act === 'retry') _retry();
    else if (act === 'apply-one') _applySuggestion(+btn.dataset.index);
    else if (act === 'skip') { _job.result[+btn.dataset.index].done = 'skipped'; _renderResult(); }
    else if (act === 'apply-all') {
      _job.result.forEach((s, i) => { if (!s.done) _applySuggestion(i, false); });
      _renderResult();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Flow
     ═══════════════════════════════════════════════════════════════════ */

  async function _request() {
    if (!_job || _job.busy) return;
    const job = _job;

    if (job.action.local) {
      job.result = job.action.local(job.snapshot);
      if (!job.result) _renderError('Nothing to generate — add some ## headings first.');
      else _renderResult();
      return ChatPanel.endActionTurn();
    }

    const model = typeof AIConfigManager !== 'undefined' ? AIConfigManager.getActiveModel() : null;
    const problem = !model ? 'No AI model configured. Open Settings (⚙) to add one.'
      : AIConfigManager.validateModel(model).length > 0 ? 'The selected model is not fully configured. Update it in Settings.'
      : null;
    if (problem) {
      _renderError(problem);
      return ChatPanel.endActionTurn();
    }

    job.busy = true;
    job.result = null;

    const messages = buildActionMessages(job.action, {
      text: job.snapshot, start: job.start, end: job.end, filename: _deps.getFilename(),
    });

    try {
      const response = await aiService.getResponse(messages, model);
      if (_job !== job) return; // replaced while waiting
      let result = extractResult(response, job.action.apply);
      if (job.action.apply === 'tags' && !result.length) throw new Error('The model did not suggest any tags.');
      if (typeof result === 'string' && !result.trim()) throw new Error('The model returned an empty response.');
      if (job.action.apply === 'replace') {
        result = job.action.scope === 'document'
          ? result.replace(/\s*$/, '') + job.original.match(/\s*$/)[0]
          : matchWhitespace(job.original, result);
      }
      job.result = result;
      _renderResult();
      ChatPanel.endActionTurn(..._historyTurn(job));
      if (job.action.apply === 'show-only') _job = null;
    } catch (err) {
      if (_job === job) _renderError(err.message || String(err));
      ChatPanel.endActionTurn();
    } finally {
      job.busy = false;
    }
  }

  /**
   * Run an editor edit even while the editor pane is hidden (Preview mode):
   * replaceRangeNative() needs a focusable textarea to record the change in
   * the native undo history. Same approach as QuickEdit.applyPatch().
   */
  function _withEditorVisible(fn) {
    const pane = document.getElementById('editorPane');
    const wasHidden = pane && pane.classList.contains('hidden');
    if (wasHidden) pane.classList.remove('hidden');
    try { fn(); }
    finally { if (wasHidden) pane.classList.add('hidden'); }
  }

  function _replace(start, end, text) {
    _withEditorVisible(() => _deps.replaceRangeNative(start, end, text));
    _deps.updateHighlight();
    _deps.triggerUpdate();
  }

  function _accept() {
    const job = _job;
    const editor = _deps.getEditor();
    if (!job || job.result == null || !editor) return;
    const { action } = job;

    if (action.apply === 'tags') {
      const tags = job.result;
      _close('✓ Sent to Add Tags');
      if (typeof TagModal !== 'undefined') TagModal.show(tags);
      return;
    }

    if (action.apply === 'insert-top') {
      const at = insertionPoint(editor.value);
      _replace(at, at, padBlock(editor.value, job.result, at));
      return _close('✓ Inserted');
    }

    if (action.scope === 'document') {
      if (editor.value !== job.snapshot) {
        return _renderError('The document changed while AI was working. Run the action again.');
      }
      _withEditorVisible(() => _deps.setEditorContentNative(job.result));
      return _close('✓ Applied');
    }

    // The user may have typed elsewhere while the model was answering —
    // relocate the original passage rather than overwrite the wrong range.
    let { start, end } = job;
    if (editor.value.slice(start, end) !== job.original) {
      const found = editor.value.indexOf(job.original);
      if (found === -1) return _renderError('The selected text changed while AI was working. Select it again and retry.');
      start = found; end = found + job.original.length;
    }

    _replace(start, end, job.result);
    _close('✓ Applied');
  }

  /** Apply one proofread suggestion wherever its original text now is. */
  function _applySuggestion(i, rerender = true) {
    const s = _job?.result?.[i];
    const editor = _deps.getEditor();
    if (!s || s.done || !editor) return;
    const at = editor.value.indexOf(s.original);
    if (at === -1) s.done = 'missing';
    else {
      _replace(at, at + s.original.length, s.suggestion);
      s.done = 'applied';
    }
    if (rerender) _renderResult();
  }

  /**
   * Run an action on the current selection / caret paragraph, or the whole
   * document for document-scope actions. The result appears in the AI
   * Assistant panel.
   * @param {string} id
   * @param {{start:number, end:number}} [range]  Explicit source range (e.g. from a
   *   Preview Quick Edit block); defaults to the editor selection / caret paragraph.
   */
  function run(id, range = null) {
    const action = getAction(id);
    const editor = _deps.getEditor && _deps.getEditor();
    if (!action || !editor || typeof ChatPanel === 'undefined') return;
    if (_job?.busy || ChatPanel.isBusy()) return;
    if (_job) _close('Dismissed');

    const text  = editor.value;
    const isDoc = action.scope === 'document';
    if (isDoc) range = { start: 0, end: text.length };
    else if (!range) range = resolveRange(text, editor.selectionStart, editor.selectionEnd);

    // Actions that need the user's own words go through the chat input,
    // scoped to the selection (or the paragraph at the caret).
    if (action.chatPrefill !== undefined) {
      // The chat reads the editor selection; a hidden textarea doesn't keep one.
      if (range) _withEditorVisible(() => editor.setSelectionRange(range.start, range.end));
      ChatPanel.prefillInput(action.chatPrefill);
      return;
    }

    const original = range ? text.slice(range.start, range.end) : '';
    const problem = !original.trim()
      ? (isDoc ? 'The document is empty.' : 'Select some text first (or place the cursor inside a paragraph).')
      : isDoc && !action.local && text.length > DOC_MAX_CHARS
        ? `This document is too large for a whole-document action (limit ${DOC_MAX_CHARS / 1000}k characters). Select a part and use right-click → ✨ AI instead.`
        : null;
    if (problem) {
      if (typeof StatusBar !== 'undefined') StatusBar.showToast(problem);
      return;
    }

    _job = {
      action,
      snapshot: text,
      start:    range.start,
      end:      range.end,
      original,
      label:    isDoc ? (_deps.getFilename() || 'Document') : _lineLabel(text, range.start, range.end),
      result:   null,
      busy:     false,
      turn:     null,
    };
    _startTurn(_job);
    _request();
  }

  /** [user, assistant] summary of a finished action for the chat history. */
  function _historyTurn(job) {
    const task = job.action.prompt;
    const r = job.result;
    if (job.action.scope === 'document') {
      const what = job.action.apply === 'tags'        ? `Suggested tags: ${r.join(', ')}`
                 : job.action.apply === 'suggestions' ? `Proofread suggestions:\n${r.map(x => `- "${x.original}" → "${x.suggestion}"`).join('\n')}`
                 : job.action.apply === 'insert-top'  ? `Proposed insertion at the top:\n${r}`
                 : '[Proposed a full-document edit]';
      return [`${task} (whole document "${job.label}")`, what];
    }
    return [`${task}\n\nSelected text (${job.label}):\n${job.original}`,
            job.action.apply === 'show-only' ? r : `[Suggested replacement for ${job.label}]\n${r}`];
  }

  /** Add the user + AI bubbles for a job and wire the AI bubble's buttons. */
  function _startTurn(job) {
    const preview = job.original.trim().replace(/\s+/g, ' ');
    job.turn = ChatPanel.beginActionTurn(job.action.scope === 'document'
      ? `✨ ${job.action.label} · ${job.label}`
      : `✨ ${job.action.label} · ${job.label}\n“${preview.length > 80 ? preview.slice(0, 80) + '…' : preview}”`);
    const turn = job.turn;
    turn.row.addEventListener('click', e => { if (_job && _job.turn === turn) _onBubbleClick(e); });
  }

  /** Retry: close this bubble and ask again in a fresh turn. */
  function _retry() {
    const old = _job;
    if (!old || old.busy || ChatPanel.isBusy()) return;
    _close('Retried');
    _job = { ...old, turn: null, result: null, busy: false, snapshot: _deps.getEditor().value };
    _startTurn(_job);
    _request();
  }

  /** Editor toolbar "✨ AI" button → dropdown of document actions. */
  function _initToolbarMenu() {
    const btn  = document.getElementById('btn-ai-actions');
    const menu = document.getElementById('aiToolbarMenu');
    if (!btn || !menu) return;

    actionsFor('document').forEach(a => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ctx-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = a.label;
      item.addEventListener('click', () => {
        hide();
        run(a.id);
      });
      menu.appendChild(item);
    });

    function hide() {
      menu.classList.remove('visible');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !menu.classList.contains('visible');
      if (!open) return hide();
      const r = btn.getBoundingClientRect();
      menu.classList.add('visible');
      menu.style.top  = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
      btn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  }

  function init(deps) {
    _deps = deps || {};
    const editor = _deps.getEditor && _deps.getEditor();

    // Ctrl/Cmd+K in the editor → custom prompt on the selection
    editor?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        run('custom');
      }
    });

    _initToolbarMenu();
  }

  return {
    ACTIONS,
    init,
    run,
    getAction,
    actionsFor,
    // pure helpers (exported for tests)
    resolveRange,
    insertionPoint,
    padBlock,
    buildToc,
    buildActionMessages,
    extractResult,
    parseTags,
    parseSuggestions,
    matchWhitespace,
    diffWords,
    diffLines,
  };

})();

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AIActions };
}
