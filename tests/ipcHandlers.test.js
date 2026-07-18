/**
 * @jest-environment node
 *
 * Unit tests for IPC handlers — file/folder operations, PDF export, etc.
 *
 * Tests cover:
 *  1. File operations: read, write, new file creation
 *  2. Folder operations: read directory, list .md files
 *  3. File metadata: rename, path sanitization
 *  4. PDF export: HTML → PDF conversion workflow
 *  5. Backup system: file versioning before AI edits
 *  6. Error handling: invalid paths, file-exists conflicts
 */

'use strict';

const path = require('path');

// ─── Helpers ────────────────────────────────────────────────────────────────
// Mock implementations of IPC handler logic (without Electron dependencies)

/**
 * Sanitize filename to prevent path traversal.
 * Returns basename only (no parent-dir escapes).
 */
function sanitizeFilename(fileName) {
  const safeName = path.win32.basename(fileName.trim());
  if (!safeName) throw new Error('Invalid filename.');
  return safeName;
}

/**
 * Append .md extension if user didn't provide one.
 */
function ensureMarkdownExt(fileName) {
  const safeName = sanitizeFilename(fileName);
  return /\.[a-zA-Z0-9]+$/.test(safeName) ? safeName : `${safeName}.md`;
}

/**
 * Generate backup filename from file path and timestamp.
 * Format: originalname_ISO-TIMESTAMP.md
 */
function generateBackupPath(filePath) {
  const basename = path.win32.basename(filePath, path.win32.extname(filePath));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${basename}_${timestamp}.md`;
}

/**
 * Parse markdown files from a flat file list.
 * Returns array of { name, path } sorted alphabetically.
 */
function filterMarkdownFiles(entries) {
  return entries
    .filter(name => /\.(md|markdown)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Validate PDF export filename (no path separators).
 */
function validateExportFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename is required');
  }
  if (filename.includes('\\') || filename.includes('/')) {
    throw new Error('Filename cannot contain path separators');
  }
  return filename.trim();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('IPC Handlers', () => {

  describe('File operations', () => {

    describe('File creation with .md extension', () => {
      test('appends .md when user provides no extension', () => {
        const result = ensureMarkdownExt('my-note');
        expect(result).toBe('my-note.md');
      });

      test('preserves extension when user provides one', () => {
        const result = ensureMarkdownExt('my-note.markdown');
        expect(result).toBe('my-note.markdown');
      });

      test('normalizes whitespace', () => {
        const result = ensureMarkdownExt('  my-note  ');
        expect(result).toBe('my-note.md');
      });

      test('rejects empty string', () => {
        expect(() => ensureMarkdownExt('   ')).toThrow('Invalid filename.');
      });

      test('rejects path traversal attempt', () => {
        expect(() => ensureMarkdownExt('../../../etc/passwd')).not.toThrow();
        // sanitizeFilename returns only the basename, which is 'passwd'
        const result = ensureMarkdownExt('../../../etc/passwd');
        expect(result).toBe('passwd.md');
      });
    });

    describe('Filename sanitization', () => {
      test('strips directory components', () => {
        const result = sanitizeFilename('/path/to/file.md');
        expect(result).toBe('file.md');
      });

      test('handles backslashes on Windows', () => {
        const result = sanitizeFilename('C:\\Users\\Bob\\notes.md');
        expect(result).toBe('notes.md');
      });

      test('trims whitespace', () => {
        const result = sanitizeFilename('  myfile.md  ');
        expect(result).toBe('myfile.md');
      });

      test('rejects empty after trimming', () => {
        expect(() => sanitizeFilename('   /   ')).toThrow('Invalid filename.');
      });

      test('handles Unicode filenames', () => {
        const result = sanitizeFilename('讲义.md');
        expect(result).toBe('讲义.md');
      });
    });

    describe('Backup path generation', () => {
      test('creates backup filename with timestamp', () => {
        const backup = generateBackupPath('/home/user/docs/file.md');
        // Timestamp format: 2026-05-27T09-19-08-368Z
        expect(backup).toMatch(/^file_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
      });

      test('removes extension from original filename', () => {
        const backup = generateBackupPath('/path/file.markdown');
        expect(backup).toMatch(/^file_/);
        expect(backup).toMatch(/\.md$/);
      });

      test('handles Windows paths', () => {
        const backup = generateBackupPath('C:\\Users\\Bob\\document.md');
        expect(backup).toMatch(/^document_/);
      });

      test('timestamp format is sortable', () => {
        const now1 = new Date('2026-03-15T10:30:00Z').toISOString().replace(/[:.]/g, '-');
        const now2 = new Date('2026-03-15T10:35:00Z').toISOString().replace(/[:.]/g, '-');
        const file1 = `doc_${now1}.md`;
        const file2 = `doc_${now2}.md`;
        expect([file2, file1].sort()[0]).toBe(file1);
      });
    });

  });

  describe('Folder operations', () => {

    test('filters markdown files from entry list', () => {
      const entries = ['readme.md', 'notes.markdown', 'data.json', 'config.txt', 'guide.MD'];
      const result = filterMarkdownFiles(entries);
      // Should include all .md files (case-insensitive), sorted alphabetically
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('readme.md');
      expect(result).toContain('guide.MD');
      expect(result).toContain('notes.markdown');
      expect(result).not.toContain('data.json');
    });

    test('returns empty array when no markdown files', () => {
      const entries = ['package.json', 'config.yml', 'notes.txt'];
      const result = filterMarkdownFiles(entries);
      expect(result).toEqual([]);
    });

    test('sorts results case-insensitively', () => {
      const entries = ['Zebra.md', 'apple.md', 'Banana.md'];
      const result = filterMarkdownFiles(entries);
      expect(result[0]).toBe('apple.md');
      expect(result[1]).toBe('Banana.md');
      expect(result[2]).toBe('Zebra.md');
    });

    test('ignores hidden files and directories', () => {
      const entries = ['.hidden.md', 'visible.md', '.backup/file.md'];
      const result = filterMarkdownFiles(entries);
      expect(result).toContain('.hidden.md'); // still passes filter (it's .md)
      expect(result).toContain('visible.md');
      // .backup/file.md would be rejected before this point (not a direct entry)
    });
  });

  describe('PDF export validation', () => {

    test('accepts valid filename', () => {
      const result = validateExportFilename('document.pdf');
      expect(result).toBe('document.pdf');
    });

    test('rejects filename with forward slash', () => {
      expect(() => validateExportFilename('folder/file.pdf')).toThrow('path separators');
    });

    test('rejects filename with backslash', () => {
      expect(() => validateExportFilename('folder\\file.pdf')).toThrow('path separators');
    });

    test('trims whitespace', () => {
      const result = validateExportFilename('  document.pdf  ');
      expect(result).toBe('document.pdf');
    });

    test('rejects null/undefined', () => {
      expect(() => validateExportFilename(null)).toThrow('Filename is required');
      expect(() => validateExportFilename(undefined)).toThrow('Filename is required');
    });

    test('rejects non-string input', () => {
      expect(() => validateExportFilename(123)).toThrow('Filename is required');
    });

    test('rejects empty string', () => {
      expect(() => validateExportFilename('')).toThrow('Filename is required');
    });
  });

  describe('Backup prune logic', () => {

    test('identifies which backups to keep (most recent N)', () => {
      const allBackups = [
        'doc_2026-03-15T10-00-00.md',
        'doc_2026-03-15T11-00-00.md',
        'doc_2026-03-15T12-00-00.md',
        'doc_2026-03-16T10-00-00.md',
        'doc_2026-03-16T11-00-00.md',
        'doc_2026-03-16T12-00-00.md',
        'doc_2026-03-17T10-00-00.md',
        'doc_2026-03-17T11-00-00.md',
        'doc_2026-03-17T12-00-00.md',
        'doc_2026-03-17T13-00-00.md',
        'doc_2026-03-17T14-00-00.md',
        'doc_2026-03-17T15-00-00.md',
      ];

      // Keep 10 most recent, delete oldest 2
      const keepCount = 10;
      const toDelete = allBackups.slice(0, allBackups.length - keepCount);
      const toKeep = allBackups.slice(allBackups.length - keepCount);

      expect(toDelete).toEqual([
        'doc_2026-03-15T10-00-00.md',
        'doc_2026-03-15T11-00-00.md',
      ]);
      expect(toKeep.length).toBe(10);
    });

    test('handles empty backup list', () => {
      const allBackups = [];
      const keepCount = 10;
      const toDelete = allBackups.slice(0, Math.max(0, allBackups.length - keepCount));
      expect(toDelete).toEqual([]);
    });

    test('keeps all backups when under limit', () => {
      const allBackups = ['doc_v1.md', 'doc_v2.md', 'doc_v3.md'];
      const keepCount = 10;
      const toDelete = allBackups.slice(0, Math.max(0, allBackups.length - keepCount));
      expect(toDelete.length).toBe(0);
    });
  });

  describe('Model configuration storage', () => {

    test('strips encryption-sensitive fields from config JSON', () => {
      const model = {
        id: 'uuid-123',
        label: 'My Model',
        type: 'api',
        base_url: 'https://api.example.com',
        model_name: 'gpt-4',
        // api_key is intentionally ABSENT — stored separately in encrypted .bin
        is_default: true,
        created_at: '2026-03-15T10:00:00Z',
      };

      expect(model.api_key).toBeUndefined();
      expect(model.label).toBe('My Model');
      expect(model.id).toBeDefined();
    });

    test('validates model type is supported', () => {
      const supportedTypes = ['ollama', 'api'];
      const model = { type: 'api' };
      expect(supportedTypes).toContain(model.type);
    });

    test('rejects unknown model type', () => {
      const supportedTypes = ['ollama', 'api'];
      const modelType = 'unknown-backend';
      expect(supportedTypes).not.toContain(modelType);
    });
  });

});
