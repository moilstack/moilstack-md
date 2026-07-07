/**
 * File Service — test utility only. Not part of the production save path.
 *
 * The renderer loads this as a plain <script> tag (no bundler), so it
 * declares a global `fileService` object.  The CommonJS export guard at
 * the bottom makes the same object importable by Jest / Node without any
 * modification to the browser path.
 *
 * The production save path is SaveManager → electronAPI.writeFile
 * (see saveManager.js). This module's setTimeout-based mock is only used
 * in tests.
 */

const fileService = {
  /** @type {Map<string, string>} In-memory store: filename → content */
  contentMap: new Map(),

  /**
   * Save file content.
   *
   * Success path  — stores content in `contentMap` and resolves after ~100 ms.
   * Failure path  — uncomment the `reject` setTimeout to simulate a disk error.
   *
   * @param {string} filename
   * @param {string} content
   * @returns {Promise<void>}
   */
  saveFile(filename, content) {
    return new Promise((resolve, reject) => {
      this.contentMap.set(filename, content);

      // ── Real IPC (uncomment when ready) ──────────────────────────────
      // return window.electronAPI.writeFile(filename, content)
      //   .then(resolve).catch(reject);

      // ── Mock: success ─────────────────────────────────────────────────
      setTimeout(() => resolve(), 100);

      // ── Mock: failure (uncomment to test error-handling UI) ───────────
      // setTimeout(() => reject(new Error('Disk write error')), 100);
    });
  },
};

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fileService };
}
