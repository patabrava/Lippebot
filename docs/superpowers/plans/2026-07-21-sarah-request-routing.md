# Sarah Request Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved ownership-first sales/service workflow with deterministic CRM policy, departmental email routing, request-level idempotency, factory-number guidance, and labeled live Pipedrive/email verification.

**Architecture:** Keep Gemini responsible for conversational collection and move all side-effect decisions into focused backend policy and orchestration modules. The widget owns a persistent active `requestId`; Pipedrive owns exact identity/factory matching and Serviceanfrage writes; the existing Supabase conversation journal provides restart-safe checkpoints; email and CRM completion are gated and idempotent per request.

**Tech Stack:** TypeScript, Hono SSE, Vertex AI Gemini function calls, Pipedrive REST API v1, Nodemailer SMTP, Supabase PostgREST, Vite web component, Vitest, Playwright/browser validation.

---

## File Structure

Create focused modules instead of expanding the already-large route and Pipedrive files further:

- `backend/src/request/request-policy.ts`: pure ownership, service-type, emergency, recipient, and CRM-write policy.
- `backend/src/request/request-journal.ts`: request-scoped durable checkpoints backed by `conversation_events`, with in-memory fallback for tests or disabled tracking.
- `backend/src/request/request-orchestrator.ts`: ordered CRM/readback/email execution and retry behavior.
- `backend/src/request/e2e-marker.ts`: strict extraction and formatting of labeled E2E subjects.
- `backend/src/services/pipedrive.ts`: retain low-level API access and add exact factory-case resolution, sales-pipeline filtering, Serviceanfrage creation/readback, and request-marker reuse.
- `backend/src/routes/chat.ts`: translate model events into request-orchestrator calls and SSE events; remove session-scoped side-effect ownership.
- `backend/src/types/index.ts`: shared request domain types and result contracts.
- `backend/src/services/gemini.ts` and `backend/src/prompts/system-prompt.ts`: collect the approved ownership/manufacturer/factory/service-kind fields and never authorize side effects.
- `backend/src/support/support-routing.ts` and `backend/src/services/email.ts`: actual departmental recipients and exact structured subjects/bodies.
- `backend/src/services/conversation-tracking.ts`: reliable request-checkpoint read/write methods without changing the existing tables.
- `widget/src/storage/history.ts`: persist and rotate active request IDs.
- `widget/src/api/client.ts` and `widget/src/sarah-widget.ts`: send request IDs and render the deterministic factory-label action.
- `widget/public/fabriknummer-hinweis.png`: fixed instructional label image.
- `backend/scripts/live-request-routing-e2e.ts`: fixture creation, labeled chat submissions, Pipedrive readback, and evidence report.
- `backend/scripts/live-request-routing-readback.ts`: read-only reconciliation for reruns and final evidence.

### Task 1: Define the Request Domain and Pure Policy

**Files:**
- Create: `backend/src/request/request-policy.ts`
- Modify: `backend/src/types/index.ts`
- Test: `backend/tests/request-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Cover emergency interruption, ownership branches, service-kind routing, factory-number requirements, CRM-write permission, and all departmental addresses.

```ts
expect(classifyRequestPolicy({ ownsLift: 'no', priorContact: 'no' })).toMatchObject({ kind: 'opportunity' });
expect(classifyRequestPolicy({ ownsLift: 'yes', liftManufacturer: 'other' })).toMatchObject({ crm: 'forbidden' });
expect(classifyRequestPolicy({ ownsLift: 'yes', liftManufacturer: 'lippe', factoryNumberStatus: 'provided', serviceRequestType: 'maintenance' })).toMatchObject({ crm: 'read_only', recipient: 'technik@lippelift.de' });
expect(classifyRequestPolicy({ ownsLift: 'yes', liftManufacturer: 'lippe', factoryNumberStatus: 'provided', serviceRequestType: 'invoice_payment' })).toMatchObject({ crm: 'create_service_request', recipient: 'finance@lippelift.de' });
expect(detectEmergency('Eine Person steckt im Lift fest')).toEqual({ emergency: true, show112: true });
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run: `cd backend && npm test -- tests/request-policy.test.ts`

Expected: FAIL because the policy module and new fields do not exist.

- [ ] **Step 3: Add the domain contracts**

Add these stable types to `backend/src/types/index.ts`:

```ts
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type LiftManufacturer = 'lippe' | 'other' | 'unknown';
export type FactoryNumberStatus = 'provided' | 'unavailable' | 'unknown';
export type ServiceRequestType =
  | 'maintenance'
  | 'repair'
  | 'technical'
  | 'invoice_payment'
  | 'sales_contract_order'
  | 'spare_parts_installation_warranty';
export type RequestLifecycle = 'collecting' | 'matching' | 'ready' | 'processing' | 'completed' | 'failed';

export interface RequestContext {
  requestId: string;
  ownsLift?: YesNoUnknown;
  liftManufacturer?: LiftManufacturer;
  factoryNumber?: string;
  factoryNumberStatus?: FactoryNumberStatus;
  serviceRequestType?: ServiceRequestType;
}
```

Extend `LeadData` with `ownsLift?: YesNoUnknown`. Extend `SupportData` with the four lift/service fields. Add `requestId` to `ChatRequest` and to internal handoff result contracts.

- [ ] **Step 4: Implement the pure policy**

`classifyRequestPolicy()` returns one explicit outcome:

```ts
export type CrmPermission = 'sales_opportunity' | 'forbidden' | 'read_only' | 'create_service_request';

export interface RequestPolicy {
  kind: 'opportunity' | 'service';
  crm: CrmPermission;
  recipient?: SupportInbox;
  needsFactoryNumber: boolean;
}
```

Map maintenance/repair/technical to `technik@`, invoice/payment to `finance@`, sales/contract/order to `sales@`, and spare parts/installation/warranty to `lossau@`. `detectEmergency()` must use focused German phrases for trapped persons, injuries, fire/smoke, and immediate danger, while excluding ordinary non-urgent fault language.

- [ ] **Step 5: Run the test and commit**

Run: `cd backend && npm test -- tests/request-policy.test.ts`

Expected: PASS.

Commit: `feat: define deterministic request routing policy`

### Task 2: Stabilize Gemini Collection and Customer Wording

**Files:**
- Modify: `backend/src/services/gemini.ts`
- Modify: `backend/src/prompts/system-prompt.ts`
- Test: `backend/tests/gemini.test.ts`
- Test: `backend/tests/system-prompt.test.ts`

- [ ] **Step 1: Add failing tool-contract and prompt tests**

Assert that `report_state`, `submit_lead`, and `submit_service_request` expose the new enums; lead submission requires `ownsLift=no`; service submission requires ownership/manufacturer/service type and either a provided factory number or explicit unavailability for LIPPE lifts. Assert the exact original branch order and emergency wording.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend && npm test -- tests/gemini.test.ts tests/system-prompt.test.ts`

Expected: FAIL on missing fields and rules.

- [ ] **Step 3: Update the function schemas**

Add reusable schema properties:

```ts
const ownsLiftProperty = { type: STRING, enum: ['yes', 'no', 'unknown'] };
const manufacturerProperty = { type: STRING, enum: ['lippe', 'other', 'unknown'] };
const factoryStatusProperty = { type: STRING, enum: ['provided', 'unavailable', 'unknown'] };
const serviceTypeProperty = {
  type: STRING,
  enum: ['maintenance', 'repair', 'technical', 'invoice_payment', 'sales_contract_order', 'spare_parts_installation_warranty'],
};
```

Validate submissions before yielding them. Invalid submissions return a function response that asks for exactly the next missing decision and does not imply backend success.

- [ ] **Step 4: Replace the prompt flow with the approved contract**

The prompt must state:

1. general advice stays in `berater` without the workflow;
2. actionable handoff starts with lift ownership;
3. no lift routes to opportunity and asks prior employee contact about this purchase;
4. owned lift asks LIPPE vs other;
5. LIPPE asks for factory number after showing backend-controlled help;
6. factory unavailability is allowed;
7. one contact method is sufficient;
8. Sarah never claims success from the function response; the route appends success only after required writes.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd backend && npm test -- tests/gemini.test.ts tests/system-prompt.test.ts`

Expected: PASS.

Commit: `feat: collect ownership and factory routing data`

### Task 3: Implement Safe Sales Matching Semantics

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Add failing sales tests**

Add cases proving:

- name candidates are established before phone/email corroboration;
- name alone never links;
- `priorContact=yes` with no unique existing sales opportunity returns `identity_review` and creates nothing;
- `priorContact=no` with no existing person creates a person/opportunity;
- open deals are filtered to the configured sales pipeline;
- service deals never count as sales opportunities;
- multiple open sales opportunities return review with no note/person/deal mutation.

- [ ] **Step 2: Run the failing Pipedrive slice**

Run: `cd backend && npm test -- tests/pipedrive.test.ts`

Expected: FAIL on prior-contact and cross-pipeline cases.

- [ ] **Step 3: Refactor identity matching**

Change `resolveLeadIdentity()` to establish normalized name candidates first, then intersect them with normalized phone results, then email results. Strong identifiers that identify a person outside the name candidate set produce `conflicting_contact_identifiers`.

Change `getOpenPersonDeals()` to accept a pipeline filter and return only open deals whose `pipeline_id` equals the configured sales pipeline. Apply the same filter to reference matches.

Before person creation:

```ts
if (data.priorContact === 'yes' && identity.status !== 'unique' && reference.status !== 'unique') {
  return { outcome: 'identity_review', reason: 'prior_contact_case_not_found', candidateCount: 0 };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- tests/pipedrive.test.ts`

Expected: PASS.

Commit: `fix: enforce prior-contact sales case matching`

### Task 4: Add Exact Factory-Case Resolution

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/src/types/index.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Add failing factory-number tests**

Mock `/dealFields`, `/deals/search`, and `/deals/{id}`. Cover exact one, zero, multiple, unrelated-custom-field false positives, missing person, closed source cases, and API failure.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd backend && npm test -- tests/pipedrive.test.ts -t 'factory'`

Expected: FAIL because `resolveFactoryCase` does not exist.

- [ ] **Step 3: Implement exact resolver**

Add:

```ts
export type FactoryCaseResult =
  | { matchState: 'unique'; personId: number; dealId: number; factoryNumber: string }
  | { matchState: 'unresolved'; candidateCount: 0 }
  | { matchState: 'ambiguous'; candidateCount: number };
```

Cache the unique deal-field key whose name is exactly `Fabriknummer`. Search `custom_fields`, fetch every candidate deal, compare only that field using Unicode normalization, trim, case folding, and whitespace normalization, then deduplicate by deal ID. A missing-person match is ambiguous and never writable.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- tests/pipedrive.test.ts -t 'factory'`

Expected: PASS.

Commit: `feat: resolve service cases by exact factory number`

### Task 5: Create and Read Back the Exact Serviceanfrage Deal

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/.env.example`
- Modify: `deploy/hostinger-lippebot-demo.compose.yml`
- Test: `backend/tests/config.test.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Add failing destination and creation tests**

Assert live metadata mapping and exact write payload:

```ts
expect(dealBody).toMatchObject({
  title: 'Serviceanfrage - Erika Muster',
  person_id: 321,
  pipeline_id: 1,
  stage_id: 2,
  user_id: 24093328,
  value: 0,
  currency: 'EUR',
  status: 'open',
});
```

Assert that a request marker finds and reuses an existing Serviceanfrage on retry, the structured note contains the original deal URL/ID and transcript, and post-create readback rejects a wrong pipeline/stage/owner/person/value.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend && npm test -- tests/config.test.ts tests/pipedrive.test.ts -t 'Serviceanfrage|service destination'`

- [ ] **Step 3: Add configuration and metadata verification**

Add defaults:

```env
PIPEDRIVE_SERVICE_PIPELINE_ID=1
PIPEDRIVE_SERVICE_STAGE_ID=2
PIPEDRIVE_SERVICE_OWNER_ID=24093328
```

Before the first Serviceanfrage write, verify through `/pipelines`, `/stages`, and `/users/{id}` that the IDs map to `Akquise`, `Kontaktieren`, and `Marco Lossau`. Cache only a successful verification.

- [ ] **Step 4: Implement idempotent create plus readback**

Add `createServiceRequest({ requestId, data, sourceCase, transcript })`. Search existing notes/deals for the exact request marker first. Create the deal, create one pinned structured note, fetch the deal and note back, validate all required fields, and return both source and created deal IDs/URLs. Never update the source deal or person.

- [ ] **Step 5: Run tests and commit**

Run: `cd backend && npm test -- tests/config.test.ts tests/pipedrive.test.ts`

Expected: PASS.

Commit: `feat: create exact Pipedrive service request deals`

### Task 6: Add Durable Request Checkpoints

**Files:**
- Modify: `backend/src/services/conversation-tracking.ts`
- Create: `backend/src/request/request-journal.ts`
- Test: `backend/tests/conversation-tracking.test.ts`
- Test: `backend/tests/request-journal.test.ts`

- [ ] **Step 1: Write failing checkpoint tests**

Cover request lookup after a new service instance, CRM checkpoint reuse, email checkpoint reuse, failure recording, and two request IDs in one session.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd backend && npm test -- tests/conversation-tracking.test.ts tests/request-journal.test.ts`

- [ ] **Step 3: Extend the tracker with reliable checkpoint I/O**

Add methods that do not swallow errors:

```ts
getRequestEvents(sessionId: string, requestId: string): Promise<RequestCheckpoint[]>;
recordRequestCheckpoint(input: { sessionId: string; requestId: string; step: 'crm' | 'email' | 'completed' | 'failed'; payload: Record<string, unknown> }): Promise<void>;
```

Store checkpoints as `conversation_events` rows with event type `request_checkpoint`. Query by session and filter exact `payload.requestId` in the returned JSON. Keep existing best-effort tracking methods unchanged.

- [ ] **Step 4: Implement the journal**

`createRequestJournal()` combines persistent checkpoints with in-process locks. `runStep(requestId, step, operation)` returns the recorded payload when completed, shares an in-flight promise for concurrent duplicates, and records success only after the operation resolves.

- [ ] **Step 5: Run tests and commit**

Run: `cd backend && npm test -- tests/conversation-tracking.test.ts tests/request-journal.test.ts`

Expected: PASS.

Commit: `feat: persist request-level completion checkpoints`

### Task 7: Build the Deterministic Request Orchestrator

**Files:**
- Create: `backend/src/request/request-orchestrator.ts`
- Test: `backend/tests/request-orchestrator.test.ts`

- [ ] **Step 1: Write the failing orchestration matrix**

Use mocked Pipedrive, email, and journal services. Cover every policy branch, exact call order, email-only no-CRM assertions, CRM-readback-before-email, departmental recipient, retry after email failure, and no duplicate Serviceanfrage.

- [ ] **Step 2: Run and verify failure**

Run: `cd backend && npm test -- tests/request-orchestrator.test.ts`

- [ ] **Step 3: Implement one explicit execution method**

```ts
execute(input: {
  sessionId: string;
  requestId: string;
  mode: Mode;
  leadData?: LeadData;
  supportData?: SupportData;
  transcript: string;
}): Promise<RequestExecutionResult>;
```

Opportunity branches call `createLead`. Service branches call the pure policy, optionally call `resolveFactoryCase`, optionally create/read back a Serviceanfrage, then send exactly one completed email to the policy recipient. Unresolved factory cases and third-party lifts never call a Pipedrive mutation method. Maintenance/repair never call any Pipedrive mutation method.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- tests/request-orchestrator.test.ts`

Expected: PASS.

Commit: `feat: orchestrate request side effects deterministically`

### Task 8: Route Emails to Real Departments with Traceable Subjects

**Files:**
- Create: `backend/src/request/e2e-marker.ts`
- Modify: `backend/src/support/support-routing.ts`
- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/support-routing.test.ts`
- Test: `backend/tests/email.test.ts`

- [ ] **Step 1: Add failing subject/body/recipient tests**

Assert normal subjects include request ID/category/customer and E2E input produces:

`[LIPPEBOT E2E][UC-11][20260721-a] LIPPE exact match - technical service`

Assert the body contains request ID, manufacturer, factory number, match status, original-case URL, new Serviceanfrage URL, and request transcript. Assert HTML/header escaping and no guessed link.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend && npm test -- tests/support-routing.test.ts tests/email.test.ts`

- [ ] **Step 3: Implement strict marker extraction and structured mail**

Accept only `\[LIPPEBOT E2E\]\[UC-\d{2}\]\[[A-Za-z0-9-]+\]` from controlled test content. Normal subjects use `Sarah [<category>] [<requestId>]: <customer>`. The orchestrator passes the policy recipient directly; `SERVICE_EMAIL_TO` remains only for abandoned-chat summaries and is not used for completed service requests.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- tests/support-routing.test.ts tests/email.test.ts`

Expected: PASS.

Commit: `feat: route structured request emails by department`

### Task 9: Integrate Request IDs, Emergency Interruption, and Completion Gating in Chat

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Add failing route tests**

Cover request ID validation, immediate emergency response without Gemini/CRM/email, deterministic factory-help action, email-only completion, CRM-required completion, backend failure returning error without `done`, two request IDs in one session, and retry of the same request ID.

- [ ] **Step 2: Run route tests and verify failure**

Run: `cd backend && npm test -- tests/integration.test.ts`

- [ ] **Step 3: Replace session-scoped side-effect maps**

The route passes complete request/transcript data to the orchestrator. Session-scoped maps may remain only for streaming/transient locks that do not define durable completion. The route emits:

```json
{"type":"action","action":"request_completed","data":{"requestId":"..."}}
```

only after the orchestrator succeeds. It emits `show_factory_number_help` once per request when LIPPE ownership is known and factory status remains unknown. A failed required step emits an error and never emits `done` or `request_completed`.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend && npm test -- tests/integration.test.ts`

Expected: PASS.

Commit: `feat: gate chat completion by request outcome`

### Task 10: Add Persistent Widget Request IDs and Factory-Number Guidance

**Files:**
- Modify: `widget/src/storage/history.ts`
- Modify: `widget/src/api/client.ts`
- Modify: `widget/src/sarah-widget.ts`
- Modify: `widget/src/styles/theme.ts`
- Create: `widget/public/fabriknummer-hinweis.png`
- Test: `widget/tests/history.test.ts`
- Test: `widget/tests/client.test.ts`
- Test: `widget/tests/sarah-widget.test.ts`

- [ ] **Step 1: Generate the fixed instructional image**

Use the image-generation tool to create a clear, non-photorealistic German instructional graphic showing a generic LIPPE Lift product label with the field `Fabriknummer` highlighted. It must not depict a real customer serial number. Save the verified asset as `widget/public/fabriknummer-hinweis.png`.

- [ ] **Step 2: Write failing widget tests**

Assert `ChatHistory.getRequestId()` persists, `completeRequest(id)` increments only the matching active ID, `sendMessage()` includes `requestId`, `show_factory_number_help` renders the fixed image with alt text, and `request_completed` rotates the ID while retaining messages/contact context.

- [ ] **Step 3: Run widget tests and verify failure**

Run: `cd widget && npm test`

- [ ] **Step 4: Implement request persistence and action rendering**

Store `requestSequence` and `activeRequestId` in the existing history object. Render the image through a dedicated DOM method using a fixed same-origin source `${apiOrigin}/fabriknummer-hinweis.png`; never render an arbitrary model-provided image URL.

- [ ] **Step 5: Run tests/build and commit**

Run: `cd widget && npm test && npm run build`

Expected: 22 existing tests plus new tests PASS; Vite copies the image into `dist`.

Commit: `feat: isolate chat concerns and show factory label help`

### Task 11: Complete Automated Regression and Deployment Configuration

**Files:**
- Modify: tests affected by upstream contract changes
- Modify: `deploy/hostinger-lippebot-demo.compose.yml`
- Modify: `docs/superpowers/specs/2026-07-21-sarah-request-routing-design.md` only if implementation reveals a factual correction

- [ ] **Step 1: Run the complete automated block**

Run:

```bash
cd backend && npm test && npm run build
cd ../widget && npm test && npm run build
```

Expected: all test files pass, zero TypeScript errors, and the widget asset exists in `widget/dist/fabriknummer-hinweis.png`.

- [ ] **Step 2: Repair and rerun the same block until green**

Treat every failure as incomplete. Preserve upstream completed-email behavior unless the approved routing contract intentionally changes it.

- [ ] **Step 3: Commit the integrated implementation**

Commit: `feat: implement Sarah ownership request workflow`

### Task 12: Build the Labeled Live E2E Harness

**Files:**
- Create: `backend/scripts/live-request-routing-e2e.ts`
- Create: `backend/scripts/live-request-routing-readback.ts`
- Modify: `backend/package.json`
- Test: `backend/tests/e2e-marker.test.ts`

- [ ] **Step 1: Add scripts with safe explicit gates**

The writer script requires `LIVE_E2E_CONFIRM=YES`, a run ID, API URL, Pipedrive credentials, and SMTP-backed live deployment. It creates only clearly labeled synthetic fixtures, submits the 17 spec cases to the real `/api/chat` endpoint, and writes JSON evidence to `output/live-request-routing-<run-id>.json`.

- [ ] **Step 2: Implement exact before/after reconciliation**

For CRM-writing cases record person/deal/note IDs and read back title, pipeline, stage, owner, value, factory source, URLs, marker, and counts. For email-only cases record before/after person/deal/note/activity counts and fail on unexpected mutation. Never print API keys or SMTP credentials.

- [ ] **Step 3: Add deterministic cleanup support without auto-deleting evidence**

Provide `--cleanup <run-id>` as a separate explicit command. Do not delete live evidence during the verification run; retain it for user inspection.

- [ ] **Step 4: Test and commit**

Run: `cd backend && npm test -- tests/e2e-marker.test.ts && npm run build`

Commit: `test: add labeled live request routing matrix`

### Task 13: Deploy and Execute the Mandatory Live Regression Block

**Files:**
- Evidence output only: `output/live-request-routing-<run-id>.json`

- [ ] **Step 1: Publish the verified branch**

Push `codex/sarah-request-routing`, integrate it into `main` only after the branch test block is green, push `main`, restart Hostinger project `lippebot-demo`, and verify `http://187.124.16.6:8085/api/health` reports Pipedrive, email, and conversation tracking enabled.

- [ ] **Step 2: Run the 17 labeled live cases**

Use subjects exactly shaped as `[LIPPEBOT E2E][UC-<number>][<run-id>] <use-case name>`. Exercise the real chat endpoint for all cases from the spec. Use the real browser widget for factory-image rendering and the sequential-two-concern flow.

- [ ] **Step 3: Read back Pipedrive and email evidence**

Run the readback script, open every created/reused Pipedrive deal URL, verify exact Serviceanfrage formatting, and use the connected Gmail/sender mailbox to verify each subject and recipient where mailbox access permits. SMTP acceptance without a matching subject record is not sufficient when mailbox readback is available.

- [ ] **Step 4: Repair failures and rerun the affected complete live block**

Any mismatch in recipient, subject, deal title, pipeline, stage, owner, value, person, source-case link, note, transcript, factory number, mutation count, or request independence is a failure. Fix, redeploy, and rerun the full affected case family.

- [ ] **Step 5: Produce the final use-case evidence table**

Report each UC subject, request ID, expected result, actual email recipient, Pipedrive person/source/service IDs and links, mutation counts, and pass/fail. Do not claim completion while any required row is missing.
