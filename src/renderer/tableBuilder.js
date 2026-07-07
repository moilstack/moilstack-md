/**
 * tableBuilder.js — Visual table builder modal.
 *
 * Column names and alignment are edited directly in the grid header row.
 * "+" at the end of the header adds a column; "×" on each header removes it.
 * Selecting an existing MD table before opening pre-fills all data.
 */

const TableBuilder = (() => {

  const _overlay  = document.getElementById('tableBuilderOverlay');
  const _rowsWrap = document.getElementById('tblRowsWrap');

  /* ── State ────────────────────────────────────────────────────────── */

  let _cols     = []; // [{ name, align: 'left'|'center'|'right' }]
  let _rows     = []; // string[][]
  let _selStart = null;
  let _selEnd   = null;

  /* ── Markdown table parser ────────────────────────────────────────── */

  function parseTable(md) {
    const lines = md.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    if (!lines.every(l => l.startsWith('|') && l.endsWith('|'))) return null;

    const parseRow = l => l.slice(1, -1).split('|').map(c => c.trim());
    const header   = parseRow(lines[0]);
    const seps     = parseRow(lines[1]);
    if (seps.length !== header.length) return null;
    if (!seps.every(s => /^:?-+:?$/.test(s))) return null;

    const cols = header.map((name, i) => {
      const s = seps[i];
      const align = s.startsWith(':') && s.endsWith(':') ? 'center'
                  : s.endsWith(':')                       ? 'right'
                                                          : 'left';
      return { name, align };
    });

    const rows = lines.slice(2).map(l => {
      const cells = parseRow(l);
      return Array.from({ length: cols.length }, (_, i) => cells[i] ?? '');
    });

    return { cols, rows };
  }

  /* ── Column helpers ───────────────────────────────────────────────── */

  function _addColumn() {
    _cols.push({ name: `Col ${_cols.length + 1}`, align: 'left' });
    _rows.forEach(r => r.push(''));
    _render();
  }

  function _removeColumn(ci) {
    if (_cols.length <= 1) return;
    _cols.splice(ci, 1);
    _rows.forEach(r => r.splice(ci, 1));
    _render();
  }

  /* ── Row helpers ──────────────────────────────────────────────────── */

  function _addRow() {
    _rows.push(_cols.map(() => ''));
    _render();
    requestAnimationFrame(() => {
      const cells = _rowsWrap?.querySelectorAll('tbody tr:last-child td textarea');
      if (cells?.length) cells[0].focus();
    });
  }

  function _removeRow(ri) {
    _rows.splice(ri, 1);
    _render();
  }

  /* ── Alignment button helper ──────────────────────────────────────── */

  function _applyAlign(btn, align) {
    btn.textContent    = align === 'center' ? 'C' : align === 'right' ? 'R' : 'L';
    btn.dataset.align  = align;
    btn.title          = `Alignment: ${align} — click to cycle`;
  }

  /* ── Render the entire grid ───────────────────────────────────────── */

  function _render() {
    if (!_rowsWrap) return;
    _rowsWrap.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'tbl-data-grid';

    /* ── Header row (editable column names + controls) ── */
    const thead = document.createElement('thead');
    const htr   = document.createElement('tr');

    _cols.forEach((col, ci) => {
      const th   = document.createElement('th');
      th.className = 'tbl-col-header';

      const wrap = document.createElement('div');
      wrap.className = 'tbl-col-header-wrap';

      const nameInput = document.createElement('input');
      nameInput.type         = 'text';
      nameInput.className    = 'form-input tbl-col-header-input';
      nameInput.value        = col.name;
      nameInput.placeholder  = `Col ${ci + 1}`;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck   = false;
      nameInput.addEventListener('input', () => { _cols[ci].name = nameInput.value; });

      const alignBtn = document.createElement('button');
      alignBtn.className = 'tbl-align-btn';
      alignBtn.type      = 'button';
      _applyAlign(alignBtn, col.align);
      alignBtn.addEventListener('click', () => {
        const next = { left: 'center', center: 'right', right: 'left' }[_cols[ci].align];
        _cols[ci].align = next;
        _applyAlign(alignBtn, next);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type        = 'button';
      removeBtn.className   = 'tbl-remove-btn';
      removeBtn.title       = 'Remove column';
      removeBtn.textContent = '×';
      removeBtn.disabled    = _cols.length <= 1;
      removeBtn.addEventListener('click', () => _removeColumn(ci));

      wrap.appendChild(nameInput);
      wrap.appendChild(alignBtn);
      wrap.appendChild(removeBtn);
      th.appendChild(wrap);
      htr.appendChild(th);
    });

    // "+" add-column cell at end of header
    const thAdd = document.createElement('th');
    thAdd.className = 'tbl-add-col-th';
    const addColBtn = document.createElement('button');
    addColBtn.type      = 'button';
    addColBtn.className = 'tbl-add-col-btn';
    addColBtn.title     = 'Add column';
    addColBtn.textContent = '+';
    addColBtn.addEventListener('click', _addColumn);
    thAdd.appendChild(addColBtn);
    htr.appendChild(thAdd);

    thead.appendChild(htr);
    table.appendChild(thead);

    /* ── Body rows ── */
    if (_rows.length > 0) {
      const tbody = document.createElement('tbody');
      _rows.forEach((rowData, ri) => {
        const tr = document.createElement('tr');

        _cols.forEach((_, ci) => {
          const td  = document.createElement('td');
          const inp = document.createElement('textarea');
          inp.className    = 'form-input tbl-cell-input';
          inp.value        = rowData[ci] || '';
          inp.autocomplete = 'off';
          inp.spellcheck   = false;
          inp.rows         = 1;
          inp.addEventListener('input', () => { _rows[ri][ci] = inp.value; });
          inp.addEventListener('keydown', e => {
            if (e.key === 'Tab' && !e.shiftKey &&
                ci === _cols.length - 1 && ri === _rows.length - 1) {
              e.preventDefault();
              _addRow();
            }
          });
          td.appendChild(inp);
          tr.appendChild(td);
        });

        // Remove-row cell aligned with add-column header cell
        const tdRm  = document.createElement('td');
        tdRm.className = 'tbl-row-remove-td';
        const rmBtn = document.createElement('button');
        rmBtn.type        = 'button';
        rmBtn.className   = 'tbl-remove-btn';
        rmBtn.title       = 'Remove row';
        rmBtn.textContent = '×';
        rmBtn.addEventListener('click', () => _removeRow(ri));
        tdRm.appendChild(rmBtn);
        tr.appendChild(tdRm);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }

    _rowsWrap.appendChild(table);
  }

  /* ── Markdown generation ──────────────────────────────────────────── */

  function _buildMd() {
    const colWidths = _cols.map((col, i) => {
      const headerLen = (col.name || `Col ${i + 1}`).length;
      const dataMax   = _rows.reduce((max, r) => Math.max(max, (r[i] || '').length), 0);
      return Math.max(headerLen, dataMax, 3);
    });

    const pad = (str, w) => str + ' '.repeat(Math.max(0, w - str.length));

    const header = '| ' + _cols.map((c, i) =>
      pad(c.name || `Col ${i + 1}`, colWidths[i])).join(' | ') + ' |';

    const sep = '| ' + _cols.map((c, i) => {
      const w = colWidths[i];
      if (c.align === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':';
      if (c.align === 'right')  return '-'.repeat(Math.max(1, w - 1)) + ':';
      return '-'.repeat(w);
    }).join(' | ') + ' |';

    const dataRows = _rows.map(r =>
      '| ' + _cols.map((_, i) => pad(r[i] || '', colWidths[i])).join(' | ') + ' |'
    );

    return [header, sep, ...dataRows].join('\n');
  }

  /* ── Save / insert ────────────────────────────────────────────────── */

  function _save() {
    const md     = _buildMd();
    const editor = document.getElementById('mdEditor');
    if (!editor) { _hide(); return; }

    editor.focus();

    if (_selStart !== null && _selEnd !== null) {
      editor.setSelectionRange(_selStart, _selEnd);
      editor.setRangeText(md, _selStart, _selEnd, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const pos    = editor.selectionStart;
      const val    = editor.value;
      const before = pos > 0 && val[pos - 1] !== '\n' ? '\n' : '';
      const after  = pos < val.length && val[pos] !== '\n' ? '\n' : '';
      editor.setSelectionRange(pos, pos);
      editor.setRangeText(before + md + after, pos, pos, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (typeof EditorCore !== 'undefined') EditorCore.triggerUpdate();
    _hide();
  }

  /* ── Show / hide ──────────────────────────────────────────────────── */

  function show(opts = {}) {
    const { cols, rows, selStart, selEnd } = opts;

    if (cols && rows) {
      _cols     = cols.map(c => ({ ...c }));
      _rows     = rows.map(r => [...r]);
      _selStart = selStart ?? null;
      _selEnd   = selEnd   ?? null;
    } else {
      _cols     = [
        { name: 'Column 1', align: 'left' },
        { name: 'Column 2', align: 'left' },
        { name: 'Column 3', align: 'left' },
      ];
      _rows     = [['', '', ''], ['', '', '']];
      _selStart = null;
      _selEnd   = null;
    }

    const saveBtn = document.getElementById('btnTblInsert');
    if (saveBtn) saveBtn.textContent = _selStart !== null ? 'Save' : 'Insert';

    _render();
    _overlay?.classList.remove('hidden');
    requestAnimationFrame(() =>
      _rowsWrap?.querySelector('tbody textarea')?.focus()
    );
  }

  function _hide() {
    _overlay?.classList.add('hidden');
  }

  /* ── Button wiring ────────────────────────────────────────────────── */

  document.getElementById('btnCloseTableBuilder')?.addEventListener('click', _hide);
  document.getElementById('btnTblCancel')?.addEventListener('click', _hide);
  document.getElementById('btnTblInsert')?.addEventListener('click', _save);
  document.getElementById('btnTblAddRow')?.addEventListener('click', _addRow);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_overlay?.classList.contains('hidden')) _hide();
  });

  return { show, parseTable };

})();
