import { describe, expect, it } from 'vitest';
import { hasPriorContactStatus } from '../src/contact/prior-contact.js';

describe('hasPriorContactStatus', () => {
  it.each(['yes', 'no', 'unknown'])('accepts %s', (priorContact) => {
    expect(hasPriorContactStatus({ priorContact })).toBe(true);
  });

  it.each([
    {},
    { priorContact: '' },
    { priorContact: 'maybe' },
    { priorContact: null },
  ])('rejects an invalid status: $priorContact', (data) => {
    expect(hasPriorContactStatus(data)).toBe(false);
  });
});
