import nodemailer from 'nodemailer';
import { buildPipedriveDealUrl } from '../crm/pipedrive-links.js';
import { buildSupportEmailHtml, buildSupportEmailSubject } from '../support/support-routing.js';
import type {
  LeadData,
  LeadCrmOutcome,
  ServiceData,
  SupportData,
  SupportMatchState,
  SupportNoteStatus,
} from '../types/index.js';

export interface LeadNotificationContext {
  outcome: LeadCrmOutcome | 'failed';
  personId?: number;
  dealId?: number;
  createdPerson?: boolean;
  reason?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  pipedriveWebBaseUrl?: string;
}

interface MailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
}

type SendFn = (options: MailOptions) => Promise<unknown>;

export interface AbandonedChatSummary {
  sessionId: string;
  reason: string;
  transcript: string;
  lastUserMessage?: string;
  messageCount: number;
  submittedAt: string;
}

export type CompletedChatKind = 'general' | 'opportunity' | 'case';

export interface CompletedChatSummary {
  sessionId: string;
  mode: string;
  kind: CompletedChatKind;
  summary: string;
  transcript: string;
  completedAt: string;
  leadData?: LeadData;
  leadContext?: LeadNotificationContext;
  supportData?: SupportData;
  supportContext?: {
    matchState: SupportMatchState;
    noteStatus: SupportNoteStatus;
    noteError?: string;
    intendedInbox: string;
    dealId?: number;
    createdPerson?: boolean;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label: string, value: unknown): string {
  if (value === undefined || value === null || String(value).trim().length === 0) return '';
  return `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">${escapeHtml(label)}:</td><td>${escapeHtml(String(value).trim())}</td></tr>`;
}

export function createEmailService(smtp: SmtpConfig, sendOverride?: SendFn) {
  const configured = smtp.host.length > 0;
  const pipedriveWebBaseUrl = smtp.pipedriveWebBaseUrl ?? 'https://lippelift.pipedrive.com';

  let sendFn: SendFn;
  if (sendOverride) {
    sendFn = sendOverride;
  } else if (configured) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    sendFn = (options) => transporter.sendMail(options);
  } else {
    sendFn = async () => {};
  }

  const from = smtp.user || 'sarah@lippelift.de';

  async function sendLeadNotification(
    to: string,
    data: LeadData,
    crmContext?: LeadNotificationContext,
  ): Promise<void> {
    if (!configured && !sendOverride) return;

    const crmLabel = crmContext
      ? {
        created: 'Neuer CRM-Fall erstellt',
        reused: 'Bestehender CRM-Fall wiederverwendet',
        person_review: 'Manuelle Fallauswahl erforderlich',
        identity_review: 'Manuelle Identitätsprüfung erforderlich',
        failed: 'CRM-Übertragung fehlgeschlagen',
      }[crmContext.outcome]
      : undefined;
    const dealUrl = buildPipedriveDealUrl(pipedriveWebBaseUrl, crmContext?.dealId);
    const crmAction = crmContext
      ? dealUrl
        ? `<p><a href="${escapeHtml(dealUrl)}" style="display:inline-block;padding:10px 16px;background:#0b63ce;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fall in Pipedrive öffnen</a></p>`
        : '<p><strong>Manuelle Prüfung erforderlich</strong></p>'
      : '';

    const html = `
      <h2>Neue Anfrage über Sarah (Chatbot)</h2>
      ${crmAction}
      <table style="border-collapse:collapse;">
        ${crmLabel ? row('CRM-Zuordnung', crmLabel) : ''}
        ${crmContext?.personId ? row('Person-ID', crmContext.personId) : ''}
        ${crmContext?.dealId ? row('Fall-ID', crmContext.dealId) : ''}
        ${crmContext?.reason ? row('CRM-Hinweis', crmContext.reason) : ''}
        ${row('Name', `${data.firstName} ${data.lastName}`)}
        ${row('Telefon', data.phone)}
        ${row('E-Mail', data.email)}
        ${row('Vorheriger Kontakt', data.priorContact)}
        ${row('Referenz', data.priorContactReference)}
        ${row('Straße', data.street)}
        ${row('PLZ / Stadt', [data.postalCode, data.city].filter(Boolean).join(' '))}
        ${row('Erreichbarkeit', data.availability)}
        ${row('Treppe', `${data.stairLocation || 'k.A.'} / ${data.stairType || 'k.A.'}`)}
        ${row('Gebäude', data.buildingType || 'k.A.')}
        ${row('Lifttyp', data.liftType === 'sitzlift' ? 'Sitzlift' : data.liftType === 'rollstuhlgeeignet' ? 'Rollstuhlgeeignet' : 'k.A.')}
        ${row('Nachricht', data.message)}
        ${row('Newsletter', data.newsletter || 'k.A.')}
      </table>
    `;

    await sendFn({ from, to, subject: `Sarah Lead: ${data.firstName} ${data.lastName}`, html });
  }

  async function sendServiceNotification(to: string, data: ServiceData): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Service-Anfrage über Sarah (Chatbot)</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kunde:</td><td>${data.customerName}</td></tr>
        ${data.phone ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>` : ''}
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.liftModel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lift-Modell:</td><td>${data.liftModel}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Problem:</td><td>${data.issueDescription}</td></tr>
      </table>
    `;

    await sendFn({ from, to, subject: `Service-Anfrage: ${data.customerName}`, html });
  }

  async function sendSupportNotification(to: string, input: {
    data: SupportData;
    intendedInbox: string;
    matchState: SupportMatchState;
    noteStatus: SupportNoteStatus;
    noteError?: string;
    dealId?: number;
  }): Promise<void> {
    if (!configured && !sendOverride) return;

    await sendFn({
      from,
      to,
      subject: buildSupportEmailSubject(input.data),
      html: buildSupportEmailHtml({
        ...input,
        dealUrl: buildPipedriveDealUrl(pipedriveWebBaseUrl, input.dealId),
      }),
    });
  }

  async function sendAbandonedChatSummary(to: string, input: AbandonedChatSummary): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Unbeantworteter Sarah-Chat</h2>
      <p><strong>Kurzfassung:</strong> ${input.lastUserMessage ? escapeHtml(input.lastUserMessage) : 'Keine eindeutige letzte Nutzernachricht vorhanden.'}</p>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Session:</td><td>${escapeHtml(input.sessionId)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Grund:</td><td>${escapeHtml(input.reason)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nachrichten:</td><td>${input.messageCount}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Eingereicht:</td><td>${escapeHtml(input.submittedAt)}</td></tr>
      </table>
      <h3>Transkript</h3>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;border:1px solid #ddd;padding:12px;border-radius:8px;">${escapeHtml(input.transcript)}</pre>
    `;

    await sendFn({
      from,
      to,
      subject: `Sarah Chat-Zusammenfassung: ${input.sessionId}`,
      html,
    });
  }

  async function sendCompletedChatSummary(to: string, input: CompletedChatSummary): Promise<void> {
    if (!configured && !sendOverride) return;

    const kindLabel = {
      general: 'Chat',
      opportunity: 'Opportunity',
      case: 'Case',
    }[input.kind];
    const dealId = input.leadContext?.dealId ?? input.supportContext?.dealId;
    const dealUrl = buildPipedriveDealUrl(pipedriveWebBaseUrl, dealId);
    const crmAction = input.kind === 'general'
      ? ''
      : dealUrl
        ? `<p><a href="${escapeHtml(dealUrl)}" style="display:inline-block;padding:10px 16px;background:#0b63ce;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fall in Pipedrive öffnen</a></p>`
        : '<p><strong>Manuelle Prüfung erforderlich</strong></p>';
    const createdPerson = input.leadContext?.createdPerson ?? input.supportContext?.createdPerson;
    const contactStatus = createdPerson === true
      ? 'Neu'
      : createdPerson === false
        ? 'Bestehend'
        : undefined;
    const contactName = createdPerson === false
      ? input.leadData
        ? [input.leadData.firstName, input.leadData.lastName].filter(Boolean).join(' ')
        : input.supportData?.customerName
      : undefined;

    const leadRows = input.leadData
      ? `
        ${row('Name', [input.leadData.firstName, input.leadData.lastName].filter(Boolean).join(' '))}
        ${row('Telefon', input.leadData.phone)}
        ${row('E-Mail', input.leadData.email)}
        ${row('Vorheriger Kontakt', input.leadData.priorContact)}
        ${row('Referenz', input.leadData.priorContactReference)}
        ${row('Adresse', [input.leadData.street, input.leadData.postalCode, input.leadData.city].filter(Boolean).join(', '))}
        ${row('Erreichbarkeit', input.leadData.availability)}
        ${row('Lifttyp', input.leadData.liftType)}
        ${row('Anliegen', input.leadData.message)}
        ${row('CRM-Ergebnis', input.leadContext?.outcome)}
        ${row('CRM-Hinweis', input.leadContext?.reason)}
      `
      : '';
    const supportRows = input.supportData
      ? `
        ${row('Telefon', input.supportData.phone)}
        ${row('E-Mail', input.supportData.email)}
        ${row('Kategorie', input.supportData.category)}
        ${row('Problem', input.supportData.issueDescription)}
        ${row('Lift-Modell', input.supportData.liftModel)}
        ${row('Referenz', input.supportData.priorContactReference)}
        ${row('CRM-Notizfehler', input.supportContext?.noteError)}
        ${row('Ziel-Postfach', input.supportContext?.intendedInbox)}
      `
      : '';
    const structuredRows = leadRows || supportRows;

    const html = `
      <h2>Sarah ${kindLabel} – Chatende</h2>
      ${crmAction}
      <h3>Zusammenfassung</h3>
      <p>${escapeHtml(input.summary)}</p>
      <table style="border-collapse:collapse;">
        ${row('Chatende', input.completedAt)}
        ${row('Kontaktstatus', contactStatus)}
        ${row('Kontaktname', contactName)}
        ${structuredRows}
      </table>
      <h3>Vollständiges Transkript</h3>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;border:1px solid #ddd;padding:12px;border-radius:8px;">${escapeHtml(input.transcript)}</pre>
    `;

    await sendFn({
      from,
      to,
      subject: `Sarah ${kindLabel}-Zusammenfassung: ${input.sessionId}`,
      html,
    });
  }

  return {
    isConfigured: () => configured,
    sendLeadNotification,
    sendServiceNotification,
    sendSupportNotification,
    sendAbandonedChatSummary,
    sendCompletedChatSummary,
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
