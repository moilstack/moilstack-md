/**
 * Export Service — test utility only. Not part of the production export path.
 *
 * Loaded as a plain <script> tag (no bundler), so it declares a global
 * `exportService` object.  The CommonJS export guard at the bottom makes the
 * same object importable by Jest / Node without modification to the browser path.
 *
 * The production export path is SaveManager.exportFile → electronAPI.exportPdf
 * (see saveManager.js). This module's Blob/anchor download is only used in tests.
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
    });
  },
};

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportService };
}
