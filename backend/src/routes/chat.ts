import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { GeminiService } from '../services/gemini.js';
import type { PipedriveService } from '../services/pipedrive.js';
import type { EmailService } from '../services/email.js';
import type { ConversationTracker } from '../services/conversation-tracking.js';
import type {
  ChatMessage,
  LeadCrmResult,
  LeadData,
  SupportData,
  SupportHandoffResult,
  SupportNoteStatus,
} from '../types/index.js';
import { getSupportInbox, resolveSupportCategory } from '../support/support-routing.js';
import { hasContactMethod } from '../contact/contact-method.js';
import { buildPipedriveTranscriptNote } from '../chat/transcript.js';

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
    && hasContactMethod(data)
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

  return !!(
    data.customerName
    && data.category
    && data.issueDescription
    && hasContactMethod(data)
  );
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
    data.offerNumber,
    data.leadId,
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

const abandonedChatRequestSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).default('no_answer_after_inactivity_prompt'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.number(),
  })).min(1),
});

interface ChatDeps {
  gemini: GeminiService;
  pipedrive: PipedriveService;
  email: EmailService;
  conversationTracker?: ConversationTracker;
  notificationEmailTo: string;
  serviceEmailTo: string;
}

type LeadInternalResult = LeadCrmResult | {
  outcome: 'failed';
  reason: string;
  personId?: never;
  dealId?: never;
};
type LeadClientActionResult = { status: 'accepted' | 'needs_contact' };
type SupportClientActionResult = { status: 'accepted' | 'needs_contact' };

type TranscriptMessage = z.infer<typeof abandonedChatRequestSchema>['history'][number];

function formatTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((msg) => {
      const speaker = msg.role === 'user' ? 'Nutzer' : 'Sarah';
      const timestamp = Number.isFinite(msg.timestamp)
        ? new Date(msg.timestamp).toISOString()
        : 'Zeit unbekannt';
      return `[${timestamp}] ${speaker}: ${msg.content}`;
    })
    .join('\n\n');
}

function getLastUserMessage(messages: TranscriptMessage[]): string | undefined {
  return [...messages].reverse().find((msg) => msg.role === 'user' && msg.content.trim())?.content.trim();
}

function buildSupportClientActionResult(
  result: Pick<SupportHandoffResult, 'matchState'>,
  supportData: SupportData,
): SupportClientActionResult {
  if ((result.matchState === 'unresolved' || result.matchState === 'ambiguous') && !hasSupportDisambiguator(supportData)) {
    return { status: 'needs_contact' };
  }

  return { status: 'accepted' };
}

async function track(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error('Conversation tracking error:', err);
  }
}

export function createChatRoute(deps: ChatDeps): Hono {
  const app = new Hono();
  const tracker = deps.conversationTracker;
  const completedLeadActions = new Map<string, LeadInternalResult>();
  const completedSupportActions = new Map<string, SupportHandoffResult>();
  const completedTranscriptNotes = new Set<string>();
  const completedAbandonedSummaries = new Set<string>();

  async function emitLeadAction(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    sessionId: string,
    leadData: LeadData,
    errorLabel: string,
  ): Promise<LeadInternalResult | undefined> {
    if (!hasRequiredLeadFields(leadData)) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_lead', data: { status: 'needs_contact' } }),
      });
      return undefined;
    }

    const existingResult = completedLeadActions.get(sessionId);
    if (existingResult) {
      const clientResult: LeadClientActionResult = { status: 'accepted' };
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_lead', data: clientResult, duplicate: true }),
      });
      if (tracker?.isEnabled()) {
        void track(() => tracker.recordEvent({
          sessionId,
          eventType: 'lead_duplicate',
          payload: { ...existingResult },
        }));
      }
      return existingResult;
    }

    let result: LeadInternalResult;
    if (!deps.pipedrive.isConfigured()) {
      result = { outcome: 'failed', reason: 'pipedrive_not_configured' };
    } else {
      try {
        result = await deps.pipedrive.createLead(leadData);
      } catch (err) {
        console.error(errorLabel, err);
        result = {
          outcome: 'failed',
          reason: err instanceof Error ? err.message : 'unknown_pipedrive_error',
        };
      }
    }

    completedLeadActions.set(sessionId, result);

    if (tracker?.isEnabled()) {
      const eventType = result.outcome === 'created'
        ? 'lead_created'
        : result.outcome === 'reused'
          ? 'lead_reused'
          : result.outcome === 'failed'
            ? 'lead_failed'
            : 'lead_review';
      void track(() => tracker.recordEvent({
        sessionId,
        eventType,
        payload: { ...result },
      }));
      if (result.personId || result.dealId) {
        void track(() => tracker.updateSession({
          sessionId,
          leadPersonId: result.personId,
          leadDealId: result.dealId,
        }));
      }
    }

    if (deps.email.isConfigured() && deps.notificationEmailTo) {
      try {
        await deps.email.sendLeadNotification(deps.notificationEmailTo, leadData, result);
      } catch (err) {
        console.error('Lead notification error:', err);
      }
    }

    const clientResult: LeadClientActionResult = { status: 'accepted' };
    await stream.writeSSE({
      data: JSON.stringify({ type: 'action', action: 'create_lead', data: clientResult }),
    });
    return result;
  }

  async function emitSupportAction(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    sessionId: string,
    supportData: SupportData,
  ): Promise<SupportHandoffResult | undefined> {
    if (!hasRequiredServiceFields(supportData)) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_service', data: { status: 'needs_contact' } }),
      });
      return undefined;
    }

    const existingResult = completedSupportActions.get(sessionId);
    if (existingResult) {
      const existingActionResult = buildSupportClientActionResult(existingResult, supportData);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_service', data: existingActionResult, duplicate: true }),
      });
      if (tracker?.isEnabled()) {
        void track(() => tracker.recordEvent({
          sessionId,
          eventType: 'support_handoff_duplicate',
          payload: existingResult as unknown as Record<string, unknown>,
        }));
      }
      return existingResult;
    }

    const category = resolveSupportCategory(supportData);
    const normalizedSupportData = { ...supportData, category };
    const intendedInbox = getSupportInbox(category);
    const emailRecipient = deps.serviceEmailTo || 'caechma@gmail.com';

    let matchState: SupportHandoffResult['matchState'] = 'unresolved';
    let personId: number | undefined;
    let dealId: number | undefined;
    let noteStatus: SupportNoteStatus = 'skipped';
    let noteError: string | undefined;

    if (deps.pipedrive.isConfigured()) {
      try {
        const match = await deps.pipedrive.resolveSupportPerson(normalizedSupportData);
        matchState = match.matchState;
        personId = match.personId;
        dealId = match.dealId;
      } catch (err) {
        console.error('Support person resolution error:', err);
      }

      if (matchState === 'unique' && personId) {
        try {
          await deps.pipedrive.createSupportNote(personId, normalizedSupportData, dealId);
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
      dealId,
      intendedInbox,
      emailRecipient,
      noteStatus,
      noteError,
    };
    completedSupportActions.set(sessionId, result);
    const clientActionResult = buildSupportClientActionResult(result, normalizedSupportData);
    let emailStatus: 'not_configured' | 'sent' | 'failed' = deps.email.isConfigured() && emailRecipient
      ? 'sent'
      : 'not_configured';
    let emailError: string | undefined;

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
      emailStatus = 'failed';
      emailError = err instanceof Error ? err.message : String(err);
      console.error('Support email notification error:', err);
    }
    if (tracker?.isEnabled()) {
      void track(() => tracker.recordEvent({
        sessionId,
        eventType: 'support_handoff_created',
        payload: {
          ...result,
          emailStatus,
          emailError,
        },
      }));
      void track(() => tracker.updateSession({
        sessionId,
        supportPersonId: result.personId,
        supportNoteStatus: result.noteStatus,
        supportMatchState: result.matchState,
        supportIntendedInbox: result.intendedInbox,
      }));
    }

    await stream.writeSSE({
      data: JSON.stringify({ type: 'action', action: 'create_service', data: clientActionResult }),
    });
    return result;
  }

  async function persistTranscriptNote(
    sessionId: string,
    personId: number | undefined,
    dealId: number | undefined,
    content: string,
  ): Promise<void> {
    if (!personId) return;

    const completionKey = `${sessionId}:${personId}:${dealId ?? 'person'}`;
    if (completedTranscriptNotes.has(completionKey)) return;

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { noteId } = await deps.pipedrive.createChatTranscriptNote(personId, dealId, content);
        completedTranscriptNotes.add(completionKey);
        if (tracker?.isEnabled()) {
          await track(() => tracker.recordEvent({
            sessionId,
            eventType: 'crm_transcript_note_created',
            payload: { personId, ...(dealId ? { dealId } : {}), noteId },
          }));
        }
        return;
      } catch (err) {
        lastError = err;
      }
    }

    const error = lastError instanceof Error ? lastError : new Error(String(lastError));
    if (tracker?.isEnabled()) {
      await track(() => tracker.recordEvent({
        sessionId,
        eventType: 'crm_transcript_note_failed',
        payload: {
          personId,
          ...(dealId ? { dealId } : {}),
          error: error.message,
        },
      }));
    }
    throw error;
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
        const currentUserTimestamp = Date.now();
        if (tracker?.isEnabled()) {
          void track(async () => {
            await tracker.ensureSession(sessionId);
            await tracker.recordMessage({
              sessionId,
              role: 'user',
              content: message,
              turnIndex: history.length + 1,
            });
          });
        }
        const gen = deps.gemini.streamChat(sessionId, message, history);

        let lastMode = 'undetermined';
        let lastCollectedData = {};
        let leadActionAttempted = false;
        let serviceActionAttempted = false;
        let leadResult: LeadInternalResult | undefined;
        let supportResult: SupportHandoffResult | undefined;
        let assistantText = '';

        for await (const event of gen) {
          if (event.type === 'token' && event.content) {
            assistantText += event.content;
            await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: event.content }) });
          }

          if (event.type === 'state' && event.state) {
            lastMode = event.state.mode;
            lastCollectedData = event.state.collectedData;
            if (tracker?.isEnabled()) {
              void track(() => tracker.recordEvent({
                sessionId,
                eventType: 'state_reported',
                payload: { mode: lastMode, collectedData: lastCollectedData },
              }));
              void track(() => tracker.updateSession({
                sessionId,
                finalMode: lastMode,
                finalCollectedData: lastCollectedData as Record<string, unknown>,
              }));
            }
          }

          if (event.type === 'lead' && event.leadData) {
            leadActionAttempted = true;
            leadResult = await emitLeadAction(stream, sessionId, event.leadData, 'Lead creation error:');
          }

          if (event.type === 'service' && event.serviceData) {
            serviceActionAttempted = true;
            supportResult = await emitSupportAction(stream, sessionId, event.serviceData);
          }
        }

        // If Gemini used report_state with complete data (instead of submit_lead/submit_service_request),
        // trigger Pipedrive/email based on mode + collected data completeness
        const collectedObj = lastCollectedData as Record<string, unknown>;
        if (!leadActionAttempted && lastMode === 'anfrage' && hasRequiredLeadFields(collectedObj)) {
          leadResult = await emitLeadAction(stream, sessionId, collectedObj as LeadData, 'Lead creation from state error:');
        }
        if (!serviceActionAttempted && lastMode === 'service' && hasRequiredServiceFields(collectedObj)) {
          supportResult = await emitSupportAction(stream, sessionId, collectedObj as SupportData);
        }

        const transcript = buildPipedriveTranscriptNote({
          sessionId,
          history,
          currentMessage: message,
          assistantText,
          currentUserTimestamp,
          assistantTimestamp: Date.now(),
        });
        await persistTranscriptNote(sessionId, leadResult?.personId, leadResult?.dealId, transcript);
        await persistTranscriptNote(sessionId, supportResult?.personId, supportResult?.dealId, transcript);

        if (tracker?.isEnabled() && assistantText.trim().length > 0) {
          void track(() => tracker.recordMessage({
            sessionId,
            role: 'assistant',
            content: assistantText,
            turnIndex: history.length + 2,
          }));
        }
        if (tracker?.isEnabled()) {
          void track(() => tracker.recordEvent({
            sessionId,
            eventType: 'chat_done',
            payload: { mode: lastMode, collectedData: lastCollectedData },
          }));
          void track(() => tracker.updateSession({
            sessionId,
            finalMode: lastMode,
            finalCollectedData: lastCollectedData as Record<string, unknown>,
          }));
        }
        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }),
        });
      } catch (err) {
        console.error('Chat stream error:', err);
        if (tracker?.isEnabled()) {
          void track(() => tracker.recordEvent({
            sessionId,
            eventType: 'chat_error',
            payload: { message: err instanceof Error ? err.message : String(err) },
          }));
        }
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: 'Ein Fehler ist aufgetreten. Bitte versuch es erneut.' }),
        });
      }
    });
  });

  app.post('/api/chat/abandoned', async (c) => {
    const body = await c.req.json();
    const parsed = abandonedChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, reason, history } = parsed.data;
    const emailRecipient = deps.serviceEmailTo || 'caechma@gmail.com';

    if (completedAbandonedSummaries.has(sessionId)) {
      return c.json({ status: 'duplicate' });
    }

    if (!deps.email.isConfigured() || !emailRecipient) {
      if (tracker?.isEnabled()) {
        void track(() => tracker.recordEvent({
          sessionId,
          eventType: 'abandoned_summary_failed',
          payload: { emailStatus: 'not_configured', emailRecipient },
        }));
      }
      return c.json({ status: 'not_configured' }, 503);
    }

    const summary = {
      sessionId,
      reason,
      transcript: formatTranscript(history),
      lastUserMessage: getLastUserMessage(history),
      messageCount: history.length,
      submittedAt: new Date().toISOString(),
    };

    try {
      await deps.email.sendAbandonedChatSummary(emailRecipient, summary);
      completedAbandonedSummaries.add(sessionId);
      if (tracker?.isEnabled()) {
        void track(() => tracker.recordEvent({
          sessionId,
          eventType: 'abandoned_summary_sent',
          payload: {
            emailRecipient,
            reason,
            messageCount: history.length,
          },
        }));
      }
      return c.json({ status: 'sent' });
    } catch (err) {
      const emailError = err instanceof Error ? err.message : String(err);
      console.error('Abandoned chat summary email error:', err);
      if (tracker?.isEnabled()) {
        void track(() => tracker.recordEvent({
          sessionId,
          eventType: 'abandoned_summary_failed',
          payload: { emailRecipient, reason, emailError },
        }));
      }
      return c.json({ status: 'failed' }, 502);
    }
  });

  return app;
}
