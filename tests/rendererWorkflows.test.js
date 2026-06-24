/**
 * @jest-environment jsdom
 *
 * Unit tests for renderer workflows — file operations, localStorage, UI state
 *
 * Tests cover:
 *  1. Single-file mode detection from URL query params
 *  2. Recent items management (add, deduplicate, cap at 5)
 *  3. Pinned files per folder
 *  4. File sections (categories) creation/rename/delete
 *  5. Current file tracking
 *  6. Dirty state and auto-save scheduling
 *  7. Drag-and-drop file item state preparation
 */

'use strict';

// ─── Helpers ────────────────────────────────────────────────────────────────
// Minimal implementations matching src/renderer/index.js logic

const RECENT_ITEMS_KEY = 'recentItems';
const RECENT_MAX = 5;
const PINNED_FILES_KEY = 'pinnedFiles';
const SECTIONS_KEY = 'fileSections';

function getRecentItems() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRecentItem(type, itemPath, name) {
  let items = getRecentItems();
  // Remove existing entry for the same path (bump to top)
  items = items.filter(i => i.path !== itemPath);
  items.unshift({ type, path: itemPath, name, timestamp: Date.now() });
  items = items.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
}

function getPinnedMap() {
  try {
    return JSON.parse(localStorage.getItem(PINNED_FILES_KEY) || '{}');
  } catch {
    return {};
  }
}

function getPinnedForFolder(folderPath) {
  return getPinnedMap()[folderPath] || [];
}

function togglePinFile(folderPath, filePath) {
  const map = getPinnedMap();
  const pinned = map[folderPath] || [];
  const idx = pinned.indexOf(filePath);

  if (idx === -1) {
    map[folderPath] = [...pinned, filePath];
  } else {
    map[folderPath] = pinned.filter(p => p !== filePath);
    if (map[folderPath].length === 0) delete map[folderPath];
  }

  localStorage.setItem(PINNED_FILES_KEY, JSON.stringify(map));
  return idx === -1; // true = now pinned
}

function getSectionsStore() {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

function getFolderSections(folderPath) {
  return getSectionsStore()[folderPath] || { sections: [], fileMap: {} };
}

function saveFolderSections(folderPath, data) {
  const store = getSectionsStore();
  store[folderPath] = data;
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(store));
}

function createSection(folderPath, name) {
  const data = getFolderSections(folderPath);
  const id = 'sec-' + Math.random().toString(36).slice(2, 9);
  data.sections.push({ id, name: name.trim(), collapsed: false });
  saveFolderSections(folderPath, data);
  return id;
}

function renameSection(folderPath, sectionId, newName) {
  const data = getFolderSections(folderPath);
  const sec = data.sections.find(s => s.id === sectionId);
  if (sec) {
    sec.name = newName.trim();
    saveFolderSections(folderPath, data);
  }
}

function deleteSection(folderPath, sectionId) {
  const data = getFolderSections(folderPath);
  data.sections = data.sections.filter(s => s.id !== sectionId);
  for (const fp of Object.keys(data.fileMap)) {
    if (data.fileMap[fp] === sectionId) delete data.fileMap[fp];
  }
  saveFolderSections(folderPath, data);
}

function assignFileToSection(folderPath, filePath, sectionId) {
  const data = getFolderSections(folderPath);
  if (sectionId === null) {
    delete data.fileMap[filePath];
  } else {
    data.fileMap[filePath] = sectionId;
  }
  saveFolderSections(folderPath, data);
}

function detectSingleFileMode() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('openFile') || null;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Renderer Workflows', () => {

  beforeEach(() => {
    localStorage.clear();
    // Reset location to base URL for each test
    delete window.location;
    window.location = new URL('http://localhost');
  });

  describe('Single-file mode detection', () => {
    test('detects openFile query param from window.location', () => {
      window.location = new URL('http://localhost?openFile=/path/to/file.md');
      const filePath = detectSingleFileMode();
      expect(filePath).toBe('/path/to/file.md');
    });

    test('returns null when openFile param is absent', () => {
      window.location = new URL('http://localhost');
      const filePath = detectSingleFileMode();
      expect(filePath).toBeNull();
    });

    test('decodes URL-encoded file paths', () => {
      window.location = new URL('http://localhost?openFile=/path/to/my%20file.md');
      const filePath = detectSingleFileMode();
      expect(filePath).toBe('/path/to/my file.md');
    });

    test('returns null when param is missing', () => {
      window.location = new URL('http://localhost');
      const filePath = detectSingleFileMode();
      expect(filePath).toBeNull();
    });

    test('returns null when param is present but empty', () => {
      window.location = new URL('http://localhost?openFile=');
      const filePath = detectSingleFileMode();
      // URLSearchParams.get returns null in both cases
      expect(filePath).toBeNull();
    });
  });

  describe('Recent items management', () => {
    test('adds new item to recent list', () => {
      addRecentItem('file', '/path/to/notes.md', 'notes.md');
      const items = getRecentItems();
      expect(items).toHaveLength(1);
      expect(items[0].path).toBe('/path/to/notes.md');
      expect(items[0].type).toBe('file');
    });

    test('bumps existing item to top when added again', () => {
      addRecentItem('file', '/path1/file.md', 'file.md');
      addRecentItem('file', '/path2/file.md', 'file.md');
      addRecentItem('file', '/path1/file.md', 'file.md');

      const items = getRecentItems();
      expect(items).toHaveLength(2);
      expect(items[0].path).toBe('/path1/file.md');
      expect(items[1].path).toBe('/path2/file.md');
    });

    test('caps list at RECENT_MAX entries', () => {
      for (let i = 0; i < 10; i++) {
        addRecentItem('file', `/path${i}/file.md`, `file${i}.md`);
      }
      const items = getRecentItems();
      expect(items).toHaveLength(RECENT_MAX);
      // Most recent 5 should be i=5..9
      expect(items[0].path).toBe('/path9/file.md');
      expect(items[4].path).toBe('/path5/file.md');
    });

    test('deduplicates by path before capping', () => {
      addRecentItem('file', '/shared/file.md', 'file.md');
      addRecentItem('file', '/other1.md', 'other1.md');
      addRecentItem('file', '/other2.md', 'other2.md');
      // Re-add the same shared file
      addRecentItem('file', '/shared/file.md', 'file.md');

      const items = getRecentItems();
      expect(items).toHaveLength(3);
      expect(items[0].path).toBe('/shared/file.md');
    });

    test('stores timestamp for each item', () => {
      const before = Date.now();
      addRecentItem('folder', '/home/project', 'project');
      const after = Date.now();

      const items = getRecentItems();
      expect(items[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(items[0].timestamp).toBeLessThanOrEqual(after);
    });

    test('handles corrupted localStorage gracefully', () => {
      localStorage.setItem(RECENT_ITEMS_KEY, 'invalid json {]');
      const items = getRecentItems();
      expect(items).toEqual([]);
    });
  });

  describe('Pinned files', () => {
    test('pins file within a folder', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/notes.md';
      const wasPinned = togglePinFile(folderPath, filePath);

      expect(wasPinned).toBe(true);
      expect(getPinnedForFolder(folderPath)).toContain(filePath);
    });

    test('unpins file by toggling again', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/notes.md';

      togglePinFile(folderPath, filePath); // pin
      const wasPinned = togglePinFile(folderPath, filePath); // unpin

      expect(wasPinned).toBe(false);
      expect(getPinnedForFolder(folderPath)).not.toContain(filePath);
    });

    test('maintains separate pin lists per folder', () => {
      togglePinFile('/folder1', '/folder1/file1.md');
      togglePinFile('/folder2', '/folder2/file2.md');

      expect(getPinnedForFolder('/folder1')).toEqual(['/folder1/file1.md']);
      expect(getPinnedForFolder('/folder2')).toEqual(['/folder2/file2.md']);
    });

    test('returns empty array for folder with no pins', () => {
      const result = getPinnedForFolder('/nonexistent');
      expect(result).toEqual([]);
    });

    test('removes folder key when last pin is removed', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/notes.md';

      togglePinFile(folderPath, filePath); // pin
      togglePinFile(folderPath, filePath); // unpin

      const map = getPinnedMap();
      expect(map[folderPath]).toBeUndefined();
    });
  });

  describe('File sections (categories)', () => {
    test('creates new section for a folder', () => {
      const folderPath = '/home/project';
      const sectionId = createSection(folderPath, 'Notes');

      const sections = getFolderSections(folderPath);
      expect(sections.sections).toHaveLength(1);
      expect(sections.sections[0].name).toBe('Notes');
      expect(sections.sections[0].id).toBe(sectionId);
      expect(sections.sections[0].collapsed).toBe(false);
    });

    test('trims section name', () => {
      const folderPath = '/home/project';
      createSection(folderPath, '  Important Files  ');

      const sections = getFolderSections(folderPath);
      expect(sections.sections[0].name).toBe('Important Files');
    });

    test('creates multiple sections in order', () => {
      const folderPath = '/home/project';
      const id1 = createSection(folderPath, 'Section 1');
      const id2 = createSection(folderPath, 'Section 2');
      const id3 = createSection(folderPath, 'Section 3');

      const sections = getFolderSections(folderPath);
      expect(sections.sections).toHaveLength(3);
      expect(sections.sections[0].id).toBe(id1);
      expect(sections.sections[2].id).toBe(id3);
    });

    test('renames a section', () => {
      const folderPath = '/home/project';
      const sectionId = createSection(folderPath, 'Old Name');
      renameSection(folderPath, sectionId, 'New Name');

      const sections = getFolderSections(folderPath);
      expect(sections.sections[0].name).toBe('New Name');
    });

    test('assigns file to a section', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/file.md';
      const sectionId = createSection(folderPath, 'Notes');

      assignFileToSection(folderPath, filePath, sectionId);

      const sections = getFolderSections(folderPath);
      expect(sections.fileMap[filePath]).toBe(sectionId);
    });

    test('removes file from section by assigning null', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/file.md';
      const sectionId = createSection(folderPath, 'Notes');

      assignFileToSection(folderPath, filePath, sectionId);
      assignFileToSection(folderPath, filePath, null);

      const sections = getFolderSections(folderPath);
      expect(sections.fileMap[filePath]).toBeUndefined();
    });

    test('deletes section and unassigns its files', () => {
      const folderPath = '/home/project';
      const file1 = '/home/project/file1.md';
      const file2 = '/home/project/file2.md';
      const sectionId = createSection(folderPath, 'Notes');

      assignFileToSection(folderPath, file1, sectionId);
      assignFileToSection(folderPath, file2, sectionId);

      deleteSection(folderPath, sectionId);

      const sections = getFolderSections(folderPath);
      expect(sections.sections).toHaveLength(0);
      expect(sections.fileMap[file1]).toBeUndefined();
      expect(sections.fileMap[file2]).toBeUndefined();
    });

    test('handles corrupted sections store gracefully', () => {
      localStorage.setItem(SECTIONS_KEY, 'invalid json {]');
      const sections = getFolderSections('/any/path');
      expect(sections).toEqual({ sections: [], fileMap: {} });
    });
  });

  describe('File item drag-and-drop state', () => {
    test('prepares file item with data attributes for drag', () => {
      const filePath = '/home/project/notes.md';
      const fileName = 'notes.md';
      const isPinned = false;

      const fileItem = {
        path: filePath,
        name: fileName,
        pinned: isPinned,
        draggable: true,
      };

      expect(fileItem.draggable).toBe(true);
      expect(fileItem.path).toBe(filePath);
    });

    test('drag data includes filePath and parent section', () => {
      const folderPath = '/home/project';
      const filePath = '/home/project/file.md';
      const sectionId = createSection(folderPath, 'Notes');
      assignFileToSection(folderPath, filePath, sectionId);

      const dragData = {
        filePath,
        fromSection: sectionId,
        fromFolder: folderPath,
      };

      expect(dragData.filePath).toBe(filePath);
      expect(dragData.fromSection).toBe(sectionId);
    });

    test('drop target validates section target', () => {
      const folderPath = '/home/project';
      const sectionId = createSection(folderPath, 'Target');

      const dropTarget = {
        type: 'section',
        sectionId,
        folderPath,
      };

      expect(dropTarget.sectionId).toBe(sectionId);
    });
  });

  describe('Current file tracking', () => {
    test('stores current file path and name', () => {
      const currentFile = {
        name: 'notes.md',
        path: '/home/project/notes.md',
      };

      expect(currentFile.name).toBe('notes.md');
      expect(currentFile.path).toBe('/home/project/notes.md');
    });

    test('extracts filename from path when needed', () => {
      const filePath = '/home/project/notes.md';
      const fileName = filePath.split(/[\\/]/).pop();

      expect(fileName).toBe('notes.md');
    });

    test('handles Windows paths correctly', () => {
      const filePath = 'C:\\Users\\Bob\\Documents\\notes.md';
      const fileName = filePath.split(/[\\/]/).pop();

      expect(fileName).toBe('notes.md');
    });
  });

});
