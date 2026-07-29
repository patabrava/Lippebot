import type { LeadData, Mode, SupportData } from '../types/index.js';
import { hasContactMethod } from '../contact/contact-method.js';
import { hasPriorContactStatus } from '../contact/prior-contact.js';

export type CollectedRequestData = Partial<LeadData & SupportData>;

export interface IntakeState {
  mode: Mode;
  collectedData: CollectedRequestData;
  awaitingVerification: boolean;
  completed: boolean;
}

const repairIssuePattern = /\b(?:kaputt|defekt|reparatur|reparieren|beschädigt|beschaedigt)\b/i;
const technicalIssuePattern = /\b(?:störung|stoerung|fehler(?:code)?|ausfall|piept|funktioniert\s+nicht|bleibt\s+stehen)\b/i;
const maintenanceIssuePattern = /\b(?:wartung|warten\s+lassen|inspektion)\b/i;
const invoiceIssuePattern = /\b(?:rechnung|zahlung|mahnung|zahlungsreferenz)\b/i;
const salesIssuePattern = /\b(?:vertrag|vertragsbestätigung|vertragsbestaetigung|bestellung|auftragsstatus)\b/i;
const installationIssuePattern = /\b(?:ersatzteil|montage|installation|einbau|gewährleistung|gewaehrleistung|garantie)\b/i;
const liftContextPattern = /\b(?:sitzlift|treppenlift|plattformlift|lift)\b/i;
const negatedRepairPattern = /\b(?:nicht|kein(?:e|en|er|es)?)\s+(?:kaputt|defekt|beschädigt|beschaedigt)\b/i;

function issueCandidates(message: string): string[] {
  return message
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((part) => part.replace(/^\s*(?:\*\*)?[A-ZÄÖÜ][^:]{0,20}(?::|\*\*)\s*/u, '').trim())
    .filter(Boolean);
}

function isCategoryMenu(candidate: string): boolean {
  const categoryMatches = [
    repairIssuePattern,
    technicalIssuePattern,
    maintenanceIssuePattern,
    invoiceIssuePattern,
    salesIssuePattern,
    installationIssuePattern,
  ].filter((pattern) => pattern.test(candidate)).length;
  return categoryMatches >= 3;
}

export function inferExplicitServiceContext(message: string): {
  mode: 'service';
  collectedData: CollectedRequestData;
} | undefined {
  const normalized = message.trim();
  if (!normalized) return undefined;

  for (const candidate of issueCandidates(normalized)) {
    if (isCategoryMenu(candidate)) continue;

    let serviceRequestType: SupportData['serviceRequestType'];
    let category: SupportData['category'];

    if (
      repairIssuePattern.test(candidate)
      && liftContextPattern.test(candidate)
      && !negatedRepairPattern.test(candidate)
    ) {
      serviceRequestType = 'repair';
      category = 'technik';
    } else if (technicalIssuePattern.test(candidate) && liftContextPattern.test(candidate)) {
      serviceRequestType = 'technical';
      category = 'technik';
    } else if (maintenanceIssuePattern.test(candidate) && liftContextPattern.test(candidate)) {
      serviceRequestType = 'maintenance';
      category = 'technik';
    } else if (invoiceIssuePattern.test(candidate)) {
      serviceRequestType = 'invoice_payment';
      category = 'finance';
    } else if (installationIssuePattern.test(candidate)) {
      serviceRequestType = 'spare_parts_installation_warranty';
      category = 'lossau';
    } else if (salesIssuePattern.test(candidate)) {
      serviceRequestType = 'sales_contract_order';
      category = 'sales';
    }

    if (serviceRequestType && category) {
      return {
        mode: 'service',
        collectedData: {
          serviceRequestType,
          category,
          issueDescription: candidate.slice(0, 500),
        },
      };
    }
  }

  return undefined;
}

export function mergeCollectedData(
  current: CollectedRequestData,
  incoming: Record<string, unknown>,
): CollectedRequestData {
  const definedIncoming = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  return { ...current, ...definedIncoming } as CollectedRequestData;
}

export function isExplicitVerificationConfirmation(message: string): boolean {
  const normalized = message
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[.!?]+$/g, '')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ');

  if (/^(ja|jep|jo|sieht gut aus)$/.test(normalized)) {
    return true;
  }

  return /^(ja )?(stimmt|passt|korrekt|alles (stimmt|richtig|korrekt)|(die )?(daten|angaben) (stimmen|sind korrekt)|das (stimmt|passt) so)$/.test(normalized);
}

export function isNoFurtherConcern(message: string): boolean {
  const normalized = message
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');

  return /^(nein|nien|nö|nee|ne|nein danke|nien danke|nö danke|das war alles|sonst nichts|kein weiteres anliegen)$/.test(normalized);
}

export function isFurtherConcernConfirmation(message: string): boolean {
  const normalized = message
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[.!?]+$/g, '')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ');

  return /^(ja|jep|jo|ja bitte|ja gerne|ich habe noch (eine frage|ein anliegen)|noch eine frage|noch ein anliegen)$/.test(normalized);
}

export function isLeadReady(data: CollectedRequestData): data is LeadData {
  return data.ownsLift === 'no'
    && hasPriorContactStatus(data)
    && !!data.customerSegment
    && !!data.firstName
    && !!data.lastName
    && hasContactMethod(data)
    && !!data.street
    && !!data.postalCode
    && !!data.city
    && !!data.availability;
}

export function isServiceReady(data: CollectedRequestData): data is SupportData {
  const isOrderedLift = data.requestSituation === 'ordered_not_installed'
    && data.ownsLift === 'no'
    && data.serviceRequestType === 'sales_contract_order';
  const hasFactoryDecision = data.liftManufacturer === 'other'
    || data.factoryNumberStatus === 'unavailable'
    || (data.factoryNumberStatus === 'provided' && !!data.factoryNumber?.trim());

  return (isOrderedLift || (data.ownsLift === 'yes'
    && ['lippe', 'other'].includes(String(data.liftManufacturer))
    && hasFactoryDecision))
    && !!data.serviceRequestType
    && !!data.customerName
    && !!data.category
    && !!data.issueDescription
    && hasPriorContactStatus(data)
    && hasContactMethod(data);
}

export function isRequestReady(mode: Mode, data: CollectedRequestData): boolean {
  if (mode === 'anfrage') return isLeadReady(data);
  if (mode === 'service') return isServiceReady(data);
  return false;
}

function addLine(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    lines.push(`• ${label}: ${value.trim()}`);
  }
}

function addContactLine(lines: string[], data: CollectedRequestData): void {
  addLine(lines, 'E-Mail', data.email);
  addLine(lines, 'Telefon', data.phone);
}

function priorContactLabel(data: CollectedRequestData): string | undefined {
  if (data.priorContact === 'yes') return 'Ja';
  if (data.priorContact === 'no') return 'Nein';
  if (data.priorContact === 'unknown') return 'Unbekannt';
  return undefined;
}

export function buildVerificationMessage(mode: Mode, data: CollectedRequestData): string {
  const lines: string[] = [];

  if (mode === 'anfrage') {
    addLine(lines, 'Name', [data.firstName, data.lastName].filter(Boolean).join(' '));
    addContactLine(lines, data);
    addLine(lines, 'Adresse', [data.street, data.postalCode, data.city].filter(Boolean).join(', '));
    addLine(lines, 'Anfrage', data.message);
    addLine(lines, 'Kundengruppe', data.customerSegment === 'firma' ? 'Geschäftlich' : 'Privat');
    addLine(lines, 'Treppenstandort', data.stairLocation);
    addLine(lines, 'Treppenverlauf', data.stairType);
    addLine(lines, 'Lifttyp', data.liftType);
    addLine(lines, 'Gebäudetyp', data.buildingType);
    addLine(lines, 'Vorheriger Kontakt', priorContactLabel(data));
    addLine(lines, 'Referenz', data.priorContactReference);
    addLine(lines, 'Erreichbarkeit', data.availability);
    addLine(lines, 'Newsletter', data.newsletter);
  } else {
    addLine(lines, 'Name', data.customerName);
    addContactLine(lines, data);
    addLine(lines, 'Anliegen', data.issueDescription);
    addLine(lines, 'Situation', data.requestSituation === 'ordered_not_installed'
      ? 'Lift bestellt, aber noch nicht eingebaut'
      : undefined);
    if (data.requestSituation !== 'ordered_not_installed') {
      addLine(lines, 'Hersteller', data.liftManufacturer === 'lippe' ? 'LIPPE Lift' : 'Anderer Hersteller');
      addLine(lines, 'Fabriknummer', data.factoryNumberStatus === 'unavailable'
        ? 'Nicht verfügbar'
        : data.factoryNumber);
    }
    addLine(lines, 'Vorheriger Kontakt', priorContactLabel(data));
    addLine(lines, 'Referenz', data.priorContactReference);
    addLine(lines, 'Lift-Modell', data.liftModel);
    addLine(lines, 'Symptomdetails', data.symptomDetails);
    addLine(lines, 'Auslöser/Bedingungen', data.triggerConditions);
    addLine(lines, 'Rechnungsnummer', data.invoiceNumber);
    addLine(lines, 'Kundennummer', data.customerNumber);
    addLine(lines, 'Zahlungsreferenz', data.paymentReference);
    addLine(lines, 'Auftragsnummer', data.orderNumber);
    addLine(lines, 'Angebotsnummer', data.offerNumber);
    addLine(lines, 'Lead-ID', data.leadId);
    addLine(lines, 'Vertragsreferenz', data.contractReference);
    addLine(lines, 'Ersatzteilreferenz', data.sparePartReference);
    addLine(lines, 'Installationskontext', data.installationContext);
    addLine(lines, 'Mangelkontext', data.defectContext);
  }

  return [
    'Bevor ich dein Anliegen weiterleite, zeige ich dir alle erfassten Angaben. So kannst du sie prüfen und ich kann dein Anliegen korrekt an einen unserer Mitarbeiter weiterleiten:',
    '',
    ...lines,
    '',
    'Sind alle Angaben korrekt? Antworte bitte mit „Ja“ oder nenne mir die Angabe, die ich ändern soll.',
  ].join('\n');
}

export function buildAuthoritativeStateContext(state: IntakeState): string {
  const hasExplicitIssue = !!(
    state.collectedData.issueDescription
    && state.collectedData.category
    && state.collectedData.serviceRequestType
  );
  return [
    'INTERNER, VERBINDLICHER ANFRAGESTATUS:',
    `Modus: ${state.mode}`,
    `Bereits erfasste Daten: ${JSON.stringify(state.collectedData)}`,
    'Bereits erfasste Werte nicht erneut abfragen. Neue oder korrigierte Angaben im report_state vollständig übernehmen.',
    hasExplicitIssue
      ? 'Das Anliegen, der Service-Typ und die Kategorie sind bereits eindeutig. Erkenne das konkrete Anliegen kurz an und frage NICHT erneut, ob es um Technik, Rechnung, Vertrag, Ersatzteile oder Montage geht.'
      : 'Wenn die aktuelle Nachricht oder eingefügter Text das Anliegen eindeutig beschreibt, übernimm Beschreibung, Service-Typ und Kategorie sofort und frage nicht allgemein nach der Art des Anliegens.',
    state.awaitingVerification
      ? 'Die Zusammenfassung wurde bereits gezeigt. Der Nutzer kann jetzt bestätigen oder eine Korrektur nennen.'
      : 'Die Daten wurden noch nicht durch den Nutzer bestätigt.',
  ].join('\n');
}
