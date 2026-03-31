import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { GeminiService } from '../services/gemini.js';
import type { PipedriveService } from '../services/pipedrive.js';
import type { EmailService } from '../services/email.js';
import type { ChatMessage } from '../types/index.js';

const chatRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.number(),
  })).default([]),
});

interface ChatDeps {
  gemini: GeminiService;
  pipedrive: PipedriveService;
  email: EmailService;
  notificationEmailTo: string;
  serviceEmailTo: string;
}

export function createChatRoute(deps: ChatDeps): Hono {
  const app = new Hono();

  app.post('/api/chat', async (c) => {
    const body = await c.req.json();
    const parsed = chatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, message, history } = parsed.data;

    return streamSSE(c, async (stream) => {
      try {
        const gen = deps.gemini.streamChat(sessionId, message, history);

        let lastMode = 'undetermined';
        let lastCollectedData = {};

        for await (const event of gen) {
          if (event.type === 'token' && event.content) {
            await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: event.content }) });
          }

          if (event.type === 'state' && event.state) {
            lastMode = event.state.mode;
            lastCollectedData = event.state.collectedData;
          }

          if (event.type === 'lead' && event.leadData) {
            try {
              if (deps.pipedrive.isConfigured()) {
                const result = await deps.pipedrive.createLead(event.leadData);
                await stream.writeSSE({
                  data: JSON.stringify({ type: 'action', action: 'create_lead', data: result }),
                });
              }
              if (deps.email.isConfigured() && deps.notificationEmailTo) {
                await deps.email.sendLeadNotification(deps.notificationEmailTo, event.leadData);
              }
            } catch (err) {
              console.error('Lead creation error:', err);
            }
          }

          if (event.type === 'service' && event.serviceData) {
            try {
              if (deps.pipedrive.isConfigured()) {
                const result = await deps.pipedrive.createServiceActivity(event.serviceData);
                await stream.writeSSE({
                  data: JSON.stringify({ type: 'action', action: 'create_service', data: result }),
                });
              }
              if (deps.email.isConfigured() && deps.serviceEmailTo) {
                await deps.email.sendServiceNotification(deps.serviceEmailTo, event.serviceData);
              }
            } catch (err) {
              console.error('Service activity creation error:', err);
            }
          }
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }),
        });
      } catch (err) {
        console.error('Chat stream error:', err);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.' }),
        });
      }
    });
  });

  return app;
}
