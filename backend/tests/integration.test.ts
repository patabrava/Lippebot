import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createChatRoute } from '../src/routes/chat.js';
import type { GeminiService } from '../src/services/gemini.js';
import type { PipedriveService } from '../src/services/pipedrive.js';
import type { EmailService } from '../src/services/email.js';

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
  };
}

function createMockEmail(): EmailService {
  return {
    isConfigured: () => false,
    sendLeadNotification: vi.fn(),
    sendServiceNotification: vi.fn(),
  };
}

describe('POST /api/chat', () => {
  let app: Hono;

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
});
