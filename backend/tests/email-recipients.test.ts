import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BYPASS_EMAIL_RECIPIENTS,
  DEFAULT_INTERNAL_EMAIL_RECIPIENTS,
  parseEmailRecipients,
  resolveBypassEmailRecipients,
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

  it('uses only the default bypass pair when configuration is absent', () => {
    expect(resolveBypassEmailRecipients(undefined)).toEqual(
      DEFAULT_BYPASS_EMAIL_RECIPIENTS.split(','),
    );
  });

  it('replaces bypass defaults and normalizes separators and duplicates', () => {
    expect(resolveBypassEmailRecipients(
      ' replacement@example.test ; SECOND@example.test, Replacement@example.test ',
    )).toEqual([
      'replacement@example.test',
      'SECOND@example.test',
    ]);
  });

  it('preserves an explicitly blank bypass list for startup validation', () => {
    expect(resolveBypassEmailRecipients('   ')).toEqual([]);
  });
});
