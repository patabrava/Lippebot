import { describe, expect, it } from 'vitest';
import { buildPipedriveDealUrl } from '../src/crm/pipedrive-links.js';

describe('buildPipedriveDealUrl', () => {
  it('builds the exact deal detail URL', () => {
    expect(buildPipedriveDealUrl('https://lippelift.pipedrive.com', 1618))
      .toBe('https://lippelift.pipedrive.com/deal/1618');
  });

  it('normalizes a trailing slash', () => {
    expect(buildPipedriveDealUrl('https://lippelift.pipedrive.com/', 456))
      .toBe('https://lippelift.pipedrive.com/deal/456');
  });

  it.each([
    ['', 456],
    ['http://lippelift.pipedrive.com', 456],
    ['not-a-url', 456],
    ['https://user:pass@lippelift.pipedrive.com', 456],
    ['https://lippelift.pipedrive.com', 0],
    ['https://lippelift.pipedrive.com', -1],
    ['https://lippelift.pipedrive.com', 1.5],
    ['https://lippelift.pipedrive.com', Number.NaN],
  ])('rejects unsafe or invalid input: %s %s', (baseUrl, dealId) => {
    expect(buildPipedriveDealUrl(baseUrl, dealId)).toBeUndefined();
  });
});
