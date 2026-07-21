import { describe, expect, it } from 'vitest';
import {
  buildRunUniquePhone,
  opportunityCheckpointMatches,
  shouldRetryChatAttempt,
} from '../scripts/live-request-routing-helpers.js';

describe('live request routing helpers', () => {
  it('builds phone numbers that are unique by run and case', () => {
    expect(buildRunUniquePhone('20260721134618', 2)).toBe('+49 151 13461802');
    expect(buildRunUniquePhone('20260721134618', 3)).toBe('+49 151 13461803');
    expect(buildRunUniquePhone('20260721134619', 2)).toBe('+49 151 13461902');
  });

  it('retries errors and required flows that finish without completing', () => {
    expect(shouldRetryChatAttempt([{ type: 'error' }], false, true, 1, 3)).toBe(true);
    expect(shouldRetryChatAttempt([{ type: 'done' }], false, true, 1, 3)).toBe(true);
    expect(shouldRetryChatAttempt([{ type: 'done' }], false, false, 1, 3)).toBe(false);
    expect(shouldRetryChatAttempt([{ type: 'action' }], true, true, 1, 3)).toBe(false);
    expect(shouldRetryChatAttempt([{ type: 'error' }], false, true, 3, 3)).toBe(false);
  });

  it('requires UC-02 and UC-03 to reuse their exact fixture person and deal', () => {
    const fixtures = { people: [101, 102], deals: [201, 202] };

    expect(opportunityCheckpointMatches('UC-02', [{
      step: 'crm', result: { outcome: 'reused', personId: 101, dealId: 201 },
    }], fixtures)).toBe(true);
    expect(opportunityCheckpointMatches('UC-03', [{
      step: 'crm', result: { outcome: 'reused', personId: 102, dealId: 202 },
    }], fixtures)).toBe(true);
    expect(opportunityCheckpointMatches('UC-03', [{
      step: 'crm', result: { outcome: 'identity_review', reason: 'conflicting_contact_identifiers' },
    }], fixtures)).toBe(false);
    expect(opportunityCheckpointMatches('UC-03', [{
      step: 'crm', result: { outcome: 'reused', personId: 102, dealId: 999 },
    }], fixtures)).toBe(false);
  });
});
