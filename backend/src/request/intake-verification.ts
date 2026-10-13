import type { ChatMessage, LeadData, Mode, SupportData } from '../types/index.js';
import {
  hasEmailContactMethod,
  hasPhoneContactMethod,
  hasRequiredContactDetails,
  isUsableEmail,
  isUsablePhone,
} from '../contact/contact-method.js';
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
const afterSalesIssuePattern = /\b(?:störung|stoerung|fehler(?:code)?|ausfall|piept|funktioniert\s+nicht|bleibt\s+stehen|mangel|mängel|maengel)\b/i;
const technicalIssuePattern = /\b(?:konstruktion|konstruiert|konstruktionszeichnung|zeichnung|gezeichnet|auslegung|steifigkeit|spezifikation|technische?\s+frage|fertigungszeichnung|fertigungsvorbereitung|fuer\s+die\s+fertigung|für\s+die\s+fertigung)\b/i;
const maintenanceIssuePattern = /\b(?:wartung|warten\s+lassen|inspektion)\b/i;
const invoiceIssuePattern = /\b(?:rechnung|zahlung|mahnung|zahlungsreferenz)\b/i;
const salesIssuePattern = /\b(?:vertrag|vertragsbestätigung|vertragsbestaetigung|bestellung|auftragsstatus)\b/i;
const installationIssuePattern = /\b(?:ersatzteil|montage|montier\w*|installation|einbau|fertigstellung|fertiggestellt|gewährleistung|gewaehrleistung|garantie)\b/i;
const liftContextPattern = /\b(?:sitzlift|treppenlift|plattformlift|lift)\b/i;
const negatedRepairPattern = /\b(?:nicht|kein(?:e|en|er|es)?)\s+(?:kaputt|defekt|beschädigt|beschaedigt)\b/i;
const explicitNewLiftDemandPattern = /\b(?:benötig\w*|benoetig\w*|brauch\w*|such\w*|möcht\w*|moecht\w*|hätt\w*|haett\w*|will|plan\w*)\b[^.!?\n]{0,100}\b(?:einen|eine|ein)\s+(?:(?:neuen?|passenden?|geeigneten?|rollstuhlgeeigneten?|vertikalen?)\s+)*(?:senkrechtaufzug|aufzug|sitzlift|treppenlift|plattformlift|hublift|lift)\b/i;
const explicitExistingLiftPattern = /\b(?:bereits|schon)\b[^.!?\n]{0,100}\b(?:bestellt|gekauft|eingebaut|montiert)\b|\b(?:vorhanden\w*|eingebaut\w*|bestellt\w*)\s+(?:aufzug|sitzlift|treppenlift|plattformlift|hublift|lift)\b/i;
const noStaircasePattern = /\b(?:keine?\s+(?:klassische\s+)?treppe(?:\s+vorhanden)?|ohne\s+(?:klassische\s+)?treppe|treppe\s+(?:ist\s+)?nicht\s+vorhanden)\b/i;
const verticalLiftPattern = /\b(?:hublift|senkrechtlift|senkrechtaufzug|vertikallift)\b|\bvertikal\w*\s+plattform(?:lift|hublift)\w*\b/i;
const plannedLiftPattern = /\bplan\w*\b[^.!?\n]{0,160}\b(?:einbau|installation)\b[^.!?\n]{0,160}\b(?:plattformlift|plattformhublift|hublift|sitzlift|treppenlift|lift)\w*\b/i;

export function inferLeadStairType(message: string): LeadData['stairType'] | undefined {
  if (noStaircasePattern.test(message) || verticalLiftPattern.test(message)) {
    return 'keine_treppe';
  }
  return undefined;
}

export function inferContactDataFromMessage(message: string): Pick<LeadData, 'email' | 'phone'> {
  const email = message.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/i)?.[0];
  const labelledPhone = message.match(/\b(?:telefon|tel\.?|handy|mobil)\s*:?\s*((?:\+?\d)[\d\s()./-]{4,}\d)/i)?.[1]?.trim();
  const trimmed = message.trim();
  const standalonePhone = /^[+\d\s()./-]+$/.test(trimmed) ? trimmed : undefined;
  const phone = [labelledPhone, standalonePhone].find((candidate) => isUsablePhone(candidate));
  return {
    ...(email && isUsableEmail(email) ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

export function inferPhoneContactStatusFromMessage(
  message: string,
): Pick<LeadData, 'phoneContactStatus'> {
  const normalized = message.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  const explicitlyDeclinesPhone = /\b(?:keine|ohne)\s+telefon(?:nummer)?\b/.test(normalized)
    || /\btelefon(?:nummer)?\s+(?:nicht|keine)\s+(?:angeben|nennen|mitteilen)\b/.test(normalized)
    || /\b(?:möchte|moechte|will)\s+(?:ich\s+)?(?:meine\s+)?telefonnummer\s+nicht\s+(?:angeben|nennen|mitteilen)\b/.test(normalized)
    || /\b(?:nur|ausschließlich|ausschliesslich)\s+(?:per|über|ueber)\s+e-?mail\b/.test(normalized);
  return explicitlyDeclinesPhone ? { phoneContactStatus: 'declined' } : {};
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
    afterSalesIssuePattern,
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

  const candidate = issueCandidates(normalized).find((part) => explicitNewLiftDemandPattern.test(part) || plannedLiftPattern.test(part));
  if (!candidate) return undefined;

  const concern = normalized;
  const stairType = inferLeadStairType(concern);
  return {
    mode: 'anfrage',
    collectedData: {
      requestSituation: 'new_lift',
      ownsLift: 'no',
      message: concern,
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
      category = 'lossau';
    } else if (afterSalesIssuePattern.test(candidate) && liftContextPattern.test(candidate)) {
      serviceRequestType = 'repair';
      category = 'lossau';
    } else if (maintenanceIssuePattern.test(candidate) && liftContextPattern.test(candidate)) {
      serviceRequestType = 'maintenance';
      category = 'lossau';
    } else if (technicalIssuePattern.test(candidate)) {
      serviceRequestType = 'technical';
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
  let normalized = data;
  if (hasPhoneContactMethod(data) && data.phoneContactStatus !== 'provided') {
    normalized = { ...normalized, phoneContactStatus: 'provided' };
  }
  if (
    typeof data.factoryNumber === 'string'
    && data.factoryNumber.trim()
    && data.factoryNumberStatus !== 'unavailable'
  ) {
    normalized = { ...normalized, factoryNumberStatus: 'provided' };
  }
  return normalized;
}

export function containsVerificationQuestion(message: string): boolean {
  const normalized = message
    .replace(/[*_`]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ');

  return /\b(?:ist (?:das(?: alles)?|alles)(?: so)? korrekt|ist das alles so richtig|stimmt das so|sind (?:alle |die )?(?:angaben|daten)(?: so)? korrekt|sind alle angaben richtig)\b/.test(normalized);
}

function normalizeShortReply(message: string): string {
  return message
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/^[\s"'„“‚‘’«».,!?]+|[\s"'„“‚‘’«».,!?]+$/g, '')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPriorContactQuestion(message: string): boolean {
  const normalized = message
    .replace(/[*_`]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ');
  return normalized.includes('hattest du wegen dieses anliegens schon einmal kontakt mit uns')
    || normalized.includes('hattest du wegen dieses anliegens schon kontakt mit uns');
}

function parsePriorContactReply(message: string): LeadData['priorContact'] | undefined {
  const normalized = normalizeShortReply(message);
  if (/^(ja|jep|jo)$/.test(normalized)) return 'yes';
  if (/^(nein|nien|nö|nee|ne)$/.test(normalized)) return 'no';
  return undefined;
}

export function inferPriorContactFromHistory(
  history: ChatMessage[],
  currentMessage?: string,
): LeadData['priorContact'] | undefined {
  const messages = currentMessage === undefined
    ? history
    : [...history, { role: 'user' as const, content: currentMessage, timestamp: Date.now() }];
  let inferred: LeadData['priorContact'] | undefined;

  for (let index = 0; index < messages.length - 1; index += 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (question.role !== 'assistant'
      || answer.role !== 'user'
      || !containsPriorContactQuestion(question.content)) continue;
    inferred = parsePriorContactReply(answer.content) ?? inferred;
  }
  return inferred;
}

export function historyAwaitsVerification(history: ChatMessage[]): boolean {
  const latestAssistant = [...history].reverse().find((entry) => entry.role === 'assistant');
  return !!latestAssistant && containsVerificationQuestion(latestAssistant.content);
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

const CONTACT_DETAILS_QUESTION = 'Wie lauten deine E-Mail-Adresse und Telefonnummer?';
const EMAIL_QUESTION = 'Wie lautet deine E-Mail-Adresse?';
const PHONE_QUESTION = 'Für eine persönliche Beratung brauchen wir deine Telefonnummer. Wenn du keine angeben möchtest, schreiben wir dir per E-Mail. Wie lautet deine Telefonnummer?';

type IntakeQuestionIntent =
  | 'situation' | 'name' | 'contact' | 'email' | 'phone' | 'issue' | 'prior_contact'
  | 'reference' | 'location' | 'stair_type' | 'lift_type' | 'building' | 'segment'
  | 'address' | 'availability' | 'manufacturer' | 'factory_number' | 'service_type' | 'other';

function intakeQuestionIntent(text: string): IntakeQuestionIntent {
  const normalized = text.replace(/[*_`]/g, '').toLocaleLowerCase('de-DE');
  if (/neuen lift|bereits bestellt|bereits eingebaut|bestehendes anliegen|neue anfrage/.test(normalized)) return 'situation';
  if (/vollständigen name|vollstaendigen name|wie ist dein name|wie heißt du|wie heisst du/.test(normalized)) return 'name';
  if (/e-mail-adresse und telefonnummer|email-adresse und telefonnummer|kontaktdaten/.test(normalized)) return 'contact';
  if (/e-?mail|email/.test(normalized)) return 'email';
  if (/telefon|handy|mobilnummer|rückruf|rueckruf/.test(normalized)) return 'phone';
  if (/vorherigen kontakt|kontakt mit uns|schon einmal kontakt/.test(normalized)) return 'prior_contact';
  if (/referenz|angebotsnummer|auftragsnummer|vorgangsnummer/.test(normalized)) return 'reference';
  if (/anliegen|problem|beschreib/.test(normalized)) return 'issue';
  if (/drinnen|draußen|draussen|innen oder außen|innen oder aussen/.test(normalized)) return 'location';
  if (/treppe|gerade oder kurvig|treppenverlauf/.test(normalized)) return 'stair_type';
  if (/sitzlift|rollstuhlgeeignet|lifttyp/.test(normalized)) return 'lift_type';
  if (/einfamilienhaus|mehrfamilienhaus|gebäude|gebaeude/.test(normalized)) return 'building';
  if (/private anfrage|geschäftlich|geschaeftlich|firmenkunde/.test(normalized)) return 'segment';
  if (/adresse|straße|strasse|postleitzahl|plz|stadt/.test(normalized)) return 'address';
  if (/erreichbar|uhrzeit|zeitfenster|vormittag|nachmittag/.test(normalized)) return 'availability';
  if (/hersteller|lippe lift oder/.test(normalized)) return 'manufacturer';
  if (/fabriknummer|etikett/.test(normalized)) return 'factory_number';
  if (/technik, rechnung|rechnung, vertrag|ersatzteile und montage/.test(normalized)) return 'service_type';
  return 'other';
}

function questionIntents(text: string): IntakeQuestionIntent[] {
  return text.split(/(?<=[.!?])\s+|\n+/)
    .filter((part) => part.includes('?')
      || /\b(?:beschreibe|schreibe|nenne|teile|sag)\s+(?:mir|uns|bitte|die|deine?|kurz)\b/i.test(part)
      || /\b(?:brauche|benötige|benoetige)\s+(?:ich|wir)\b/i.test(part))
    .map(intakeQuestionIntent);
}

export function ensureNextMissingQuestion(
  assistantText: string,
  nextQuestion: string,
  _history: ChatMessage[] = [],
): string {
  const expectedIntent = questionIntents(nextQuestion).at(-1) ?? intakeQuestionIntent(nextQuestion);

  const trimmed = assistantText.trim();
  if (!trimmed || containsVerificationQuestion(trimmed)) return nextQuestion;
  if ([CONTACT_DETAILS_QUESTION, EMAIL_QUESTION, PHONE_QUESTION].includes(nextQuestion)) return nextQuestion;

  const currentQuestions = questionIntents(trimmed);
  const matchingQuestion = currentQuestions.includes(expectedIntent);
  if (currentQuestions.length > 0 && (!matchingQuestion || currentQuestions.length > 1)) {
    const firstSentence = trimmed.split(/(?<=[.!?])\s+|\n+/)[0];
    const acknowledgment = questionIntents(firstSentence).length === 0
      && /^(?:verstanden|danke|alles klar|verstehe|klar|super)\b/i.test(firstSentence)
      && !/\b(?:meinte|fehlt|brauche|benötige)\b/i.test(firstSentence)
      ? firstSentence : '';
    return acknowledgment ? `${acknowledgment}\n\n${nextQuestion}` : nextQuestion;
  }
  if (matchingQuestion) return trimmed;
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
    if (!hasEmailContactMethod(data) && !hasPhoneContactMethod(data)) return CONTACT_DETAILS_QUESTION;
    if (!hasEmailContactMethod(data)) return EMAIL_QUESTION;
    if (!hasPhoneContactMethod(data) && data.phoneContactStatus !== 'declined') return PHONE_QUESTION;
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
    if (hasPhoneContactMethod(data) && !data.availability) {
      return 'Wann bist du am besten erreichbar: 08:00–12:00, 12:00–16:00 oder 16:00–20:00 Uhr?';
    }
  }

  if (mode === 'service') {
    if (!data.customerName) return 'Wie ist dein vollständiger Name?';
    if (!hasEmailContactMethod(data) && !hasPhoneContactMethod(data)) return CONTACT_DETAILS_QUESTION;
    if (!hasEmailContactMethod(data)) return EMAIL_QUESTION;
    if (!hasPhoneContactMethod(data) && data.phoneContactStatus !== 'declined') return PHONE_QUESTION;
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
  const normalized = normalizeShortReply(message);

  if (/^(ja|jep|jo|sieht gut aus)$/.test(normalized)) {
    return true;
  }

  return /^(ja )?(stimmt|passt|korrekt|alles (stimmt|richtig|korrekt)|(die )?(daten|angaben) (stimmen|sind korrekt)|das (stimmt|passt) so)$/.test(normalized);
}

export function isNoFurtherConcern(message: string): boolean {
  const normalized = normalizeShortReply(message);

  return /^(nein|nien|nö|nee|ne|nein danke|nien danke|nö danke|das war alles|sonst nichts|kein weiteres anliegen)$/.test(normalized);
}

export function isFurtherConcernConfirmation(message: string): boolean {
  const normalized = normalizeShortReply(message);

  return /^(ja|jep|jo|ja bitte|ja gerne|ich habe noch (eine frage|ein anliegen)|noch eine frage|noch ein anliegen)$/.test(normalized);
}

export function isLeadReady(data: CollectedRequestData): data is LeadData {
  return data.ownsLift === 'no'
    && hasPriorContactStatus(data)
    && !!data.customerSegment
    && !!data.firstName
    && !!data.lastName
    && hasRequiredContactDetails(data)
    && !!data.street
    && !!data.postalCode
    && !!data.city
    && (!hasPhoneContactMethod(data) || !!data.availability);
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
    && hasRequiredContactDetails(data);
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
    state.mode === 'service' && state.collectedData.issueDescription
    && state.collectedData.category
    && state.collectedData.serviceRequestType
  );
  return [
    'INTERNER, VERBINDLICHER ANFRAGESTATUS:',
    `Modus: ${state.mode}`,
    `Bereits erfasste Daten: ${JSON.stringify(state.collectedData)}`,
    'Bereits erfasste Werte nicht erneut abfragen. Neue oder korrigierte Angaben im report_state vollständig übernehmen.',
    state.mode === 'anfrage' && state.collectedData.message
      ? 'Das Neukauf-Anliegen ist bereits in message erfasst, einschließlich technischer Zeichnungen, Projektplanung und Einbaumaße. Frage NICHT erneut, worum es bei der Anfrage geht. Technische Begriffe ändern die bereits geklärte Situation new_lift nicht in eine Serviceanfrage.'
      : '',
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
