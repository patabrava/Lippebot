import { describe, expect, it } from 'vitest';
import { formatBerlinDate, formatBerlinDateTime } from '../src/time/berlin.js';

describe('Berlin time formatting', () => {
  it('formats winter timestamps as CET', () => {
    expect(formatBerlinDateTime(new Date('2026-01-15T10:15:00.000Z')))
      .toBe('2026-01-15 11:15:00 CET');
  });

  it('formats summer timestamps as CEST', () => {
    expect(formatBerlinDateTime(new Date('2026-05-21T20:34:05.000Z')))
      .toBe('2026-05-21 22:34:05 CEST');
  });

  it('uses the Berlin calendar date across the UTC midnight boundary', () => {
    expect(formatBerlinDate(new Date('2026-07-13T22:30:00.000Z'))).toBe('2026-07-14');
  });
});
