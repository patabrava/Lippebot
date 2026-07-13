# Pipedrive Cross-Session Case Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completed sales and support chats from the same safely identified person reuse that person's single open Pipedrive deal across completely separate chat sessions.

**Architecture:** Keep identity and deal selection inside the Pipedrive service. Resolve all supplied strong identifiers, fall back to normalized name only with address corroboration, and return an explicit internal outcome. Reuse exactly one open deal by adding a pinned note, create only when no safe person/deal match exists, and route ambiguous results to internal review without guessing. Keep customer-facing responses generic and notification delivery independent of CRM success.

**Tech Stack:** TypeScript, Hono, Vitest, Pipedrive REST API v1, Nodemailer, Hostinger Docker Compose.

---

### Task 1: Define CRM outcomes and normalization helpers

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing normalization and outcome tests**

Add focused tests proving that `createLead()`:

```ts
expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
expect(phoneSearchUrls).toEqual(expect.arrayContaining([
  expect.stringContaining('term=0049526196660'),
]));
```

Cover `05261 96660`, `+49 (0) 5261 96660`, and `0049 5261 96660` as equivalent phone inputs. Add a conflicting email/phone test in which the identifiers resolve to different people and assert `identity_review` with no person update, deal creation, or note creation.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: FAIL because `createLead()` still returns only `{ personId, dealId }`, stops after the first identifier, and has no review outcomes.

- [ ] **Step 3: Add the shared result types**

Add to `backend/src/types/index.ts`:

```ts
export type LeadCrmOutcome =
  | 'created'
  | 'reused'
  | 'person_review'
  | 'identity_review';

export interface LeadCrmResult {
  outcome: LeadCrmOutcome;
  personId?: number;
  dealId?: number;
  candidateCount?: number;
  reason?: string;
}
```

- [ ] **Step 4: Implement deterministic normalization helpers**

In `backend/src/services/pipedrive.ts`, add small pure helpers:

```ts
function normalizeGermanPhoneKey(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0049')) digits = digits.slice(4);
  else if (digits.startsWith('49')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits ? `49${digits}` : undefined;
}

function normalizeNameTokens(value?: string): string[] {
  return (value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(dr|prof|herr|frau)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).sort();
}
```

Keep the existing Pipedrive write normalization for stored phone values, but use the canonical key when comparing supplied identifiers and cached matches.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: the new normalization/conflict tests pass while existing tests may still require result-shape updates in Task 2.

- [ ] **Step 6: Commit**

```bash
git add backend/src/types/index.ts backend/src/services/pipedrive.ts backend/tests/pipedrive.test.ts
git commit -m "feat: model safe lead crm outcomes"
```

### Task 2: Resolve a lead identity safely

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing identity-resolution tests**

Add tests for:

```ts
// exact email uniquely resolves person 321
expect(result.personId).toBe(321);

// exact email and normalized phone agree on person 321
expect(result.outcome).not.toBe('identity_review');

// normalized name plus matching address resolves person 321
expect(result.personId).toBe(321);

// normalized/fuzzy name without corroboration never auto-links
expect(result).toEqual(expect.objectContaining({ outcome: 'identity_review' }));
```

Mock `GET /persons/search` and `GET /persons/:id` responses with names such as `Schmidt, Maria`, `Maria Anna Schmidt`, and `Müller`/`Mueller`, plus the existing address custom field.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: FAIL because lead identity resolution currently searches email first, then phone, and never checks name/address corroboration or conflicts.

- [ ] **Step 3: Implement candidate-set resolution**

Replace `findExistingPerson()` with a helper that returns one of:

```ts
type LeadIdentityResolution =
  | { status: 'none' }
  | { status: 'unique'; personId: number }
  | { status: 'ambiguous'; candidateCount: number; reason: string };
```

Rules:

1. Search every supplied strong identifier.
2. Merge duplicate IDs per identifier.
3. Resolve when all non-empty strong-identifier result sets agree on one person.
4. Return `ambiguous` when email and phone disagree or one result set contains multiple people.
5. Only when strong identifiers return no match, search by name and fetch candidate details.
6. Normalize name tokens and require the stored address custom field to corroborate the submitted postal code or normalized street/city.
7. Never turn a Pipedrive search error into `none`; propagate the error.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: all identity tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pipedrive.ts backend/tests/pipedrive.test.ts
git commit -m "feat: resolve returning lead identity safely"
```

### Task 3: Reuse one open deal and review ambiguity

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing deal-resolution tests**

Add tests for all branches:

```ts
expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
expect(dealPostCalls).toHaveLength(0);
expect(reuseNoteBody).toEqual(expect.objectContaining({
  person_id: 321,
  deal_id: 456,
  pinned_to_person_flag: 1,
  pinned_to_deal_flag: 1,
}));
```

Also verify:

- zero open deals creates one new deal and returns `created`;
- two open deals create no deal, add a person-only review note, and return `person_review`;
- a new person still creates one person and one deal;
- person update or note failure never falls through to a new deal;
- reused deals are not updated, moved, or reopened.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: FAIL because `createLead()` always posts `/deals`.

- [ ] **Step 3: Extract lead note construction**

Add a helper that records the follow-up context without changing the deal:

```ts
function buildLeadFollowUpNote(data: LeadData): string {
  return [
    '<strong>Sarah Folgeanfrage</strong>',
    `Erreichbarkeit: ${data.availability ?? 'k.A.'}`,
    data.message ? `Nachricht: ${data.message}` : '',
    data.email ? `E-Mail: ${data.email}` : '',
    data.phone ? `Telefon: ${data.phone}` : '',
  ].filter(Boolean).join('<br>');
}
```

- [ ] **Step 4: Implement the zero/one/multiple deal branches**

Within `createLead()`:

```ts
const identity = await resolveLeadIdentity(data);
if (identity.status === 'ambiguous') {
  return { outcome: 'identity_review', candidateCount: identity.candidateCount, reason: identity.reason };
}

if (identity.status === 'unique') {
  const openDeals = await getOpenPersonDeals(identity.personId);
  if (openDeals.length === 1) {
    await updatePerson(...);
    await createPinnedLeadNote(identity.personId, openDeals[0].id, data);
    return { outcome: 'reused', personId: identity.personId, dealId: openDeals[0].id };
  }
  if (openDeals.length > 1) {
    await createPersonReviewNote(identity.personId, data, openDeals.length);
    return { outcome: 'person_review', personId: identity.personId, candidateCount: openDeals.length };
  }
}
```

Create a person only for `identity.status === 'none'`; create a deal only for a new person or an existing person with zero open deals.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/pipedrive.test.ts
```

Expected: all Pipedrive service tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/pipedrive.ts backend/tests/pipedrive.test.ts
git commit -m "feat: reuse a returning lead's open deal"
```

### Task 4: Keep browser responses generic and notifications independent

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/integration.test.ts`
- Test: `backend/tests/email.test.ts`

- [ ] **Step 1: Write failing route and email tests**

Add route tests that mock `createLead()` with each outcome and assert:

```ts
expect(clientAction).toEqual({ status: 'accepted' });
expect(clientText).not.toContain('Pipedrive');
expect(clientText).not.toContain('identity_review');
expect(sendLeadNotification).toHaveBeenCalled();
```

Add an API-failure test proving notification email is still attempted. Add email tests proving the internal HTML identifies `reused`, `person_review`, `identity_review`, and `failed` without exposing these details to the browser.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd backend && npm test -- tests/integration.test.ts tests/email.test.ts
```

Expected: FAIL because lead CRM and email delivery currently share one `try` block and the browser receives raw IDs.

- [ ] **Step 3: Refactor lead action orchestration**

Use an internal map of `LeadCrmResult`, but emit only:

```ts
{ type: 'action', action: 'create_lead', data: { status: 'accepted' } }
```

Run Pipedrive and notification email in separate `try` blocks. Track `lead_created`, `lead_reused`, or `lead_review` with safe IDs internally. Pass a notification context to `sendLeadNotification()`:

```ts
interface LeadNotificationContext {
  outcome: LeadCrmOutcome | 'failed';
  personId?: number;
  dealId?: number;
  reason?: string;
}
```

- [ ] **Step 4: Add internal-only lead status wording**

Render one escaped internal row such as:

```ts
<tr><td>CRM-Zuordnung:</td><td>${label}</td></tr>
```

Labels must distinguish new case, reused case, manual person/case review, identity review, and CRM failure. Escape the optional reason before embedding it.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd backend && npm test -- tests/integration.test.ts tests/email.test.ts
```

Expected: route and email tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/chat.ts backend/src/services/email.ts backend/tests/integration.test.ts backend/tests/email.test.ts
git commit -m "feat: report lead reuse internally"
```

### Task 5: Verify the complete backend and deploy safely

**Files:**
- Verify: `backend/src/services/pipedrive.ts`
- Verify: `backend/src/routes/chat.ts`
- Verify: `backend/src/services/email.ts`
- Verify: `backend/tests/pipedrive.test.ts`
- Verify: `backend/tests/integration.test.ts`
- Verify: `backend/tests/email.test.ts`

- [ ] **Step 1: Run formatting and diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only planned files changed.

- [ ] **Step 2: Run the full backend suite**

```bash
cd backend && npm test
```

Expected: all test files and tests pass.

- [ ] **Step 3: Run the TypeScript build**

```bash
cd backend && npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Review the complete diff against the design**

Confirm line by line:

- exact email and normalized phone reuse;
- conflicting identifiers do not mutate CRM;
- normalized names require address corroboration;
- one open deal receives a pinned note;
- zero open deals creates one deal;
- multiple open deals create no deal;
- Pipedrive failure still sends email;
- browser output contains no CRM internals;
- support behavior remains unchanged.

- [ ] **Step 5: Commit final adjustments**

```bash
git add backend/src backend/tests
git commit -m "test: cover cross-session case reuse"
```

- [ ] **Step 6: Integrate into main and push**

Preserve unrelated dirty files in the main worktree. Merge or cherry-pick only the reviewed case-reuse commits, then:

```bash
git push origin main
```

- [ ] **Step 7: Redeploy Hostinger**

Restart `lippebot-demo` on VPS `1498567`, poll the Hostinger action to `success`, confirm both containers have fresh uptime, and verify:

```bash
curl --fail --silent --show-error http://187.124.16.6:8085/api/health
```

- [ ] **Step 8: Repeat the live two-session CRM test**

Use two new clearly labeled identities. For each funnel, submit a complete first request, discard all history, use a different session ID for the follow-up, and read Pipedrive back directly.

Expected sales result:

```json
{ "samePerson": true, "sameCase": true, "openDealCount": 1 }
```

Expected support result:

```json
{ "samePerson": true, "sameCase": true, "openDealCount": 1 }
```

Confirm the follow-up adds a new pinned note to the original deal and does not create a second deal.
