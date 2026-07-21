import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertEmailRecipientCheckpoints,
  extractOpportunityCrm,
  extractServiceCrm,
  parseRetentionSchedule,
  requireOpportunityReuse,
  requireServiceReuse,
  type LiveReuseCheckpoint,
  type PipedriveDealField,
} from './live-prior-contact-reuse-helpers.js';

type Json = Record<string, unknown>;
type Checkpoint = LiveReuseCheckpoint & { createdAt?: string };
type ChatResult = {
  label: string;
  sessionId: string;
  requestId: string;
  attempts: number;
  events: Json[];
  checkpoints: Checkpoint[];
  recipients: string[];
};

const confirm = process.env.LIVE_PRIOR_CONTACT_E2E_CONFIRM;
if (confirm !== 'YES') {
  throw new Error('Refusing live CRM/email writes. Set LIVE_PRIOR_CONTACT_E2E_CONFIRM=YES. Test records are retained.');
}

const apiKey = process.env.PIPEDRIVE_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!apiKey || !supabaseUrl || !supabaseKey) {
  throw new Error('PIPEDRIVE_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required');
}

const baseUrl = (process.env.LIVE_E2E_BASE_URL || 'http://187.124.16.6:8085').replace(/\/$/, '');
const runId = process.env.LIVE_E2E_RUN_ID || new Date().toISOString().replace(/\D/g, '').slice(0, 17);
if (!/^[A-Za-z0-9_-]{8,64}$/.test(runId)) throw new Error('LIVE_E2E_RUN_ID must be 8-64 safe identifier characters');
const outputDir = resolve(process.cwd(), 'output', `prior-contact-reuse-${runId}`);
const outputPath = resolve(outputDir, 'evidence.json');
const pdBase = 'https://api.pipedrive.com/v1';
const copyRecipients = ['berg@lippelift.de', 'caechma@gmail.com'];
const salesRecipients = ['sales@lippelift.de', ...copyRecipients];
const supportRecipients = ['technik@lippelift.de', ...copyRecipients];
const maxChatAttempts = integerEnv('LIVE_E2E_CHAT_ATTEMPTS', 4, 1, 8);
const retryDelayMs = integerEnv('LIVE_E2E_RETRY_DELAY_MS', 10_000, 0, 60_000);
const checkpointTimeoutMs = integerEnv('LIVE_E2E_CHECKPOINT_TIMEOUT_MS', 30_000, 1_000, 120_000);
const indexTimeoutMs = integerEnv('LIVE_E2E_INDEX_TIMEOUT_MS', 180_000, 5_000, 600_000);
const retentionSchedule = parseRetentionSchedule(process.env.LIVE_E2E_RETENTION_SCHEDULE_SECONDS);

const sessionIds = {
  salesInitial: `qa-keep-${runId}-sales-initial-session`,
  salesFollowUp: `qa-keep-${runId}-sales-followup-session`,
  supportInitial: `qa-keep-${runId}-support-initial-session`,
  supportFollowUp: `qa-keep-${runId}-support-followup-session`,
};
const requestIds = {
  salesInitial: `qa-keep-${runId}-sales-initial-request`,
  salesFollowUp: `qa-keep-${runId}-sales-followup-request`,
  supportInitial: `qa-keep-${runId}-support-initial-request`,
  supportFollowUp: `qa-keep-${runId}-support-followup-request`,
};
if (new Set(Object.values(sessionIds)).size !== 4 || new Set(Object.values(requestIds)).size !== 4) {
  throw new Error('Cross-session harness requires four distinct sessions and request IDs');
}

const artifact: Json = {
  runId,
  baseUrl,
  label: 'LIPPEBOT QA KEEP',
  createdAt: new Date().toISOString(),
  recordsRetained: true,
  cleanupPerformed: false,
  sessionIds,
  requestIds,
  retentionScheduleSeconds: retentionSchedule,
  phases: {},
};
const phases = artifact.phases as Json;

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing`);
  return value as Json;
}

function entityId(value: unknown, label: string): number {
  const nested = value && typeof value === 'object' ? value as Json : undefined;
  const candidate = nested ? nested.id ?? nested.value : value;
  const id = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} has no positive ID`);
  return id;
}

function scalar(value: unknown): string {
  const nested = value && typeof value === 'object' ? value as Json : undefined;
  return String(nested ? nested.value ?? nested.label ?? '' : value ?? '').trim();
}

function canonical(value: unknown): string {
  return scalar(value).toLowerCase().replace(/\s+/g, ' ');
}

async function pd<T>(path: string, init?: RequestInit): Promise<T> {
  const join = path.includes('?') ? '&' : '?';
  const response = await fetch(`${pdBase}${path}${join}api_token=${encodeURIComponent(apiKey!)}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const payload = await response.json() as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !payload.success) {
    throw new Error(`Pipedrive ${init?.method ?? 'GET'} ${path}: ${response.status} ${payload.error || response.statusText}`);
  }
  return payload.data as T;
}

async function createPd(path: string, body: Json): Promise<number> {
  const created = await pd<Json>(path, { method: 'POST', body: JSON.stringify(body) });
  return entityId(created.id, `Created Pipedrive ${path}`);
}

async function assertHealthy(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/health`);
  const health = await response.json() as Json;
  if (!response.ok
    || health.status !== 'ok'
    || health.pipedrive !== true
    || health.email !== true
    || health.conversationTracking !== true) {
    throw new Error(`Live health preflight failed: ${JSON.stringify(health)}`);
  }
  phases.health = health;
}

async function factoryField(): Promise<PipedriveDealField> {
  const fields = await pd<PipedriveDealField[]>('/dealFields?limit=500');
  const factories = fields.filter((field) => field.name === 'Fabriknummer');
  if (factories.length !== 1) throw new Error(`Expected one Fabriknummer field, found ${factories.length}`);
  return factories[0];
}

async function requestCheckpoints(sessionId: string, requestId: string): Promise<Checkpoint[]> {
  const params = new URLSearchParams({
    session_id: `eq.${sessionId}`,
    event_type: 'eq.request_checkpoint',
    select: 'payload,created_at',
    order: 'created_at.asc',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/conversation_events?${params.toString()}`, {
    headers: { apikey: supabaseKey!, Authorization: `Bearer ${supabaseKey!}` },
  });
  if (!response.ok) throw new Error(`Supabase checkpoint read failed: ${response.status} ${await response.text()}`);
  const rows = await response.json() as Array<{ payload?: Json; created_at?: string }>;
  return rows.flatMap((row) => {
    const payload = row.payload;
    if (!payload || payload.requestId !== requestId || typeof payload.step !== 'string') return [];
    return [{
      step: payload.step,
      result: payload.result && typeof payload.result === 'object' ? payload.result as Json : {},
      createdAt: row.created_at,
    }];
  });
}

async function waitForCheckpoints(
  sessionId: string,
  requestId: string,
  expectedRecipients: string[],
): Promise<Checkpoint[]> {
  const deadline = Date.now() + checkpointTimeoutMs;
  let latest: Checkpoint[] = [];
  while (Date.now() <= deadline) {
    latest = await requestCheckpoints(sessionId, requestId);
    try {
      if (latest.filter((checkpoint) => checkpoint.step === 'crm').length !== 1) throw new Error('CRM pending');
      assertEmailRecipientCheckpoints(latest, expectedRecipients);
      return latest;
    } catch {
      await delay(1_000);
    }
  }
  return latest;
}

function parseSse(raw: string): Json[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith('data: ')) return [];
    try {
      return [JSON.parse(line.slice(6)) as Json];
    } catch {
      throw new Error(`Invalid live SSE event: ${line.slice(0, 160)}`);
    }
  });
}

async function chat(input: {
  label: string;
  sessionId: string;
  requestId: string;
  message: string;
  expectedRecipients: string[];
}): Promise<ChatResult> {
  let lastEvents: Json[] = [];
  let lastCheckpoints: Checkpoint[] = [];
  for (let attempt = 1; attempt <= maxChatAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: input.sessionId,
        requestId: input.requestId,
        message: input.message,
        history: [],
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${input.label} HTTP ${response.status}: ${raw}`);
    lastEvents = parseSse(raw);
    lastCheckpoints = await waitForCheckpoints(input.sessionId, input.requestId, input.expectedRecipients);
    try {
      const recipients = assertEmailRecipientCheckpoints(lastCheckpoints, input.expectedRecipients);
      if (lastCheckpoints.filter((checkpoint) => checkpoint.step === 'crm').length !== 1) {
        throw new Error('CRM checkpoint missing');
      }
      return {
        label: input.label,
        sessionId: input.sessionId,
        requestId: input.requestId,
        attempts: attempt,
        events: lastEvents,
        checkpoints: lastCheckpoints,
        recipients,
      };
    } catch (error) {
      if (attempt >= maxChatAttempts) throw error;
      console.log(JSON.stringify({ phase: input.label, attempt, status: 'retrying_same_request_id' }));
      await delay(retryDelayMs * attempt);
    }
  }
  throw new Error(`${input.label} exhausted attempts (${lastEvents.length} events, ${lastCheckpoints.length} checkpoints)`);
}

async function exactIndexedDeals(term: string, fieldKey: string): Promise<Json[]> {
  const search = await pd<{ items?: Array<{ item?: Json }> }>(
    `/deals/search?term=${encodeURIComponent(term)}&fields=custom_fields&exact_match=false&limit=100`,
  );
  const ids = [...new Set((search.items || []).flatMap((entry) => {
    try {
      return [entityId(entry.item?.id, 'Pipedrive search deal')];
    } catch {
      return [];
    }
  }))];
  const deals = await Promise.all(ids.map((id) => pd<Json>(`/deals/${id}`)));
  return deals.filter((deal) => canonical(deal[fieldKey]) === canonical(term));
}

async function waitForIndexedDeal(input: {
  label: string;
  dealId: number;
  personId: number;
  fieldKey: string;
  value: string;
}): Promise<Json> {
  const deadline = Date.now() + indexTimeoutMs;
  let lastIds: number[] = [];
  let nextProgressAt = 0;
  while (Date.now() <= deadline) {
    const matches = await exactIndexedDeals(input.value, input.fieldKey);
    lastIds = matches.map((deal) => entityId(deal.id, `${input.label} indexed deal`));
    if (lastIds.length > 1 || (lastIds.length === 1 && lastIds[0] !== input.dealId)) {
      throw new Error(`${input.label} reference is ambiguous or points elsewhere: ${lastIds.join(',')}`);
    }
    if (lastIds.length === 1) {
      const deal = matches[0];
      if (entityId(deal.person_id, `${input.label} person`) !== input.personId || deal.status !== 'open') {
        throw new Error(`${input.label} indexed deal has the wrong person or status`);
      }
      return deal;
    }
    if (Date.now() >= nextProgressAt) {
      console.log(JSON.stringify({ phase: input.label, status: 'waiting_for_pipedrive_index' }));
      nextProgressAt = Date.now() + 30_000;
    }
    await delay(5_000);
  }
  throw new Error(`${input.label} was not indexed within ${indexTimeoutMs}ms (matches: ${lastIds.join(',') || 'none'})`);
}

async function searchPersonIds(term: string, fields: 'name' | 'email'): Promise<number[]> {
  const search = await pd<{ items?: Array<{ item?: Json }> }>(
    `/persons/search?term=${encodeURIComponent(term)}&fields=${fields}&exact_match=true&limit=100`,
  );
  return [...new Set((search.items || []).flatMap((entry) => {
    try {
      return [entityId(entry.item?.id, 'Pipedrive person search')];
    } catch {
      return [];
    }
  }))];
}

async function waitForPersonAndDealsIndexed(input: {
  label: string;
  personId: number;
  email: string;
  name?: string;
  expectedOpenDealIds: number[];
}): Promise<void> {
  const deadline = Date.now() + indexTimeoutMs;
  let nextProgressAt = 0;
  while (Date.now() <= deadline) {
    const [emailIds, nameIds, openDeals] = await Promise.all([
      searchPersonIds(input.email, 'email'),
      input.name ? searchPersonIds(input.name, 'name') : Promise.resolve([input.personId]),
      pd<Json[] | null>(`/persons/${input.personId}/deals?status=open`),
    ]);
    const openIds = (openDeals ?? []).map((deal) => entityId(deal.id, `${input.label} open deal`)).sort((a, b) => a - b);
    const expected = [...input.expectedOpenDealIds].sort((a, b) => a - b);
    if (emailIds.length === 1
      && emailIds[0] === input.personId
      && nameIds.includes(input.personId)
      && JSON.stringify(openIds) === JSON.stringify(expected)) return;
    if (emailIds.some((id) => id !== input.personId)) {
      throw new Error(`${input.label} exact email is ambiguous: ${emailIds.join(',')}`);
    }
    if (Date.now() >= nextProgressAt) {
      console.log(JSON.stringify({ phase: input.label, status: 'waiting_for_person_and_deal_index' }));
      nextProgressAt = Date.now() + 30_000;
    }
    await delay(5_000);
  }
  throw new Error(`${input.label} person/deals were not indexed within ${indexTimeoutMs}ms`);
}

function salesMessage(input: { followUp: boolean; name: string; email: string }): string {
  const phase = input.followUp ? 'SALES FOLLOW-UP' : 'SALES INITIAL';
  return [
    `LIPPEBOT QA KEEP - ${phase} - Lauf ${runId}.`,
    'Ich besitze noch keinen Lift und moechte diese Anfrage jetzt verbindlich absenden.',
    input.followUp
      ? 'Ich habe euch bereits geschrieben, habe aber keine Angebots-, Auftrags- oder Vorgangsnummer zur Hand. Dies ist eine neue Unterhaltung und eine Folgeanfrage zum selben Vorgang.'
      : 'Ich habe vorher weder mit euch gesprochen noch geschrieben. Dies ist meine erste Anfrage.',
    `Mein Name ist ${input.name}. Meine E-Mail-Adresse ist ${input.email}.`,
    'Ich gebe nur die E-Mail-Adresse als Kontaktmoeglichkeit an; eine Telefonnummer ist nicht erforderlich.',
    'Privatperson, Treppe innen und gerade, Einfamilienhaus, Sitzlift fuer mich selbst.',
    'Adresse: QA Keep Testweg 21, 32756 Detmold. Erreichbarkeit: 09:00 bis 12:00 Uhr.',
    `Anliegen: LIPPEBOT QA KEEP ${phase} ${runId}.`,
    'Alle Pflichtangaben sind vorhanden. Bitte jetzt absenden und submit_lead aufrufen.',
  ].join(' ');
}

function supportMessage(input: {
  followUp: boolean;
  name: string;
  email: string;
  factoryNumber: string;
}): string {
  const phase = input.followUp ? 'SUPPORT FOLLOW-UP' : 'SUPPORT INITIAL';
  return [
    `LIPPEBOT QA KEEP - ${phase} - Lauf ${runId}.`,
    'Ich besitze bereits einen LIPPE Lift und moechte diese technische Serviceanfrage jetzt verbindlich absenden.',
    `Die Fabriknummer ist ${input.factoryNumber}. Hersteller ist LIPPE Lift. Anfrageart und Kategorie: technische Stoerung/Technik.`,
    input.followUp
      ? 'Ich habe euch dazu bereits geschrieben, habe aber keine Angebots-, Auftrags- oder Vorgangsnummer zur Hand. Dies ist eine neue Unterhaltung und eine Folgeanfrage zum selben Servicefall.'
      : 'Ich habe vorher weder mit euch gesprochen noch geschrieben. Dies ist meine erste Anfrage zu dieser Stoerung.',
    `Kundenname: ${input.name}. E-Mail-Adresse: ${input.email}.`,
    'Ich gebe nur die E-Mail-Adresse als Kontaktmoeglichkeit an; eine Telefonnummer ist nicht erforderlich.',
    `Problembeschreibung: LIPPEBOT QA KEEP ${phase} ${runId}; der Lift stoppt im Test sporadisch.`,
    'Alle Pflichtangaben sind vorhanden. Bitte jetzt absenden und submit_service_request aufrufen.',
  ].join(' ');
}

function requireEntity(value: unknown, expectedId: number, label: string): Json {
  const entity = object(value, label);
  if (entityId(entity.id, label) !== expectedId) throw new Error(`${label} direct ID mismatch`);
  return entity;
}

async function directReadback(input: {
  elapsedSeconds: number;
  factoryField: PipedriveDealField;
  sales: { personId: number; dealId: number };
  support: {
    personId: number;
    sourceDealId: number;
    dealId: number;
    initialNoteId: number;
    followUpNoteId: number;
    factoryNumber: string;
  };
}): Promise<Json> {
  const [
    salesPersonRaw,
    salesDealRaw,
    salesOpenRaw,
    supportPersonRaw,
    supportSourceRaw,
    supportDealRaw,
    supportOpenRaw,
    initialNoteRaw,
    followUpNoteRaw,
    supportDealNotesRaw,
  ] = await Promise.all([
    pd<Json | null>(`/persons/${input.sales.personId}`),
    pd<Json | null>(`/deals/${input.sales.dealId}`),
    pd<Json[] | null>(`/persons/${input.sales.personId}/deals?status=open`),
    pd<Json | null>(`/persons/${input.support.personId}`),
    pd<Json | null>(`/deals/${input.support.sourceDealId}`),
    pd<Json | null>(`/deals/${input.support.dealId}`),
    pd<Json[] | null>(`/persons/${input.support.personId}/deals?status=open`),
    pd<Json | null>(`/notes/${input.support.initialNoteId}`),
    pd<Json | null>(`/notes/${input.support.followUpNoteId}`),
    pd<Json[] | null>(`/notes?deal_id=${input.support.dealId}&limit=500`),
  ]);

  const salesPerson = requireEntity(salesPersonRaw, input.sales.personId, 'Sales person');
  const salesDeal = requireEntity(salesDealRaw, input.sales.dealId, 'Sales deal');
  const salesOpen = salesOpenRaw ?? [];
  if (canonical(salesPerson.name).includes('lippebot') === false || canonical(salesPerson.name).includes('keep') === false) {
    throw new Error('Sales person is not visibly labeled LIPPEBOT QA KEEP');
  }
  if (salesDeal.status !== 'open'
    || entityId(salesDeal.person_id, 'Sales deal person') !== input.sales.personId) {
    throw new Error('Sales direct deal readback does not match its person or status');
  }
  const salesOpenIds = salesOpen.map((deal) => entityId(deal.id, 'Sales open deal')).sort((a, b) => a - b);
  if (JSON.stringify(salesOpenIds) !== JSON.stringify([input.sales.dealId])) {
    throw new Error(`Sales person has unexpected open deals: ${salesOpenIds.join(',')}`);
  }

  const supportPerson = requireEntity(supportPersonRaw, input.support.personId, 'Support person');
  const supportSource = requireEntity(supportSourceRaw, input.support.sourceDealId, 'Support source deal');
  const supportDeal = requireEntity(supportDealRaw, input.support.dealId, 'Support service deal');
  const initialNote = requireEntity(initialNoteRaw, input.support.initialNoteId, 'Initial support note');
  const followUpNote = requireEntity(followUpNoteRaw, input.support.followUpNoteId, 'Follow-up support note');
  const supportOpen = supportOpenRaw ?? [];
  const supportDealNotes = supportDealNotesRaw ?? [];
  if (canonical(supportPerson.name).includes('lippebot qa keep') === false) {
    throw new Error('Support person is not visibly labeled LIPPEBOT QA KEEP');
  }
  if (supportSource.status !== 'open'
    || entityId(supportSource.person_id, 'Support source person') !== input.support.personId
    || canonical(supportSource[input.factoryField.key]) !== canonical(input.support.factoryNumber)) {
    throw new Error('Support source deal direct readback mismatch');
  }
  if (supportDeal.status !== 'open'
    || entityId(supportDeal.person_id, 'Support service person') !== input.support.personId) {
    throw new Error('Support service deal direct readback mismatch');
  }
  const supportOpenIds = supportOpen.map((deal) => entityId(deal.id, 'Support open deal')).sort((a, b) => a - b);
  const expectedSupportOpenIds = [input.support.sourceDealId, input.support.dealId].sort((a, b) => a - b);
  if (JSON.stringify(supportOpenIds) !== JSON.stringify(expectedSupportOpenIds)) {
    throw new Error(`Support person has unexpected open deals: ${supportOpenIds.join(',')}`);
  }
  const expectedNotes = [
    { note: initialNote, id: input.support.initialNoteId, requestId: requestIds.supportInitial },
    { note: followUpNote, id: input.support.followUpNoteId, requestId: requestIds.supportFollowUp },
  ];
  for (const expected of expectedNotes) {
    if (entityId(expected.note.deal_id, `Support note ${expected.id} deal`) !== input.support.dealId
      || !String(expected.note.content || '').includes(`[LIPPEBOT REQUEST:${expected.requestId}]`)) {
      throw new Error(`Support note ${expected.id} is not pinned to the expected request and deal`);
    }
  }
  const supportDealNoteIds = supportDealNotes.map((note) => entityId(note.id, 'Support deal note'));
  if (!expectedNotes.every((expected) => supportDealNoteIds.includes(expected.id))) {
    throw new Error('Support deal note listing does not contain both request-specific notes');
  }

  return {
    elapsedSeconds: input.elapsedSeconds,
    readAt: new Date().toISOString(),
    sales: {
      personId: input.sales.personId,
      dealId: input.sales.dealId,
      openDealIds: salesOpenIds,
      status: salesDeal.status,
      url: `https://lippelift.pipedrive.com/deal/${input.sales.dealId}`,
    },
    support: {
      personId: input.support.personId,
      sourceDealId: input.support.sourceDealId,
      serviceDealId: input.support.dealId,
      noteIds: [input.support.initialNoteId, input.support.followUpNoteId],
      openDealIds: supportOpenIds,
      status: supportDeal.status,
      sourceUrl: `https://lippelift.pipedrive.com/deal/${input.support.sourceDealId}`,
      serviceUrl: `https://lippelift.pipedrive.com/deal/${input.support.dealId}`,
    },
  };
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await assertHealthy();
  const factory = await factoryField();
  phases.fields = { factory: factory.name };
  console.log(JSON.stringify({ runId, label: 'LIPPEBOT QA KEEP', status: 'preflight_passed' }));

  const suffix = runId.slice(-8);
  const salesName = `LIPPEBOT QA KEEP Sales ${suffix}`;
  const salesEmail = `lippebot.qa.keep.sales.${runId}@example.invalid`;
  const salesInitial = await chat({
    label: 'sales_initial',
    sessionId: sessionIds.salesInitial,
    requestId: requestIds.salesInitial,
    message: salesMessage({ followUp: false, name: salesName, email: salesEmail }),
    expectedRecipients: salesRecipients,
  });
  phases.salesInitial = salesInitial;
  const salesInitialCrm = extractOpportunityCrm(salesInitial.checkpoints);
  if (salesInitialCrm.outcome !== 'created') throw new Error(`Fresh sales request was not created: ${salesInitialCrm.outcome}`);
  await waitForPersonAndDealsIndexed({
    label: 'sales_identity_and_case',
    personId: salesInitialCrm.personId,
    name: salesName,
    email: salesEmail,
    expectedOpenDealIds: [salesInitialCrm.dealId],
  });

  const salesFollowUp = await chat({
    label: 'sales_followup_new_session',
    sessionId: sessionIds.salesFollowUp,
    requestId: requestIds.salesFollowUp,
    message: salesMessage({ followUp: true, name: salesName, email: salesEmail }),
    expectedRecipients: salesRecipients,
  });
  phases.salesFollowUp = salesFollowUp;
  const sales = {
    ...requireOpportunityReuse(salesInitialCrm, extractOpportunityCrm(salesFollowUp.checkpoints)),
  };

  const supportName = `LIPPEBOT QA KEEP Support ${suffix}`;
  const supportEmail = `lippebot.qa.keep.support.${runId}@example.invalid`;
  const factoryNumber = `KEEP-FN-${runId}`;
  const supportPersonId = await createPd('/persons', {
    name: supportName,
    email: [{ value: supportEmail, primary: true }],
    visible_to: 3,
  });
  const supportSourceDealId = await createPd('/deals', {
    title: `LIPPEBOT QA KEEP source factory ${runId}`,
    person_id: supportPersonId,
    pipeline_id: 1,
    stage_id: 2,
    value: 0,
    currency: 'EUR',
    status: 'open',
    visible_to: 3,
    [factory.key]: factoryNumber,
  });
  phases.supportFixture = {
    personId: supportPersonId,
    sourceDealId: supportSourceDealId,
    personUrl: `https://lippelift.pipedrive.com/person/${supportPersonId}`,
    sourceUrl: `https://lippelift.pipedrive.com/deal/${supportSourceDealId}`,
  };
  await waitForIndexedDeal({
    label: 'support_source_factory',
    dealId: supportSourceDealId,
    personId: supportPersonId,
    fieldKey: factory.key,
    value: factoryNumber,
  });

  const supportInitial = await chat({
    label: 'support_initial',
    sessionId: sessionIds.supportInitial,
    requestId: requestIds.supportInitial,
    message: supportMessage({
      followUp: false,
      name: supportName,
      email: supportEmail,
      factoryNumber,
    }),
    expectedRecipients: supportRecipients,
  });
  phases.supportInitial = supportInitial;
  const supportInitialCrm = extractServiceCrm(supportInitial.checkpoints);
  if (supportInitialCrm.personId !== supportPersonId || supportInitialCrm.sourceDealId !== supportSourceDealId) {
    throw new Error('Initial support request did not use the exact source fixture person and deal');
  }
  await waitForPersonAndDealsIndexed({
    label: 'support_identity_and_service_case',
    personId: supportPersonId,
    email: supportEmail,
    expectedOpenDealIds: [supportSourceDealId, supportInitialCrm.dealId],
  });

  const supportFollowUp = await chat({
    label: 'support_followup_new_session',
    sessionId: sessionIds.supportFollowUp,
    requestId: requestIds.supportFollowUp,
    message: supportMessage({
      followUp: true,
      name: supportName,
      email: supportEmail,
      factoryNumber,
    }),
    expectedRecipients: supportRecipients,
  });
  phases.supportFollowUp = supportFollowUp;
  const support = {
    ...requireServiceReuse(supportInitialCrm, extractServiceCrm(supportFollowUp.checkpoints)),
    factoryNumber,
  };

  const recipientCheckpointTotals = [salesInitial, salesFollowUp, supportInitial, supportFollowUp]
    .flatMap((result) => result.recipients)
    .reduce((totals, recipient) => {
      totals[recipient] = (totals[recipient] ?? 0) + 1;
      return totals;
    }, {} as Record<string, number>);
  const expectedRecipientCheckpointTotals = {
    'berg@lippelift.de': 4,
    'caechma@gmail.com': 4,
    'sales@lippelift.de': 2,
    'technik@lippelift.de': 2,
  };
  const recipientTotalsMatch = Object.keys(recipientCheckpointTotals).length === Object.keys(expectedRecipientCheckpointTotals).length
    && Object.entries(expectedRecipientCheckpointTotals).every(([recipient, count]) => recipientCheckpointTotals[recipient] === count);
  if (!recipientTotalsMatch) {
    throw new Error(`Aggregate recipient checkpoint mismatch: ${JSON.stringify(recipientCheckpointTotals)}`);
  }
  phases.reuse = { sales, support, recipientCheckpointTotals };

  const retentionStartedAt = Date.now();
  const readbacks: Json[] = [];
  for (const elapsedSeconds of retentionSchedule) {
    await delay(Math.max(0, retentionStartedAt + elapsedSeconds * 1_000 - Date.now()));
    const readback = await directReadback({ elapsedSeconds, factoryField: factory, sales, support });
    readbacks.push(readback);
    console.log(JSON.stringify({ runId, status: 'direct_readback_passed', elapsedSeconds }));
  }
  phases.directReadbacks = readbacks;
  artifact.pass = true;
  artifact.completedAt = new Date().toISOString();
  console.log(JSON.stringify({
    runId,
    outputPath,
    pass: true,
    recipientCheckpointTotals,
    salesDealId: sales.dealId,
    supportSourceDealId: support.sourceDealId,
    supportServiceDealId: support.dealId,
    supportNoteIds: [support.initialNoteId, support.followUpNoteId],
  }, null, 2));
}

try {
  await main();
} catch (error) {
  artifact.pass = false;
  artifact.failedAt = new Date().toISOString();
  artifact.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}
