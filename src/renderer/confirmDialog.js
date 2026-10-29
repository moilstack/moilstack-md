/**
 * confirmDialog.js — app-styled replacement for window.confirm().
 *
 *   const ok = await ConfirmDialog.ask({
 *     title: 'Delete task?',
 *     message: '"Draft API spec" will be removed.',
 *     okLabel: 'Delete',
 *     danger: true,
 *   });
 *
 * Reuses the .label-modal shell (same look as the Tags dialog). Enter
 * confirms, Esc / Cancel / clicking outside cancels. Focus returns to
 * whatever had it before. Only one dialog is open at a time; asking again
 * cancels the earlier one.
 */

const ConfirmDialog = (() => {
  let _overlay = null;
  let _resolve = null;

  function _build() {
    _overlay = document.createElement('div');
    _overlay.className = 'label-modal-overlay confirm-dialog hidden';
    _overlay.setAttribute('role', 'alertdialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.innerHTML = `
      <div class="label-modal">
        <div class="label-modal__header">
          <span class="label-modal__title" id="confirmDialogTitle"></span>
        </div>
        <div class="label-modal__body">
          <p class="confirm-dialog__message" id="confirmDialogMessage"></p>
          <p class="confirm-dialog__note hidden"></p>
          <div class="label-modal__actions">
            <button type="button" class="btn btn-outline btn-sm confirm-dialog__cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm confirm-dialog__ok">OK</button>
          </div>
        </div>
      </div>`;
    _overlay.setAttribute('aria-labelledby', 'confirmDialogTitle');
    _overlay.setAttribute('aria-describedby', 'confirmDialogMessage');
    document.body.append(_overlay);

    _overlay.querySelector('.confirm-dialog__cancel').addEventListener('click', () => _close(false));
    _overlay.querySelector('.confirm-dialog__ok').addEventListener('click', () => _close(true));
    _overlay.addEventListener('mousedown', (e) => { if (e.target === _overlay) _close(false); });
    _overlay.addEventListener('keydown', (e) => {
      // Keep these keys from reaching the views underneath (Esc would close them too)
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); _close(false); }
      if (e.key === 'Enter' && !e.target.classList.contains('confirm-dialog__cancel')) { e.preventDefault(); _close(true); }
      if (e.key === 'Tab') {
        // Keep focus on the two buttons
        const [cancel, ok] = _overlay.querySelectorAll('button');
        if (e.shiftKey && document.activeElement === cancel) { e.preventDefault(); ok.focus(); }
        else if (!e.shiftKey && document.activeElement === ok) { e.preventDefault(); cancel.focus(); }
      }
    });
  }

  let _returnFocus = null;

  function _close(result) {
    if (!_resolve) return;
    _overlay.classList.add('hidden');
    const done = _resolve;
    _resolve = null;
    _returnFocus?.focus?.();
    _returnFocus = null;
    done(result);
  }

  /**
   * @param {object} opts
   *   title     heading, e.g. "Delete idea?"
   *   message   main line
   *   note      optional smaller line under it
   *   okLabel   confirm button text (default "OK")
   *   danger    red confirm button
   * @returns {Promise<boolean>}
   */
  function ask({ title = 'Are you sure?', message = '', note = '', okLabel = 'OK', danger = false } = {}) {
    if (!_overlay) _build();
    _close(false); // an earlier dialog still open counts as cancelled
    _returnFocus = document.activeElement;
    _overlay.querySelector('.label-modal__title').textContent = title;
    _overlay.querySelector('.confirm-dialog__message').textContent = message;
    const noteEl = _overlay.querySelector('.confirm-dialog__note');
    noteEl.textContent = note;
    noteEl.classList.toggle('hidden', !note);
    const ok = _overlay.querySelector('.confirm-dialog__ok');
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', danger);
    ok.classList.toggle('btn-primary', !danger);
    _overlay.classList.remove('hidden');
    ok.focus();
    return new Promise((resolve) => { _resolve = resolve; });
  }

  return { ask };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConfirmDialog };
}
