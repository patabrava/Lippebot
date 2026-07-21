export type ConversationEventType =
  | 'state_reported'
  | 'lead_created'
  | 'lead_reused'
  | 'lead_review'
  | 'lead_failed'
  | 'lead_duplicate'
  | 'support_handoff_created'
  | 'support_handoff_duplicate'
  | 'crm_transcript_note_created'
  | 'crm_transcript_note_failed'
  | 'completed_summary_email_sent'
  | 'completed_summary_email_failed'
  | 'abandoned_summary_sent'
  | 'abandoned_summary_failed'
  | 'chat_done'
  | 'chat_error'
  | 'request_checkpoint'
  | 'tracking_error';

export type RequestCheckpointStep =
  | 'crm'
  | 'email'
  | `email_recipient:${string}`
  | 'completed'
  | 'failed';

export interface RequestCheckpoint {
  sessionId?: string;
  requestId: string;
  step: RequestCheckpointStep;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export interface ConversationTracker {
  isEnabled(): boolean;
  ensureSession(sessionId: string): Promise<void>;
  recordMessage(input: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    turnIndex?: number;
  }): Promise<void>;
  recordEvent(input: {
    sessionId: string;
    eventType: ConversationEventType;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  updateSession(input: {
    sessionId: string;
    finalMode?: string;
    finalCollectedData?: Record<string, unknown>;
    leadPersonId?: number;
    leadDealId?: number;
    supportPersonId?: number;
    supportNoteStatus?: string;
    supportMatchState?: string;
    supportIntendedInbox?: string;
  }): Promise<void>;
  getRequestEvents(sessionId: string, requestId: string): Promise<RequestCheckpoint[]>;
  recordRequestCheckpoint(input: {
    sessionId: string;
    requestId: string;
    step: RequestCheckpointStep;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

interface ConversationTrackerConfig {
  enabled: boolean;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  timeoutMs?: number;
}

const disabledTracker: ConversationTracker = {
  isEnabled: () => false,
  ensureSession: async () => undefined,
  recordMessage: async () => undefined,
  recordEvent: async () => undefined,
  updateSession: async () => undefined,
  getRequestEvents: async () => [],
  recordRequestCheckpoint: async () => undefined,
};

function jsonHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function encodeFilterValue(value: string): string {
  return encodeURIComponent(value);
}

function definedEntries(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function swallowTrackingError(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error('Conversation tracking error:', err);
  }
}

export function createConversationTracker(config: ConversationTrackerConfig): ConversationTracker {
  if (!config.enabled || !config.supabaseUrl || !config.serviceRoleKey) {
    return disabledTracker;
  }

  const baseUrl = normalizeBaseUrl(config.supabaseUrl);
  const serviceRoleKey = config.serviceRoleKey;
  const timeoutMs = config.timeoutMs ?? 2500;

  async function request(path: string, init: RequestInit): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supabase ${init.method || 'GET'} ${path} failed with ${res.status}: ${body}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supabase ${init.method || 'GET'} ${path} failed with ${res.status}: ${body}`);
      }
      return await res.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureSessionReliable(sessionId: string): Promise<void> {
    await request('conversation_sessions?on_conflict=session_id', {
      method: 'POST',
      headers: {
        ...jsonHeaders(serviceRoleKey),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ session_id: sessionId, updated_at: new Date().toISOString() }),
    });
  }

  async function safeRequest(path: string, init: RequestInit): Promise<void> {
    await swallowTrackingError(() => request(path, init));
  }

  async function patchSession(sessionId: string, payload: Record<string, unknown>): Promise<void> {
    await safeRequest(`conversation_sessions?session_id=eq.${encodeFilterValue(sessionId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(serviceRoleKey),
      body: JSON.stringify(definedEntries({ ...payload, updated_at: new Date().toISOString() })),
    });
  }

  async function ensureSession(sessionId: string): Promise<void> {
    await safeRequest('conversation_sessions?on_conflict=session_id', {
      method: 'POST',
      headers: {
        ...jsonHeaders(serviceRoleKey),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ session_id: sessionId, updated_at: new Date().toISOString() }),
    });
  }

  return {
    isEnabled: () => true,

    ensureSession,

    async recordMessage(input): Promise<void> {
      const turnIndex = input.turnIndex ?? Date.now();
      await ensureSession(input.sessionId);
      await safeRequest('conversation_messages', {
        method: 'POST',
        headers: jsonHeaders(serviceRoleKey),
        body: JSON.stringify({
          session_id: input.sessionId,
          role: input.role,
          content: input.content,
          turn_index: turnIndex,
        }),
      });
      await patchSession(input.sessionId, {
        last_message_at: new Date().toISOString(),
        message_count: turnIndex,
      });
    },

    async recordEvent(input): Promise<void> {
      await ensureSession(input.sessionId);
      await safeRequest('conversation_events', {
        method: 'POST',
        headers: jsonHeaders(serviceRoleKey),
        body: JSON.stringify({
          session_id: input.sessionId,
          event_type: input.eventType,
          payload: input.payload || {},
        }),
      });
    },

    async updateSession(input): Promise<void> {
      await patchSession(input.sessionId, {
        final_mode: input.finalMode,
        final_collected_data: input.finalCollectedData,
        lead_person_id: input.leadPersonId,
        lead_deal_id: input.leadDealId,
        support_person_id: input.supportPersonId,
        support_note_status: input.supportNoteStatus,
        support_match_state: input.supportMatchState,
        support_intended_inbox: input.supportIntendedInbox,
      });
    },

    async getRequestEvents(sessionId, requestId): Promise<RequestCheckpoint[]> {
      const params = new URLSearchParams({
        session_id: `eq.${sessionId}`,
        event_type: 'eq.request_checkpoint',
        select: 'payload,created_at',
        order: 'created_at.asc',
      });
      const rows = await requestJson<Array<{ payload?: Record<string, unknown>; created_at?: string }>>(
        `conversation_events?${params.toString()}`,
        { method: 'GET', headers: jsonHeaders(serviceRoleKey) },
      );
      return rows.flatMap((row) => {
        const payload = row.payload;
        if (!payload || payload.requestId !== requestId || typeof payload.step !== 'string') return [];
        return [{
          requestId,
          step: payload.step as RequestCheckpointStep,
          payload: payload.result && typeof payload.result === 'object'
            ? payload.result as Record<string, unknown>
            : {},
          createdAt: row.created_at,
        }];
      });
    },

    async recordRequestCheckpoint(input): Promise<void> {
      await ensureSessionReliable(input.sessionId);
      await request('conversation_events', {
        method: 'POST',
        headers: jsonHeaders(serviceRoleKey),
        body: JSON.stringify({
          session_id: input.sessionId,
          event_type: 'request_checkpoint',
          payload: {
            requestId: input.requestId,
            step: input.step,
            result: input.payload,
          },
        }),
      });
    },
  };
}
