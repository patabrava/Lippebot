import { describe, expect, it, vi } from 'vitest';
import { createRequestJournal } from '../src/request/request-journal.js';
import type { ConversationTracker, RequestCheckpoint } from '../src/services/conversation-tracking.js';

function trackerWithStore(store: RequestCheckpoint[]): ConversationTracker {
  return {
    isEnabled: () => true,
    ensureSession: async () => undefined,
    recordMessage: async () => undefined,
    recordEvent: async () => undefined,
    updateSession: async () => undefined,
    getRequestEvents: async (sessionId, requestId) => store.filter((item) => item.sessionId === sessionId && item.requestId === requestId),
    recordRequestCheckpoint: async (input) => {
      store.push({
        sessionId: input.sessionId,
        requestId: input.requestId,
        step: input.step,
        payload: input.payload,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

describe('createRequestJournal', () => {
  it('reuses a persisted CRM checkpoint in a new journal instance', async () => {
    const store: RequestCheckpoint[] = [];
    const tracker = trackerWithStore(store);
    const operation = vi.fn().mockResolvedValue({ dealId: 801 });
    await createRequestJournal(tracker).runStep({ sessionId: 's1', requestId: 'r1', step: 'crm' }, operation);

    const result = await createRequestJournal(tracker).runStep(
      { sessionId: 's1', requestId: 'r1', step: 'crm' },
      vi.fn().mockRejectedValue(new Error('must not run')),
    );

    expect(result).toEqual({ dealId: 801 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight operation for concurrent duplicates', async () => {
    const tracker = trackerWithStore([]);
    let resolveOperation!: (value: { messageId: string }) => void;
    const operation = vi.fn(() => new Promise<{ messageId: string }>((resolve) => { resolveOperation = resolve; }));
    const journal = createRequestJournal(tracker);
    const first = journal.runStep({ sessionId: 's1', requestId: 'r1', step: 'email' }, operation);
    const second = journal.runStep({ sessionId: 's1', requestId: 'r1', step: 'email' }, operation);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    resolveOperation({ messageId: 'm1' });

    await expect(Promise.all([first, second])).resolves.toEqual([{ messageId: 'm1' }, { messageId: 'm1' }]);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('records failure without completing the failed step and permits retry', async () => {
    const store: RequestCheckpoint[] = [];
    const journal = createRequestJournal(trackerWithStore(store));
    await expect(journal.runStep(
      { sessionId: 's1', requestId: 'r1', step: 'email' },
      vi.fn().mockRejectedValue(new Error('smtp unavailable')),
    )).rejects.toThrow('smtp unavailable');

    expect(store).toEqual([expect.objectContaining({
      requestId: 'r1',
      step: 'failed',
      payload: { failedStep: 'email', error: 'smtp unavailable' },
    })]);
    await expect(journal.runStep(
      { sessionId: 's1', requestId: 'r1', step: 'email' },
      vi.fn().mockResolvedValue({ messageId: 'retry-ok' }),
    )).resolves.toEqual({ messageId: 'retry-ok' });
  });

  it('keeps two request IDs in the same chat session independent', async () => {
    const tracker = trackerWithStore([]);
    const journal = createRequestJournal(tracker);
    await journal.runStep({ sessionId: 's1', requestId: 'r1', step: 'crm' }, async () => ({ dealId: 801 }));
    await journal.runStep({ sessionId: 's1', requestId: 'r2', step: 'crm' }, async () => ({ dealId: 802 }));

    await expect(createRequestJournal(tracker).runStep(
      { sessionId: 's1', requestId: 'r2', step: 'crm' }, async () => ({ dealId: 999 }),
    )).resolves.toEqual({ dealId: 802 });
  });

  it('reuses a durable CRM bypass checkpoint after restart', async () => {
    const store: RequestCheckpoint[] = [];
    const tracker = trackerWithStore(store);
    await createRequestJournal(tracker).runStep(
      { sessionId: 's-bypass', requestId: 'r-bypass', step: 'crm_bypassed' },
      async () => ({ reason: 'launch_mode' }),
    );

    const operation = vi.fn().mockRejectedValue(new Error('must not run'));
    await expect(createRequestJournal(tracker).runStep(
      { sessionId: 's-bypass', requestId: 'r-bypass', step: 'crm_bypassed' },
      operation,
    )).resolves.toEqual({ reason: 'launch_mode' });
    expect(operation).not.toHaveBeenCalled();
  });
});
