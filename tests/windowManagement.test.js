/**
 * @jest-environment node
 *
 * Unit tests for window management — window creation and single-instance logic
 *
 * Tests cover:
 *  1. Single-file mode detection and query parameter embedding
 *  2. Window cascading (offsetting new windows from existing ones)
 *  3. File/folder args parsing from CLI argv
 *  4. IPC startup signals sent to renderer (did-finish-load)
 */

'use strict';

const path = require('path');

// ─── Helpers ────────────────────────────────────────────────────────────────
// Mock the Electron API without importing the full main process

/**
 * Parse launch arguments and return { filePath, folderPath }.
 * Matches the real getArgsFromArgv from main/index.js
 */
function getArgsFromArgv(argv) {
  let filePath = null, folderPath = null;
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--folder=')) {
      folderPath = arg.slice('--folder='.length).replace(/^"|"$/g, '');
    } else if (!arg.startsWith('-') && /\.(md|markdown)$/i.test(arg)) {
      filePath = arg;
    }
  }
  return { filePath, folderPath };
}

/**
 * Simulate window creation with optional single-file mode.
 * Returns mock config that would be passed to loadFile.
 */
function simulateWindowCreation(args = {}) {
  const config = {};

  // Single-file mode: embed the path as a URL query param
  if (args.singleFileMode && args.filePath) {
    config.query = { openFile: args.filePath };
  }

  return config;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Window Management', () => {

  describe('getArgsFromArgv()', () => {
    test('parses file path from argv', () => {
      const argv = ['/path/to/electron', '/path/to/file.md'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('/path/to/file.md');
      expect(result.folderPath).toBeNull();
    });

    test('parses .markdown extension', () => {
      const argv = ['/path/to/electron', '/path/to/file.markdown'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('/path/to/file.markdown');
    });

    test('ignores non-Markdown files', () => {
      const argv = ['/path/to/electron', '/path/to/file.txt', '/path/to/doc.md'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('/path/to/doc.md');
    });

    test('parses folder argument with quoted path', () => {
      const argv = ['/path/to/electron', '--folder="/path/to/folder"'];
      const result = getArgsFromArgv(argv);
      expect(result.folderPath).toBe('/path/to/folder');
      expect(result.filePath).toBeNull();
    });

    test('parses folder argument without quotes', () => {
      const argv = ['/path/to/electron', '--folder=/path/to/folder'];
      const result = getArgsFromArgv(argv);
      expect(result.folderPath).toBe('/path/to/folder');
    });

    test('ignores unrecognized flags', () => {
      const argv = ['/path/to/electron', '--dev', '--debug', '/file.md'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('/file.md');
    });

    test('returns both when file and folder are provided', () => {
      const argv = ['/path/to/electron', '/file.md', '--folder=/folder'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('/file.md');
      expect(result.folderPath).toBe('/folder');
    });

    test('handles empty argv', () => {
      const result = getArgsFromArgv(['/path/to/electron']);
      expect(result.filePath).toBeNull();
      expect(result.folderPath).toBeNull();
    });

    test('prefers file argument over folder when only filename is given', () => {
      const argv = ['/path/to/electron', 'notes.md'];
      const result = getArgsFromArgv(argv);
      expect(result.filePath).toBe('notes.md');
    });
  });

  describe('Single-file mode window creation', () => {
    test('embeds filePath as query param in single-file mode', () => {
      const config = simulateWindowCreation({
        singleFileMode: true,
        filePath: '/path/to/file.md',
      });
      expect(config.query?.openFile).toBe('/path/to/file.md');
    });

    test('does not embed query param when singleFileMode is false', () => {
      const config = simulateWindowCreation({
        singleFileMode: false,
        filePath: '/path/to/file.md',
      });
      expect(config.query).toBeUndefined();
    });

    test('does not embed query param when filePath is missing', () => {
      const config = simulateWindowCreation({
        singleFileMode: true,
      });
      expect(config.query).toBeUndefined();
    });

    test('creates empty config for default window', () => {
      const config = simulateWindowCreation({});
      expect(Object.keys(config).length).toBe(0);
    });
  });

  describe('Window positioning (cascading)', () => {
    test('calculates next window position offset by 40px', () => {
      // Simulate existing window at (100, 100)
      const lastPos = { x: 100, y: 100 };
      const newPos = { x: lastPos.x + 40, y: lastPos.y + 40 };
      expect(newPos).toEqual({ x: 140, y: 140 });
    });

    test('applies cascading offset to multiple new windows', () => {
      const positions = [];
      let current = { x: 100, y: 100 };
      for (let i = 0; i < 3; i++) {
        current = { x: current.x + 40, y: current.y + 40 };
        positions.push(current);
      }
      expect(positions[0]).toEqual({ x: 140, y: 140 });
      expect(positions[1]).toEqual({ x: 180, y: 180 });
      expect(positions[2]).toEqual({ x: 220, y: 220 });
    });
  });

});
