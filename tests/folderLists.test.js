const { parseQuickAdd, taskGroupOf } = require('../src/renderer/folderLists.js');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

describe('parseQuickAdd', () => {
  test('priority, date word and tags come out of the text', () => {
    expect(parseQuickAdd('Call bank !high tomorrow #finance')).toEqual({
      text: 'Call bank', priority: 'high', due: inDays(1), tags: ['finance'],
    });
  });

  test('short priority forms', () => {
    expect(parseQuickAdd('a !h').priority).toBe('high');
    expect(parseQuickAdd('a !m').priority).toBe('med');
    expect(parseQuickAdd('a !l').priority).toBe('low');
  });

  test('ISO date, today, in N days and weeks', () => {
    expect(parseQuickAdd('x 2026-12-01').due).toBe('2026-12-01');
    expect(parseQuickAdd('x today').due).toBe(inDays(0));
    expect(parseQuickAdd('x in 3 days').due).toBe(inDays(3));
    expect(parseQuickAdd('x in 2 weeks').due).toBe(inDays(14));
  });

  test('weekday is the next one, counting today', () => {
    const due = parseQuickAdd('Report friday').due;
    const [y, m, d] = due.split('-').map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(5);
    expect(due >= inDays(0) && due <= inDays(6)).toBe(true);
  });

  test('plain text is left alone', () => {
    expect(parseQuickAdd('Fix issue #12 on sat')).toEqual({
      text: 'Fix issue #12 on sat', priority: null, due: null, tags: [],
    });
    expect(parseQuickAdd('Email bob@x.com about todays plan')).toMatchObject({ due: null });
  });
});

describe('_noteLines', () => {
  const { _noteLines } = require('../src/renderer/folderLists.js');

  test('indents lines and keeps one blank line between paragraphs', () => {
    expect(_noteLines('\nFirst para\nmore\n\n\n\nSecond para\n\n')).toEqual([
      '    First para', '    more', '    ', '    Second para',
    ]);
  });

  test('empty text gives no lines', () => {
    expect(_noteLines('  \n\n')).toEqual([]);
  });
});

describe('taskGroupOf', () => {
  afterEach(() => jest.useRealTimers());
  const at = (day) => jest.useFakeTimers().setSystemTime(new Date(`${day}T10:00:00`));

  test('Saturday: tomorrow is Sunday, next Monday is next week', () => {
    at('2026-10-31');   // Saturday
    expect(taskGroupOf({ due: null })).toBe('none');
    expect(taskGroupOf({ due: '2026-10-30' })).toBe('overdue');
    expect(taskGroupOf({ due: '2026-10-31' })).toBe('today');
    expect(taskGroupOf({ due: '2026-11-01' })).toBe('tomorrow');
    expect(taskGroupOf({ due: '2026-11-02' })).toBe('nextweek');
    expect(taskGroupOf({ due: '2026-11-08' })).toBe('nextweek');
    expect(taskGroupOf({ due: '2026-11-09' })).toBe('later');
  });

  test('Wednesday: this week runs to Sunday', () => {
    at('2026-10-28');   // Wednesday
    expect(taskGroupOf({ due: '2026-10-30' })).toBe('week');
    expect(taskGroupOf({ due: '2026-11-01' })).toBe('week');
    expect(taskGroupOf({ due: '2026-11-02' })).toBe('nextweek');
  });

  test('Sunday: Monday is tomorrow, rest of next week is next week', () => {
    at('2026-11-01');   // Sunday
    expect(taskGroupOf({ due: '2026-11-02' })).toBe('tomorrow');
    expect(taskGroupOf({ due: '2026-11-03' })).toBe('nextweek');
    expect(taskGroupOf({ due: '2026-11-09' })).toBe('later');
  });
});
