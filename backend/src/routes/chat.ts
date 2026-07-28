import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { GeminiService } from '../services/gemini.js';
import type { PipedriveService } from '../services/pipedrive.js';
import { EmailDeliveryError, type CompletedChatSummary, type EmailService } from '../services/email.js';
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
import { hasPriorContactStatus } from '../contact/prior-contact.js';
import { buildPipedriveTranscriptNote } from '../chat/transcript.js';
import { formatBerlinDateTime } from '../time/berlin.js';
import { detectEmergency } from '../request/request-policy.js';
import type { RequestOrchestrator } from '../request/request-orchestrator.js';
import {
  parseEmailRecipients,
  resolveInternalEmailRecipients,
} from '../email/recipients.js';
import {
  buildAuthoritativeStateContext,
  buildVerificationMessage,
  isExplicitVerificationConfirmation,
  isLeadReady,
  isNoFurtherConcern,
  isRequestReady,
  isServiceReady,
  mergeCollectedData,
  type IntakeState,
} from '../request/intake-verification.js';

const OPPORTUNITY_EMAIL_TO = 'sales@lippelift.de';
const REQUEST_COMPLETION_MESSAGE = 'Danke. Dein Anliegen wurde an das zuständige Team weitergegeben. Hast du noch ein weiteres Anliegen?';

function routedEmailRecipients(primaryRecipient: string, configuredInternalRecipients: string): string {
  return parseEmailRecipients(
    primaryRecipient,
    resolveInternalEmailRecipients(configuredInternalRecipients),
  ).join(',');
}

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
    data.priorContactReference,
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
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
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
  bypass?: Readonly<{
    enabled: boolean;
    recipients: readonly string[];
  }>;
  requestOrchestrator?: RequestOrchestrator;
}

type LeadInternalResult = LeadCrmResult | {
  outcome: 'failed';
  reason: string;
  personId?: never;
  dealId?: never;
};
type LeadClientActionResult = { status: 'accepted' | 'needs_contact' | 'needs_prior_contact' };
type SupportClientActionResult = { status: 'accepted' | 'needs_contact' | 'needs_prior_contact' };

type TranscriptMessage = z.infer<typeof abandonedChatRequestSchema>['history'][number];

function isAiQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  return candidate.status === 429
    || candidate.code === 429
    || (typeof candidate.message === 'string'
      && (candidate.message.includes('RESOURCE_EXHAUSTED') || candidate.message.includes('Quota exceeded')));
}

function formatTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((msg) => {
      const speaker = msg.role === 'user' ? 'Nutzer' : 'Sarah';
      const timestamp = Number.isFinite(msg.timestamp)
        ? formatBerlinDateTime(new Date(msg.timestamp))
        : 'Zeit unbekannt';
      return `[${timestamp}] ${speaker}: ${msg.content}`;
    })
    .join('\n\n');
}

function buildCompletedTranscript(input: {
  history: ChatMessage[];
  currentMessage: string;
  assistantText: string;
  currentUserTimestamp: number;
  assistantTimestamp: number;
}): string {
  const messages: ChatMessage[] = [
    ...input.history,
    { role: 'user', content: input.currentMessage, timestamp: input.currentUserTimestamp },
  ];
  if (input.assistantText.trim()) {
    messages.push({ role: 'assistant', content: input.assistantText, timestamp: input.assistantTimestamp });
  }
  return formatTranscript(messages);
}

function buildLeadSummary(data: LeadData, result: LeadInternalResult): string {
  const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
  const location = [data.postalCode, data.city].filter(Boolean).join(' ');
  const details = [
    name && `Anfrage von ${name}`,
    data.message && `Anliegen: ${data.message}`,
    location && `Ort: ${location}`,
    data.availability && `Erreichbarkeit: ${data.availability}`,
    `CRM-Ergebnis: ${result.outcome}`,
  ].filter(Boolean);
  return `${details.join('. ')}.`;
}

function buildSupportSummary(data: SupportData, result: SupportHandoffResult): string {
  const details = [
    data.customerName && `Servicefall von ${data.customerName}`,
    data.category && `Kategorie: ${data.category}`,
    data.issueDescription && `Problem: ${data.issueDescription}`,
    `CRM-Zuordnung: ${result.matchState}`,
  ].filter(Boolean);
  return `${details.join('. ')}.`;
}

function summaryLine(label: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return `${label}: ${value.trim()}`;
}

function buildLeadPipedriveSummary(data: LeadData, result: LeadInternalResult): string {
  const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
  const address = [data.street, data.postalCode, data.city].filter(Boolean).join(', ');
  return [
    summaryLine('Anfrage von', name),
    summaryLine('E-Mail', data.email),
    summaryLine('Telefon', data.phone),
    summaryLine('Adresse', address),
    summaryLine('Erreichbarkeit', data.availability),
    summaryLine('Vorheriger Kontakt', data.priorContact),
    summaryLine('Referenz', data.priorContactReference),
    summaryLine('Anliegen', data.message),
    `CRM-Ergebnis: ${result.outcome}`,
  ].filter(Boolean).join('\n');
}

function buildSupportPipedriveSummary(data: SupportData, result: SupportHandoffResult): string {
  return [
    summaryLine('Kunde', data.customerName),
    summaryLine('Kategorie', data.category),
    summaryLine('Problem', data.issueDescription),
    summaryLine('E-Mail', data.email),
    summaryLine('Telefon', data.phone),
    summaryLine('Vorheriger Kontakt', data.priorContact),
    summaryLine('Referenz', data.priorContactReference),
    summaryLine('Lift-Modell', data.liftModel),
    summaryLine('Symptomdetails', data.symptomDetails),
    summaryLine('Auslöser/Bedingungen', data.triggerConditions),
    summaryLine('Rechnungsnummer', data.invoiceNumber),
    summaryLine('Kundennummer', data.customerNumber),
    summaryLine('Zahlungsreferenz', data.paymentReference),
    summaryLine('Auftragsnummer', data.orderNumber),
    summaryLine('Angebotsnummer', data.offerNumber),
    summaryLine('Lead-ID', data.leadId),
    summaryLine('Vertragsreferenz', data.contractReference),
    summaryLine('Ersatzteilreferenz', data.sparePartReference),
    summaryLine('Installationskontext', data.installationContext),
    summaryLine('Mangelkontext', data.defectContext),
    `CRM-Zuordnung: ${result.matchState}`,
  ].filter(Boolean).join('\n');
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
  const completedTranscriptNotes = new Map<string, number>();
  const inFlightTranscriptNotes = new Map<string, Promise<number>>();
  const completedSummaryEmails = new Set<string>();
  const inFlightSummaryEmails = new Map<string, Promise<void>>();
  const pendingSummaryEmailRecipients = new Map<string, string[]>();
  const completedAbandonedSummaries = new Set<string>();
  const inFlightAbandonedSummaries = new Map<string, Promise<void>>();
  const pendingAbandonedSummaryRecipients = new Map<string, string[]>();
  const factoryHelpShownRequests = new Set<string>();
  const intakeStates = new Map<string, IntakeState>();

  async function runRequestScopedFlow(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    input: {
      sessionId: string;
      requestId: string;
      message: string;
      history: ChatMessage[];
    },
  ): Promise<void> {
    const { sessionId, requestId, message, history } = input;
    const emergency = detectEmergency(message);
    if (emergency.emergency) {
      const content = 'Bei Verletzung oder unmittelbarer Gefahr rufen Sie bitte sofort 112. Fuer dringenden LIPPE Lift Service erreichen Sie uns unter +49 (0)5261 9666-0.';
      await stream.writeSSE({ data: JSON.stringify({ type: 'token', content }) });
      await stream.writeSSE({ data: JSON.stringify({ type: 'done', mode: 'service', collectedData: {} }) });
      return;
    }

    let intakeState = intakeStates.get(requestId) ?? {
      mode: 'undetermined' as const,
      collectedData: {},
      awaitingVerification: false,
      completed: false,
    };

    if (intakeState.completed) {
      if (isNoFurtherConcern(message)) {
        const content = 'Alles klar, danke für deine Nachricht. Ich wünsche dir einen schönen Tag!';
        await stream.writeSSE({ data: JSON.stringify({ type: 'token', content }) });
        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', mode: intakeState.mode, collectedData: intakeState.collectedData }),
        });
        return;
      }
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'action',
          action: 'start_new_request',
          data: { completedRequestId: requestId },
        }),
      });
      const content = 'Gerne. Beschreibe mir bitte kurz dein weiteres Anliegen.';
      await stream.writeSSE({ data: JSON.stringify({ type: 'token', content }) });
      await stream.writeSSE({ data: JSON.stringify({ type: 'done', mode: 'undetermined', collectedData: {} }) });
      return;
    }

    if (intakeState.awaitingVerification
      && !isExplicitVerificationConfirmation(message)
      && isNoFurtherConcern(message)) {
      intakeState = { ...intakeState, awaitingVerification: false };
      intakeStates.set(requestId, intakeState);
      const content = 'Alles klar. Welche Angabe soll ich korrigieren?';
      await stream.writeSSE({ data: JSON.stringify({ type: 'token', content }) });
      await stream.writeSSE({
        data: JSON.stringify({ type: 'done', mode: intakeState.mode, collectedData: intakeState.collectedData }),
      });
      return;
    }

    const currentUserTimestamp = Date.now();
    let lastMode: 'berater' | 'anfrage' | 'service' | 'undetermined' = intakeState.mode;
    let lastCollectedData: Record<string, unknown> = intakeState.collectedData;
    let leadData: LeadData | undefined;
    let supportData: SupportData | undefined;
    let assistantText = '';
    const verificationConfirmed = intakeState.awaitingVerification
      && isExplicitVerificationConfirmation(message)
      && isRequestReady(intakeState.mode, intakeState.collectedData);

    if (!verificationConfirmed) {
      const gen = deps.gemini.streamChat(
        sessionId,
        message,
        history,
        buildAuthoritativeStateContext(intakeState),
      );

      for await (const event of gen) {
        if (event.type === 'token' && event.content) {
          assistantText += event.content;
        }
        if (event.type === 'state' && event.state) {
          if (event.state.mode !== 'undetermined') lastMode = event.state.mode;
          lastCollectedData = mergeCollectedData(
            lastCollectedData,
            event.state.collectedData as Record<string, unknown>,
          ) as Record<string, unknown>;
          if (!factoryHelpShownRequests.has(requestId)
            && lastCollectedData.ownsLift === 'yes'
            && lastCollectedData.liftManufacturer === 'lippe'
            && (!lastCollectedData.factoryNumberStatus || lastCollectedData.factoryNumberStatus === 'unknown')) {
            factoryHelpShownRequests.add(requestId);
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'action',
                action: 'show_factory_number_help',
                data: { requestId },
              }),
            });
          }
        }
        if (event.type === 'lead' && event.leadData) {
          lastMode = 'anfrage';
          lastCollectedData = mergeCollectedData(
            lastCollectedData,
            event.leadData as unknown as Record<string, unknown>,
          ) as Record<string, unknown>;
        }
        if (event.type === 'service' && event.serviceData && hasPriorContactStatus(event.serviceData)) {
          lastMode = 'service';
          lastCollectedData = mergeCollectedData(lastCollectedData, {
            ...event.serviceData,
            category: resolveSupportCategory(event.serviceData),
          }) as Record<string, unknown>;
        }
      }
    }

    intakeState = {
      mode: lastMode,
      collectedData: mergeCollectedData(intakeState.collectedData, lastCollectedData),
      awaitingVerification: intakeState.awaitingVerification,
      completed: false,
    };

    const ready = isRequestReady(intakeState.mode, intakeState.collectedData);
    if (ready && !verificationConfirmed) {
      intakeState.awaitingVerification = true;
      intakeStates.set(requestId, intakeState);
      const verificationMessage = buildVerificationMessage(intakeState.mode, intakeState.collectedData);
      await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: verificationMessage }) });
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          mode: intakeState.mode,
          collectedData: intakeState.collectedData,
        }),
      });
      return;
    }

    if (!ready) {
      intakeState.awaitingVerification = false;
      intakeStates.set(requestId, intakeState);
      if (assistantText) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: assistantText }) });
      }
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          mode: intakeState.mode,
          collectedData: intakeState.collectedData,
        }),
      });
      return;
    }

    if (isLeadReady(intakeState.collectedData)) {
      lastMode = 'anfrage';
      lastCollectedData = intakeState.collectedData as Record<string, unknown>;
      leadData = lastCollectedData as LeadData;
    } else if (isServiceReady(intakeState.collectedData)) {
      lastMode = 'service';
      lastCollectedData = intakeState.collectedData as Record<string, unknown>;
      supportData = {
        ...(lastCollectedData as SupportData),
        category: resolveSupportCategory(lastCollectedData as SupportData),
      };
    }

    if (!leadData && !supportData) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }) });
      return;
    }

    const assistantTimestamp = Date.now();
    const transcript = buildCompletedTranscript({
      history,
      currentMessage: message,
      assistantText: REQUEST_COMPLETION_MESSAGE,
      currentUserTimestamp,
      assistantTimestamp,
    });
    const result = await deps.requestOrchestrator!.execute({
      sessionId,
      requestId,
      mode: leadData ? 'anfrage' : 'service',
      transcript,
      ...(leadData ? { leadData } : { supportData }),
    });
    await stream.writeSSE({
      data: JSON.stringify({ type: 'action', action: 'request_completed', data: { requestId, kind: result.kind } }),
    });
    intakeStates.set(requestId, { ...intakeState, awaitingVerification: false, completed: true });
    await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: REQUEST_COMPLETION_MESSAGE }) });
    await stream.writeSSE({ data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }) });
  }

  async function emitLeadAction(
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    sessionId: string,
    leadData: LeadData,
    errorLabel: string,
  ): Promise<LeadInternalResult | undefined> {
    if (!hasPriorContactStatus(leadData)) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_lead', data: { status: 'needs_prior_contact' } }),
      });
      return undefined;
    }
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
    if (!hasPriorContactStatus(supportData)) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_service', data: { status: 'needs_prior_contact' } }),
      });
      return undefined;
    }
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
    const emailRecipient = routedEmailRecipients(intendedInbox, deps.serviceEmailTo);

    let matchState: SupportHandoffResult['matchState'] = 'unresolved';
    let personId: number | undefined;
    let dealId: number | undefined;
    let createdPerson: boolean | undefined;
    let noteStatus: SupportNoteStatus = 'skipped';
    let noteError: string | undefined;
    let crmError: Error | undefined;

    if (deps.pipedrive.isConfigured()) {
      try {
        const match = await deps.pipedrive.resolveSupportPerson(normalizedSupportData);
        matchState = match.matchState;
        personId = match.personId;
        dealId = match.dealId;
        if (personId && dealId) createdPerson = false;

        if (!dealId) {
          const supportCase = await deps.pipedrive.createSupportCase(normalizedSupportData, match);
          personId = supportCase.personId;
          dealId = supportCase.dealId;
          createdPerson = supportCase.createdPerson;
        }
      } catch (err) {
        crmError = err instanceof Error ? err : new Error(String(err));
        noteStatus = 'failed';
        noteError = crmError.message;
        console.error('Support case persistence error:', err);
      }

    } else {
      crmError = new Error('Pipedrive not configured');
      noteStatus = 'failed';
      noteError = crmError.message;
    }

    const result: SupportHandoffResult = {
      matchState,
      personId,
      dealId,
      createdPerson,
      intendedInbox,
      emailRecipient,
      noteStatus,
      noteError,
    };
    const clientActionResult = buildSupportClientActionResult(result, normalizedSupportData);
    if (tracker?.isEnabled()) {
      void track(() => tracker.updateSession({
        sessionId,
        supportPersonId: result.personId,
        supportNoteStatus: result.noteStatus,
        supportMatchState: result.matchState,
        supportIntendedInbox: result.intendedInbox,
      }));
    }

    completedSupportActions.set(sessionId, result);

    if (!crmError && personId && dealId) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'action', action: 'create_service', data: clientActionResult }),
      });
    }
    return result;
  }

  async function persistTranscriptNote(
    sessionId: string,
    personId: number | undefined,
    dealId: number | undefined,
    content: string,
  ): Promise<number | undefined> {
    if (!personId) return undefined;

    const completionKey = `${sessionId}:${personId}:${dealId ?? 'person'}`;
    const completedNoteId = completedTranscriptNotes.get(completionKey);
    if (completedNoteId) return completedNoteId;
    const existingWrite = inFlightTranscriptNotes.get(completionKey);
    if (existingWrite) {
      await existingWrite;
      return existingWrite;
    }

    const write = (async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const { noteId } = await deps.pipedrive.createChatTranscriptNote(sessionId, personId, dealId, content);
          completedTranscriptNotes.set(completionKey, noteId);
          if (tracker?.isEnabled()) {
            await track(() => tracker.recordEvent({
              sessionId,
              eventType: 'crm_transcript_note_created',
              payload: { personId, ...(dealId ? { dealId } : {}), noteId },
            }));
          }
          return noteId;
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
    })();

    inFlightTranscriptNotes.set(completionKey, write);
    try {
      return await write;
    } finally {
      if (inFlightTranscriptNotes.get(completionKey) === write) {
        inFlightTranscriptNotes.delete(completionKey);
      }
    }
  }

  async function persistCompletedSummaryEmail(
    sessionId: string,
    recipient: string,
    input: CompletedChatSummary,
  ): Promise<void> {
    if (completedSummaryEmails.has(sessionId)) return;
    const existingWrite = inFlightSummaryEmails.get(sessionId);
    if (existingWrite) {
      await existingWrite;
      return;
    }

    const write = (async () => {
      if (!deps.email.isConfigured()) {
        const error = new Error('Email not configured');
        if (tracker?.isEnabled()) {
          await track(() => tracker.recordEvent({
            sessionId,
            eventType: 'completed_summary_email_failed',
            payload: { recipient, mode: input.mode, kind: input.kind, error: error.message },
          }));
        }
        throw error;
      }

      let lastError: unknown;
      let pendingRecipients = pendingSummaryEmailRecipients.get(sessionId) ?? parseEmailRecipients(recipient);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await deps.email.sendCompletedChatSummary(pendingRecipients.join(','), input);
          completedSummaryEmails.add(sessionId);
          pendingSummaryEmailRecipients.delete(sessionId);
          if (tracker?.isEnabled()) {
            await track(() => tracker.recordEvent({
              sessionId,
              eventType: 'completed_summary_email_sent',
              payload: { recipient, mode: input.mode, kind: input.kind, attempt },
            }));
          }
          return;
        } catch (err) {
          lastError = err;
          if (err instanceof EmailDeliveryError && err.failedRecipients.length > 0) {
            pendingRecipients = err.failedRecipients;
            pendingSummaryEmailRecipients.set(sessionId, pendingRecipients);
          }
        }
      }

      const error = lastError instanceof Error ? lastError : new Error(String(lastError));
      if (tracker?.isEnabled()) {
        await track(() => tracker.recordEvent({
          sessionId,
          eventType: 'completed_summary_email_failed',
          payload: { recipient, mode: input.mode, kind: input.kind, error: error.message },
        }));
      }
      throw error;
    })();

    inFlightSummaryEmails.set(sessionId, write);
    try {
      await write;
    } finally {
      if (inFlightSummaryEmails.get(sessionId) === write) {
        inFlightSummaryEmails.delete(sessionId);
      }
    }
  }

  app.post('/api/chat', async (c) => {
    const body = await c.req.json();
    const parsed = chatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, requestId, message, history } = parsed.data;

    return streamSSE(c, async (stream) => {
      try {
        if (requestId && deps.requestOrchestrator) {
          await runRequestScopedFlow(stream, { sessionId, requestId, message, history });
          return;
        }
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
        let leadDataForEmail: LeadData | undefined;
        let supportDataForEmail: SupportData | undefined;
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
            leadDataForEmail = event.leadData;
            leadResult = await emitLeadAction(stream, sessionId, event.leadData, 'Lead creation error:');
          }

          if (event.type === 'service' && event.serviceData) {
            serviceActionAttempted = true;
            supportDataForEmail = {
              ...event.serviceData,
              category: resolveSupportCategory(event.serviceData),
            };
            supportResult = await emitSupportAction(stream, sessionId, event.serviceData);
          }
        }

        // If Gemini used report_state with complete data (instead of submit_lead/submit_service_request),
        // trigger Pipedrive/email based on mode + collected data completeness
        const collectedObj = lastCollectedData as Record<string, unknown>;
        if (!leadActionAttempted && lastMode === 'anfrage' && hasRequiredLeadFields(collectedObj)) {
          leadDataForEmail = collectedObj as LeadData;
          leadResult = await emitLeadAction(stream, sessionId, collectedObj as LeadData, 'Lead creation from state error:');
        }
        if (!serviceActionAttempted && lastMode === 'service' && hasRequiredServiceFields(collectedObj)) {
          supportDataForEmail = {
            ...(collectedObj as SupportData),
            category: resolveSupportCategory(collectedObj as SupportData),
          };
          supportResult = await emitSupportAction(stream, sessionId, collectedObj as SupportData);
        }

        const assistantTimestamp = Date.now();
        if (leadResult && leadDataForEmail && leadResult.personId) {
          const note = buildPipedriveTranscriptNote({
            sessionId,
            summary: buildLeadPipedriveSummary(leadDataForEmail, leadResult),
            history,
            currentMessage: message,
            assistantText,
            currentUserTimestamp,
            assistantTimestamp,
          });
          await persistTranscriptNote(sessionId, leadResult.personId, leadResult.dealId, note);
        } else if (supportResult && supportDataForEmail && supportResult.personId) {
          const note = buildPipedriveTranscriptNote({
            sessionId,
            summary: buildSupportPipedriveSummary(supportDataForEmail, supportResult),
            history,
            currentMessage: message,
            assistantText,
            currentUserTimestamp,
            assistantTimestamp,
          });
          const noteId = await persistTranscriptNote(
            sessionId,
            supportResult.personId,
            supportResult.dealId,
            note,
          );
          if (noteId) {
            supportResult.noteStatus = 'created';
            supportResult.noteError = undefined;
            if (tracker?.isEnabled()) {
              await track(() => tracker.recordEvent({
                sessionId,
                eventType: 'support_handoff_created',
                payload: { ...supportResult },
              }));
              await track(() => tracker.updateSession({
                sessionId,
                supportPersonId: supportResult.personId,
                supportNoteStatus: supportResult.noteStatus,
                supportMatchState: supportResult.matchState,
                supportIntendedInbox: supportResult.intendedInbox,
              }));
            }
          }
        }

        const completedTranscript = buildCompletedTranscript({
          history,
          currentMessage: message,
          assistantText,
          currentUserTimestamp,
          assistantTimestamp,
        });
        if (leadResult && leadDataForEmail) {
          await persistCompletedSummaryEmail(
            sessionId,
            routedEmailRecipients(OPPORTUNITY_EMAIL_TO, deps.notificationEmailTo),
            {
              sessionId,
              mode: lastMode,
              kind: 'opportunity',
              summary: buildLeadSummary(leadDataForEmail, leadResult),
              transcript: completedTranscript,
              completedAt: formatBerlinDateTime(new Date(assistantTimestamp)),
              leadData: leadDataForEmail,
              leadContext: leadResult,
            },
          );
        } else if (supportResult && supportDataForEmail) {
          await persistCompletedSummaryEmail(
            sessionId,
            supportResult.emailRecipient,
            {
              sessionId,
              mode: lastMode,
              kind: 'case',
              summary: buildSupportSummary(supportDataForEmail, supportResult),
              transcript: completedTranscript,
              completedAt: formatBerlinDateTime(new Date(assistantTimestamp)),
              supportData: supportDataForEmail,
              supportContext: {
                matchState: supportResult.matchState,
                noteStatus: supportResult.noteStatus,
                noteError: supportResult.noteError,
                intendedInbox: supportResult.intendedInbox,
                dealId: supportResult.dealId,
                createdPerson: supportResult.createdPerson,
              },
            },
          );
          if (!supportResult.personId || !supportResult.dealId) {
            throw new Error(supportResult.noteError || 'Support handoff has no concrete Pipedrive case');
          }
        }

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
        const customerError = isAiQuotaError(err)
          ? 'Das tägliche KI-Testlimit ist gerade erreicht. Bitte versuch es später erneut.'
          : 'Ein Fehler ist aufgetreten. Bitte versuch es erneut.';
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: customerError }),
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
    const emailRecipient = deps.bypass?.enabled
      ? parseEmailRecipients(...deps.bypass.recipients).join(',')
      : resolveInternalEmailRecipients(deps.serviceEmailTo);

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

    const existingWrite = inFlightAbandonedSummaries.get(sessionId);
    if (existingWrite) {
      try {
        await existingWrite;
        return c.json({ status: 'duplicate' });
      } catch {
        return c.json({ status: 'failed' }, 502);
      }
    }

    const write = (async () => {
      const pendingRecipients = pendingAbandonedSummaryRecipients.get(sessionId) ?? parseEmailRecipients(emailRecipient);
      await deps.email.sendAbandonedChatSummary(pendingRecipients.join(','), summary);
      completedAbandonedSummaries.add(sessionId);
      pendingAbandonedSummaryRecipients.delete(sessionId);
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
    })();
    inFlightAbandonedSummaries.set(sessionId, write);

    try {
      await write;
      return c.json({ status: 'sent' });
    } catch (err) {
      if (err instanceof EmailDeliveryError && err.failedRecipients.length > 0) {
        pendingAbandonedSummaryRecipients.set(sessionId, err.failedRecipients);
      }
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
    } finally {
      if (inFlightAbandonedSummaries.get(sessionId) === write) {
        inFlightAbandonedSummaries.delete(sessionId);
      }
    }
  });

  return app;
}
