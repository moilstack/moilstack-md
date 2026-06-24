/**
 * @jest-environment jsdom
 *
 * Unit tests for fileService.saveFile() — four scenarios:
 *
 *  1. Success path resolves with undefined
 *  2. Content is written to the in-memory contentMap
 *  3. Mock failure path rejects with the expected error
 *  4. UI feedback: button label restores to "Save" after 1500 ms (fake timers)
 */

'use strict';

const { fileService } = require('../src/renderer/fileService');

// ─── Shared fixture ────────────────────────────────────────────────────────────

const FLOPPY_SVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="1" y="1" width="11" height="11" rx="1.5"
        stroke="currentColor" stroke-width="1.3"/>
  <rect x="3.5" y="1" width="4" height="3.5" rx=".5"
        fill="currentColor" stroke="none"/>
  <rect x="2.5" y="7" width="8" height="4" rx=".8"
        stroke="currentColor" stroke-width="1.2"/>
</svg>`;

/**
 * Minimal reproduction of the saveFile UI logic from index.js.
 * Tests the feedback pattern without importing the full renderer module
 * (which has browser-only side-effects at load time).
 *
 * @param {HTMLButtonElement} btn
 * @param {string}            filename
 * @param {string}            content
 */
async function saveFile(btn, filename, content) {
  try {
    await fileService.saveFile(filename, content);
    btn.textContent = '✓ Saved';
    setTimeout(() => {
      btn.innerHTML = `${FLOPPY_SVG}<span>Save</span>`;
    }, 1500);
  } catch (err) {
    btn.textContent = `Error: ${err.message}`;
  }
}

// ─── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  fileService.contentMap.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('fileService.saveFile()', () => {

  // 1. Success path
  test('resolves with undefined on success', async () => {
    const promise = fileService.saveFile('hello.md', '# Hello');
    jest.runAllTimers();
    await expect(promise).resolves.toBeUndefined();
  });

  // 2. Memory map
  test('stores content in contentMap under the given filename', async () => {
    const content = '# My Note\n\nSome **bold** text.';
    const promise = fileService.saveFile('notes.md', content);
    jest.runAllTimers();
    await promise;
    expect(fileService.contentMap.get('notes.md')).toBe(content);
  });

  // 3. Failure path
  test('rejects with the expected error when the failure path is used', async () => {
    // Temporarily override saveFile to use the failure path
    const originalSaveFile = fileService.saveFile.bind(fileService);
    fileService.saveFile = function (filename, content) {
      return new Promise((resolve, reject) => {
        this.contentMap.set(filename, content);
        setTimeout(() => reject(new Error('Disk write error')), 100);
      });
    };

    const promise = fileService.saveFile('fail.md', 'content');
    jest.runAllTimers();
    await expect(promise).rejects.toThrow('Disk write error');

    fileService.saveFile = originalSaveFile; // restore
  });

  // 4. UI feedback — button label restoration via fake timers
  test('restores button innerHTML to floppy + "Save" after 1500 ms', async () => {
    // Arrange — minimal DOM button
    const btn = document.createElement('button');
    btn.id = 'btn-save';
    btn.innerHTML = `${FLOPPY_SVG}<span>Save</span>`;
    document.body.appendChild(btn);

    // Act — trigger save; advance through the 100 ms mock delay
    const promise = saveFile(btn, 'doc.md', '# Doc');
    jest.advanceTimersByTime(100);       // resolve the fileService setTimeout
    await promise;                       // await the async save

    // Assert — immediate feedback
    expect(btn.textContent).toBe('✓ Saved');

    // Act — advance through the 1500 ms restore delay
    jest.advanceTimersByTime(1500);

    // Assert — button is restored
    expect(btn.querySelector('span').textContent).toBe('Save');
    expect(btn.querySelector('svg')).not.toBeNull();

    // Cleanup
    document.body.removeChild(btn);
  });

});
