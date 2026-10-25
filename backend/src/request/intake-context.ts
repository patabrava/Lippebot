import type { ChatMessage, RequestSituation } from '../types/index.js';
import { normalizeBuildingType, normalizeLiftType, normalizeStairLocation, normalizeStairType } from '../lead/lead-options.js';
import {
  inferContactDataFromMessage,
  inferExplicitLeadContext,
  inferExplicitServiceContext,
  inferLeadStairType,
  inferPhoneContactStatusFromMessage,
  mergeCollectedData,
  type IntakeState,
  type CollectedRequestData,
} from './intake-verification.js';

// The widget retains the full session even after starting another request.
// Only the customer turns following that boundary belong to this intake.
export function currentRequestHistory(history: ChatMessage[]): ChatMessage[] {
  let boundary = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'assistant'
      && history[index].content === 'Gerne. Beschreibe mir bitte kurz dein weiteres Anliegen.') {
      boundary = index;
      break;
    }
  }
  return history.slice(boundary + 1);
}

function explicitSituation(text: string): RequestSituation | undefined {
  const normalized = text.trim().toLocaleLowerCase('de-DE');
  if (/\b(?:bereits|schon)\s+(?:einen\s+\w*\s*)?(?:bestellt|gekauft)\b|^(?:der lift ist )?(?:bereits )?bestellt[.!]?$/.test(normalized)) return 'ordered_not_installed';
  if (/\b(?:bereits|schon)\s+eingebaut\b|^(?:der lift ist )?eingebaut[.!]?$/.test(normalized)) return 'installed_lift';
  if (/^(?:(?:es geht um|für|fuer|einen|ein|der)\s+)*(?:neuen?|neuer)\s+(?:treppenlift|sitzlift|plattformlift|hublift|lift)[.!]?$/.test(normalized)) return 'new_lift';
  if (inferExplicitLeadContext(text)) return 'new_lift';
  return undefined;
}

function explicitAnswer(message: string, previous?: ChatMessage): CollectedRequestData {
  const text = message.trim();
  const normalized = text.toLocaleLowerCase('de-DE').replace(/[.!]$/, '');
  const data: CollectedRequestData = {};
  const stairLocation = normalizeStairLocation(normalized);
  const stairType = normalizeStairType(normalized);
  const buildingType = normalizeBuildingType(normalized);
  const liftType = normalizeLiftType(normalized);
  if (stairLocation) data.stairLocation = stairLocation;
  if (stairType) data.stairType = stairType;
  if (buildingType) data.buildingType = buildingType;
  if (liftType) data.liftType = liftType;
  if (/^(?:privat|privatperson|private anfrage)$/.test(normalized)) data.customerSegment = 'privatperson';
  if (/^(?:geschäftlich|geschaeftlich|firma|firmenkunde|gewerblich)$/.test(normalized)) data.customerSegment = 'firma';
  const time = normalized.replace(/[–—]/g, '-').replace(/\s|uhr/g, '');
  if (/^(?:0?8(?::00)?)-(?:12(?::00)?)$/.test(time)) data.availability = '08:00 - 12:00';
  if (/^12(?::00)?-16(?::00)?$/.test(time)) data.availability = '12:00 - 16:00';
  if (/^16(?::00)?-20(?::00)?$/.test(time)) data.availability = '16:00 - 20:00';
  const address = text.match(/^(.+?\s+\d+\s*[a-z]?)(?:\s*,\s*|\s+)(\d{5})\s+([\p{L}][\p{L}\s-]+)[.!]?$/iu);
  if (address) { data.street = address[1]; data.postalCode = address[2]; data.city = address[3].trim(); }
  if (previous?.role === 'assistant' && /\bname(?:n)?\b/i.test(previous.content)) {
    const name = text.split(/,|\s+[\w.+-]+@/)[0].trim();
    if (/^[\p{L}][\p{L}\s'.-]+$/u.test(name) && name.split(/\s+/).length >= 2
      && !/\b(?:lift|email|bitte|keine|meinen|meinst|weiß|weiss)\b/i.test(name)) {
      const [firstName, ...lastName] = name.split(/\s+/);
      data.firstName = firstName;
      data.lastName = lastName.join(' ');
      data.customerName = name;
    }
  }
  if (previous?.role === 'assistant' && /fabriknummer/i.test(previous.content)) {
    if (/\b(?:keine|nicht|unbekannt|unverfügbar|unverfuegbar)\b|^nein$/.test(normalized)) data.factoryNumberStatus = 'unavailable';
    else if (/^[A-Z0-9][A-Z0-9/-]{3,}$/i.test(text) && /\d/.test(text)) { data.factoryNumber = text; data.factoryNumberStatus = 'provided'; }
  }
  if (/^(?:(?:es ist|von|ein|der hersteller ist)\s+)*(?:lippe|lippe lift)[.!]?$/.test(normalized)) data.liftManufacturer = 'lippe';
  if (/^(?:anderer hersteller|von einem anderen hersteller|nicht von lippe lift)$/.test(normalized)) data.liftManufacturer = 'other';
  return data;
}

/** Recover factual customer context independently of the model's partial state.
 * Technical drawings can describe either a prospective purchase or an existing
 * lift: the customer's explicit situation decides the intake branch.
 */
export function reconcileIntakeContext(
  state: IntakeState,
  history: ChatMessage[],
  currentMessage: string,
): IntakeState {
  const turns = [...currentRequestHistory(history), { role: 'user' as const, content: currentMessage, timestamp: 0 }];
  let data = { ...state.collectedData };
  let situation = data.requestSituation;
  const concerns: string[] = [];
  for (const [index, turn] of turns.entries()) {
    if (turn.role !== 'user') continue;
    const message = turn.content;
    situation = explicitSituation(message) ?? situation;
    data = mergeCollectedData(data, {
      ...inferContactDataFromMessage(message),
      ...inferPhoneContactStatusFromMessage(message),
      ...explicitAnswer(message, turns[index - 1]),
    });
    const lead = inferExplicitLeadContext(message);
    const service = inferExplicitServiceContext(message);
    const preceding = turns[index - 1];
    const descriptionReply = preceding?.role === 'assistant'
      && /beschreibe.*(?:anliegen|anfrage)|worum.*(?:anliegen|anfrage).*geht/i.test(preceding.content)
      && message.trim().split(/\s+/).length >= 3
      && !/^(?:was meinen|was meinst|wie bitte|ich verstehe|danke|weiß nicht|weiss nicht)/i.test(message.trim());
    if (lead || service || descriptionReply) {
      const pastedTranscript = /\*\*S\*\*|(?:Sarah|Nutzer):/.test(message);
      const concern = pastedTranscript && !lead && service
        ? service!.collectedData.issueDescription!
        : message.trim();
      if (!concerns.includes(concern)) concerns.push(concern);
    }
  }
  const openingPattern = /^(?:welcher (?:treppen)?lift passt zu mir|förderung\s*&\s*zuschüsse|service\s*&\s*wartung)[?!.]*$/iu;
  const hasAdvisoryOpening = turns.some((turn) => turn.role === 'user' && openingPattern.test(turn.content.trim()));
  // Model summaries can shrink over a long intake. Preserve the customer's
  // original discovery answers before the first form question as well.
  const formStart = turns.findIndex((turn) => turn.role === 'assistant'
    && /wie (?:ist|lautet).*name|wie heißt du|wie heisst du|e-mail|telefonnummer|kontaktdaten|bereits bestellten lift/i.test(turn.content));
  const discovery = hasAdvisoryOpening ? turns.slice(0, formStart < 0 ? undefined : formStart)
    .filter((turn) => turn.role === 'user' && !openingPattern.test(turn.content.trim())
      && turn.content.trim().split(/\s+/).length >= 3)
    .map((turn) => turn.content.trim()) : [];
  const descriptions: string[] = [];
  for (const part of [...discovery, ...concerns, data.message || data.issueDescription].filter((value): value is string => !!value)) {
    if (descriptions.some((existing) => existing.includes(part))) continue;
    for (let index = descriptions.length - 1; index >= 0; index -= 1) {
      if (part.includes(descriptions[index])) descriptions.splice(index, 1);
    }
    descriptions.push(part);
  }
  const description = hasAdvisoryOpening ? descriptions.join('\n\n')
    : concerns.join('\n\n') || data.message || data.issueDescription;
  if (description) {
    // One customer concern survives transitions between technical service and
    // sales intake, whose submission schemas use different description keys.
    data.message = description;
    data.issueDescription = description;
  }
  // Choosing an informational opening starts discovery, not a handoff. Keep
  // collecting facts without letting a new-lift mention start the form. The
  // model switches to anfrage only after the customer requests a handoff.
  const advisoryConversation = (state.mode === 'berater' || state.mode === 'undetermined')
    && hasAdvisoryOpening;
  const mode = advisoryConversation && (!situation || situation === 'new_lift') ? 'berater'
    : situation === 'new_lift' ? 'anfrage'
    : situation === 'ordered_not_installed' || situation === 'installed_lift' ? 'service'
      : state.mode;
  if (situation) {
    data.requestSituation = situation;
    data.ownsLift = situation === 'installed_lift' ? 'yes' : 'no';
    if (situation === 'ordered_not_installed' && !data.serviceRequestType) {
      data.serviceRequestType = 'sales_contract_order';
      data.category = 'sales';
    }
  }
  if (mode === 'anfrage') {
    const stairType = inferLeadStairType(description ?? '');
    if (stairType) data.stairType = stairType;
  }
  return { ...state, mode, collectedData: data };
}
