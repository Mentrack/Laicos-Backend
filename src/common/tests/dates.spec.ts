import { addDays, fromDateColumn, lagosToday, toDateColumn } from '../dates';

describe('dates', () => {
  it('reads today in Lagos, an hour ahead of UTC', () => {
    expect(lagosToday(new Date('2026-10-08T22:59:59Z'))).toBe('2026-10-08');
    expect(lagosToday(new Date('2026-10-08T23:00:00Z'))).toBe('2026-10-09');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
  });

  it('round-trips a @db.Date column', () => {
    const column = toDateColumn('2026-11-15');
    expect(column.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(fromDateColumn(column)).toBe('2026-11-15');
  });
});
