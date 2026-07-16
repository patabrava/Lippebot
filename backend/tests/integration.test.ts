import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createChatRoute } from '../src/routes/chat.js';
import type { GeminiService } from '../src/services/gemini.js';
import type { PipedriveService } from '../src/services/pipedrive.js';
import type { EmailService } from '../src/services/email.js';
import type { ConversationTracker } from '../src/services/conversation-tracking.js';

function createMockGemini(): GeminiService {
  return {
    async *streamChat(sessionId: string, message: string) {
      yield { type: 'token' as const, content: 'Hallo! ' };
      yield { type: 'token' as const, content: 'Ich bin Sarah.' };
      yield {
        type: 'state' as const,
        state: { sessionId, mode: 'berater' as const, collectedData: {} },
      };
    },
  };
}

function createMockPipedrive(): PipedriveService {
  return {
    isConfigured: () => false,
    createLead: vi.fn(),
    createServiceActivity: vi.fn(),
    createSupportCase: vi.fn(),
    resolveSupportPerson: vi.fn(),
    createSupportNote: vi.fn(),
    createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
  };
}

function createMockEmail(): EmailService {
  return {
    isConfigured: () => true,
    sendLeadNotification: vi.fn(),
    sendServiceNotification: vi.fn(),
    sendAbandonedChatSummary: vi.fn(),
    sendSupportNotification: vi.fn(),
    sendCompletedChatSummary: vi.fn().mockResolvedValue(undefined),
  };
}

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

describe('POST /api/chat', () => {
  let app: Hono;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    app = new Hono();
    app.route('/', chatRoute);
  });

  it('returns 400 for invalid request', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('streams SSE response for valid request', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-123',
        message: 'Hallo',
        history: [],
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain('Hallo!');
    expect(text).toContain('Ich bin Sarah.');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"mode":"berater"');
  });

  it('does not mistake an ordinary response turn for the end of a general conversation', async () => {
    const sequence: string[] = [];
    const sendCompletedChatSummary = vi.fn().mockImplementation(async () => {
      sequence.push('email');
    });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          sequence.push('token-1');
          yield { type: 'token' as const, content: 'Sarahs ' };
          sequence.push('token-2');
          yield { type: 'token' as const, content: 'finale Antwort' };
          yield { type: 'state' as const, state: { sessionId, mode: 'berater' as const, collectedData: {} } };
        },
      },
      pipedrive: createMockPipedrive(),
      email: { ...createMockEmail(), sendCompletedChatSummary },
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'completed-general',
        message: 'Ich brauche Hilfe',
        history: [
          { role: 'assistant', content: 'Willkommen bei LIPPE Lift.', timestamp: 1_752_652_000_000 },
        ],
      }),
    })).text();

    expect(sequence).toEqual(['token-1', 'token-2']);
    expect(sendCompletedChatSummary).not.toHaveBeenCalled();
    expect(text).toContain('"type":"done"');
  });

  it('sends one opportunity summary with structured data and suppresses the early lead email', async () => {
    const sendLeadNotification = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
      message: 'Ich brauche einen Sitzlift.',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Ihre Anfrage wurde aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
      },
      email: { ...createMockEmail(), sendLeadNotification, sendCompletedChatSummary },
      notificationEmailTo: 'sales@example.com',
      serviceEmailTo: 'support@example.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'completed-opportunity', message: 'Absenden', history: [] }),
    })).text();

    expect(sendLeadNotification).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('sales@example.com', expect.objectContaining({
      kind: 'opportunity',
      leadData,
      leadContext: { outcome: 'created', personId: 321, dealId: 654 },
      transcript: expect.stringContaining('Ihre Anfrage wurde aufgenommen.'),
    }));
    expect(text).toContain('"type":"done"');
  });

  it('sends one case summary with structured data and suppresses the early support email', async () => {
    const sendSupportNotification = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      category: 'technik' as const,
      issueDescription: 'Der Lift bleibt im Erdgeschoss stehen.',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'service' as const, serviceData: supportData };
          yield { type: 'token' as const, content: 'Der Servicefall wurde aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'service' as const, collectedData: supportData } };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        resolveSupportPerson: vi.fn().mockResolvedValue({
          matchState: 'unique', personId: 501, dealId: 7001, candidateCount: 1,
        }),
        createSupportNote: vi.fn().mockResolvedValue({ noteId: 9001 }),
      },
      email: { ...createMockEmail(), sendSupportNotification, sendCompletedChatSummary },
      notificationEmailTo: 'sales@example.com',
      serviceEmailTo: 'support@example.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'completed-case', message: 'Servicefall absenden', history: [] }),
    })).text();

    expect(sendSupportNotification).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('support@example.com', expect.objectContaining({
      kind: 'case',
      supportData,
      supportContext: expect.objectContaining({
        matchState: 'unique', noteStatus: 'created', intendedInbox: 'technik@lippelift.de', dealId: 7001,
      }),
      transcript: expect.stringContaining('Der Servicefall wurde aufgenommen.'),
    }));
    expect(text).toContain('"type":"done"');
  });

  it('retries a completed summary email and gates done on permanent SMTP failure', async () => {
    const tracker = createMockTracker();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendCompletedChatSummary = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Retry',
      lastName: 'Test',
      email: 'retry@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Anfrage aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
      },
      email: { ...createMockEmail(), sendCompletedChatSummary },
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'completed-email-failure', message: 'Hallo', history: [] }),
    })).text();

    expect(sendCompletedChatSummary).toHaveBeenCalledTimes(3);
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'completed-email-failure',
      eventType: 'completed_summary_email_failed',
      payload: expect.objectContaining({ recipient: 'berg@lippelift.de', error: 'SMTP unavailable' }),
    });
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(errorSpy).toHaveBeenCalledWith('Chat stream error:', expect.any(Error));
  });

  it('does not report a completed opportunity when SMTP is not configured', async () => {
    const tracker = createMockTracker();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendCompletedChatSummary = vi.fn();
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Config',
      lastName: 'Test',
      email: 'config@example.de',
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
        ...createMockPipedrive(),
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
      },
      email: { ...createMockEmail(), isConfigured: () => false, sendCompletedChatSummary },
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'completed-email-unconfigured', message: 'Absenden', history: [] }),
    })).text();

    expect(sendCompletedChatSummary).not.toHaveBeenCalled();
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'completed-email-unconfigured',
      eventType: 'completed_summary_email_failed',
      payload: expect.objectContaining({ recipient: 'berg@lippelift.de', error: 'Email not configured' }),
    });
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(errorSpy).toHaveBeenCalledWith('Chat stream error:', expect.any(Error));
  });

  it('deduplicates completed summary email writes for repeated and concurrent session completion', async () => {
    let resolveSend: (() => void) | undefined;
    const sendCompletedChatSummary = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSend = resolve;
    }));
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Dedupe',
      lastName: 'Test',
      email: 'dedupe@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Anfrage aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
      },
      email: { ...createMockEmail(), sendCompletedChatSummary },
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const request = () => testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'completed-email-dedupe', message: 'Hallo', history: [] }),
    }).then((res) => res.text());

    const first = request();
    const second = request();
    await vi.waitFor(() => expect(sendCompletedChatSummary).toHaveBeenCalledOnce());
    resolveSend?.();
    const [firstText, secondText] = await Promise.all([first, second]);
    const thirdText = await request();

    expect(sendCompletedChatSummary).toHaveBeenCalledOnce();
    expect(firstText).toContain('"type":"done"');
    expect(secondText).toContain('"type":"done"');
    expect(thirdText).toContain('"type":"done"');
  });

  it('does not run state fallback after a lead action was already emitted', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 123, dealId: 456 });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          const leadData = {
            priorContact: 'unknown' as const,
            customerSegment: 'Privatperson' as never,
            firstName: 'Max',
            lastName: 'Mustermann',
            phone: '05261 96660',
            street: 'Musterstrasse 1',
            postalCode: '32657',
            city: 'Lemgo',
            availability: '08:00 - 12:00' as const,
          };
          yield { type: 'lead' as const, leadData };
          yield {
            type: 'state' as const,
            state: { sessionId, mode: 'anfrage' as const, collectedData: leadData },
          };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-duplicate-guard',
        message: 'Hallo',
        history: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(await res.text()).toContain('"action":"create_lead"');
  });

  it('does not create a directly submitted lead without phone or email', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 123, dealId: 456 });
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'lead' as const, leadData };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'lead-needs-contact', message: 'Das ist alles', history: [] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(createLead).not.toHaveBeenCalled();
    expect(text).toContain('"action":"create_lead"');
    expect(text).toContain('"status":"needs_contact"');
  });

  it('does not create a complete lead before prior-contact status is known', async () => {
    const createLead = vi.fn();
    const leadData = {
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'lead' as const, leadData };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        createLead,
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'lead-needs-prior-contact', message: 'Das ist alles', history: [] }),
    });

    expect(createLead).not.toHaveBeenCalled();
    expect(await res.text()).toContain('"status":"needs_prior_contact"');
  });

  it('streams du-form fallback copy when chat generation fails', async () => {
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          throw new Error('upstream exhausted');
        },
      },
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-error-copy',
        message: 'Hallo',
        history: [],
      }),
    });

    const text = await res.text();
    expect(text).toContain('Ein Fehler ist aufgetreten. Bitte versuch es erneut.');
    expect(text).not.toContain('Bitte versuchen Sie es erneut.');
  });

  it('emits a lead action when completed lead data is submitted through state fallback', async () => {
    const createLead = vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 });
    const leadData = {
      priorContact: 'unknown' as const,
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
          yield {
            type: 'state' as const,
            state: { sessionId, mode: 'anfrage' as const, collectedData: leadData },
          };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-state-fallback',
        message: 'Hier sind meine Daten',
        history: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(createLead).toHaveBeenCalledWith(leadData);
    const text = await res.text();
    expect(text).toContain('"action":"create_lead"');
    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain('"personId"');
    expect(text).not.toContain('"dealId"');
  });

  it('emits a lead action for complete email-only state fallback data', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 321, dealId: 654 });
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield {
            type: 'state' as const,
            state: { sessionId, mode: 'anfrage' as const, collectedData: leadData },
          };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'email-state-fallback', message: 'Hier sind meine Daten', history: [] }),
    });

    expect(res.status).toBe(200);
    expect(createLead).toHaveBeenCalledWith(leadData);
    expect(await res.text()).toContain('"action":"create_lead"');
  });

  it('does not emit a lead action for state fallback data without phone or email', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 321, dealId: 654 });
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield {
            type: 'state' as const,
            state: { sessionId, mode: 'anfrage' as const, collectedData: leadData },
          };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'missing-contact-state', message: 'Hier sind meine Daten', history: [] }),
    });

    expect(res.status).toBe(200);
    expect(createLead).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain('"action":"create_lead"');
  });

  it('does not create a second lead when the same session reports completed data again', async () => {
    const createLead = vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 });
    const leadData = {
      priorContact: 'unknown' as const,
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
          yield {
            type: 'state' as const,
            state: { sessionId, mode: 'anfrage' as const, collectedData: leadData },
          };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const requestBody = {
      sessionId: 'test-same-session-dedupe',
      message: 'Noch eine Nachricht',
      history: [],
    };

    const first = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const second = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(createLead).toHaveBeenCalledTimes(1);
    const secondText = await second.text();
    expect(secondText).toContain('"action":"create_lead"');
    expect(secondText).toContain('"status":"accepted"');
    expect(secondText).not.toContain('"dealId"');
    expect(secondText).toContain('"duplicate":true');
  });

  it('keeps a reused CRM case internal while notifying and tracking the reuse', async () => {
    const tracker = createMockTracker();
    const createLead = vi.fn().mockResolvedValue({ outcome: 'reused', personId: 321, dealId: 654 });
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'lead' as const, leadData };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      conversationTracker: tracker,
      notificationEmailTo: 'team@example.com',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'reused-case', message: 'Noch eine Anfrage', history: [] }),
    });

    const text = await res.text();
    expect(text).toContain('"action":"create_lead"');
    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain('"personId"');
    expect(text).not.toContain('"dealId"');
    expect(text).not.toContain('reused');
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('team@example.com', expect.objectContaining({
      kind: 'opportunity',
      leadData,
      leadContext: { outcome: 'reused', personId: 321, dealId: 654 },
    }));
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'reused-case',
      eventType: 'lead_reused',
      payload: { outcome: 'reused', personId: 321, dealId: 654 },
    });
  });

  it.each([
    [{ outcome: 'person_review', personId: 321, candidateCount: 2, reason: 'multiple_open_deals' }, 'review-person'],
    [{ outcome: 'identity_review', candidateCount: 2, reason: 'conflicting_contact_identifiers' }, 'review-identity'],
  ] as const)('keeps the %s lead review internal while notifying and tracking it', async (crmResult, sessionId) => {
    const tracker = createMockTracker();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Review',
      lastName: 'Test',
      email: 'review@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'lead' as const, leadData };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue(crmResult),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      conversationTracker: tracker,
      notificationEmailTo: 'team@example.com',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: 'Bitte prüfen', history: [] }),
    })).text();

    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain(crmResult.outcome);
    expect(text).not.toContain('"personId"');
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('team@example.com', expect.objectContaining({
      kind: 'opportunity', leadData, leadContext: crmResult,
    }));
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId,
      eventType: 'lead_review',
      payload: crmResult,
    });
  });

  it('still accepts and emails a complete lead when Pipedrive fails', async () => {
    const tracker = createMockTracker();
    const createLead = vi.fn().mockRejectedValue(new Error('Pipedrive unavailable'));
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'Privatperson' as never,
      firstName: 'Erika',
      lastName: 'Test',
      phone: '05261 96660',
      street: 'Musterstrasse 2',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'lead' as const, leadData };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead,
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      conversationTracker: tracker,
      notificationEmailTo: 'team@example.com',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'crm-failed', message: 'Bitte zurückrufen', history: [] }),
    });

    const text = await res.text();
    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain('Pipedrive unavailable');
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('team@example.com', expect.objectContaining({
      kind: 'opportunity',
      leadData,
      leadContext: { outcome: 'failed', reason: 'Pipedrive unavailable' },
    }));
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'crm-failed',
      eventType: 'lead_failed',
      payload: { outcome: 'failed', reason: 'Pipedrive unavailable' },
    });
    expect(errorSpy).toHaveBeenCalledWith('Lead creation error:', expect.any(Error));
  });

  it('writes the complete opportunity transcript before reporting chat completion', async () => {
    const tracker = createMockTracker();
    const sequence: string[] = [];
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max.transcript@example.de',
      street: 'Musterstrasse 1',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const createChatTranscriptNote = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      sequence.push('transcript');
      return { noteId: 9101 };
    });
    vi.mocked(tracker.recordEvent).mockImplementation(async (input) => {
      if (input.eventType === 'chat_done') sequence.push('done');
    });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Die Anfrage wurde vollständig aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote,
      },
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'opportunity-transcript',
        message: 'Bitte senden Sie die Anfrage ab.',
        history: [
          { role: 'assistant', content: 'Willkommen bei LIPPE Lift.', timestamp: Date.parse('2026-07-13T08:00:00Z') },
          { role: 'user', content: 'Ich brauche einen Sitzlift.', timestamp: Date.parse('2026-07-13T08:01:00Z') },
        ],
      }),
    })).text();

    expect(createChatTranscriptNote).toHaveBeenCalledWith('opportunity-transcript', 321, 654, expect.any(String));
    const transcript = createChatTranscriptNote.mock.calls[0][3];
    expect(transcript).toContain('Willkommen bei LIPPE Lift.');
    expect(transcript).toContain('Ich brauche einen Sitzlift.');
    expect(transcript).toContain('Bitte senden Sie die Anfrage ab.');
    expect(transcript).toContain('Die Anfrage wurde vollständig aufgenommen.');
    expect(sequence).toEqual(['transcript', 'done']);
    expect(text).toContain('"type":"done"');
  });

  it('writes a separate complete transcript note for a resolved support case', async () => {
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
      category: 'technik' as const,
      issueDescription: 'Der Lift bleibt stehen.',
    };
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const createChatTranscriptNote = vi.fn().mockResolvedValue({ noteId: 9102 });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'service' as const, serviceData: supportData };
          yield { type: 'token' as const, content: 'Der Servicefall wurde aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'service' as const, collectedData: supportData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn(),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, dealId: 7001, candidateCount: 1 }),
        createSupportNote,
        createChatTranscriptNote,
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'support-transcript',
        message: 'Bitte eröffnen Sie den Fall.',
        history: [{ role: 'user', content: 'Mein Lift ist defekt.', timestamp: Date.parse('2026-07-13T08:00:00Z') }],
      }),
    })).text();

    expect(createSupportNote).toHaveBeenCalledWith(501, supportData, 7001);
    expect(createChatTranscriptNote).toHaveBeenCalledWith(
      'support-transcript',
      501,
      7001,
      expect.stringContaining('Vollständiges Sarah-Chatprotokoll'),
    );
    expect(createChatTranscriptNote.mock.calls[0][3]).toContain('Der Servicefall wurde aufgenommen.');
  });

  it('retries transcript persistence and does not duplicate a successful session note', async () => {
    const tracker = createMockTracker();
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Retry',
      lastName: 'Test',
      phone: '05261 96660',
      street: 'Musterstrasse 2',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const createChatTranscriptNote = vi.fn()
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockResolvedValueOnce({ noteId: 9103 });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Erledigt.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'reused', personId: 321, dealId: 654 }),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote,
      },
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const body = JSON.stringify({ sessionId: 'retry-transcript', message: 'Abschließen', history: [] });

    await (await testApp.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).text();
    await (await testApp.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).text();

    expect(createChatTranscriptNote).toHaveBeenCalledTimes(3);
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'retry-transcript',
      eventType: 'crm_transcript_note_created',
      payload: { personId: 321, dealId: 654, noteId: 9103 },
    });
  });

  it('shares one in-flight transcript write between concurrent retries for the same session target', async () => {
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Concurrent',
      lastName: 'Test',
      phone: '05261 96660',
      street: 'Musterstrasse 4',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    let releaseTranscript!: (value: { noteId: number }) => void;
    const pendingTranscript = new Promise<{ noteId: number }>((resolve) => {
      releaseTranscript = resolve;
    });
    const createChatTranscriptNote = vi.fn().mockReturnValue(pendingTranscript);
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Erledigt.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'reused', personId: 321, dealId: 654 }),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote,
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const body = JSON.stringify({ sessionId: 'concurrent-transcript', message: 'Abschließen', history: [] });

    const firstText = (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })).text();
    await vi.waitFor(() => expect(createChatTranscriptNote).toHaveBeenCalledTimes(1));

    const secondText = (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })).text();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(createChatTranscriptNote).toHaveBeenCalledTimes(1);
    releaseTranscript({ noteId: 9104 });
    await Promise.all([firstText, secondText]);
    expect(createChatTranscriptNote).toHaveBeenCalledTimes(1);
  });

  it('does not report done when mandatory transcript persistence fails three times', async () => {
    const tracker = createMockTracker();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const leadData = {
      priorContact: 'unknown' as const,
      customerSegment: 'privatperson' as const,
      firstName: 'Failure',
      lastName: 'Test',
      phone: '05261 96660',
      street: 'Musterstrasse 3',
      postalCode: '32657',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };
    const createChatTranscriptNote = vi.fn().mockRejectedValue(new Error('Pipedrive notes unavailable'));
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'lead' as const, leadData };
          yield { type: 'token' as const, content: 'Die Anfrage ist aufgenommen.' };
          yield { type: 'state' as const, state: { sessionId, mode: 'anfrage' as const, collectedData: leadData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 321, dealId: 654 }),
        createServiceActivity: vi.fn(),
        resolveSupportPerson: vi.fn(),
        createSupportNote: vi.fn(),
        createChatTranscriptNote,
      },
      email: createMockEmail(),
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'failed-transcript', message: 'Abschließen', history: [] }),
    })).text();

    expect(createChatTranscriptNote).toHaveBeenCalledTimes(3);
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'failed-transcript',
      eventType: 'crm_transcript_note_failed',
      payload: { personId: 321, dealId: 654, error: 'Pipedrive notes unavailable' },
    });
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(errorSpy).toHaveBeenCalledWith('Chat stream error:', expect.any(Error));
  });

  it('creates a compact support note and sends one routed support email for a unique match', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({
      matchState: 'unique',
      personId: 501,
      dealId: 654,
      candidateCount: 1,
    });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const createServiceActivity = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt im Erdgeschoss stehen.',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
          yield { type: 'service' as const, serviceData: supportData };
          yield { type: 'state' as const, state: { sessionId, mode: 'service' as const, collectedData: supportData } };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn(),
        createServiceActivity,
        resolveSupportPerson,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-unique', message: 'Mein Lift ist kaputt', history: [] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(resolveSupportPerson).toHaveBeenCalledWith(supportData);
    expect(createSupportNote).toHaveBeenCalledWith(501, supportData, 654);
    expect(createServiceActivity).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      kind: 'case',
      supportData,
      supportContext: expect.objectContaining({
        intendedInbox: 'technik@lippelift.de', matchState: 'unique', noteStatus: 'created', dealId: 654,
      }),
    }));
    expect(text).toContain('"action":"create_service"');
    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain('"matchState"');
    expect(text).not.toContain('technik@lippelift.de');
    expect(text).not.toContain('caechma@gmail.com');
    expect(text).not.toContain('Pipedrive');
    expect(text).not.toContain('CRM');
    expect(text).not.toContain('lippelift.pipedrive.com');
    expect(text).not.toContain('/deal/654');
    expect(text).not.toContain('"dealId"');
  });

  it('accepts an email-only support handoff without requesting a phone number', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 501, dealId: 7002, createdPerson: false });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt im Erdgeschoss stehen.',
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
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-email-only', message: 'Mein Lift ist kaputt', history: [] }),
    });

    const text = await res.text();
    expect(resolveSupportPerson).toHaveBeenCalledWith(supportData);
    expect(createSupportCase).toHaveBeenCalledWith(supportData, {
      matchState: 'unique', personId: 501, candidateCount: 1,
    });
    expect(createSupportNote).toHaveBeenCalledWith(501, supportData, 7002);
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      kind: 'case', supportData,
    }));
    expect(text).toContain('"status":"accepted"');
  });

  it('passes a matched opportunity id to the support note writer', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({
      matchState: 'unique',
      personId: 501,
      dealId: 7001,
      candidateCount: 1,
    });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendSupportNotification = vi.fn().mockResolvedValue({ messageId: 'support-1' });
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      category: 'sales' as const,
      issueDescription: 'TEST NOTE',
      offerNumber: '14.28',
    };
    const app = createChatRoute({
      gemini: {
        async *streamChat(sessionId) {
          yield { type: 'service' as const, serviceData: supportData };
          yield { type: 'state' as const, state: { sessionId, mode: 'service' as const, collectedData: supportData } };
          yield { type: 'token' as const, content: 'Danke, ich gebe das weiter.' };
        },
      },
      pipedrive: {
        isConfigured: () => true,
        createLead: vi.fn(),
        createServiceActivity: vi.fn(),
        resolveSupportPerson,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'berg@lippelift.de',
    });

    await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-opportunity', message: 'Status Angebot 14.28', history: [] }),
    });

    expect(createSupportNote).toHaveBeenCalledWith(501, supportData, 7001);
  });

  it('creates a reviewable Pipedrive case and full transcript for unresolved support matches', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 701, dealId: 801, createdPerson: true });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const createChatTranscriptNote = vi.fn().mockResolvedValue({ noteId: 9100 });
    const createServiceActivity = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Unbekannter Kunde',
      phone: '05261 96660',
      category: 'finance' as const,
      issueDescription: 'Frage zu einer Rechnung.',
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
        createServiceActivity,
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote,
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-unresolved', message: 'Rechnung', history: [] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(createSupportCase).toHaveBeenCalledWith(supportData, {
      matchState: 'unresolved',
      candidateCount: 0,
    });
    expect(createSupportNote).toHaveBeenCalledWith(701, supportData, 801, 'unresolved');
    expect(createChatTranscriptNote).toHaveBeenCalledWith(
      'support-unresolved',
      701,
      801,
      expect.stringContaining('Vollständiges Sarah-Chatprotokoll'),
    );
    expect(createServiceActivity).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      kind: 'case',
      supportData,
      supportContext: expect.objectContaining({
        intendedInbox: 'finance@lippelift.de', matchState: 'unresolved', noteStatus: 'created', dealId: 801,
      }),
    }));
    expect(text).toContain('"type":"done"');
  });

  it('creates a separate review case without guessing an ambiguous existing customer', async () => {
    const match = { matchState: 'ambiguous' as const, candidateCount: 2 };
    const resolveSupportPerson = vi.fn().mockResolvedValue(match);
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 702, dealId: 802, createdPerson: true });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9002 });
    const createChatTranscriptNote = vi.fn().mockResolvedValue({ noteId: 9102 });
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'yes' as const,
      customerName: 'Maria Schmidt',
      email: 'new-address@example.de',
      category: 'technik' as const,
      issueDescription: 'Der Lift bleibt stehen.',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'service' as const, serviceData: supportData };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote,
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'berg@lippelift.de,caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-ambiguous-review', message: 'Lift defekt', history: [] }),
    })).text();

    expect(createSupportCase).toHaveBeenCalledWith(supportData, match);
    expect(createSupportNote).toHaveBeenCalledWith(702, supportData, 802, 'ambiguous');
    expect(createChatTranscriptNote).toHaveBeenCalledWith(
      'support-ambiguous-review', 702, 802, expect.any(String),
    );
    expect(sendCompletedChatSummary).toHaveBeenCalledWith(
      'berg@lippelift.de,caechma@gmail.com',
      expect.objectContaining({
        kind: 'case',
        supportContext: expect.objectContaining({ matchState: 'ambiguous', noteStatus: 'created', dealId: 802 }),
      }),
    );
    expect(text).toContain('"type":"done"');
  });

  it('emails the team but does not report completion when fallback CRM case creation fails', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const createSupportCase = vi.fn().mockRejectedValue(new Error('Pipedrive API error: 503 Service Unavailable'));
    const createSupportNote = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Camilo Test',
      email: 'camilo.test@example.de',
      category: 'lossau' as const,
      issueDescription: 'Installation ausstehend.',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'service' as const, serviceData: supportData };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'berg@lippelift.de',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const text = await (await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-crm-failure', message: 'Installation', history: [] }),
    })).text();

    expect(createSupportNote).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('berg@lippelift.de', expect.objectContaining({
      kind: 'case',
      supportContext: expect.objectContaining({
        matchState: 'unresolved', noteStatus: 'failed', noteError: 'Pipedrive API error: 503 Service Unavailable',
      }),
    }));
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(errorSpy).toHaveBeenCalledWith('Support case persistence error:', expect.any(Error));
  });

  it('rejects a directly submitted support handoff without phone or email', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Camilo Echeverri',
      category: 'technik' as const,
      issueDescription: 'Treppenlift ist defekt.',
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
        resolveSupportPerson,
        createSupportNote: vi.fn(),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-needs-contact', message: 'Lift defekt', history: [] }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(resolveSupportPerson).not.toHaveBeenCalled();
    expect(sendCompletedChatSummary).not.toHaveBeenCalled();
    expect(text).toContain('"action":"create_service"');
    expect(text).toContain('"status":"needs_contact"');
    expect(text).not.toContain('"matchState"');
  });

  it('does not hand off complete support data before prior-contact status is known', async () => {
    const resolveSupportPerson = vi.fn();
    const supportData = {
      customerName: 'Maria Schmidt',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt stehen.',
      email: 'maria@example.de',
    };
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat() {
          yield { type: 'service' as const, serviceData: supportData };
        },
      },
      pipedrive: {
        ...createMockPipedrive(),
        isConfigured: () => true,
        resolveSupportPerson,
      },
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-needs-prior-contact', message: 'Das ist alles', history: [] }),
    });

    expect(resolveSupportPerson).not.toHaveBeenCalled();
    expect(await res.text()).toContain('"status":"needs_prior_contact"');
  });

  it('still sends the support email when the unique-match note write fails', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 501, dealId: 7003, createdPerson: false });
    const createSupportNote = vi.fn().mockRejectedValue(new Error('Pipedrive API error: 500 Internal Server Error'));
    const createServiceActivity = vi.fn();
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      category: 'lossau' as const,
      issueDescription: 'Ersatzteil fuer die Schiene benoetigt.',
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
        createServiceActivity,
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'support-note-fails', message: 'Ersatzteil', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(createServiceActivity).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Support note creation error:', expect.any(Error));
    expect(sendCompletedChatSummary).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      kind: 'case',
      supportContext: expect.objectContaining({
        intendedInbox: 'lossau@lippelift.de',
        matchState: 'unique',
        noteStatus: 'failed',
        noteError: 'Pipedrive API error: 500 Internal Server Error',
      }),
    }));

    errorSpy.mockRestore();
  });

  it('does not duplicate the support note while retrying a failed completed summary email', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 501, dealId: 7004, createdPerson: false });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendCompletedChatSummary = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt stehen.',
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
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const requestBody = { sessionId: 'support-email-fails', message: 'Lift kaputt', history: [] };

    const first = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(first.status).toBe(200);
    const firstText = await first.text();
    expect(firstText).toContain('"status":"accepted"');
    expect(firstText).toContain('"type":"error"');
    expect(firstText).not.toContain('"type":"done"');
    expect(firstText).not.toContain('SMTP unavailable');

    const second = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(second.status).toBe(200);
    const secondText = await second.text();

    expect(createSupportNote).toHaveBeenCalledTimes(1);
    expect(sendCompletedChatSummary).toHaveBeenCalledTimes(6);
    expect(errorSpy).toHaveBeenCalledWith('Chat stream error:', expect.any(Error));
    expect(secondText).toContain('"duplicate":true');
    expect(secondText).toContain('"type":"error"');
    expect(secondText).not.toContain('"type":"done"');
  });

  it('does not run a second support handoff for the same session', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportCase = vi.fn().mockResolvedValue({ personId: 501, dealId: 7005, createdPerson: false });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendCompletedChatSummary = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      priorContact: 'unknown' as const,
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt stehen.',
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
        resolveSupportPerson,
        createSupportCase,
        createSupportNote,
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary,
      },
      notificationEmailTo: '',
      serviceEmailTo: 'caechma@gmail.com',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);
    const requestBody = { sessionId: 'support-same-session', message: 'Lift kaputt', history: [] };

    const first = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    expect(first.status).toBe(200);
    await first.text();

    const second = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    expect(second.status).toBe(200);
    expect(resolveSupportPerson).toHaveBeenCalledTimes(1);
    expect(createSupportNote).toHaveBeenCalledTimes(1);
    expect(sendCompletedChatSummary).toHaveBeenCalledTimes(1);
    const secondText = await second.text();
    expect(secondText).toContain('"action":"create_service"');
    expect(secondText).toContain('"status":"accepted"');
    expect(secondText).toContain('"duplicate":true');
    expect(secondText).not.toContain('technik@lippelift.de');
  });

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
    const createLead = vi.fn().mockResolvedValue({ outcome: 'created', personId: 123, dealId: 456 });
    const leadData = {
      priorContact: 'unknown' as const,
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
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
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
      payload: { outcome: 'created', personId: 123, dealId: 456 },
    });
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-lead',
      eventType: 'lead_duplicate',
      payload: { outcome: 'created', personId: 123, dealId: 456 },
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
      priorContact: 'unknown' as const,
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
        createSupportCase: vi.fn().mockResolvedValue({ personId: 789, dealId: 7006, createdPerson: false }),
        createSupportNote: vi.fn().mockResolvedValue(undefined),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
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
        dealId: 7006,
        intendedInbox: 'technik@lippelift.de',
        emailRecipient: 'berg@lippelift.de',
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

  it('records completed summary email failures separately from the handoff event', async () => {
    const tracker = createMockTracker();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supportData = {
      priorContact: 'unknown' as const,
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
        createSupportCase: vi.fn().mockResolvedValue({ personId: 789, dealId: 7007, createdPerson: false }),
        createSupportNote: vi.fn().mockResolvedValue(undefined),
        createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 9100 }),
      },
      email: {
        ...createMockEmail(),
        isConfigured: () => true,
        sendCompletedChatSummary: vi.fn().mockRejectedValue(new Error('SMTP unavailable')),
      },
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: 'technik@example.test',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tracked-support-email-fail', message: 'Service', history: [] }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'tracked-support-email-fail',
      eventType: 'completed_summary_email_failed',
      payload: expect.objectContaining({
        recipient: 'technik@example.test', kind: 'case', error: 'SMTP unavailable',
      }),
    });
    expect(errorSpy).toHaveBeenCalledWith('Chat stream error:', expect.any(Error));
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(errorSpy).toHaveBeenCalledWith('Conversation tracking error:', expect.any(Error));
  });
});

describe('POST /api/chat/abandoned', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a support summary email for an unanswered inactive chat', async () => {
    const sendAbandonedChatSummary = vi.fn().mockResolvedValue(undefined);
    const tracker = createMockTracker();
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification: vi.fn(),
        sendAbandonedChatSummary,
      },
      conversationTracker: tracker,
      notificationEmailTo: '',
      serviceEmailTo: 'support@lippelift.de',
    });
    const testApp = new Hono();
    testApp.route('/', chatRoute);

    const res = await testApp.request('/api/chat/abandoned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'idle-session-1',
        reason: 'no_answer_after_inactivity_prompt',
        history: [
          { role: 'assistant', content: 'Hallo! Ich bin Sarah.', timestamp: 1000 },
          { role: 'user', content: 'Mein Lift macht komische Geraeusche.', timestamp: 2000 },
          { role: 'assistant', content: 'Gibt es noch was was ich tun kann?', timestamp: 3000 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(sendAbandonedChatSummary).toHaveBeenCalledWith('support@lippelift.de', expect.objectContaining({
      sessionId: 'idle-session-1',
      reason: 'no_answer_after_inactivity_prompt',
      transcript: expect.stringContaining('Mein Lift macht komische Geraeusche.'),
    }));
    expect(tracker.recordEvent).toHaveBeenCalledWith({
      sessionId: 'idle-session-1',
      eventType: 'abandoned_summary_sent',
      payload: expect.objectContaining({ emailRecipient: 'support@lippelift.de' }),
    });
  });
});
