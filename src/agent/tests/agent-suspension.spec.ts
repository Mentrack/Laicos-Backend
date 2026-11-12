import {
  currentlySuspendedWhere,
  isCurrentlySuspended,
  notCurrentlySuspendedWhere,
} from '../utils/agent-suspension';

const now = new Date('2026-11-12T10:00:00Z');
const later = new Date('2026-11-13T10:00:00Z');
const earlier = new Date('2026-11-11T10:00:00Z');

describe('agent suspension', () => {
  it.each([
    [null, null, false],
    [earlier, null, true],
    [earlier, later, true],
    [earlier, earlier, false],
    [earlier, now, false], // ends exactly now: no longer suspended
  ])(
    'suspendedAt %s until %s -> %s',
    (suspendedAt, suspendedUntil, expected) => {
      expect(isCurrentlySuspended({ suspendedAt, suspendedUntil }, now)).toBe(
        expected,
      );
    },
  );

  it('currentlySuspendedWhere', () => {
    expect(currentlySuspendedWhere(now)).toEqual({
      suspendedAt: { not: null },
      OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }],
    });
  });

  it('notCurrentlySuspendedWhere', () => {
    expect(notCurrentlySuspendedWhere(now)).toEqual({
      OR: [{ suspendedAt: null }, { suspendedUntil: { lte: now } }],
    });
  });
});
