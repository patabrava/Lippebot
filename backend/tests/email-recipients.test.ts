import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERNAL_EMAIL_RECIPIENTS,
  parseEmailRecipients,
  resolveInternalEmailRecipients,
} from '../src/email/recipients.js';

describe('email recipients', () => {
  it('always retains Berg and caechma alongside configured recipients', () => {
    expect(parseEmailRecipients(resolveInternalEmailRecipients('legacy@example.test; BERG@lippelift.de'))).toEqual([
      'legacy@example.test',
      'BERG@lippelift.de',
      'caechma@gmail.com',
    ]);
  });

  it('uses the mandatory internal pair when configuration is blank', () => {
    expect(resolveInternalEmailRecipients('  ')).toBe(DEFAULT_INTERNAL_EMAIL_RECIPIENTS);
  });
});
