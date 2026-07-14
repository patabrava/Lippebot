# Prior-Contact Case Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask both sales and support users whether they previously contacted Lippelift, collect an exact reference first when they did, and safely reuse the referenced open Pipedrive case without ever requesting both email and telephone.

**Architecture:** Add one shared prior-contact status validator used by Gemini and the chat route. Carry the status and optional reference through tool calls, conversation state, CRM notes, and internal emails. Resolve exact deal references before the existing person/single-open-deal fallback, while preserving identity-conflict review, transcript persistence, deep links, and generic browser responses.

**Tech Stack:** TypeScript, Hono, Vertex AI Gemini function calls, Pipedrive REST API v1, Nodemailer, Vitest, Hostinger Docker Compose.

---

### Task 1: Add prior-contact data and enforce the Gemini conversation contract

**Files:**
- Create: `backend/src/contact/prior-contact.ts`
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/prompts/system-prompt.ts`
- Modify: `backend/src/services/gemini.ts`
- Test: `backend/tests/prior-contact.test.ts`
- Test: `backend/tests/system-prompt.test.ts`
- Test: `backend/tests/gemini.test.ts`

- [ ] **Step 1: Write the failing status-validator tests**

Create `backend/tests/prior-contact.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasPriorContactStatus } from '../src/contact/prior-contact.js';

describe('hasPriorContactStatus', () => {
  it.each(['yes', 'no', 'unknown'])('accepts %s', (priorContact) => {
    expect(hasPriorContactStatus({ priorContact })).toBe(true);
  });

  it.each([{}, { priorContact: '' }, { priorContact: 'maybe' }])('rejects invalid input', (data) => {
    expect(hasPriorContactStatus(data)).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing prompt and tool-schema tests**

Extend `backend/tests/system-prompt.test.ts` to require the exact shared question, reference-first follow-up, inference rules, the `unknown` non-blocking path, and the existing one-contact-method rule:

```ts
expect(prompt).toContain('Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?');
expect(prompt).toContain('Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?');
expect(prompt).toContain('Welche E-Mail-Adresse oder Telefonnummer hast du damals verwendet?');
expect(prompt).toContain('Frage nicht erneut, wenn');
expect(prompt).toContain('unknown');
```

Extend `backend/tests/gemini.test.ts` to assert `priorContact` is an enum and required on both submission tools, and that `priorContactReference` exists on `report_state`, `submit_lead`, and `submit_service_request`:

```ts
expect(leadDeclaration.parameters.properties.priorContact.enum).toEqual(['yes', 'no', 'unknown']);
expect(leadDeclaration.parameters.required).toContain('priorContact');
expect(serviceDeclaration.parameters.required).toContain('priorContact');
expect(leadDeclaration.parameters.properties.priorContactReference).toBeDefined();
```

Add a streamed-call test where Gemini calls either submission function without `priorContact`; assert no lead/service event is yielded, the premature success text is suppressed, and the follow-up function response contains `needsPriorContact: true`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/prior-contact.test.ts tests/system-prompt.test.ts tests/gemini.test.ts
```

Expected: FAIL because the shared type, validator, prompt instructions, and tool fields do not exist.

- [ ] **Step 4: Add the shared types and validator**

Add to `backend/src/types/index.ts`:

```ts
export type PriorContactStatus = 'yes' | 'no' | 'unknown';

// Add to LeadData and SupportData:
priorContact?: PriorContactStatus;
priorContactReference?: string;
```

Create `backend/src/contact/prior-contact.ts`:

```ts
import type { PriorContactStatus } from '../types/index.js';

const statuses = new Set<PriorContactStatus>(['yes', 'no', 'unknown']);

export function hasPriorContactStatus(value: unknown): value is { priorContact: PriorContactStatus } {
  if (typeof value !== 'object' || value === null) return false;
  return statuses.has((value as { priorContact?: PriorContactStatus }).priorContact as PriorContactStatus);
}
```

- [ ] **Step 5: Add the natural prompt flow**

Update both funnel sections in `backend/src/prompts/system-prompt.ts` so Sarah:

```text
- asks “Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?” once before contact details;
- infers yes/no from explicit wording and skips redundant questions;
- after yes asks “Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?”;
- treats any supplied invoice/customer/order/offer/lead/contract/payment/spare-part reference as the reference answer;
- when no reference exists later asks for either the prior email or telephone, never both;
- records unknown and continues when the user cannot or will not answer;
- never lets no bypass normal duplicate protection.
```

Add `Prior contact` to the sales and support collection lists and place it before preferred contact method in the sales sequence.

- [ ] **Step 6: Enforce prior-contact fields in Gemini**

In `backend/src/services/gemini.ts`, add both properties to all relevant schemas:

```ts
priorContact: {
  type: FunctionDeclarationSchemaType.STRING,
  enum: ['yes', 'no', 'unknown'],
},
priorContactReference: { type: FunctionDeclarationSchemaType.STRING },
```

Add `priorContact` to the required arrays for `submit_lead` and `submit_service_request`. Import `hasPriorContactStatus`, include it in premature-success suppression, and validate it before `hasContactMethod`:

```ts
if (!hasPriorContactStatus(call.args)) {
  functionResponses.push({
    functionResponse: {
      name: call.name,
      response: {
        success: false,
        needsPriorContact: true,
        message: 'Kläre zuerst mit genau einer natürlichen Frage, ob die Person wegen dieses Anliegens schon Kontakt mit uns hatte. Wenn sie es nicht weiß oder nicht sagen möchte, verwende unknown.',
      },
    },
  });
  continue;
}
```

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/prior-contact.test.ts tests/system-prompt.test.ts tests/gemini.test.ts
```

Expected: all prior-contact prompt and Gemini tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/contact/prior-contact.ts backend/src/types/index.ts backend/src/prompts/system-prompt.ts backend/src/services/gemini.ts backend/tests/prior-contact.test.ts backend/tests/system-prompt.test.ts backend/tests/gemini.test.ts
git commit -m "feat: collect prior contact before handoff"
```

### Task 2: Resolve exact lead references before the normal identity fallback

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing lead-reference tests**

Add focused tests that mock `/deals/search`, `/persons/search`, `/persons/:id`, `/persons/:id/deals`, person update, and note creation. Cover:

```ts
expect(await service.createLead({
  priorContact: 'yes',
  priorContactReference: 'ANG-TEST-42',
  email: 'returning@example.de',
  // existing required lead fields
})).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
```

Assert the selected deal receives a pinned note even when person `321` has another open deal. Add tests proving:

- duplicate search hits for deal `456` are deduplicated;
- reference deal person `321` plus exact email person `654` returns `identity_review` with no mutations;
- two open reference deals return review and create no person/deal/note;
- a closed reference match is ignored and never reopened;
- a `/deals/search` failure propagates and produces no mutations.

- [ ] **Step 2: Run the lead reference tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts -t "reference"
```

Expected: FAIL because lead creation does not search deal references.

- [ ] **Step 3: Add reference resolution helpers**

In `backend/src/services/pipedrive.ts`, extend `DealSearchItem` as needed and add:

```ts
type LeadReferenceResolution =
  | { status: 'none' }
  | { status: 'unique'; personId: number; dealId: number }
  | { status: 'ambiguous'; candidateCount: number; reason: string };

function caseIdentifiers(data: Pick<LeadData, 'priorContactReference'> | SupportData): string[] {
  const values = [
    data.priorContactReference,
    'customerNumber' in data ? data.customerNumber : undefined,
    'invoiceNumber' in data ? data.invoiceNumber : undefined,
    'orderNumber' in data ? data.orderNumber : undefined,
    'offerNumber' in data ? data.offerNumber : undefined,
    'leadId' in data ? data.leadId : undefined,
    'contractReference' in data ? data.contractReference : undefined,
    'paymentReference' in data ? data.paymentReference : undefined,
    'sparePartReference' in data ? data.sparePartReference : undefined,
  ];
  return [...new Set(values.filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim()).filter((value) => value.length >= 2))];
}
```

Search each reference with `fields=custom_fields&exact_match=true`, deduplicate by deal ID, filter to open deals, and return a unique person/deal only when the deal has a person. Search failures must propagate.

- [ ] **Step 4: Apply reference precedence safely in createLead**

Resolve both the reference and existing identity before mutation. Implement these branches:

```ts
if (reference.status === 'ambiguous') {
  return { outcome: 'identity_review', candidateCount: reference.candidateCount, reason: reference.reason };
}
if (reference.status === 'unique') {
  if (identity.status === 'unique' && identity.personId !== reference.personId) {
    return { outcome: 'identity_review', candidateCount: 2, reason: 'reference_contact_conflict' };
  }
  if (identity.status === 'ambiguous' && ['conflicting_contact_identifiers', 'ambiguous_contact_identifier'].includes(identity.reason)) {
    return { outcome: 'identity_review', candidateCount: identity.candidateCount, reason: identity.reason };
  }
  await updatePerson(reference.personId, ...);
  await createPinnedLeadNote(reference.personId, reference.dealId, data);
  return { outcome: 'reused', personId: reference.personId, dealId: reference.dealId };
}
```

Keep the current exact contact/name and zero/one/multiple-open-deal logic unchanged when no reference resolves.

- [ ] **Step 5: Include prior-contact context in lead notes**

Extend `buildLeadFollowUpNote()` and the initial deal note with escaped lines:

```ts
`Vorheriger Kontakt: ${data.priorContact ?? 'unknown'}`
data.priorContactReference ? `Referenz: ${escapeHtml(data.priorContactReference)}` : ''
```

- [ ] **Step 6: Run all Pipedrive tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: all existing case reuse, Berlin timestamp, transcript, and new reference tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/pipedrive.ts backend/tests/pipedrive.test.ts
git commit -m "feat: route returning leads by exact reference"
```

### Task 3: Make support reference routing conflict-safe and observable

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/src/support/support-routing.ts`
- Test: `backend/tests/pipedrive.test.ts`
- Test: `backend/tests/support-routing.test.ts`

- [ ] **Step 1: Write failing support reference tests**

Add tests where `priorContactReference: 'CASE-TEST-17'` resolves one open deal. Assert `resolveSupportPerson()` returns its person and deal. Add conflict coverage where the exact reference points to person `321` while exact email/name points to `654`; expect `ambiguous` and no note mutation. Add multiple-reference-deal and closed-deal cases.

Extend support note/email tests:

```ts
expect(note).toContain('Vorheriger Kontakt: yes');
expect(note).toContain('Referenz: CASE-TEST-17');
expect(html).toContain('Vorheriger Kontakt');
expect(html).toContain('CASE-TEST-17');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts tests/support-routing.test.ts -t "prior|reference|Referenz"
```

Expected: FAIL because the generic reference is not searched or rendered.

- [ ] **Step 3: Rework support deal resolution around global exact references**

Replace candidate-first filtering in `resolveSupportDeal()` with:

```ts
const openReferenceDeals = dedupe(allReferenceMatches).filter(isOpenDeal);
if (openReferenceDeals.length > 1) {
  return { matchState: 'ambiguous', candidateCount: openReferenceDeals.length };
}
if (openReferenceDeals.length === 1) {
  const personId = getDealPersonId(openReferenceDeals[0]);
  if (!personId) return { matchState: 'ambiguous', dealId: openReferenceDeals[0].id, candidateCount: 1 };
  if (candidateSet.size > 0 && !candidateSet.has(personId)) {
    return { matchState: 'ambiguous', candidateCount: candidateSet.size + 1 };
  }
  return { matchState: 'unique', personId, dealId: openReferenceDeals[0].id, candidateCount: 1 };
}
```

Only after no reference resolves should the existing unique-person/single-open-deal fallback run.

- [ ] **Step 4: Render prior-contact support context**

In `buildSupportNoteContent()` add lines for the status and reference. In `buildSupportEmailHtml()` add escaped rows for the same values. Preserve the current Pipedrive deep link and manual-review behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts tests/support-routing.test.ts
```

Expected: all support identity, reference, note, email, and deep-link tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/pipedrive.ts backend/src/support/support-routing.ts backend/tests/pipedrive.test.ts backend/tests/support-routing.test.ts
git commit -m "feat: route support by exact prior reference"
```

### Task 4: Guard route handoffs and expose prior-contact context internally only

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/integration.test.ts`
- Test: `backend/tests/email.test.ts`

- [ ] **Step 1: Write failing route and email tests**

Add integration tests proving lead and support handoffs without a valid `priorContact` do not call Pipedrive. Expect a customer-safe action status `needs_prior_contact`. Add valid returning fixtures with only email plus a reference and assert the full data reaches `createLead()` or `resolveSupportPerson()`.

Assert browser SSE contains none of:

```ts
['priorContactReference', 'personId', 'dealId', 'identity_review', 'Pipedrive']
```

Add lead email assertions for escaped prior-contact status and reference while preserving the exact deal link.

- [ ] **Step 2: Run route/email tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/integration.test.ts tests/email.test.ts
```

Expected: new invalid-status and internal-context tests fail.

- [ ] **Step 3: Add route validation without changing successful client responses**

Import `hasPriorContactStatus` in `backend/src/routes/chat.ts`. Before existing field validation in both emitters, return:

```ts
{ type: 'action', action: 'create_lead', data: { status: 'needs_prior_contact' } }
```

or the corresponding `create_service` action. Add `needs_prior_contact` to both internal client result unions. Include `priorContactReference` in `hasSupportDisambiguator()`.

Keep successful actions exactly `{ status: 'accepted' }`, keep CRM details internal, and do not change post-stream transcript persistence.

- [ ] **Step 4: Render prior-contact context in lead email**

Add escaped internal-only rows in `sendLeadNotification()`:

```ts
${data.priorContact ? row('Vorheriger Kontakt', data.priorContact) : ''}
${data.priorContactReference ? row('Referenz', data.priorContactReference) : ''}
```

Use an escaping helper rather than interpolating raw user values. Preserve current CRM outcome and Pipedrive-deal-link rows.

- [ ] **Step 5: Update existing complete integration fixtures**

Add `priorContact: 'unknown'` to legacy complete lead/support fixtures. Use `yes` plus `priorContactReference` in returning-case fixtures. Do not add both email and telephone merely to satisfy tests.

- [ ] **Step 6: Run route/email tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/integration.test.ts tests/email.test.ts
```

Expected: all route, transcript, deep-link, failure-isolation, and new prior-contact tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/chat.ts backend/src/services/email.ts backend/tests/integration.test.ts backend/tests/email.test.ts
git commit -m "feat: guard prior-contact handoffs"
```

### Task 5: Full verification, publish, deploy, and live-test both funnels

**Files:**
- Verify all modified backend source and tests
- Verify: `docs/superpowers/specs/2026-07-13-prior-contact-routing-design.md`
- Verify: `docs/superpowers/plans/2026-07-14-prior-contact-routing.md`

- [ ] **Step 1: Run static checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only planned files changed.

- [ ] **Step 2: Run the complete backend suite**

Run:

```bash
cd backend && npm test
```

Expected: every test file passes, including mandatory transcript dedupe, Berlin timestamps, deep links, case reuse, and prior-contact routing.

- [ ] **Step 3: Run the TypeScript build**

Run:

```bash
cd backend && npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Review the final diff against the spec**

Confirm:

- both funnels ask/infer prior contact before contact details;
- yes asks for an exact reference first;
- unknown never blocks forever;
- only one contact method remains sufficient;
- reference/contact conflicts and multiple deals never mutate CRM;
- exact reference can select one deal among multiple open opportunities;
- browser output stays generic;
- internal notes/emails include status/reference;
- full transcript notes and deep links remain intact.

- [ ] **Step 5: Push the reviewed commits to remote main**

Fetch and verify ancestry, preserve unrelated dirty files in the root worktree, then push the clean feature branch directly to `main`:

```bash
git fetch origin main
git rebase origin/main
git push origin codex/prior-contact-routing:main
```

Expected: remote `refs/heads/main` points at the final reviewed commit.

- [ ] **Step 6: Redeploy Hostinger**

Restart project `lippebot-demo` on VPS `1498567`, poll the action to `success`, verify fresh container uptime and clone/start logs, then run:

```bash
curl --fail --silent --show-error http://187.124.16.6:8085/api/health
```

Expected: `status: ok` with Pipedrive, email, and conversation tracking enabled.

- [ ] **Step 7: Run live two-session sales verification**

Create a clearly labeled test person and one open deal, set an exact test reference in a searchable Pipedrive custom field, and submit a complete returning sales chat using:

```json
{
  "priorContact": "yes",
  "priorContactReference": "E2E-PRIOR-SALES-<tag>",
  "email": "lippebot.prior.sales.<tag>@example.com"
}
```

Close the session, use a new session ID with empty history, and submit a follow-up. Read Pipedrive directly and assert the same person, same referenced deal, one open deal, and new pinned compact/transcript notes.

- [ ] **Step 8: Run live two-session support verification**

Repeat with a separate clearly labeled person/deal/reference and email-only support messages. Assert both support sessions resolve the same person and referenced deal, add pinned support/transcript notes, and do not create another deal.

- [ ] **Step 9: Perform final production readback**

Verify remote `main`, container uptime, `/api/health`, browser responses without CRM fields, and the two live Pipedrive results. Report test tags, person IDs, deal IDs, note-count changes, commit, deployment action, and health result.
