import { describe, expect, it } from 'vitest';
import { extractE2ESubject } from '../src/request/e2e-marker.js';

describe('extractE2ESubject', () => {
  it('extracts a strict labeled E2E subject', () => {
    expect(extractE2ESubject('[LIPPEBOT E2E][UC-11][20260721-a] LIPPE exact match - technical service'))
      .toBe('[LIPPEBOT E2E][UC-11][20260721-a] LIPPE exact match - technical service');
  });

  it.each([
    '[LIPPEBOT E2E][UC-1][run] invalid case width',
    '[LIPPEBOT E2E][UC-11][run id] invalid run',
    '[LIPPEBOT E2E][UC-11][run]\r\nBcc: attacker@example.com',
    'ordinary customer issue',
  ])('rejects invalid or unsafe marker text: %s', (value) => {
    expect(extractE2ESubject(value)).toBeUndefined();
  });
});
