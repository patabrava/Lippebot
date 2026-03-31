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
});
