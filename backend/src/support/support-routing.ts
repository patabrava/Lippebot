import type {
  SupportCategory,
  SupportData,
  SupportMatchState,
  SupportNoteStatus,
} from '../types/index.js';
import { formatBerlinDateTime } from '../time/berlin.js';
import { extractE2ESubject } from '../request/e2e-marker.js';

const supportInboxes: Record<SupportCategory, string> = {
  technik: 'technik@lippelift.de',
  finance: 'finance@lippelift.de',
  sales: 'sales@lippelift.de',
  lossau: 'lossau@lippelift.de',
};

const routingKeywords: Array<{ category: SupportCategory; patterns: RegExp[] }> = [
  {
    category: 'technik',
    patterns: [
      /stoerung/i,
      /störung/i,
      /fehler/i,
      /kaputt/i,
      /bleibt\s+stehen/i,
      /funktioniert\s+nicht/i,
      /wartung/i,
      /ausfall/i,
      /piept/i,
    ],
  },
  {
    category: 'lossau',
    patterns: [
      /ersatzteil/i,
      /montage/i,
      /installation/i,
      /einbau/i,
      /schiene/i,
      /fertigung/i,
      /produktions/i,
    ],
  },
  {
    category: 'finance',
    patterns: [
      /rechnung/i,
      /zahlung/i,
      /mahnung/i,
      /agb/i,
      /verwaltung/i,
      /kundennummer/i,
      /beleg/i,
    ],
  },
  {
    category: 'sales',
    patterns: [
      /vertrag/i,
      /vertragsbestaetigung/i,
      /vertragsbestätigung/i,
      /bestellung/i,
      /auftragsstatus/i,
      /angebot/i,
      /kauf/i,
    ],
  },
];

export function getSupportInbox(category: SupportCategory): string {
  return supportInboxes[category];
}

export function inferSupportCategory(text: string): SupportCategory | undefined {
  const normalized = text.trim();
  for (const rule of routingKeywords) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.category;
    }
  }
  return undefined;
}

export function resolveSupportCategory(data: SupportData): SupportCategory {
  return data.category ?? inferSupportCategory(data.issueDescription ?? '') ?? 'sales';
}

function line(label: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return `${label}: ${value.trim()}`;
}

export function buildSupportNoteContent(
  data: SupportData,
  matchState: SupportMatchState,
  now = new Date(),
): string {
  const category = resolveSupportCategory(data);
  return [
    `Sarah Chatbot Support - ${formatBerlinDateTime(now)}`,
    `Kategorie: ${category}`,
    `CRM-Treffer: ${matchState}`,
    line('Kurzfassung', data.issueDescription),
    line('Telefon', data.phone),
    line('E-Mail', data.email),
    line('Vorheriger Kontakt', data.priorContact),
    line('Referenz', data.priorContactReference),
    line('Lift-Modell', data.liftModel),
    line('Symptomdetails', data.symptomDetails),
    line('Ausloeser/Bedingungen', data.triggerConditions),
    line('Rechnungsnummer', data.invoiceNumber),
    line('Kundennummer', data.customerNumber),
    line('Zahlungsreferenz', data.paymentReference),
    line('Auftragsnummer', data.orderNumber),
    line('Angebotsnummer', data.offerNumber),
    line('Lead-ID', data.leadId),
    line('Vertragsreferenz', data.contractReference),
    line('Ersatzteilreferenz', data.sparePartReference),
    line('Installationskontext', data.installationContext),
    line('Mangelkontext', data.defectContext),
  ].filter(Boolean).join('\n');
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
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  return `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">${label}:</td><td>${escapeHtml(value.trim())}</td></tr>`;
}

function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildSupportEmailSubject(data: SupportData, requestId?: string): string {
  const e2eSubject = extractE2ESubject(data.issueDescription);
  if (e2eSubject) return e2eSubject;
  const category = resolveSupportCategory(data);
  const customerName = sanitizeEmailHeader(data.customerName ?? '') || 'Unbekannter Kunde';
  if (requestId) {
    return `Sarah [${category}] [${sanitizeEmailHeader(requestId)}]: ${customerName}`;
  }
  return `Sarah Support [${category}]: ${customerName}`;
}

export function buildSupportEmailHtml(input: {
  requestId?: string;
  data: SupportData;
  intendedInbox: string;
  matchState: SupportMatchState;
  noteStatus: SupportNoteStatus;
  noteError?: string;
  dealUrl?: string;
  sourceDealUrl?: string;
  serviceDealUrl?: string;
  transcript?: string;
}): string {
  const category = resolveSupportCategory(input.data);
  const matchLabel = input.matchState === 'unique'
    ? 'Eindeutiger CRM-Treffer'
    : input.matchState === 'ambiguous'
      ? 'Mehrere moegliche CRM-Treffer'
      : 'Kein eindeutiger CRM-Treffer';

  const primaryDealUrl = input.serviceDealUrl ?? input.dealUrl;
  const hasAnyDealUrl = Boolean(primaryDealUrl || input.sourceDealUrl);

  return `
    <h2>Support-Anfrage ueber Sarah</h2>
    ${primaryDealUrl
      ? `<p><a href="${escapeHtml(primaryDealUrl)}" style="display:inline-block;padding:10px 16px;background:#0b63ce;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Serviceanfrage in Pipedrive öffnen</a></p>`
      : ''}
    ${input.sourceDealUrl
      ? `<p><a href="${escapeHtml(input.sourceDealUrl)}">Originalen Vorgang in Pipedrive öffnen</a></p>`
      : ''}
    ${hasAnyDealUrl
      ? ''
      : '<p><strong>Manuelle Prüfung erforderlich</strong></p>'}
    <table style="border-collapse:collapse;">
      ${row('Anfrage-ID', input.requestId)}
      ${row('Kunde', input.data.customerName)}
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kategorie:</td><td>${category}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Zielteam:</td><td>${escapeHtml(input.intendedInbox)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">CRM-Status:</td><td>${matchLabel}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Notizstatus:</td><td>${input.noteStatus}</td></tr>
      ${input.noteError ? row('CRM-Notizfehler', input.noteError) : ''}
      ${row('Telefon', input.data.phone)}
      ${row('E-Mail', input.data.email)}
      ${row('Vorheriger Kontakt', input.data.priorContact)}
      ${row('Referenz', input.data.priorContactReference)}
      ${row('Kurzfassung', input.data.issueDescription)}
      ${row('Hersteller', input.data.liftManufacturer)}
      ${row('Fabriknummer', input.data.factoryNumber)}
      ${row('Service-Typ', input.data.serviceRequestType)}
      ${row('Lift-Modell', input.data.liftModel)}
      ${row('Symptomdetails', input.data.symptomDetails)}
      ${row('Ausloeser/Bedingungen', input.data.triggerConditions)}
      ${row('Rechnungsnummer', input.data.invoiceNumber)}
      ${row('Kundennummer', input.data.customerNumber)}
      ${row('Zahlungsreferenz', input.data.paymentReference)}
      ${row('Auftragsnummer', input.data.orderNumber)}
      ${row('Angebotsnummer', input.data.offerNumber)}
      ${row('Lead-ID', input.data.leadId)}
      ${row('Vertragsreferenz', input.data.contractReference)}
      ${row('Ersatzteilreferenz', input.data.sparePartReference)}
      ${row('Installationskontext', input.data.installationContext)}
      ${row('Mangelkontext', input.data.defectContext)}
    </table>
    ${input.transcript ? `
      <h3>Vollständiges Anfrage-Transkript</h3>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;border:1px solid #ddd;padding:12px;border-radius:8px;">${escapeHtml(input.transcript)}</pre>
    ` : ''}
  `;
}
