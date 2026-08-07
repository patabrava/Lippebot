import type { LeadData, Mode, SupportData } from '../types/index.js';
import { hasContactMethod } from '../contact/contact-method.js';
import { hasPriorContactStatus } from '../contact/prior-contact.js';
import { stairTypeLabel } from '../lead/lead-options.js';

export type CollectedRequestData = Partial<LeadData & SupportData>;

export interface IntakeState {
  mode: Mode;
  collectedData: CollectedRequestData;
  awaitingVerification: boolean;
  completed: boolean;
  priorContactReferenceAsked?: boolean;
}

const repairIssuePattern = /\b(?:kaputt|defekt|reparatur|reparieren|beschädigt|beschaedigt)\b/i;
const technicalIssuePattern = /\b(?:störung|stoerung|fehler(?:code)?|ausfall|piept|funktioniert\s+nicht|bleibt\s+stehen)\b/i;
const maintenanceIssuePattern = /\b(?:wartung|warten\s+lassen|inspektion)\b/i;
const invoiceIssuePattern = /\b(?:rechnung|zahlung|mahnung|zahlungsreferenz)\b/i;
const salesIssuePattern = /\b(?:vertrag|vertragsbestätigung|vertragsbestaetigung|bestellung|auftragsstatus)\b/i;
const installationIssuePattern = /\b(?:ersatzteil|montage|installation|einbau|gewährleistung|gewaehrleistung|garantie)\b/i;
const liftContextPattern = /\b(?:sitzlift|treppenlift|plattformlift|lift)\b/i;
const negatedRepairPattern = /\b(?:nicht|kein(?:e|en|er|es)?)\s+(?:kaputt|defekt|beschädigt|beschaedigt)\b/i;
const explicitNewLiftDemandPattern = /\b(?:benötig\w*|benoetig\w*|brauch\w*|such\w*|möcht\w*|moecht\w*)\b[^.!?\n]{0,100}\b(?:einen|eine|ein)\s+(?:(?:neuen?|passenden?|geeigneten?|rollstuhlgeeigneten?)\s+)*(?:senkrechtaufzug|aufzug|sitzlift|treppenlift|plattformlift|hublift|lift)\b/i;
const explicitExistingLiftPattern = /\b(?:bereits|schon)\b[^.!?\n]{0,100}\b(?:bestellt|gekauft|eingebaut|montiert)\b|\b(?:vorhanden\w*|eingebaut\w*|bestellt\w*)\s+(?:aufzug|sitzlift|treppenlift|plattformlift|hublift|lift)\b/i;
const noStaircasePattern = /\b(?:keine?\s+(?:klassische\s+)?treppe(?:\s+vorhanden)?|ohne\s+(?:klassische\s+)?treppe|treppe\s+(?:ist\s+)?nicht\s+vorhanden)\b/i;
const verticalLiftPattern = /\b(?:hublift|senkrechtlift|senkrechtaufzug|vertikallift)\b/i;

export function inferLeadStairType(message: string): LeadData['stairType'] | undefined {
  if (noStaircasePattern.test(message) || verticalLiftPattern.test(message)) {
    return 'keine_treppe';
  }
  return undefined;
}

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

export function inferExplicitLeadContext(message: string): {
  mode: 'anfrage';
  collectedData: CollectedRequestData;
} | undefined {
  const normalized = message.trim();
  if (!normalized || explicitExistingLiftPattern.test(normalized)) return undefined;

  const candidate = issueCandidates(normalized).find((part) => explicitNewLiftDemandPattern.test(part));
  if (!candidate) return undefined;

  const concern = normalized.includes('\n')
    ? candidate
    : normalized.replace(/\s+/g, ' ');
  const stairType = inferLeadStairType(concern);
  return {
    mode: 'anfrage',
    collectedData: {
      requestSituation: 'new_lift',
      ownsLift: 'no',
      message: concern.slice(0, 500),
      ...(stairType ? { stairType } : {}),
    },
  };
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
  const normalizedIncoming = normalizeCollectedData(incoming as CollectedRequestData);
  const definedIncoming = Object.fromEntries(
    Object.entries(normalizedIncoming).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  return normalizeCollectedData({ ...current, ...definedIncoming } as CollectedRequestData);
}

export function normalizeCollectedData(data: CollectedRequestData): CollectedRequestData {
  if (
    typeof data.factoryNumber === 'string'
    && data.factoryNumber.trim()
    && data.factoryNumberStatus !== 'unavailable'
  ) {
    return { ...data, factoryNumberStatus: 'provided' };
  }
  return data;
}

export function containsVerificationQuestion(message: string): boolean {
  const normalized = message
    .replace(/[*_`]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ');

  return /\b(?:ist (?:das(?: alles)?|alles)(?: so)? korrekt|ist das alles so richtig|stimmt das so|sind (?:alle |die )?(?:angaben|daten)(?: so)? korrekt|sind alle angaben richtig)\b/.test(normalized);
}

function hasPriorContactReference(data: CollectedRequestData): boolean {
  return [
    data.priorContactReference,
    data.invoiceNumber,
    data.customerNumber,
    data.paymentReference,
    data.orderNumber,
    data.offerNumber,
    data.leadId,
    data.contractReference,
    data.sparePartReference,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

export function needsPriorContactReferenceQuestion(state: IntakeState): boolean {
  return state.collectedData.priorContact === 'yes'
    && !state.priorContactReferenceAsked
    && !hasPriorContactReference(state.collectedData);
}

export function ensureNextMissingQuestion(assistantText: string, nextQuestion: string): string {
  const trimmed = assistantText.trim();
  if (!trimmed || containsVerificationQuestion(trimmed)) return nextQuestion;
  if (trimmed.includes(nextQuestion) || trimmed.includes('?')) return trimmed;
  return `${trimmed}\n\n${nextQuestion}`;
}

export function buildNextMissingQuestion(
  mode: Mode,
  data: CollectedRequestData,
  options: { priorContactReferenceAsked?: boolean } = {},
): string {
  if ((!data.requestSituation && !data.ownsLift) || data.ownsLift === 'unknown') {
    return 'Geht es um einen neuen Lift, einen bereits bestellten Lift oder einen bereits eingebauten Lift?';
  }

  if (mode === 'anfrage') {
    if (!data.firstName || !data.lastName) return 'Wie ist dein vollständiger Name?';
    if (!hasContactMethod(data)) {
      return 'Wie können wir dich am besten erreichen? Schick mir bitte entweder deine Telefonnummer oder deine E-Mail-Adresse.';
    }
    if (!data.message) return 'Beschreibe mir bitte kurz, worum es bei deiner Anfrage geht.';
    if (!hasPriorContactStatus(data)) return 'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?';
    if (data.priorContact === 'yes'
      && !options.priorContactReferenceAsked
      && !hasPriorContactReference(data)) {
      return 'Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?';
    }
    if (!data.stairLocation) return 'Ist der Lift für drinnen oder draußen?';
    if (!data.stairType) return 'Ist deine Treppe gerade oder kurvig?';
    if (!data.liftType) return 'Brauchst du einen Sitzlift oder einen rollstuhlgeeigneten Lift?';
    if (!data.buildingType) return 'Geht es um ein Einfamilienhaus oder ein Mehrfamilienhaus?';
    if (!data.customerSegment) return 'Geht es um eine private Anfrage oder fragst du geschäftlich an?';
    if (!data.street || !data.postalCode || !data.city) return 'An welcher vollständigen Adresse brauchst du den Lift?';
    if (!data.availability) return 'Wann bist du am besten erreichbar: 08:00–12:00, 12:00–16:00 oder 16:00–20:00 Uhr?';
  }

  if (mode === 'service') {
    if (!data.customerName) return 'Wie ist dein vollständiger Name?';
    if (!hasContactMethod(data)) {
      return 'Wie können wir dich am besten erreichen? Schick mir bitte entweder deine Telefonnummer oder deine E-Mail-Adresse.';
    }
    if (!data.issueDescription) return 'Beschreibe mir bitte kurz, worum es bei deinem Anliegen geht.';
    if (!hasPriorContactStatus(data)) return 'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?';
    if (data.priorContact === 'yes'
      && !options.priorContactReferenceAsked
      && !hasPriorContactReference(data)) {
      return 'Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?';
    }
    if (data.requestSituation !== 'ordered_not_installed' && data.ownsLift !== 'yes') {
      return 'Ist der Lift bereits eingebaut?';
    }
    if (data.requestSituation !== 'ordered_not_installed' && !['lippe', 'other'].includes(String(data.liftManufacturer))) {
      return 'Ist der Lift von LIPPE Lift oder von einem anderen Hersteller?';
    }
    if (
      data.liftManufacturer === 'lippe'
      && data.factoryNumberStatus !== 'provided'
      && data.factoryNumberStatus !== 'unavailable'
    ) {
      return 'Schreibe die Fabriknummer bitte vom Etikett ab. Falls du sie nicht findest, sag mir kurz Bescheid.';
    }
    if (!data.serviceRequestType || !data.category) {
      return 'Geht es um Technik, Rechnung, Vertrag oder Ersatzteile und Montage?';
    }
  }

  return 'Welche Angabe fehlt noch oder soll geändert werden?';
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
    addLine(lines, 'Treppenverlauf', stairTypeLabel(data.stairType));
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
      ? 'Die Backend-Zusammenfassung wurde bereits gezeigt. Übernimm nur eine Korrektur; formuliere selbst keine weitere Kontroll-Zusammenfassung oder Bestätigungsfrage.'
      : 'Die Daten wurden noch nicht durch den Nutzer bestätigt. Das Backend zeigt die einzige Kontroll-Zusammenfassung automatisch, sobald alles vollständig ist; formuliere selbst niemals eine Zusammenfassung mit Bestätigungsfrage.',
    state.collectedData.priorContact === 'yes' && state.priorContactReferenceAsked
      ? 'Die Frage nach einer Angebots-, Auftrags- oder Vorgangsnummer wurde bereits gestellt. Frage sie nicht erneut, wenn der Nutzer keine Referenz hat.'
      : 'Wenn vorheriger Kontakt bejaht wurde und noch keine Referenz bekannt ist, frage als Nächstes genau einmal nach einer Angebots-, Auftrags- oder Vorgangsnummer.',
  ].join('\n');
}
