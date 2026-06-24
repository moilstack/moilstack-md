/**
 * Export Service — triggers a Markdown file download in the browser/renderer.
 *
 * Loaded as a plain <script> tag (no bundler), so it declares a global
 * `exportService` object.  The CommonJS export guard at the bottom makes the
 * same object importable by Jest / Node without modification to the browser path.
 *
 * Production upgrade path:
 *   Replace the Blob/anchor approach inside exportFile() with:
 *     return window.api.exportFile(filename, content);
 *   …where the preload exposes an IPC call to dialog.showSaveDialog in the
 *   Electron main process.
 */

const exportService = {
  /**
   * Trigger a file-download for the given Markdown content.
   *
   * @param {string} filename  Suggested download filename (e.g. "notes.md").
   * @param {string} content   Raw Markdown text to export.
   * @returns {Promise<void>}  Resolves when the download is triggered; rejects on error.
   */
  exportFile(filename, content) {
    return new Promise((resolve, reject) => {
      try {
        // ── Mock implementation: Blob → anchor → click ────────────────────
        const blob = new Blob([content], { type: 'text/markdown' });
        const url  = URL.createObjectURL(blob);

        const a      = document.createElement('a');
        a.href       = url;
        a.download   = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        resolve();
      } catch (err) {
        reject(err);
      }

      // ── Production Electron (replace block above) ─────────────────────
      // return window.api.exportFile(filename, content)
      //   .then(resolve).catch(reject);
    });
  },
};

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportService };
}
