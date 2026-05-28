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
    resolveSupportPerson: vi.fn(),
    createSupportNote: vi.fn(),
  };
}

function createMockEmail(): EmailService {
  return {
    isConfigured: () => false,
    sendLeadNotification: vi.fn(),
    sendServiceNotification: vi.fn(),
    sendSupportNotification: vi.fn(),
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

  it('does not run state fallback after a lead action was already emitted', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 123, dealId: 456 });
    const chatRoute = createChatRoute({
      gemini: {
        async *streamChat(sessionId: string) {
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
    const createLead = vi.fn().mockResolvedValue({ personId: 321, dealId: 654 });
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
    expect(text).toContain('"personId":321');
    expect(text).toContain('"dealId":654');
  });

  it('does not create a second lead when the same session reports completed data again', async () => {
    const createLead = vi.fn().mockResolvedValue({ personId: 321, dealId: 654 });
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
    expect(secondText).toContain('"dealId":654');
    expect(secondText).toContain('"duplicate":true');
  });

  it('creates a compact support note and sends one routed support email for a unique match', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const createServiceActivity = vi.fn();
    const sendSupportNotification = vi.fn().mockResolvedValue(undefined);
    const supportData = {
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
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    expect(createSupportNote).toHaveBeenCalledWith(501, supportData);
    expect(createServiceActivity).not.toHaveBeenCalled();
    expect(sendSupportNotification).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      data: supportData,
      intendedInbox: 'technik@lippelift.de',
      matchState: 'unique',
      noteStatus: 'created',
    }));
    expect(text).toContain('"action":"create_service"');
    expect(text).toContain('"status":"accepted"');
    expect(text).not.toContain('"matchState"');
    expect(text).not.toContain('technik@lippelift.de');
    expect(text).not.toContain('caechma@gmail.com');
    expect(text).not.toContain('Pipedrive');
    expect(text).not.toContain('CRM');
  });

  it('does not create a Pipedrive note for unresolved support matches but still sends the email', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const createSupportNote = vi.fn();
    const createServiceActivity = vi.fn();
    const sendSupportNotification = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      customerName: 'Unbekannter Kunde',
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
        createSupportNote,
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    await res.text();
    expect(createSupportNote).not.toHaveBeenCalled();
    expect(createServiceActivity).not.toHaveBeenCalled();
    expect(sendSupportNotification).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      intendedInbox: 'finance@lippelift.de',
      matchState: 'unresolved',
      noteStatus: 'skipped',
    }));
  });

  it('marks unresolved name-only support handoffs as needing contact details', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const sendSupportNotification = vi.fn().mockResolvedValue(undefined);
    const supportData = {
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
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    expect(resolveSupportPerson).toHaveBeenCalledWith(supportData);
    expect(sendSupportNotification).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      matchState: 'unresolved',
      noteStatus: 'skipped',
    }));
    expect(text).toContain('"action":"create_service"');
    expect(text).toContain('"status":"needs_contact"');
    expect(text).not.toContain('"matchState"');
  });

  it('still sends the support email when the unique-match note write fails', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportNote = vi.fn().mockRejectedValue(new Error('Pipedrive API error: 500 Internal Server Error'));
    const createServiceActivity = vi.fn();
    const sendSupportNotification = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supportData = {
      customerName: 'Maria Schmidt',
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
        createSupportNote,
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    expect(sendSupportNotification).toHaveBeenCalledWith('caechma@gmail.com', expect.objectContaining({
      intendedInbox: 'lossau@lippelift.de',
      matchState: 'unique',
      noteStatus: 'failed',
      noteError: 'Pipedrive API error: 500 Internal Server Error',
    }));

    errorSpy.mockRestore();
  });

  it('does not duplicate the support note when the support email fails after a unique match', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendSupportNotification = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supportData = {
      customerName: 'Maria Schmidt',
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
        createSupportNote,
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    expect(firstText).not.toContain('SMTP unavailable');

    const second = await testApp.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(second.status).toBe(200);
    const secondText = await second.text();

    expect(createSupportNote).toHaveBeenCalledTimes(1);
    expect(sendSupportNotification).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Support email notification error:', expect.any(Error));
    expect(secondText).toContain('"duplicate":true');
    expect(secondText).not.toContain('SMTP unavailable');
  });

  it('does not run a second support handoff for the same session', async () => {
    const resolveSupportPerson = vi.fn().mockResolvedValue({ matchState: 'unique', personId: 501, candidateCount: 1 });
    const createSupportNote = vi.fn().mockResolvedValue({ noteId: 9001 });
    const sendSupportNotification = vi.fn().mockResolvedValue(undefined);
    const supportData = {
      customerName: 'Maria Schmidt',
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
        createSupportNote,
      },
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification,
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
    expect(sendSupportNotification).toHaveBeenCalledTimes(1);
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
        emailStatus: 'not_configured',
        emailError: undefined,
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

  it('records support email failures in the handoff event payload', async () => {
    const tracker = createMockTracker();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      email: {
        isConfigured: () => true,
        sendLeadNotification: vi.fn(),
        sendServiceNotification: vi.fn(),
        sendSupportNotification: vi.fn().mockRejectedValue(new Error('SMTP unavailable')),
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
      eventType: 'support_handoff_created',
      payload: {
        matchState: 'unique',
        personId: 789,
        intendedInbox: 'technik@lippelift.de',
        emailRecipient: 'technik@example.test',
        noteStatus: 'created',
        noteError: undefined,
        emailStatus: 'failed',
        emailError: 'SMTP unavailable',
      },
    });
    expect(errorSpy).toHaveBeenCalledWith('Support email notification error:', expect.any(Error));
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
