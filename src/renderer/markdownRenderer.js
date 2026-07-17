/**
 * markdownRenderer.js — pure Markdown → HTML conversion functions.
 *
 * No DOM access, no external dependencies, no side effects.
 * Exposes: window.MarkdownRenderer = { parseMarkdown, escapeHtml, parseInline }
 *
 * Loaded as a plain <script> tag before editorCore.js and chatPanel.js.
 * The CommonJS export guard at the bottom makes it importable by Jest / Node.
 */

const MarkdownRenderer = (() => {

  /* ── HTML escaping ──────────────────────────────────────────────── */

  function escapeHtml(str) {
    return str
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  /* ── Math (LaTeX) rendering via KaTeX ──────────────────────────── */

  // Extracts $$...$$ and $...$ from raw Markdown *before* HTML escaping,
  // replacing them with NUL-delimited placeholders so that escapeHtml
  // never touches the LaTeX source. The slots array carries the originals.
  function protectMath(raw) {
    const slots = [];
    const protect = (expr, display) => {
      slots.push({ expr, display });
      return `\x01M${slots.length - 1}\x01`;
    };
    const out = raw
      // Display math: $$...$$  (greedy-safe, dotAll)
      .replace(/\$\$([^$]*?)\$\$/gs, (_, e) => protect(e, true))
      // Inline math: $...$  (no newline crossing, no double-dollar confusion)
      .replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_, e) => protect(e, false));
    return { text: out, slots };
  }

  function restoreMath(html, slots) {
    if (!slots.length) return html;
    return html.replace(/\x01M(\d+)\x01/g, (_, i) => {
      const { expr, display } = slots[+i];
      try {
        if (typeof katex !== 'undefined') {
          return katex.renderToString(expr, { displayMode: display, throwOnError: false, output: 'html' });
        }
      } catch (_e) { /* fall through */ }
      return `<code class="math-fallback">${escapeHtml(expr)}</code>`;
    });
  }

  // Drop-in replacement for parseInline(escapeHtml(raw)) that preserves math.
  function parseInlineMath(raw) {
    const { text, slots } = protectMath(raw);
    return restoreMath(parseInline(escapeHtml(text)), slots);
  }

  /* ── Inline Markdown rules ──────────────────────────────────────── */

  /** Apply inline Markdown rules to an already-escaped string. */
  function parseInline(str) {
    // Extract images and links into placeholders so their URLs and alt text
    // are never touched by the bold/italic/strikethrough regexes below.
    const slots = [];
    const protect = (html) => { slots.push(html); return `\x00${slots.length - 1}\x00`; };

    let s = str
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
        protect(`<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;">`))
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) =>
        protect(`<a href="${href}">${text}</a>`));

    s = s
      // Bold + italic (***text***)
      .replace(/\*\*\*(.+?)\*\*\*/g,  '<strong><em>$1</em></strong>')
      .replace(/(?<!\w)___(.+?)___(?!\w)/g, '<strong><em>$1</em></strong>')
      // Bold (**text**)
      .replace(/\*\*(.+?)\*\*/g,       '<strong>$1</strong>')
      .replace(/(?<!\w)__(.+?)__(?!\w)/g,   '<strong>$1</strong>')
      // Italic (*text*)
      .replace(/\*([^*\n]+?)\*/g,       '<em>$1</em>')
      // Underscore italic — unlike *, _ must NOT trigger mid-word (CommonMark
      // intraword-emphasis rule), otherwise identifiers like debt_summary_table
      // get their underscores eaten and part of the name turned italic.
      .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>')
      // Strikethrough (~~text~~)
      .replace(/~~(.+?)~~/g,            '<del>$1</del>')
      // Inline code (`code`) — input is already HTML-escaped by the caller, no double-escape
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      // Inline checkboxes ([ ] / [x]) — works in tables, paragraphs, anywhere inline
      .replace(/\[([xX ])\]/g, (_, c) =>
        c.toLowerCase() === 'x'
          ? '<input type="checkbox" class="task-checkbox" checked>'
          : '<input type="checkbox" class="task-checkbox">');

    // Restore protected image/link HTML
    return s.replace(/\x00(\d+)\x00/g, (_, i) => slots[+i]);
  }

  /* ── Table helpers ──────────────────────────────────────────────── */

  /** Return true if a line looks like a GFM table separator (| --- | --- |). */
  function isTableSeparator(line) {
    return /^\|?[\s]*:?-+:?[\s]*(\|[\s]*:?-+:?[\s]*)+\|?$/.test(line.trim());
  }

  /** Parse a pipe-delimited table row into an array of cell strings. */
  function parseTableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  }

  /* ── List parser (recursive — supports nested lists) ───────────── */

  function parseListBlock(lines, startIdx, baseIndent) {
    const ordered    = /^\d+\. /.test(lines[startIdx].trimStart());
    const items      = [];
    let hasTaskItems = false;
    let i            = startIdx;

    while (i < lines.length) {
      const line    = lines[i];
      const trimmed = line.trimStart();
      const indent  = line.length - trimmed.length;

      if (trimmed === '') break;          // blank line ends this list level
      if (indent < baseIndent) break;     // dedented — end of this level

      const isUnordered = /^[*\-+] /.test(trimmed);
      const isOrdered   = /^\d+\. /.test(trimmed);
      if (indent !== baseIndent || (!isUnordered && !isOrdered)) break;

      const content    = isUnordered ? trimmed.slice(2) : trimmed.replace(/^\d+\. /, '');
      const uncheckedM = content.match(/^\[ \] ([\s\S]*)/);
      const checkedM   = content.match(/^\[[xX]\] ([\s\S]*)/);
      i++;

      // If the next line is indented further and starts a list, recurse
      let subHtml = '';
      if (i < lines.length) {
        const nextTrimmed = lines[i].trimStart();
        const nextIndent  = lines[i].length - nextTrimmed.length;
        if (nextIndent > baseIndent &&
            (/^[*\-+] /.test(nextTrimmed) || /^\d+\. /.test(nextTrimmed))) {
          const sub = parseListBlock(lines, i, nextIndent);
          subHtml   = sub.html;
          i         = sub.nextIdx;
        }
      }

      if (uncheckedM) {
        hasTaskItems = true;
        items.push(`<li class="task-list-item"><input type="checkbox" class="task-checkbox"><span class="task-label">${parseInlineMath(uncheckedM[1])}</span>${subHtml}</li>`);
      } else if (checkedM) {
        hasTaskItems = true;
        items.push(`<li class="task-list-item task-list-item--checked"><input type="checkbox" class="task-checkbox" checked><span class="task-label">${parseInlineMath(checkedM[1])}</span>${subHtml}</li>`);
      } else {
        items.push(`<li>${parseInlineMath(content)}${subHtml}</li>`);
      }
    }

    const tag  = ordered ? 'ol' : 'ul';
    const attr = (!ordered && hasTaskItems) ? ' class="task-list"' : '';
    return { html: `<${tag}${attr}>${items.join('')}</${tag}>`, nextIdx: i };
  }

  /* ── Block parser ───────────────────────────────────────────────── */

  /**
   * Convert a Markdown string to an HTML string.
   * Processes one logical block at a time (line-by-line state machine).
   *
   * @param {string} src  Raw Markdown source.
   * @returns {string}    HTML output.
   */
  function parseMarkdown(src) {
    if (!src || !src.trim()) return '';

    const lines = src.split('\n');
    const out   = [];
    let i = 0;

    while (i < lines.length) {
      const line        = lines[i];
      const trimmedLine = line.trimStart();

      /* ── Fenced code block ──────────────────────────────────────── */
      // CommonMark: opening fence may have 0–3 leading spaces.
      const fenceOpen = line.match(/^( {0,3})```(.*)$/);
      if (fenceOpen) {
        const lang      = fenceOpen[2].trim();
        const indent    = fenceOpen[1];           // leading spaces to strip from body lines
        const codeLines = [];
        i++;
        // Closing fence: same or fewer leading spaces, nothing after ```
        while (i < lines.length && !lines[i].match(/^ {0,3}```\s*$/)) {
          // Strip the same indentation level that the opening fence had
          const cl = lines[i];
          codeLines.push(indent && cl.startsWith(indent) ? cl.slice(indent.length) : cl);
          i++;
        }
        i++; // consume closing ```
        const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        out.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      /* ── ATX heading  (# … ######) ─────────────────────────────── */
      const hm = trimmedLine.match(/^(#{1,6}) (.+)$/);
      if (hm) {
        const lvl = hm[1].length;
        out.push(`<h${lvl}>${parseInlineMath(hm[2].trim())}</h${lvl}>`);
        i++;
        continue;
      }

      /* ── Horizontal rule ────────────────────────────────────────── */
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedLine)) {
        out.push('<hr>');
        i++;
        continue;
      }

      /* ── Blockquote ─────────────────────────────────────────────── */
      if (trimmedLine.startsWith('> ') || trimmedLine === '>') {
        const quoteLines = [];
        while (i < lines.length && (lines[i].trimStart().startsWith('> ') || lines[i].trim() === '>')) {
          quoteLines.push(lines[i].trimStart().slice(2));
          i++;
        }
        // Recursively parse inner content for nested Markdown
        out.push(`<blockquote>${parseMarkdown(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      /* ── GFM Table ──────────────────────────────────────────────── */
      // Requires at least: header row, separator row, one data row
      if (
        line.includes('|') &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        const headerCells = parseTableRow(line);
        i += 2; // skip header + separator
        const expectedCells = headerCells.length;

        // Allow <br> tags in cells to render as line breaks; escape all other HTML.
        function parseCellContent(c) {
          const BR = '\x00BR\x00';
          const { text: mathProtected, slots: mathSlots } = protectMath(c.replace(/<br\s*\/?>/gi, BR));
          const safe = escapeHtml(mathProtected).replace(/\x00BR\x00/g, '<br>');
          return restoreMath(parseInline(safe), mathSlots);
        }

        const headerHtml = headerCells
          .map(c => `<th>${parseCellContent(c)}</th>`)
          .join('');

        const bodyRows = [];
        let pendingRow = null;

        while (i < lines.length) {
          const ln = lines[i];

          if (ln.trim() === '') {
            // Blank line: skip if we're mid-row (continuation), else end table.
            if (pendingRow !== null) { i++; continue; }
            break;
          }

          if (pendingRow !== null) {
            // Append continuation line to the open row.
            pendingRow += ln.trim();
            i++;
          } else if (ln.includes('|')) {
            pendingRow = ln;
            i++;
          } else {
            break; // non-pipe line with no pending row — outside table
          }

          // Flush when we have enough cells.
          const cells = parseTableRow(pendingRow);
          if (cells.length >= expectedCells) {
            const rowHtml = cells.map(c => `<td>${parseCellContent(c)}</td>`).join('');
            bodyRows.push(`<tr>${rowHtml}</tr>`);
            pendingRow = null;
          }
        }
        // Flush any still-pending row (fewer cells than header — render as-is).
        if (pendingRow !== null) {
          const cells = parseTableRow(pendingRow);
          const rowHtml = cells.map(c => `<td>${parseCellContent(c)}</td>`).join('');
          bodyRows.push(`<tr>${rowHtml}</tr>`);
        }

        out.push(
          `<table><thead><tr>${headerHtml}</tr></thead>` +
          `<tbody>${bodyRows.join('')}</tbody></table>`
        );
        continue;
      }

      /* ── Unordered list (+ GFM task list) or Ordered list ─────────── */
      if (/^[*\-+] /.test(trimmedLine) || /^\d+\. /.test(trimmedLine)) {
        const baseIndent = line.length - trimmedLine.length;
        const result     = parseListBlock(lines, i, baseIndent);
        out.push(result.html);
        i = result.nextIdx;
        continue;
      }

      /* ── Blank line ─────────────────────────────────────────────── */
      if (line.trim() === '') {
        i++;
        continue;
      }

      /* ── Paragraph ──────────────────────────────────────────────── */
      // Collect consecutive non-blank, non-block lines into one paragraph.
      // Use /^#{1,6} / (hash + space) as the boundary so a bare "#" with no
      // space is collected as plain text instead of blocking the loop.
      const paraLines = [];
      while (
        i < lines.length            &&
        lines[i].trim() !== ''      &&
        !/^#{1,6} /.test(lines[i].trimStart()) &&
        !/^ {0,3}```/.test(lines[i]) &&
        !lines[i].trimStart().startsWith('> ') &&
        lines[i].trim() !== '>'     &&
        !/^[*\-+] /.test(lines[i].trimStart()) &&
        !/^\d+\. /.test(lines[i].trimStart())  &&
        !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trimStart())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length) {
        const rawPara = paraLines.join('\n');
        const { text: mathPara, slots: mathParaSlots } = protectMath(rawPara);
        const escapedPara = escapeHtml(mathPara).replace(/\n/g, '<br>');
        out.push(`<p>${restoreMath(parseInline(escapedPara), mathParaSlots)}</p>`);
      } else {
        i++; // safety: no rule consumed this line — advance to prevent infinite loop
      }
    }

    return out.join('\n');
  }

  /* ── Public API ─────────────────────────────────────────────────── */
  return { parseMarkdown, escapeHtml, parseInline, parseInlineMath };

})();

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MarkdownRenderer };
  // katex is not available in Node/Jest, so math slots render as <code> fallbacks.
}
