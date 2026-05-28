import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationTracker } from '../src/services/conversation-tracking.js';

describe('createConversationTracker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is disabled when the flag is false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tracker = createConversationTracker({
      enabled: false,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
    });

    expect(tracker.isEnabled()).toBe(false);
    await tracker.ensureSession('session-1');
    await tracker.recordMessage({ sessionId: 'session-1', role: 'user', content: 'Hallo' });
    await tracker.recordEvent({ sessionId: 'session-1', eventType: 'chat_done' });
    await tracker.updateSession({ sessionId: 'session-1', finalMode: 'berater' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is disabled when credentials are missing', () => {
    expect(createConversationTracker({ enabled: true, supabaseUrl: '', serviceRoleKey: 'key' }).isEnabled()).toBe(false);
    expect(createConversationTracker({ enabled: true, supabaseUrl: 'https://example.supabase.co', serviceRoleKey: '' }).isEnabled()).toBe(false);
  });

  it('upserts a session by session_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co/',
      serviceRoleKey: 'service-key',
    });

    await tracker.ensureSession('session-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qnvgiihzbihkedakggth.supabase.co/rest/v1/conversation_sessions?on_conflict=session_id',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          apikey: 'service-key',
          Authorization: 'Bearer service-key',
          Prefer: 'resolution=merge-duplicates',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      session_id: 'session-1',
      updated_at: expect.any(String),
    });
  });

  it('records messages and updates session counters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
    });

    await tracker.recordMessage({
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hallo! Ich bin Sarah.',
      turnIndex: 3,
    });

    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/conversation_sessions?on_conflict=session_id');
    expect(fetchMock.mock.calls[1][0]).toBe('https://qnvgiihzbihkedakggth.supabase.co/rest/v1/conversation_messages');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      session_id: 'session-1',
      role: 'assistant',
      content: 'Hallo! Ich bin Sarah.',
      turn_index: 3,
    });
    expect(fetchMock.mock.calls[2][0]).toContain('/rest/v1/conversation_sessions?session_id=eq.session-1');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      last_message_at: expect.any(String),
      message_count: 3,
      updated_at: expect.any(String),
    });
  });

  it('records events with payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
    });

    await tracker.recordEvent({
      sessionId: 'session-1',
      eventType: 'lead_created',
      payload: { personId: 123, dealId: 456 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qnvgiihzbihkedakggth.supabase.co/rest/v1/conversation_events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/conversation_sessions?on_conflict=session_id');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      session_id: 'session-1',
      event_type: 'lead_created',
      payload: { personId: 123, dealId: 456 },
    });
  });

  it('updates session outcome metadata with snake_case columns', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
    });

    await tracker.updateSession({
      sessionId: 'session-1',
      finalMode: 'service',
      finalCollectedData: { category: 'technik' },
      leadPersonId: 123,
      leadDealId: 456,
      supportPersonId: 789,
      supportNoteStatus: 'created',
      supportMatchState: 'unique',
      supportIntendedInbox: 'technik@lippelift.de',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qnvgiihzbihkedakggth.supabase.co/rest/v1/conversation_sessions?session_id=eq.session-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      final_mode: 'service',
      final_collected_data: { category: 'technik' },
      lead_person_id: 123,
      lead_deal_id: 456,
      support_person_id: 789,
      support_note_status: 'created',
      support_match_state: 'unique',
      support_intended_inbox: 'technik@lippelift.de',
      updated_at: expect.any(String),
    });
  });

  it('logs tracking failures without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'database unavailable' }));
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
    });

    await expect(tracker.recordEvent({ sessionId: 'session-1', eventType: 'chat_done' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Conversation tracking error:', expect.any(Error));
  });

  it('aborts slow Supabase requests', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const tracker = createConversationTracker({
      enabled: true,
      supabaseUrl: 'https://qnvgiihzbihkedakggth.supabase.co',
      serviceRoleKey: 'service-key',
      timeoutMs: 1,
    });

    await expect(tracker.ensureSession('session-1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Conversation tracking error:', expect.any(Error));
  });
});
