# Sarah Conversation Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQL-backed server-side conversation tracking for Sarah so LIPPE Lift can archive visitor messages, final assistant replies, key state/action events, and lead/support outcomes by the existing widget `sessionId`.

**Architecture:** Keep the Webflow widget unchanged and add tracking only inside the backend. Store data in three normalized Supabase tables, isolate all Supabase writes in `backend/src/services/conversation-tracking.ts`, inject the tracker into `createChatRoute`, and make every tracking write best-effort so chat, Pipedrive, and email behavior continue when Supabase is disabled or failing.

**Tech Stack:** TypeScript, Hono SSE, Vitest, Zod config parsing, Supabase PostgREST via native `fetch`, PostgreSQL/RLS SQL

---

## File Structure

- Create: `supabase/migrations/20260529120000_conversation_tracking.sql`
  - Defines `conversation_sessions`, `conversation_messages`, `conversation_events`, indexes, and RLS with no public policies.
- Create: `backend/src/services/conversation-tracking.ts`
  - Owns the `ConversationTracker` interface, disabled no-op tracker, Supabase REST tracker, payload serialization, best-effort error isolation, session upserts, message inserts, event inserts, and session metadata updates.
- Create: `backend/tests/conversation-tracking.test.ts`
  - Unit-tests disabled behavior, enablement gates, Supabase REST calls, message/event payloads, session metadata mapping, and write-failure swallowing.
- Modify: `backend/src/config/index.ts`
  - Adds `supabaseUrl`, `supabaseServiceRoleKey`, and `conversationTrackingEnabled`.
- Modify: `backend/tests/config.test.ts`
  - Covers default disabled tracking and env loading for the three new settings.
- Modify: `backend/src/index.ts`
  - Creates the tracker from config and passes it to `createChatRoute`.
- Modify: `backend/src/routes/chat.ts`
  - Injects an optional tracker, records current user messages, accumulates final assistant text, records state/lead/support/done/error events, and updates session outcome metadata without changing existing SSE output.
- Modify: `backend/tests/integration.test.ts`
  - Adds route-level tests using a fake tracker for user message capture, final assistant message capture, state events, lead created/duplicate events, support handoff events, chat errors, and tracking failures.
- Modify: `backend/.env.example`
  - Documents the Supabase URL, service-role key, and feature flag.
- Modify: `backend/src/index.ts` health payload
  - Adds `conversationTracking` boolean so production smoke checks can confirm whether tracking is active.
- Do not modify: `widget/src/sarah-widget.ts`, `widget/src/api/client.ts`, `widget/src/storage/history.ts`
  - The widget must keep calling only the backend and must not receive Supabase credentials.

## Task 1: Add Supabase Schema Migration

**Files:**
- Create: `supabase/migrations/20260529120000_conversation_tracking.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260529120000_conversation_tracking.sql`:

```sql
create extension if not exists pgcrypto;

create table if not exists public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  final_mode text,
  final_collected_data jsonb not null default '{}'::jsonb,
  lead_person_id integer,
  lead_deal_id integer,
  support_person_id integer,
  support_note_status text,
  support_match_state text,
  support_intended_inbox text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.conversation_sessions(session_id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  turn_index integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.conversation_sessions(session_id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_sessions_started_at_idx
  on public.conversation_sessions(started_at desc);

create index if not exists conversation_sessions_last_message_at_idx
  on public.conversation_sessions(last_message_at desc);

create index if not exists conversation_messages_session_turn_idx
  on public.conversation_messages(session_id, turn_index);

create index if not exists conversation_events_session_created_idx
  on public.conversation_events(session_id, created_at);

create index if not exists conversation_events_type_idx
  on public.conversation_events(event_type);

alter table public.conversation_sessions enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_events enable row level security;
```

- [ ] **Step 2: Commit the schema migration**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
git add supabase/migrations/20260529120000_conversation_tracking.sql
git commit -m "feat: add conversation tracking schema"
```

Expected: commit succeeds with only the SQL migration staged.

## Task 2: Add Conversation Tracker Service

**Files:**
- Create: `backend/src/services/conversation-tracking.ts`
- Create: `backend/tests/conversation-tracking.test.ts`

- [ ] **Step 1: Write failing tracker tests**

Create `backend/tests/conversation-tracking.test.ts`:

```ts
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
        headers: expect.objectContaining({
          apikey: 'service-key',
          Authorization: 'Bearer service-key',
          Prefer: 'resolution=merge-duplicates',
        }),
        body: JSON.stringify({ session_id: 'session-1', updated_at: expect.any(String) }),
      }),
    );
  });

  it('records messages and increments session counters', async () => {
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

    expect(fetchMock.mock.calls[0][0]).toBe('https://qnvgiihzbihkedakggth.supabase.co/rest/v1/conversation_messages');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      session_id: 'session-1',
      role: 'assistant',
      content: 'Hallo! Ich bin Sarah.',
      turn_index: 3,
    });
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/conversation_sessions?session_id=eq.session-1');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      last_message_at: expect.any(String),
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
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_id: 'session-1',
          event_type: 'lead_created',
          payload: { personId: 123, dealId: 456 },
        }),
      }),
    );
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
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          final_mode: 'service',
          final_collected_data: { category: 'technik' },
          lead_person_id: 123,
          lead_deal_id: 456,
          support_person_id: 789,
          support_note_status: 'created',
          support_match_state: 'unique',
          support_intended_inbox: 'technik@lippelift.de',
          updated_at: expect.any(String),
        }),
      }),
    );
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
});
```

- [ ] **Step 2: Run the failing tracker tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/conversation-tracking.test.ts
```

Expected: FAIL because `../src/services/conversation-tracking.js` does not exist.

- [ ] **Step 3: Implement the tracker service**

Create `backend/src/services/conversation-tracking.ts`:

```ts
export type ConversationEventType =
  | 'state_reported'
  | 'lead_created'
  | 'lead_duplicate'
  | 'support_handoff_created'
  | 'support_handoff_duplicate'
  | 'chat_done'
  | 'chat_error'
  | 'tracking_error';

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
}

interface ConversationTrackerConfig {
  enabled: boolean;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

const disabledTracker: ConversationTracker = {
  isEnabled: () => false,
  ensureSession: async () => undefined,
  recordMessage: async () => undefined,
  recordEvent: async () => undefined,
  updateSession: async () => undefined,
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

function encodeSessionId(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

function definedEntries(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function createConversationTracker(config: ConversationTrackerConfig): ConversationTracker {
  if (!config.enabled || !config.supabaseUrl || !config.serviceRoleKey) {
    return disabledTracker;
  }

  const baseUrl = normalizeBaseUrl(config.supabaseUrl);
  const serviceRoleKey = config.serviceRoleKey;

  async function request(path: string, init: RequestInit): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${path}`, init);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supabase ${init.method || 'GET'} ${path} failed with ${res.status}: ${body}`);
      }
    } catch (err) {
      console.error('Conversation tracking error:', err);
    }
  }

  async function patchSession(sessionId: string, payload: Record<string, unknown>): Promise<void> {
    await request(`conversation_sessions?session_id=eq.${encodeSessionId(sessionId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(serviceRoleKey),
      body: JSON.stringify(definedEntries({ ...payload, updated_at: new Date().toISOString() })),
    });
  }

  return {
    isEnabled: () => true,

    async ensureSession(sessionId: string): Promise<void> {
      await request('conversation_sessions?on_conflict=session_id', {
        method: 'POST',
        headers: {
          ...jsonHeaders(serviceRoleKey),
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ session_id: sessionId, updated_at: new Date().toISOString() }),
      });
    },

    async recordMessage(input): Promise<void> {
      const turnIndex = input.turnIndex ?? Date.now();
      await request('conversation_messages', {
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
      });
    },

    async recordEvent(input): Promise<void> {
      await request('conversation_events', {
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
  };
}
```

- [ ] **Step 4: Run the tracker tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/conversation-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the tracker service**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
git add backend/src/services/conversation-tracking.ts backend/tests/conversation-tracking.test.ts
git commit -m "feat: add conversation tracker service"
```

Expected: commit succeeds with only tracker files staged.

## Task 3: Wire Tracking Config and Backend Startup

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `backend/tests/config.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write failing config tests**

Append these tests to `backend/tests/config.test.ts` inside `describe('loadConfig', () => { ... })`:

```ts
  it('defaults conversation tracking to disabled', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CONVERSATION_TRACKING_ENABLED;

    const config = loadConfig();

    expect(config.supabaseUrl).toBe('');
    expect(config.supabaseServiceRoleKey).toBe('');
    expect(config.conversationTrackingEnabled).toBe(false);
  });

  it('loads Supabase conversation tracking settings', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.SUPABASE_URL = 'https://qnvgiihzbihkedakggth.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.CONVERSATION_TRACKING_ENABLED = 'true';

    const config = loadConfig();

    expect(config.supabaseUrl).toBe('https://qnvgiihzbihkedakggth.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('service-role-key');
    expect(config.conversationTrackingEnabled).toBe(true);
  });
```

- [ ] **Step 2: Run the failing config tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/config.test.ts
```

Expected: FAIL because the three config properties do not exist.

- [ ] **Step 3: Add config fields**

Modify `backend/src/config/index.ts`:

```ts
const configSchema = z.object({
  vertexAiEnabled: z.boolean().default(true),
  vertexAiProjectId: z.string().min(1),
  vertexAiLocation: z.string().min(1).default('us-central1'),
  pipedriveApiKey: z.string().default(''),
  pipedrivePipelineId: z.coerce.number().default(1),
  pipedriveStageId: z.coerce.number().default(1),
  smtpHost: z.string().default(''),
  smtpPort: z.coerce.number().default(587),
  smtpUser: z.string().default(''),
  smtpPass: z.string().default(''),
  notificationEmailTo: z.string().default(''),
  serviceEmailTo: z.string().default(''),
  supabaseUrl: z.string().default(''),
  supabaseServiceRoleKey: z.string().default(''),
  conversationTrackingEnabled: z.boolean().default(false),
  port: z.coerce.number().default(3000),
  corsOrigin: z.string().default('http://localhost:5173'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});
```

Add the env mapping inside `loadConfig()`:

```ts
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    conversationTrackingEnabled: parseBoolean(process.env.CONVERSATION_TRACKING_ENABLED, false),
```

- [ ] **Step 4: Wire the tracker in startup**

Modify `backend/src/index.ts`:

```ts
import { createConversationTracker } from './services/conversation-tracking.js';
```

Create the tracker after email:

```ts
const conversationTracker = createConversationTracker({
  enabled: config.conversationTrackingEnabled,
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
```

Add health readback:

```ts
    conversationTracking: conversationTracker.isEnabled(),
```

Pass the tracker into `createChatRoute`:

```ts
const chatRoute = createChatRoute({
  gemini,
  pipedrive,
  email,
  conversationTracker,
  notificationEmailTo: config.notificationEmailTo,
  serviceEmailTo: config.serviceEmailTo,
});
```

Add startup logging:

```ts
  console.log(`Conversation tracking: ${conversationTracker.isEnabled() ? 'enabled' : 'disabled'}`);
```

- [ ] **Step 5: Document env vars**

Append this block to `backend/.env.example` between Email and Server:

```bash
# Conversation tracking
SUPABASE_URL=https://qnvgiihzbihkedakggth.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CONVERSATION_TRACKING_ENABLED=false
```

- [ ] **Step 6: Run config tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit config wiring**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
git add backend/src/config/index.ts backend/tests/config.test.ts backend/src/index.ts backend/.env.example
git commit -m "feat: wire conversation tracking config"
```

Expected: commit succeeds with config, startup, and env example files staged.

## Task 4: Add Chat Route Tracking Behavior

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/tests/integration.test.ts`

- [ ] **Step 1: Add test helpers**

In `backend/tests/integration.test.ts`, add this import:

```ts
import type { ConversationTracker } from '../src/services/conversation-tracking.js';
```

Add this helper below `createMockEmail()`:

```ts
function createMockTracker(overrides: Partial<ConversationTracker> = {}): ConversationTracker {
  return {
    isEnabled: vi.fn(() => true),
    ensureSession: vi.fn().mockResolvedValue(undefined),
    recordMessage: vi.fn().mockResolvedValue(undefined),
    recordEvent: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write failing route tracking tests**

Append these tests to `backend/tests/integration.test.ts` inside `describe('POST /api/chat', () => { ... })`:

```ts
  it('records the current user message and one final assistant message', async () => {
    const tracker = createMockTracker();
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-1', message: 'Hallo Sarah', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(tracker.ensureSession).toHaveBeenCalledWith('tracked-1');
    expect(tracker.recordMessage).toHaveBeenCalledWith({
      sessionId: 'tracked-1',
      role: 'user',
      content: 'Hallo Sarah',
      turnIndex: 1,
    });
    expect(tracker.recordMessage).toHaveBeenCalledWith({
      sessionId: 'tracked-1',
      role: 'assistant',
      content: 'Hallo! Ich bin Sarah.',
      turnIndex: 2,
    });
    expect(tracker.recordMessage).toHaveBeenCalledTimes(2);
  });

  it('records state_reported and chat_done events', async () => {
    const tracker = createMockTracker();
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-state', message: 'Hallo', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-state',
      eventType: 'state_reported',
      payload: { mode: 'berater', collectedData: {} },
    });
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-state',
      eventType: 'chat_done',
      payload: { mode: 'berater', collectedData: {} },
    });
    expect(tracker.updateSession).toHaveBeenCalledWith({
      sessionId: 'tracked-state',
      finalMode: 'berater',
      finalCollectedData: {},
    });
  });

  it('records lead_created and lead_duplicate events', async () => {
    const tracker = createMockTracker();
    const createLead = vi.fn().mockResolvedValue({ personId: 123, dealId: 456 });
    const leadData = {
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
      },
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const body = JSON.stringify({ sessionId: 'tracked-lead', message: 'Lead', history: [] });

    await (await testApp.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).text();
    await (await testApp.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).text();

    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-lead',
      eventType: 'lead_created',
      payload: { personId: 123, dealId: 456 },
    });
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-lead',
      eventType: 'lead_duplicate',
      payload: { personId: 123, dealId: 456 },
    });
    expect(tracker.updateSession).toHaveBeenCalledWith({
      sessionId: 'tracked-lead',
      leadPersonId: 123,
      leadDealId: 456,
    });
  });

  it('records support handoff events and metadata', async () => {
    const tracker = createMockTracker();
    const supportData = {
      customerName: 'Maria Schmidt',
      category: 'technik' as const,
      issueDescription: 'Lift piept.',
      phone: '05261 96660',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'service' as const, serviceData: supportData };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn(),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn().mockResolvedValue({ matchState: 'unique', personId: 789, candidateCount: 1 }),
        createSupportNote: vi.fn().mockResolvedValue(undefined),
      },
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-support', message: 'Service', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-support',
      eventType: 'support_handoff_created',
      payload: {
        matchState: 'unique',
        personId: 789,
        intendedInbox: 'technik@lippelift.de',
        emailRecipient: 'caechma@gmail.com',
        noteStatus: 'created',
        noteError: undefined,
      },
    });
    expect(tracker.updateSession).toHaveBeenCalledWith({
      sessionId: 'tracked-support',
      supportPersonId: 789,
      supportNoteStatus: 'created',
      supportMatchState: 'unique',
      supportIntendedInbox: 'technik@lippelift.de',
    });
  });

  it('records chat_error when generation fails', async () => {
    const tracker = createMockTracker();
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          throw new Error('upstream exhausted');
        },
      },
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-error', message: 'Hallo', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-error',
      eventType: 'chat_error',
      payload: { message: 'upstream exhausted' },
    });
  });

  it('continues streaming when tracking writes fail', async () => {
    const tracker = createMockTracker({
      ensureSession: vi.fn().mockRejectedValue(new Error('tracking failed')),
      recordMessage: vi.fn().mockRejectedValue(new Error('tracking failed')),
      recordEvent: vi.fn().mockRejectedValue(new Error('tracking failed')),
      updateSession: vi.fn().mockRejectedValue(new Error('tracking failed')),
    });
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-failing', message: 'Hallo', history: [] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
  });
```

- [ ] **Step 3: Run the failing route tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/integration.test.ts
```

Expected: FAIL because `ChatDeps` does not accept `conversationTracker` and the route does not call it.

- [ ] **Step 4: Add tracker injection and safe write helper**

Modify `backend/src/routes/chat.ts` imports:

```ts
import type { ConversationTracker } from '../services/conversation-tracking.js';
```

Modify `ChatDeps`:

```ts
interface ChatDeps {
  gemini: GeminiService;
  pipedrive: PipedriveService;
  email: EmailService;
  conversationTracker?: ConversationTracker;
  notificationEmailTo: string;
  serviceEmailTo: string;
}
```

Add this helper above `export function createChatRoute`:

```ts
async function track(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (err) {
    console.error('Conversation tracking error:', err);
  }
}
```

At the top of `createChatRoute`, add:

```ts
  const tracker = deps.conversationTracker;
```

- [ ] **Step 5: Record lead events**

Inside `emitLeadAction`, after writing a duplicate SSE action, add:

```ts
      if (tracker?.isEnabled()) {
        await track(tracker.recordEvent({
          sessionId,
          eventType: 'lead_duplicate',
          payload: existingResult,
        }));
      }
```

After `completedLeadActions.set(sessionId, result);`, add:

```ts
        if (tracker?.isEnabled()) {
          await track(tracker.recordEvent({
            sessionId,
            eventType: 'lead_created',
            payload: result,
          }));
          await track(tracker.updateSession({
            sessionId,
            leadPersonId: result.personId,
            leadDealId: result.dealId,
          }));
        }
```

- [ ] **Step 6: Record support events**

Inside `emitSupportAction`, after writing the duplicate SSE action, add:

```ts
      if (tracker?.isEnabled()) {
        await track(tracker.recordEvent({
          sessionId,
          eventType: 'support_handoff_duplicate',
          payload: existingResult,
        }));
      }
```

After `completedSupportActions.set(sessionId, result);`, add:

```ts
    if (tracker?.isEnabled()) {
      await track(tracker.recordEvent({
        sessionId,
        eventType: 'support_handoff_created',
        payload: result,
      }));
      await track(tracker.updateSession({
        sessionId,
        supportPersonId: result.personId,
        supportNoteStatus: result.noteStatus,
        supportMatchState: result.matchState,
        supportIntendedInbox: result.intendedInbox,
      }));
    }
```

- [ ] **Step 7: Record user, assistant, state, done, and error**

Inside the validated request path, before `const gen = deps.gemini.streamChat(...)`, add:

```ts
        if (tracker?.isEnabled()) {
          await track(tracker.ensureSession(sessionId));
          await track(tracker.recordMessage({
            sessionId,
            role: 'user',
            content: message,
            turnIndex: history.length + 1,
          }));
        }
```

Before the `for await` loop, add:

```ts
        let assistantText = '';
```

Inside the token branch, before `await stream.writeSSE(...)`, add:

```ts
            assistantText += event.content;
```

Inside the state branch, after assigning `lastMode` and `lastCollectedData`, add:

```ts
            if (tracker?.isEnabled()) {
              await track(tracker.recordEvent({
                sessionId,
                eventType: 'state_reported',
                payload: { mode: lastMode, collectedData: lastCollectedData },
              }));
              await track(tracker.updateSession({
                sessionId,
                finalMode: lastMode,
                finalCollectedData: lastCollectedData as Record<string, unknown>,
              }));
            }
```

Before writing the `done` SSE event, add:

```ts
        if (tracker?.isEnabled() && assistantText.trim().length > 0) {
          await track(tracker.recordMessage({
            sessionId,
            role: 'assistant',
            content: assistantText,
            turnIndex: history.length + 2,
          }));
        }
        if (tracker?.isEnabled()) {
          await track(tracker.recordEvent({
            sessionId,
            eventType: 'chat_done',
            payload: { mode: lastMode, collectedData: lastCollectedData },
          }));
          await track(tracker.updateSession({
            sessionId,
            finalMode: lastMode,
            finalCollectedData: lastCollectedData as Record<string, unknown>,
          }));
        }
```

Inside the catch block, before writing the error SSE event, add:

```ts
        if (tracker?.isEnabled()) {
          await track(tracker.recordEvent({
            sessionId,
            eventType: 'chat_error',
            payload: { message: err instanceof Error ? err.message : String(err) },
          }));
        }
```

- [ ] **Step 8: Run route tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test -- --run tests/integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit route integration**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
git add backend/src/routes/chat.ts backend/tests/integration.test.ts
git commit -m "feat: track chat conversations"
```

Expected: commit succeeds with route and integration test changes staged.

## Task 5: Final Verification and Acceptance Checks

**Files:**
- Verify: `backend`
- Verify: `widget`
- Verify: `supabase/migrations/20260529120000_conversation_tracking.sql`

- [ ] **Step 1: Run all backend tests**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm test
```

Expected: PASS for all Vitest suites.

- [ ] **Step 2: Build backend**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot/backend
npm run build
```

Expected: PASS with TypeScript emitting `dist/`.

- [ ] **Step 3: Verify the widget has no Supabase references**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
rg -n "SUPABASE|supabase|SERVICE_ROLE|conversation_sessions|conversation_messages|conversation_events" widget
```

Expected: no output.

- [ ] **Step 4: Verify backend env references are isolated**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
rg -n "SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|CONVERSATION_TRACKING_ENABLED|conversationTracking" backend/src backend/.env.example
```

Expected: matches only in `backend/src/config/index.ts`, `backend/src/index.ts`, and `backend/.env.example`.

- [ ] **Step 5: Verify migration contains RLS without public policies**

Run:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
rg -n "enable row level security|create policy|conversation_sessions|conversation_messages|conversation_events" supabase/migrations/20260529120000_conversation_tracking.sql
```

Expected: three `enable row level security` matches, table/index references, and no `create policy` match.

- [ ] **Step 6: Commit verification cleanup if needed**

If verification creates tracked build artifacts, leave them unstaged. If it requires source fixes, commit only the source/test files for those fixes:

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
git status --short
```

Expected: no unintended widget changes and no Supabase credentials in tracked files.

## Manual Supabase Enablement Notes

Run the migration SQL in the Supabase project `https://qnvgiihzbihkedakggth.supabase.co` before enabling production tracking.

Production backend envs:

```bash
SUPABASE_URL=https://qnvgiihzbihkedakggth.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
CONVERSATION_TRACKING_ENABLED=true
```

After deploy/restart, verify:

```bash
curl -s http://187.124.16.6:8085/api/health
```

Expected JSON includes:

```json
{
  "status": "ok",
  "conversationTracking": true
}
```

Run one Sarah chat and then verify Supabase with:

```sql
select session_id, started_at, last_message_at, message_count, final_mode, lead_deal_id, support_match_state, support_note_status
from public.conversation_sessions
order by started_at desc
limit 50;

select role, content, created_at
from public.conversation_messages
where session_id = '<session-id>'
order by turn_index, created_at;

select event_type, payload, created_at
from public.conversation_events
where session_id = '<session-id>'
order by created_at;
```

## Self-Review

- Spec coverage: schema, RLS, event names, disabled behavior, service-role backend writes, route orchestration, assistant token accumulation, lead/support events, error tracking, config, env docs, and widget non-change verification are covered.
- Scope control: no dashboard, scheduler, admin UI, generated summaries, transcript restore, visitor identity resolution, PII redaction, or retention job is included.
- Placeholder scan: no implementation step uses unresolved placeholder language or unbounded validation instructions.
- Type consistency: `ConversationTracker`, `ConversationEventType`, config keys, and route dependency names are consistent across tasks.
