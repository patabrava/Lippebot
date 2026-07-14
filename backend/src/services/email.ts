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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
        ${crmLabel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">CRM-Zuordnung:</td><td>${crmLabel}</td></tr>` : ''}
        ${crmContext?.personId ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Person-ID:</td><td>${crmContext.personId}</td></tr>` : ''}
        ${crmContext?.dealId ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Fall-ID:</td><td>${crmContext.dealId}</td></tr>` : ''}
        ${crmContext?.reason ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">CRM-Hinweis:</td><td>${escapeHtml(crmContext.reason)}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name:</td><td>${data.firstName} ${data.lastName}</td></tr>
        ${data.phone ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>` : ''}
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.street ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Straße:</td><td>${data.street}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">PLZ / Stadt:</td><td>${data.postalCode} ${data.city}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Erreichbarkeit:</td><td>${data.availability}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Treppe:</td><td>${data.stairLocation || 'k.A.'} / ${data.stairType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Gebäude:</td><td>${data.buildingType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lifttyp:</td><td>${data.liftType === 'sitzlift' ? 'Sitzlift' : data.liftType === 'rollstuhlgeeignet' ? 'Rollstuhlgeeignet' : 'k.A.'}</td></tr>
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nachricht:</td><td>${data.message}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Newsletter:</td><td>${data.newsletter || 'k.A.'}</td></tr>
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

  return {
    isConfigured: () => configured,
    sendLeadNotification,
    sendServiceNotification,
    sendSupportNotification,
    sendAbandonedChatSummary,
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
