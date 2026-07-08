/**
 * @jest-environment jsdom
 *
 * Unit tests for SaveManager — the real save/export flows in
 * src/renderer/saveManager.js.
 *
 * Tests cover:
 *  1. saveFile() writes via electronAPI.writeFile and marks the doc clean
 *  2. saveFile() surfaces an error and stays dirty when writeFile fails
 *  3. silentSave() resolves true on success, false on failure
 *  4. markDirty() / markClean() toggle isDirty()
 *  5. exportFile() renders Markdown to HTML and calls electronAPI.exportPdf
 *
 * saveManager.js reads `currentFile`, `mdEditor`, `FileTreeManager`,
 * `ModalManager`, `StatusBar`, and `MarkdownRenderer` as bare globals (it's
 * loaded as a plain <script> tag in the browser). We stub all of them on
 * `global` before each require() so the module resolves them the same way
 * it would at runtime.
 */

'use strict';

describe('SaveManager', () => {
  let SaveManager;
  let btnSave;
  let btnExport;
  let editor;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    document.body.innerHTML = `
      <button id="btn-save"></button>
      <button id="btn-export"></button>
      <textarea id="mdEditor"></textarea>
    `;
    btnSave   = document.getElementById('btn-save');
    btnExport = document.getElementById('btn-export');
    editor    = document.getElementById('mdEditor');
    editor.value = '# Hello world';

    global.currentFile = { name: 'test.md', path: 'C:\\notes\\test.md' };
    global.mdEditor    = editor;

    global.FileTreeManager = { touchFile: jest.fn() };
    global.ModalManager    = { showSaveAsModal: jest.fn() };
    global.StatusBar       = { showToast: jest.fn() };
    global.MarkdownRenderer = {
      parseMarkdown: jest.fn(md => `<p>${md}</p>`),
      escapeHtml:    jest.fn(s => s),
    };

    window.electronAPI = {
      writeFile:       jest.fn().mockResolvedValue({ ok: true }),
      exportPdf:       jest.fn().mockResolvedValue({ ok: true }),
      readFileBase64:  jest.fn(),
    };

    ({ SaveManager } = require('../src/renderer/saveManager'));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete global.currentFile;
    delete global.mdEditor;
    delete global.FileTreeManager;
    delete global.ModalManager;
    delete global.StatusBar;
    delete global.MarkdownRenderer;
    delete window.electronAPI;
  });

  // 1. saveFile() success path
  test('saveFile() calls electronAPI.writeFile with filePath/content and marks the doc clean', async () => {
    SaveManager.markDirty();

    await SaveManager.saveFile();

    expect(window.electronAPI.writeFile).toHaveBeenCalledWith(
      'C:\\notes\\test.md',
      '# Hello world',
    );
    expect(SaveManager.isDirty()).toBe(false);
  });

  // 2. saveFile() failure path
  test('saveFile() shows an error and does not mark clean when writeFile fails', async () => {
    window.electronAPI.writeFile.mockResolvedValueOnce({ ok: false, error: 'write failed' });
    SaveManager.markDirty();

    await SaveManager.saveFile();

    expect(SaveManager.isDirty()).toBe(true);
    expect(global.StatusBar.showToast).toHaveBeenCalledWith('Save failed: write failed');
  });

  // 3. silentSave() resolves true/false
  test('silentSave() resolves true on success', async () => {
    SaveManager.markDirty();

    const result = await SaveManager.silentSave();

    expect(result).toBe(true);
    expect(window.electronAPI.writeFile).toHaveBeenCalledWith(
      'C:\\notes\\test.md',
      '# Hello world',
    );
    expect(SaveManager.isDirty()).toBe(false);
  });

  test('silentSave() resolves false when writeFile fails', async () => {
    window.electronAPI.writeFile.mockResolvedValueOnce({ ok: false, error: 'write failed' });
    SaveManager.markDirty();

    const result = await SaveManager.silentSave();

    expect(result).toBe(false);
    expect(SaveManager.isDirty()).toBe(true);
  });

  // 4. markDirty()/markClean() toggle isDirty()
  test('markDirty() sets isDirty() true; markClean() sets it back to false', () => {
    expect(SaveManager.isDirty()).toBe(false);

    SaveManager.markDirty();
    expect(SaveManager.isDirty()).toBe(true);

    SaveManager.markClean();
    expect(SaveManager.isDirty()).toBe(false);
  });

  // 5. exportFile() renders HTML and calls electronAPI.exportPdf
  test('exportFile() calls electronAPI.exportPdf with the rendered HTML and filename', async () => {
    editor.value = '# Title';
    global.currentFile.name = 'test.md';

    await SaveManager.exportFile();

    expect(global.MarkdownRenderer.parseMarkdown).toHaveBeenCalledWith('# Title');
    expect(window.electronAPI.exportPdf).toHaveBeenCalledTimes(1);

    const [html, filename] = window.electronAPI.exportPdf.mock.calls[0];
    expect(filename).toBe('test.md');
    expect(html).toContain('<body><p># Title</p></body>');
  });

  test('exportFile() does nothing when the document is empty', async () => {
    editor.value = '   ';

    await SaveManager.exportFile();

    expect(window.electronAPI.exportPdf).not.toHaveBeenCalled();
    expect(global.StatusBar.showToast).toHaveBeenCalledWith(
      'Nothing to export — the document is empty.',
    );
  });

});
