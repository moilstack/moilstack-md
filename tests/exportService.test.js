/**
 * @jest-environment jsdom
 *
 * Unit tests for exportService.exportFile() — four scenarios:
 *
 *  1. Resolves with undefined given valid content
 *  2. Creates a Blob with the correct MIME type (text/markdown)
 *  3. Creates an anchor element, sets href/download, and calls .click()
 *  4. Rejects with the correct error message when an error is thrown
 */

'use strict';

const { exportService } = require('../src/renderer/exportService');

// ─── Setup / teardown ──────────────────────────────────────────────────────────

/**
 * jsdom does not implement URL.createObjectURL / revokeObjectURL.
 * Define them once as jest.fn() so spyOn / mockReturnValue work normally.
 */
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = jest.fn();
  }
});

/** Restore all mocks after every test so they don't bleed across cases. */
afterEach(() => {
  jest.restoreAllMocks();
  // Re-attach the stubs in case restoreAllMocks removed the originals
  if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  if (!URL.revokeObjectURL) URL.revokeObjectURL = jest.fn();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('exportService.exportFile()', () => {

  // 1. Success path — resolves with undefined
  test('resolves with undefined when given valid content', async () => {
    // Minimal stubs so the DOM side-effects don't throw in jsdom
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = exportService.exportFile('notes.md', '# Hello');
    await expect(result).resolves.toBeUndefined();
  });

  // 2. Blob MIME type
  test('creates a Blob with type "text/markdown"', async () => {
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // jest.spyOn cannot proxy a class constructor — replace global.Blob with a
    // jest.fn() wrapper that delegates to the real constructor so the rest of
    // the code still gets a valid Blob instance.
    const RealBlob = global.Blob;
    const BlobSpy  = jest.fn(function (data, options) {
      return new RealBlob(data, options);
    });
    global.Blob = BlobSpy;

    try {
      await exportService.exportFile('doc.md', '## Section');
      expect(BlobSpy).toHaveBeenCalledWith(
        ['## Section'],
        { type: 'text/markdown' },
      );
    } finally {
      global.Blob = RealBlob; // always restore
    }
  });

  // 3. Anchor element — created, configured, clicked, and removed
  test('creates an anchor, sets href and download, calls click(), then removes it', async () => {
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const clickMock = jest.fn();
    const appendSpy = jest.spyOn(document.body, 'appendChild');
    const removeSpy = jest.spyOn(document.body, 'removeChild');

    // Use the real createElement but intercept <a> to inject our click mock
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = clickMock;
      return el;
    });

    await exportService.exportFile('export.md', '# Export Test');

    // href and download were set on the anchor
    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.href).toContain('blob:');
    expect(anchor.download).toBe('export.md');

    // click was triggered
    expect(clickMock).toHaveBeenCalledTimes(1);

    // anchor was removed from body afterwards
    expect(removeSpy).toHaveBeenCalledWith(anchor);

    // blob URL was revoked
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  // 4. Failure path — rejects with the correct error message
  test('rejects with an error message when Blob creation throws', async () => {
    // Force Blob constructor to throw
    jest.spyOn(global, 'Blob').mockImplementation(() => {
      throw new Error('Blob not supported');
    });

    const result = exportService.exportFile('fail.md', 'content');
    await expect(result).rejects.toThrow('Blob not supported');
  });

});
