/**
 * Chat Panel — AI assistant sidebar for MoilStack .md.
 *
 * Loaded as a plain <script> tag (no bundler), so it declares a global
 * `ChatPanel` object. The CommonJS export guard at the bottom makes the
 * same object importable by Jest / Node without modification.
 *
 * Depends on:
 *  - aiService       (global, loaded by aiService.js before this file)
 *  - AIConfigManager (global, loaded by aiConfig.js — accessed only at
 *                     interaction time, well after all scripts have loaded)
 *  - window.electronAPI (Electron preload)
 *  - ChatPanel.init(deps) must be called once from index.js DOMContentLoaded
 */

const ChatPanel = (() => {

  /* ── Injected dependencies (populated by init) ──────────────────── */
  let _deps = {};

  /* ═══════════════════════════════════════════════════════════════════
     Private state
     ═══════════════════════════════════════════════════════════════════ */

  /** Running total of messages shown in the chat status bar. */
  let messageCount = 0;

  /**
   * When true the AI replies conversationally only — <DOC_EDIT> / <BLOCK_EDIT>
   * instructions are omitted from the system prompt so no accidental edits occur.
   * When false the AI may rewrite the document or selected block.
   * Defaults to Ask (safe) mode.
   */
  let isAskMode = true;

  /**
   * Snapshot history of editor content — captured before each AI edit so
   * Restore buttons can revert the document to a known-good state.
   * @type {string[]}
   */
  const chatHistory = [];

  /**
   * Conversation history sent to the AI on each turn.
   * Holds {role, content} objects in the OpenAI messages format.
   * Reset to [] when the user clears the chat.
   * @type {Array<{role: string, content: string}>}
   */
  const conversationHistory = [];

  /**
   * Active line-range selection snapped to full line boundaries.
   * Set by captureEditorSelection() on selectionchange inside the editor.
   * Cleared after a message is sent or when the selection collapses.
   *
   * @type {{ startLine: number, endLine: number,
   *          blockStart: number, blockEnd: number,
   *          blockText: string } | null}
   */
  let currentSelection = null;

  /* ── Token budget constants ─────────────────────────────────────────
     Rough rule: 1 token ≈ 4 characters (English prose).
     ─────────────────────────────────────────────────────────────────── */

  /** Characters per token — conservative estimate used for all budgeting. */
  const CHARS_PER_TOKEN = 4;

  /**
   * Hard cap on file content characters sent to the AI per request.
   * ≈ 25 000 tokens — fits every supported model's context window.
   */
  const MAX_FILE_CHARS = 100_000;

  /**
   * Files larger than this show a warning banner in the chat panel.
   * ≈ 6 250 tokens.
   */
  const LARGE_FILE_WARN_CHARS = 25_000;

  /**
   * Maximum conversation turns kept in history.
   */
  const MAX_HISTORY_TURNS = 10;

  /** Greeting text shown automatically when the panel first loads. */
  const CHAT_GREETING =
    "👋 Hi! I'm your writing assistant. I can help you improve your markdown, " +
    "suggest edits, fix formatting, or summarize content. What would you like help with?";

  /* ═══════════════════════════════════════════════════════════════════
     Token estimation
     ═══════════════════════════════════════════════════════════════════ */

  /** Estimate token count from a string (rough, no model-specific BPE). */
  function estimateTokens(str) {
    return Math.ceil((str || '').length / CHARS_PER_TOKEN);
  }

  /**
   * Sync the Ask/Edit toggle button states and textarea placeholder to
   * reflect the current `isAskMode` value.
   */
  function _syncModeUI() {
    const askBtn  = document.getElementById('btn-mode-ask');
    const editBtn = document.getElementById('btn-mode-edit');
    const input   = document.getElementById('chatInput');

    if (askBtn)  askBtn.classList.toggle('chat-mode-btn--active',  isAskMode);
    if (editBtn) editBtn.classList.toggle('chat-mode-btn--active', !isAskMode);

    // Only update placeholder when no selection is active (selection has its own copy)
    if (input && !currentSelection) {
      input.placeholder = isAskMode
        ? 'Ask a question about the file…'
        : 'Ask AI to edit, improve, or rewrite…';
    }
  }

  /**
   * Recompute the estimated input token count for the NEXT request and
   * update the token badge in the chat status bar.
   * Called whenever the file changes or a message is sent/received.
   */
  function updateTokenEstimate() {
    if (typeof _deps.getEditor !== 'function') return; // guard: called before init()
    const mdEditor    = _deps.getEditor();
    const fileContent = mdEditor ? mdEditor.value : '';
    const userDraft   = document.getElementById('chatInput')?.value || '';

    // When a line selection is active send only the block — reflect that saving.
    const contextContent = (currentSelection && currentSelection.blockText)
      ? currentSelection.blockText
      : fileContent;

    // System prompt overhead (static text) + context content (capped) + history + draft
    const sysToks     = 350; // approximate fixed overhead for system prompt text
    const fileToks    = estimateTokens(contextContent.slice(0, MAX_FILE_CHARS));
    const historyToks = estimateTokens(
      conversationHistory.slice(-MAX_HISTORY_TURNS).map(m => m.content).join(' ')
    );
    const draftToks   = estimateTokens(userDraft);
    const total       = sysToks + fileToks + historyToks + draftToks;

    const badge = document.getElementById('chatTokenBadge');
    if (!badge) return;

    // Format: "~2.4K" or "~800"
    badge.textContent = total >= 1000
      ? `~${(total / 1000).toFixed(1)}K tok`
      : `~${total} tok`;

    // Colour: green → amber → red as budget fills up
    badge.classList.remove('tok-ok', 'tok-warn', 'tok-danger');
    if      (total > 32_000) badge.classList.add('tok-danger');
    else if (total >  8_000) badge.classList.add('tok-warn');
    else                     badge.classList.add('tok-ok');
  }

  /**
   * Show or hide the large-file warning banner above the chat input area.
   * Called every time a new file is loaded into the editor.
   */
  function updateFileSizeWarning() {
    const banner   = document.getElementById('chatLargeFileWarn');
    if (!banner) return;
    if (typeof _deps.getEditor !== 'function') return; // guard: called before init()

    // When a line selection is active, only the selected block is sent — the
    // large-file warning is irrelevant and would show a misleading token count.
    if (currentSelection) {
      banner.classList.add('hidden');
      return;
    }

    const mdEditor = _deps.getEditor();
    const len      = mdEditor ? mdEditor.value.length : 0;
    if (len > LARGE_FILE_WARN_CHARS) {
      const estTok  = estimateTokens(len > MAX_FILE_CHARS ? MAX_FILE_CHARS : len);
      const trimmed = len > MAX_FILE_CHARS;
      banner.innerHTML = trimmed
        ? `⚠ Large file — only the first ${(MAX_FILE_CHARS / 1000).toFixed(0)}K chars are sent to the AI (~${(estimateTokens(MAX_FILE_CHARS) / 1000).toFixed(0)}K tokens). Edits may be incomplete.`
        : `ℹ Large file (~${(estTok / 1000).toFixed(1)}K tokens). Each request includes the full content.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Small helpers
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Return a short HH:MM time string for the current moment.
   * @returns {string}
   */
  function getTimeString() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Scroll the chat messages container to the very bottom. */
  function scrollChatToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /** Sync the message-count label in the chat status bar. */
  function updateChatCount() {
    const el = document.getElementById('chatMsgCount');
    if (el) el.textContent = messageCount;
  }

  /* ═══════════════════════════════════════════════════════════════════
     AI response parsers
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * If the model wrapped its reply in a single outer code fence (```markdown … ```
   * or ``` … ```), strip that wrapper and return the inner content.
   * Otherwise return the original text trimmed.
   *
   * @param {string} text  Raw AI response text.
   * @returns {string}
   */
  function stripCodeFence(text) {
    if (!text) return '';
    const trimmed = text.trim();
    const match   = trimmed.match(/^```(?:[a-zA-Z]*)\n([\s\S]*?)\n```$/);
    return match ? match[1].trim() : trimmed;
  }

  /**
   * Check whether the AI flagged its response as a document edit by wrapping
   * the content in <DOC_EDIT>…</DOC_EDIT> tags.
   *
   * @param {string} text  Full AI response text.
   * @returns {string|null}
   */
  function extractDocEdit(text) {
    if (!text) return null;
    const match = text.match(/<DOC_EDIT>\s*([\s\S]*?)\s*<\/DOC_EDIT>/);
    if (!match) return null;
    return stripDocPreamble(match[1].trim());
  }

  /**
   * Strip leading explanation prose that a model may place before the actual
   * Markdown document inside <DOC_EDIT> tags.
   *
   * @param {string} text  Content extracted from inside <DOC_EDIT> tags.
   * @returns {string}
   */
  function stripDocPreamble(text) {
    if (!text) return text;
    const lines   = text.split('\n');
    const mdStart = /^(#{1,6}\s|[|>*\-+]|\d+\.\s|```|---|\*\*\*)/;
    for (let i = 0; i < lines.length; i++) {
      if (mdStart.test(lines[i].trim())) {
        return lines.slice(i).join('\n').trim();
      }
    }
    return text;
  }

  /**
   * Extract the one-line change description from a <DOC_SUMMARY>…</DOC_SUMMARY> tag.
   *
   * @param {string} text  Full AI response text.
   * @returns {string|null}
   */
  function extractDocSummary(text) {
    if (!text) return null;
    const match = text.match(/<DOC_SUMMARY>\s*([\s\S]*?)\s*<\/DOC_SUMMARY>/);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract the block replacement text from a <BLOCK_EDIT>…</BLOCK_EDIT> tag.
   *
   * @param {string} text  Full AI response text.
   * @returns {string|null}
   */
  function extractBlockEdit(text) {
    if (!text) return null;
    const match = text.match(/<BLOCK_EDIT>\s*([\s\S]*?)\s*<\/BLOCK_EDIT>/);
    return match ? match[1] : null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Selection tracking
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Read the textarea's current selection, snap it to full line boundaries,
   * and store the result in `currentSelection`.
   * Clears `currentSelection` when the selection is collapsed (just a cursor).
   */
  function captureEditorSelection() {
    const mdEditor = _deps.getEditor();
    if (!mdEditor) return;
    const ss = mdEditor.selectionStart;
    const se = mdEditor.selectionEnd;

    if (ss === se) {
      if (currentSelection !== null) { currentSelection = null; updateSelectionDisplay(); }
      return;
    }

    const val = mdEditor.value;

    // Snap to full line boundaries
    const blockStart = val.lastIndexOf('\n', ss - 1) + 1;       // first char of first line
    let   blockEnd   = val.indexOf('\n', se - 1);                // \n at end of last line
    if (blockEnd === -1) blockEnd = val.length;                  // last line, no trailing \n
    else                 blockEnd += 1;                          // include the \n

    // 1-based line numbers
    const startLine = val.slice(0, blockStart).split('\n').length;
    const blockText = val.slice(blockStart, blockEnd);
    const linesArr  = blockText.split('\n');
    const endLine   = startLine + linesArr.length - 1 - (blockText.endsWith('\n') ? 1 : 0);

    currentSelection = { startLine, endLine, blockStart, blockEnd, blockText };
    updateSelectionDisplay();
  }

  /**
   * Paint #sel-ghost over the currently selected lines.
   *
   * The ghost is positioned in the coordinate space of .editor-wrapper
   * (the same space as #editor-highlight), so we subtract mdEditor.scrollTop
   * to convert content-relative offsets into viewport-relative ones.
   *
   * Uses the same canvas ruler that drives the line-number gutter so that
   * wrapped lines are measured correctly.
   */
  function positionSelectionGhost() {
    const ghost    = document.getElementById('sel-ghost');
    const mdEditor = _deps.getEditor();
    if (!ghost || !currentSelection || !mdEditor) return;

    // Ensure the canvas ruler is calibrated for the current editor size
    if (!_deps.getRulerCtx() || _deps.getRulerWidth() === 0) _deps.syncRuler();
    if (!_deps.getRulerCtx() || _deps.getRulerLineH() === 0) return; // ruler not ready yet

    const { startLine, endLine } = currentSelection;
    const lines  = mdEditor.value.split('\n');
    const lineH  = _deps.getRulerLineH();
    const padTop = 20; // must match #editor-highlight / #mdEditor padding-top

    // Sum visual row heights from line 1 up to (but not including) startLine
    let contentTop = padTop;
    for (let i = 0; i < startLine - 1; i++) {
      contentTop += _deps.visualRowsForLine(lines[i] || '') * lineH;
    }

    // Sum visual row heights for the selected lines
    let height = 0;
    for (let i = startLine - 1; i < endLine; i++) {
      height += _deps.visualRowsForLine(lines[i] || '') * lineH;
    }

    // Convert content offset to wrapper-viewport offset by subtracting scroll
    ghost.style.top     = (contentTop - mdEditor.scrollTop) + 'px';
    ghost.style.height  = height + 'px';
    ghost.style.opacity = '1';
    ghost.removeAttribute('hidden');
    ghost.classList.remove('hidden');
  }

  /** Hide #sel-ghost (editor has focus — native selection takes over). */
  function hideSelectionGhost() {
    const ghost = document.getElementById('sel-ghost');
    if (ghost) {
      ghost.style.opacity = '0';
      // Delay the height reset until after the CSS fade-out (120 ms)
      setTimeout(() => {
        if (ghost.style.opacity === '0') ghost.style.height = '0';
      }, 130);
    }
  }

  /**
   * Sync the selection chip in the chat statusbar and the chat-input placeholder
   * with the current `currentSelection` state.
   */
  function updateSelectionDisplay() {
    const chip  = document.getElementById('chatSelChip');
    const input = document.getElementById('chatInput');

    if (currentSelection) {
      const { startLine, endLine } = currentSelection;
      const label = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
      if (chip)  { chip.textContent = label; chip.classList.remove('hidden'); }
      if (input) input.placeholder = isAskMode
        ? `Ask about ${label}… (Enter to send)`
        : `Edit ${label}… (Enter to send)`;
      updateTokenEstimate();
      updateFileSizeWarning(); // hide banner — only the selection is being sent
    } else {
      if (chip)  chip.classList.add('hidden');
      if (input) input.placeholder = isAskMode
        ? 'Ask a question about the file…'
        : 'Ask AI to edit, improve, or rewrite…';
      hideSelectionGhost();
      updateTokenEstimate();
      updateFileSizeWarning(); // restore banner if file is large
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Message builders
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Build the messages array sent to the AI on every turn.
   *
   * When a line-range selection is active the call is routed to
   * _buildBlockMessages() which sends only the selected block.
   *
   * @param {string} userText     The user's current message.
   * @param {string} filename     Name of the currently open file.
   * @param {string} fileContent  Current editor content.
   * @param {object|null} selection  Active selection from currentSelection, or null.
   * @returns {Array<{role: string, content: string}>}
   */
  function buildMessages(userText, filename, fileContent, selection = null) {
    if (selection) return _buildBlockMessages(userText, filename, fileContent, selection);

    // ── File content budget ────────────────────────────────────────────
    let contentForAI     = fileContent;
    let truncationNotice = '';
    if (fileContent.length > MAX_FILE_CHARS) {
      contentForAI     = fileContent.slice(0, MAX_FILE_CHARS);
      truncationNotice =
        `\n\n[FILE TRUNCATED: only the first ${MAX_FILE_CHARS.toLocaleString()} of ` +
        `${fileContent.length.toLocaleString()} characters were included. ` +
        `Document edits may not cover sections beyond this point.]`;
    }

    const fileSection = [
      '=== CURRENT FILE CONTENT ===',
      contentForAI.trim()
        ? `${contentForAI}${truncationNotice}`
        : '(The file is currently empty.)',
    ].join('\n');

    let systemContent;

    if (isAskMode) {
      // ── Ask mode: conversational replies only, no document edits ────────
      systemContent = [
        'You are an intelligent assistant embedded in a text editor called MoilStack .md.',
        `The user is editing a file named "${filename}".`,
        'You have full access to the file content below. Use it to give accurate, specific answers.',
        '',
        '=== OUTPUT FORMAT ===',
        '',
        'Reply in plain conversational text, grounded in the actual file content.',
        'Reference specific sections or text from the file when relevant.',
        'DO NOT include <DOC_EDIT> or <DOC_SUMMARY> tags.',
        'DO NOT reproduce the entire document — quote only the relevant parts.',
        '',
        fileSection,
      ].join('\n');
    } else {
      // ── Edit mode: full edit + conversational behaviour ──────────────────
      systemContent = [
        'You are an intelligent assistant embedded in a text editor called MoilStack .md.',
        `The user is editing a file named "${filename}".`,
        'You have full access to the file content below. Use it to give accurate, specific answers and edits.',
        '',
        '=== OUTPUT FORMAT — OBEY EXACTLY ===',
        '',
        'CASE 1 — User wants to EDIT, CHANGE, ADD, REMOVE, FIX, IMPROVE, or REWRITE any part of the document:',
        '  Your ENTIRE response MUST be ONLY these two blocks in this exact order — nothing else:',
        '  <DOC_SUMMARY>one sentence describing what you changed</DOC_SUMMARY>',
        '  <DOC_EDIT>',
        '  [insert the COMPLETE updated document here]',
        '  </DOC_EDIT>',
        '  RULES:',
        '  - <DOC_SUMMARY> must be a single short sentence (e.g. "Added Viewer role to the permissions table.").',
        '  - Output the FULL document inside <DOC_EDIT> — every section, not just the changed part.',
        '  - The character immediately after <DOC_EDIT> must be the first character of the document.',
        '  - DO NOT write any explanation or comment outside these two tags.',
        '  - DO NOT use markdown code fences (``` or ```markdown) anywhere in your response.',
        '',
        'CASE 2 — User asks a question, asks for a summary, explanation, or help understanding the file:',
        '  Reply in plain conversational text, grounded in the actual file content.',
        '  Reference specific sections, code, or text from the file when relevant.',
        '  DO NOT include <DOC_EDIT> tags.',
        '  DO NOT reproduce the entire document — quote only the relevant parts.',
        '',
        'If you are unsure, use CASE 2.',
        '',
        fileSection,
        '',
        'REMINDER: For any edit request respond ONLY with <DOC_SUMMARY>…</DOC_SUMMARY> then <DOC_EDIT>…</DOC_EDIT>. No other text.',
      ].join('\n');
    }

    return [
      { role: 'system', content: systemContent },
      ...conversationHistory.slice(-MAX_HISTORY_TURNS),
      { role: 'user',   content: userText },
    ];
  }

  /**
   * Build messages for a BLOCK EDIT request — sends only the selected lines,
   * not the full document. Expects <BLOCK_EDIT>…</BLOCK_EDIT> in the response.
   */
  function _buildBlockMessages(userText, filename, fileContent, selection) {
    const { startLine, endLine, blockText } = selection;
    const totalLines = fileContent.split('\n').length;

    // Provide a small window of surrounding context (up to 40 lines each side)
    // so the AI understands the code/text around the selected block.
    const allLines   = fileContent.split('\n');
    const ctxBefore  = allLines.slice(Math.max(0, startLine - 41), startLine - 1).join('\n');
    const ctxAfter   = allLines.slice(endLine, Math.min(allLines.length, endLine + 40)).join('\n');

    const contextLines = [
      ...(ctxBefore.trim() ? [
        `=== CONTEXT BEFORE (lines ${Math.max(1, startLine - 40)}–${startLine - 1}) ===`,
        ctxBefore,
        '=== END CONTEXT BEFORE ===',
        '',
      ] : []),
      `=== SELECTED BLOCK (lines ${startLine}–${endLine}) ===`,
      blockText,
      '=== END OF SELECTED BLOCK ===',
      '',
      ...(ctxAfter.trim() ? [
        `=== CONTEXT AFTER (lines ${endLine + 1}–${Math.min(totalLines, endLine + 40)}) ===`,
        ctxAfter,
        '=== END CONTEXT AFTER ===',
        '',
      ] : []),
    ];

    let systemContent;

    if (isAskMode) {
      // ── Ask mode: answer questions about the selection, no block edits ───
      systemContent = [
        'You are an intelligent assistant embedded in a text editor called MoilStack .md.',
        `The user is editing "${filename}" (${totalLines} lines total).`,
        `They have selected lines ${startLine}–${endLine} and want to ask a question about that block.`,
        'Use the surrounding context lines to understand the full picture before responding.',
        '',
        ...contextLines,
        '=== OUTPUT FORMAT ===',
        '',
        'Reply conversationally as plain text, referencing specific details from the selected block.',
        'DO NOT include <BLOCK_EDIT> tags.',
      ].join('\n');
    } else {
      // ── Edit mode: full block edit + conversational behaviour ─────────────
      systemContent = [
        'You are an intelligent assistant embedded in a text editor called MoilStack .md.',
        `The user is editing "${filename}" (${totalLines} lines total).`,
        `They have selected lines ${startLine}–${endLine} and want help with ONLY that block.`,
        'Use the surrounding context lines to understand the full picture before responding.',
        '',
        ...contextLines,
        '=== OUTPUT FORMAT — OBEY EXACTLY ===',
        '',
        'CASE 1 — User wants to EDIT the selected block:',
        '  Your ENTIRE response MUST be ONLY:',
        '  <BLOCK_EDIT>',
        '  [complete replacement for the selected lines — nothing else]',
        '  </BLOCK_EDIT>',
        '  RULES:',
        '  - Return ONLY the replacement lines. Do NOT include the rest of the document.',
        '  - Match the trailing newline of the original block exactly.',
        '  - DO NOT add any explanation outside the tags.',
        '  - DO NOT use markdown code fences inside the tags.',
        '',
        'CASE 2 — User asks a QUESTION about the selection (no edit needed):',
        '  Reply conversationally as plain text, referencing specific details from the selected block.',
        '  DO NOT include <BLOCK_EDIT> tags.',
        '',
        'If unsure, use CASE 2.',
      ].join('\n');
    }

    return [
      { role: 'system', content: systemContent },
      ...conversationHistory.slice(-MAX_HISTORY_TURNS),
      { role: 'user',   content: userText },
    ];
  }

  /* ═══════════════════════════════════════════════════════════════════
     Bubble builders
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Insert a plain AI bubble with NO action buttons.
   * Used for the welcome greeting and system notices.
   * @param {string} text  Message text to display.
   */
  function addSystemBubble(text) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const row     = document.createElement('div');
    row.className = 'bubble-row ai';
    row.innerHTML = `
      <div class="bubble ai">${_deps.escapeHtml(text).replace(/\n/g, '<br>')}</div>
    `;
    chatMessages.appendChild(row);
  }

  /**
   * Append a user bubble to the chat messages container.
   * @param {string} text  Raw text typed by the user.
   */
  function addUserBubble(text) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const row     = document.createElement('div');
    row.className = 'bubble-row user';
    row.innerHTML = `
      <div class="bubble-meta">You · ${getTimeString()}</div>
      <div class="bubble user">${_deps.escapeHtml(text).replace(/\n/g, '<br>')}</div>
    `;
    chatMessages.appendChild(row);
  }

  /**
   * Append an AI bubble (with Restore + Copy actions) to the chat messages container.
   * @param {string} text  AI response text.
   */
  function addAIBubble(text) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const row          = document.createElement('div');
    row.className      = 'bubble-row ai';
    row.dataset.aiText = text;
    row.innerHTML      = `
      <div class="bubble-meta">AI Assistant · ${getTimeString()}</div>
      <div class="bubble ai">${_deps.escapeHtml(text).replace(/\n/g, '<br>')}</div>
      <div class="bubble-actions">
        <button class="bubble-action-btn restore-btn"><svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 6a4 4 0 1 0 .9-2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><polyline points="1,2 1.8,4.6 4.4,3.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg> Restore</button>
        <button class="bubble-action-btn copy-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy</button>
      </div>
    `;
    chatMessages.appendChild(row);
  }

  /**
   * Create an empty AI bubble in the DOM immediately for streaming.
   * Tokens are appended to bubbleEl.innerHTML (escaped) as they arrive.
   * row.dataset.aiText is kept in sync so Copy / Restore work correctly.
   *
   * @returns {{ row: HTMLElement, bubbleEl: HTMLElement } | null}
   */
  function createStreamingBubble() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return null;

    const row          = document.createElement('div');
    row.className      = 'bubble-row ai';
    row.dataset.aiText = '';   // kept in sync with accumulated response text

    // Bubble starts with a waiting animation; action buttons are added on completion
    row.innerHTML = `
      <div class="bubble-meta">AI Assistant · ${getTimeString()}</div>
      <div class="bubble ai bubble--waiting">
        <div class="bubble-waiting">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;

    chatMessages.appendChild(row);

    const bubbleEl = row.querySelector('.bubble.ai');
    return { row, bubbleEl };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Bubble action handlers
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * "Restore" — replace the entire editor content with the AI response,
   * then auto-save so the change is written to disk immediately.
   *
   * @param {HTMLButtonElement} btn  The clicked Restore button.
   */
  function restoreContent(btn) {
    const row = btn.closest('[data-ai-text]');
    if (!row) return;
    const newContent = row.dataset.aiText;
    if (!newContent) return;
    _deps.setEditorContentUndoable(newContent);
    _deps.saveFile();
  }

  /**
   * "Undo AI Edit" — restore the document to the snapshot captured immediately
   * before the AI applied its edit to this bubble.
   *
   * @param {HTMLButtonElement} btn  The clicked Undo button.
   */
  function undoAIEdit(btn) {
    const row = btn.closest('[data-before-text]');
    if (!row) return;
    const before = row.dataset.beforeText;
    if (before === undefined || before === null) return;
    _deps.setEditorContentUndoable(before);
    _deps.saveFile();
    const origHTML = btn.innerHTML;
    btn.textContent = '✓ Restored';
    btn.style.color = 'var(--primary)';
    setTimeout(() => { btn.innerHTML = origHTML; btn.style.color = ''; }, 1800);
  }

  /**
   * "Copy" — copy the AI bubble text to the system clipboard.
   * Falls back to `execCommand('copy')` for Electron contexts that block
   * the Clipboard API.
   * @param {HTMLButtonElement} btn  The clicked copy button.
   */
  async function copyResponse(btn) {
    const bubble = btn.closest('.bubble-row').querySelector('.bubble.ai');
    const text   = bubble.innerText || bubble.textContent;
    try {
      await navigator.clipboard.writeText(text);
      const origHTML = btn.innerHTML;
      btn.textContent = '✓ Copied!';
      btn.style.color = 'var(--primary)';
      setTimeout(() => { btn.innerHTML = origHTML; btn.style.color = ''; }, 1500);
    } catch {
      // Fallback for Electron context
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy'); // eslint-disable-line no-undef
      document.body.removeChild(ta);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Core: sendMessage
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Read the chat input, add a user bubble, show the typing indicator,
   * call aiService with streaming, then display the AI response incrementally.
   *
   * File context is taken from mdEditor.value (the live textarea) so the AI
   * always sees the current editor state — including any unsaved edits the
   * user has made since the file was last written to disk.
   */
  function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    // Always read from the live editor — this includes unsaved changes,
    // which is exactly what the user is working on when they ask for help.
    const mdEditor      = _deps.getEditor();
    const editorContent = mdEditor ? mdEditor.value : '';

    // Capture the active selection NOW (before any async work) so the correct
    // blockStart/blockEnd are used even if the user moves the cursor while
    // the AI is responding.
    const capturedSelection = currentSelection ? { ...currentSelection } : null;

    // Push current editor snapshot so Restore has a baseline
    chatHistory.push(editorContent);

    // 1. Add user bubble
    addUserBubble(text);

    // 2. Clear input and reset its height
    input.value        = '';
    input.style.height = 'auto';

    // 3. Scroll so the user bubble is visible
    scrollChatToBottom();

    // 4. Disable send controls while the AI is responding
    const sendBtn   = document.getElementById('btn-send');
    const chatInput = document.getElementById('chatInput');
    if (sendBtn)   sendBtn.disabled   = true;
    if (chatInput) chatInput.disabled = true;

    /** Re-enable input — called in all exit paths (success, error, no-model). */
    function _reenableInput() {
      if (sendBtn)   sendBtn.disabled   = false;
      if (chatInput) { chatInput.disabled = false; chatInput.focus(); }
    }

    // 5. Build messages array — rules first, then file context appended at the end
    //    (structure enforced inside buildMessages / _buildBlockMessages)
    const currentFile = _deps.getCurrentFile();
    const model       = AIConfigManager.getActiveModel();
    const messages    = buildMessages(text, currentFile.name, editorContent, capturedSelection);

    // 6. Guard: no model configured
    if (!model) {
      addAIBubble('No AI model configured. Open Settings (⚙) to add one.');
      messageCount += 2;
      updateChatCount();
      scrollChatToBottom();
      _reenableInput();
      return;
    }

    // 7. Create the streaming AI bubble (empty — tokens fill it as they arrive)
    const streaming = createStreamingBubble();
    let accumulatedText   = '';
    let responseTypeKnown = false; // true once we've seen enough tokens to classify
    let isEditMode        = false; // true when response is a <DOC_EDIT> document edit

    // 8. Token callback — smart streaming:
    //    • INFO / Q&A replies  → stream tokens into the bubble as plain text.
    //    • DOC_EDIT replies    → show a silent "Editing document…" indicator and
    //      accumulate the full document quietly. The full document is applied
    //      atomically in the .then() handler below.
    function onToken(token) {
      accumulatedText += token;
      if (!streaming) return;

      // ── Classify response type by scanning for <DOC_EDIT> ───────────────
      if (!responseTypeKnown) {
        if (accumulatedText.includes('<DOC_EDIT>') || accumulatedText.includes('<BLOCK_EDIT>')) {
          // Either edit tag found — accumulate silently, apply atomically on completion.
          responseTypeKnown = true;
          isEditMode        = true;
          streaming.bubbleEl.classList.remove('bubble--waiting');
          const editLabel = capturedSelection
            ? `Editing lines ${capturedSelection.startLine}–${capturedSelection.endLine}…`
            : 'Editing document…';
          streaming.bubbleEl.innerHTML = `
            <div class="bubble-editing-indicator">
              <div class="bubble-waiting"><span></span><span></span><span></span></div>
              <span class="bubble-editing-label">${_deps.escapeHtml(editLabel)}</span>
            </div>`;
          return;
        }

        if (accumulatedText.length < 150) return; // keep waiting, dots visible

        responseTypeKnown = true;
        streaming.bubbleEl.classList.remove('bubble--waiting');

        // In Edit mode with an active selection, stay silent even without tags —
        // the full response will be applied as a block replacement on completion.
        if (!isAskMode && capturedSelection) {
          isEditMode = true;
          const editLabel = `Editing lines ${capturedSelection.startLine}–${capturedSelection.endLine}…`;
          streaming.bubbleEl.innerHTML = `
            <div class="bubble-editing-indicator">
              <div class="bubble-waiting"><span></span><span></span><span></span></div>
              <span class="bubble-editing-label">${_deps.escapeHtml(editLabel)}</span>
            </div>`;
          return;
        }

        // 150 chars with no edit tags and no active selection → plain INFO reply.
        isEditMode = false;
        streaming.bubbleEl.innerHTML = _deps.escapeHtml(accumulatedText).replace(/\n/g, '<br>');
        streaming.row.dataset.aiText = accumulatedText;
        scrollChatToBottom();
        return;
      }

      // ── DOC_EDIT: silent accumulation only ───────────────────────────────
      if (isEditMode) return;

      // ── INFO mode: render each token incrementally ───────────────────────
      streaming.bubbleEl.innerHTML = _deps.escapeHtml(accumulatedText).replace(/\n/g, '<br>');
      streaming.row.dataset.aiText = accumulatedText;
      scrollChatToBottom();
    }

    // 9. Request AI response via streaming IPC
    aiService.getResponse(messages, model, onToken)
      .then((fullResponse) => {
        // ── Detect response intent ─────────────────────────────────────
        // Priority: BLOCK_EDIT (selection active) → DOC_EDIT → conversational
        const blockContent = capturedSelection ? extractBlockEdit(fullResponse) : null;
        const docContent   = blockContent === null ? extractDocEdit(fullResponse) : null;

        if (blockContent !== null) {
          // ── BLOCK EDIT path ──────────────────────────────────────────
          const { startLine, endLine, blockStart, blockEnd } = capturedSelection;
          const editor = _deps.getEditor();

          // Honour the original block's trailing-newline convention
          let replacement = blockContent;
          const origEndsNL = editor.value[blockEnd - 1] === '\n';
          if (origEndsNL && !replacement.endsWith('\n'))  replacement += '\n';
          if (!origEndsNL && replacement.endsWith('\n'))  replacement = replacement.slice(0, -1);

          if (editor) {
            editor.setRangeText(replacement, blockStart, blockEnd, 'end');
            _deps.updateStats();
            _deps.updateHighlight();
            _deps.triggerUpdate();
            _deps.saveFile();
          }

          // Badge: "✓ Lines X–Y updated"
          if (streaming) {
            const lineLabel = startLine === endLine
              ? `Line ${startLine}`
              : `Lines ${startLine}–${endLine}`;
            streaming.bubbleEl.innerHTML =
              `<span class="bubble-applied-badge">✓ ${_deps.escapeHtml(lineLabel)} updated</span>`;
            streaming.row.dataset.aiText = blockContent;
            streaming.row.insertAdjacentHTML('beforeend', `
              <div class="bubble-actions">
                <button class="bubble-action-btn copy-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy</button>
              </div>
            `);
          }

          const lineLabel = startLine === endLine
            ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
          conversationHistory.push({ role: 'user',      content: text });
          conversationHistory.push({ role: 'assistant', content: `[${lineLabel} updated — ${blockContent.length.toLocaleString()} chars]` });

        } else if (docContent !== null) {
          // ── FULL DOCUMENT EDIT path ──────────────────────────────────

          // ① Persist a file backup BEFORE overwriting — survives app restarts
          if (currentFile.path) {
            window.electronAPI.writeBackup(currentFile.path, editorContent).catch(() => {});
          }

          // ② Store the before-snapshot on the bubble for instant in-memory undo
          if (streaming) {
            streaming.row.dataset.beforeText = editorContent;
          }

          // ③ Apply the AI edit — through the native undo stack so Ctrl+Z works
          const editor = _deps.getEditor();
          if (editor) {
            _deps.setEditorContentUndoable(docContent);
            _deps.saveFile();
          }

          if (streaming) {
            const rawSummary  = extractDocSummary(fullResponse);
            const summaryText = rawSummary || (text.length > 120 ? text.slice(0, 120) + '…' : text);
            streaming.bubbleEl.innerHTML =
              `<span class="bubble-applied-badge">✓ Document updated</span>` +
              `<span class="bubble-applied-preview">${_deps.escapeHtml(summaryText)}</span>`;
            streaming.row.dataset.aiText = docContent;
            streaming.row.insertAdjacentHTML('beforeend', `
              <div class="bubble-actions">
                <button class="bubble-action-btn undo-btn"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 6a4 4 0 1 0 .9-2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><polyline points="1,2 1.8,4.6 4.4,3.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg> Undo</button>
                <button class="bubble-action-btn restore-btn"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(12,0) scale(-1,1)"><path d="M2 6a4 4 0 1 0 .9-2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><polyline points="1,2 1.8,4.6 4.4,3.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg> Re-apply</button>
                <button class="bubble-action-btn copy-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy</button>
              </div>
            `);
          }

          const editSummary = extractDocSummary(fullResponse) ||
            `[Document rewritten — ${docContent.length.toLocaleString()} chars]`;
          conversationHistory.push({ role: 'user',      content: text });
          conversationHistory.push({ role: 'assistant', content: editSummary });

        } else if (!isAskMode && capturedSelection) {
          // ── BLOCK EDIT FALLBACK ──────────────────────────────────────
          // Edit mode + selection but AI returned no tags — apply the full
          // response directly as the block replacement.
          const { startLine, endLine, blockStart, blockEnd } = capturedSelection;
          const editor = _deps.getEditor();
          let replacement = fullResponse.trim();

          if (editor) {
            const origEndsNL = editor.value[blockEnd - 1] === '\n';
            if (origEndsNL && !replacement.endsWith('\n'))  replacement += '\n';
            if (!origEndsNL && replacement.endsWith('\n'))  replacement = replacement.slice(0, -1);

            editor.setRangeText(replacement, blockStart, blockEnd, 'end');
            _deps.updateStats();
            _deps.updateHighlight();
            _deps.triggerUpdate();
            _deps.saveFile();
          }

          if (streaming) {
            const lineLabel = startLine === endLine
              ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
            streaming.bubbleEl.innerHTML =
              `<span class="bubble-applied-badge">✓ ${_deps.escapeHtml(lineLabel)} updated</span>`;
            streaming.row.dataset.aiText = replacement;
            streaming.row.insertAdjacentHTML('beforeend', `
              <div class="bubble-actions">
                <button class="bubble-action-btn copy-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy</button>
              </div>
            `);
          }

          const lineLabel = startLine === endLine
            ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
          conversationHistory.push({ role: 'user',      content: text });
          conversationHistory.push({ role: 'assistant', content: `[${lineLabel} updated — ${replacement.length.toLocaleString()} chars]` });

        } else {
          // ── CONVERSATIONAL REPLY path ────────────────────────────────
          const replyText = fullResponse.trim() || '(no response)';
          if (streaming) {
            streaming.bubbleEl.innerHTML = _deps.escapeHtml(replyText).replace(/\n/g, '<br>');
            streaming.row.dataset.aiText = replyText;
            streaming.row.insertAdjacentHTML('beforeend', `
              <div class="bubble-actions">
                <button class="bubble-action-btn copy-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy</button>
              </div>
            `);
          }
          conversationHistory.push({ role: 'user',      content: text });
          conversationHistory.push({ role: 'assistant', content: replyText });
        }

        // Clear the selection indicator — the edit has been applied
        currentSelection = null;
        updateSelectionDisplay();

        // Update message count (user + AI = +2) and refresh token estimate
        messageCount += 2;
        updateChatCount();
        updateTokenEstimate();
        scrollChatToBottom();
        _reenableInput();
      })
      .catch((err) => {
        console.error('[sendMessage] AI error:', err);

        // Remove the empty or partially-filled streaming bubble
        if (streaming) streaming.row.remove();

        // Show an error bubble
        addAIBubble(`⚠ Error: ${err.message || 'Unknown error from AI.'}`);

        messageCount += 2;
        updateChatCount();
        scrollChatToBottom();
        _reenableInput();
      });
  }

  /* ═══════════════════════════════════════════════════════════════════
     clearChat / handleChatKey
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Clear all chat bubbles and re-show the initial greeting.
   */
  function clearChat() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // Remove all bubbles
    chatMessages.innerHTML = '';

    // Reset conversation history so the AI starts fresh on the next message
    conversationHistory.length = 0;

    // Clear any active line selection (chip + ghost)
    currentSelection = null;
    updateSelectionDisplay();
    hideSelectionGhost();

    // Reset count, re-add greeting (no Restore/Copy buttons on a greeting)
    messageCount = 0;
    addSystemBubble(CHAT_GREETING);
    updateTokenEstimate(); // history cleared — badge should drop back to baseline
    messageCount = 1;
    updateChatCount();
  }

  /**
   * Keyboard handler for the chat textarea.
   * Enter → send; Alt+Enter → insert newline.
   * @param {KeyboardEvent} e
   */
  function handleChatKey(e) {
    if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter → insert a newline at the cursor
      e.preventDefault();
      const ta    = e.target;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      ta.setRangeText('\n', start, end, 'end');
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     init — wire event listeners, store injected dependencies
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Initialise the chat panel. Must be called once from index.js
   * DOMContentLoaded after all DOM elements exist.
   *
   * @param {object} deps  Functions/getters injected from index.js.
   */
  function init(deps) {
    _deps = deps;

    // Ask / Edit mode toggle
    document.getElementById('btn-mode-ask')?.addEventListener('click', () => {
      if (!isAskMode) { isAskMode = true; _syncModeUI(); }
    });
    document.getElementById('btn-mode-edit')?.addEventListener('click', () => {
      if (isAskMode) { isAskMode = false; _syncModeUI(); }
    });

    // Send button
    document.getElementById('btn-send')
      ?.addEventListener('click', sendMessage);

    // Chat textarea — key handler + auto-resize + live token estimate
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', handleChatKey);
      chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        updateTokenEstimate(); // draft length changed — refresh badge
      });
    }

    // Clear chat button
    document.getElementById('btn-clear-chat')
      ?.addEventListener('click', clearChat);

    // Delegated listener for bubble action buttons (Restore / Undo / Copy).
    // These are injected dynamically via innerHTML, so inline onclick is blocked
    // by CSP (script-src 'self'). A single delegated listener on the stable
    // container handles all bubbles.
    document.getElementById('chatMessages')
      ?.addEventListener('click', (e) => {
        const undoBtn    = e.target.closest('.undo-btn');
        const restoreBtn = e.target.closest('.restore-btn');
        const copyBtn    = e.target.closest('.copy-btn');
        if (undoBtn)         undoAIEdit(undoBtn);
        else if (restoreBtn) restoreContent(restoreBtn);
        else if (copyBtn)    copyResponse(copyBtn);
      });
  }

  /* ── Public API ────────────────────────────────────────────────────── */
  return {
    init,
    clearChat,
    sendMessage,
    handleChatKey,
    updateTokenEstimate,
    updateFileSizeWarning,
    captureEditorSelection,
    positionSelectionGhost,
    hideSelectionGhost,
    updateSelectionDisplay,
    updateChatCount,
  };

})();

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChatPanel };
}
