import type {
  ConversationTracker,
  RequestCheckpointStep,
} from '../services/conversation-tracking.js';

interface RunStepKey {
  sessionId: string;
  requestId: string;
  step: Exclude<RequestCheckpointStep, 'failed'>;
}

export function createRequestJournal(tracker: ConversationTracker) {
  const inFlight = new Map<string, Promise<Record<string, unknown>>>();
  const localResults = new Map<string, Record<string, unknown>>();

  function cacheKey(input: RunStepKey): string {
    return `${input.sessionId}\u0000${input.requestId}\u0000${input.step}`;
  }

  async function getStep<T extends Record<string, unknown>>(input: RunStepKey): Promise<T | undefined> {
    const key = cacheKey(input);
    const local = localResults.get(key);
    if (local) return local as T;

    const checkpoints = await tracker.getRequestEvents(input.sessionId, input.requestId);
    const persisted = [...checkpoints].reverse().find((checkpoint) => checkpoint.step === input.step);
    if (!persisted) return undefined;
    localResults.set(key, persisted.payload);
    return persisted.payload as T;
  }

  async function runStep<T extends Record<string, unknown>>(
    input: RunStepKey,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = cacheKey(input);
    const local = localResults.get(key);
    if (local) return local as T;
    const running = inFlight.get(key);
    if (running) return await running as T;

    const promise = (async (): Promise<Record<string, unknown>> => {
      const persisted = await getStep<Record<string, unknown>>(input);
      if (persisted) {
        return persisted;
      }

      try {
        const result = await operation();
        await tracker.recordRequestCheckpoint({ ...input, payload: result });
        localResults.set(key, result);
        return result;
      } catch (error) {
        await tracker.recordRequestCheckpoint({
          sessionId: input.sessionId,
          requestId: input.requestId,
          step: 'failed',
          payload: {
            failedStep: input.step,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    })();

    inFlight.set(key, promise);
    try {
      return await promise as T;
    } finally {
      inFlight.delete(key);
    }
  }

  return { getStep, runStep };
}

export type RequestJournal = ReturnType<typeof createRequestJournal>;
