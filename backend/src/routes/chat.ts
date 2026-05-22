import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { GeminiService } from '../services/gemini.js';
import type { PipedriveService } from '../services/pipedrive.js';
import type { EmailService } from '../services/email.js';
import type {
  ChatMessage,
  LeadData,
  SupportData,
  SupportHandoffResult,
  SupportNoteStatus,
} from '../types/index.js';
import { getSupportInbox, resolveSupportCategory } from '../support/support-routing.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasRequiredLeadFields(data: unknown): data is LeadData {
  if (!isRecord(data)) {
    return false;
  }

  return !!(
    data.customerSegment
    && data.firstName
    && data.lastName
    && data.phone
    && data.street
    && data.postalCode
    && data.city
    && data.availability
  );
}

function hasRequiredServiceFields(data: unknown): data is SupportData {
  if (!isRecord(data)) {
    return false;
  }

  return !!(data.customerName && data.category && data.issueDescription);
}

function hasSupportDisambiguator(data: SupportData): boolean {
  const candidateFields = [
    data.phone,
    data.email,
    data.customerNumber,
    data.invoiceNumber,
    data.orderNumber,
    data.contractReference,
    data.paymentReference,
    data.sparePartReference,
  ];

  return candidateFields.some((value) => typeof value === 'string' && value.trim().length > 0);
}

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

type LeadActionResult = { personId: number; dealId: number };
type SupportClientActionResult = { status: 'accepted' | 'needs_contact' };

function buildSupportClientActionResult(
  result: Pick<SupportHandoffResult, 'matchState'>,
  supportData: SupportData,
): SupportClientActionResult {
  if ((result.matchState === 'unresolved' || result.matchState === 'ambiguous') && !hasSupportDisambiguator(supportData)) {
    return { status: 'needs_contact' };
  }

  return { status: 'accepted' };
}

export function createChatRoute(deps: ChatDeps): Hono {
  const app = new Hono();
  const completedLeadActions = new Map<string, LeadActionResult>();
  const completedSupportActions = new Map<string, SupportHandoffResult>();

  async function emitLeadAction(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    sessionId: string,
    leadData: LeadData,
    errorLabel: string,
  ): Promise<void> {
    const existingResult = completedLeadActions.get(sessionId);
    if (existingResult) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_lead', data: existingResult, duplicate: true }),
      });
      return;
    }

    try {
      let result: LeadActionResult | undefined;
      if (deps.pipedrive.isConfigured()) {
        result = await deps.pipedrive.createLead(leadData);
        completedLeadActions.set(sessionId, result);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'action', action: 'create_lead', data: result }),
        });
      }
      if (deps.email.isConfigured() && deps.notificationEmailTo) {
        await deps.email.sendLeadNotification(deps.notificationEmailTo, leadData);
      }
    } catch (err) {
      console.error(errorLabel, err);
    }
  }

  async function emitSupportAction(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    sessionId: string,
    supportData: SupportData,
  ): Promise<void> {
    const existingResult = completedSupportActions.get(sessionId);
    if (existingResult) {
      const existingActionResult = buildSupportClientActionResult(existingResult, supportData);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_service', data: existingActionResult, duplicate: true }),
      });
      return;
    }

    const category = resolveSupportCategory(supportData);
    const normalizedSupportData = { ...supportData, category };
    const intendedInbox = getSupportInbox(category);
    const emailRecipient = deps.serviceEmailTo || 'caechma@gmail.com';

    let matchState: SupportHandoffResult['matchState'] = 'unresolved';
    let personId: number | undefined;
    let noteStatus: SupportNoteStatus = 'skipped';
    let noteError: string | undefined;

    if (deps.pipedrive.isConfigured()) {
      try {
        const match = await deps.pipedrive.resolveSupportPerson(normalizedSupportData);
        matchState = match.matchState;
        personId = match.personId;
      } catch (err) {
        console.error('Support person resolution error:', err);
      }

      if (matchState === 'unique' && personId) {
        try {
          await deps.pipedrive.createSupportNote(personId, normalizedSupportData);
          noteStatus = 'created';
        } catch (err) {
          noteStatus = 'failed';
          noteError = err instanceof Error ? err.message : String(err);
          console.error('Support note creation error:', err);
        }
      }
    }

    const result: SupportHandoffResult = {
      matchState,
      personId,
      intendedInbox,
      emailRecipient,
      noteStatus,
      noteError,
    };
    completedSupportActions.set(sessionId, result);
    const clientActionResult = buildSupportClientActionResult(result, normalizedSupportData);

    try {
      if (deps.email.isConfigured() && emailRecipient) {
        await deps.email.sendSupportNotification(emailRecipient, {
          data: normalizedSupportData,
          intendedInbox,
          matchState,
          noteStatus,
          noteError,
        });
      }
    } catch (err) {
      console.error('Support email notification error:', err);
    }

    await stream.writeSSE({
      data: JSON.stringify({ type: 'action', action: 'create_service', data: clientActionResult }),
    });
  }

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
        let leadActionAttempted = false;
        let serviceActionAttempted = false;

        for await (const event of gen) {
          if (event.type === 'token' && event.content) {
            await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: event.content }) });
          }

          if (event.type === 'state' && event.state) {
            lastMode = event.state.mode;
            lastCollectedData = event.state.collectedData;
          }

          if (event.type === 'lead' && event.leadData) {
            leadActionAttempted = true;
            await emitLeadAction(stream, sessionId, event.leadData, 'Lead creation error:');
          }

          if (event.type === 'service' && event.serviceData) {
            serviceActionAttempted = true;
            await emitSupportAction(stream, sessionId, event.serviceData);
          }
        }

        // If Gemini used report_state with complete data (instead of submit_lead/submit_service_request),
        // trigger Pipedrive/email based on mode + collected data completeness
        const collectedObj = lastCollectedData as Record<string, unknown>;
        if (!leadActionAttempted && lastMode === 'anfrage' && hasRequiredLeadFields(collectedObj)) {
          await emitLeadAction(stream, sessionId, collectedObj as LeadData, 'Lead creation from state error:');
        }
        if (!serviceActionAttempted && lastMode === 'service' && hasRequiredServiceFields(collectedObj)) {
          await emitSupportAction(stream, sessionId, collectedObj as SupportData);
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }),
        });
      } catch (err) {
        console.error('Chat stream error:', err);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: 'Ein Fehler ist aufgetreten. Bitte versuch es erneut.' }),
        });
      }
    });
  });

  return app;
}
