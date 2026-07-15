# Unmatched Support CRM Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every completed support handoff creates or reuses a concrete Pipedrive deal and stores the complete transcript there.

**Architecture:** Add one Pipedrive service operation that creates a support person when necessary and always creates a support deal for a match without a deal. Route orchestration resolves first, creates the fallback case, writes the compact note, sends the independent email, and gates completion on a concrete CRM record.

**Tech Stack:** TypeScript, Hono, Vitest, Pipedrive REST API, Nodemailer, Hostinger Docker Compose.

---

### Task 1: Pipedrive support-case creation

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/src/types/index.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests that call `createSupportCase(data, match)` and assert:

```ts
expect(result).toEqual({ personId: 701, dealId: 801, createdPerson: true });
expect(personBody).toEqual(expect.objectContaining({
  name: 'Camilo',
  email: [{ value: 'caechma@gmail.com', primary: true }],
}));
expect(dealBody).toEqual(expect.objectContaining({
  person_id: 701,
  pipeline_id: 1,
  stage_id: 2,
}));
```

Add a second test proving `{ matchState: 'unique', personId: 501 }` creates only the deal and reuses person `501`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/pipedrive.test.ts`

Expected: FAIL because `createSupportCase` does not exist.

- [ ] **Step 3: Implement the minimal service operation**

Implement:

```ts
async function createSupportCase(
  data: SupportData,
  match: SupportMatchResult,
): Promise<{ personId: number; dealId: number; createdPerson: boolean }>
```

Create a normalized person only when `match.personId` is absent, then create a deal with the Sarah owner, configured pipeline/stage, inbound Sarah channel, Berlin request date, and resolved support category.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/pipedrive.test.ts`

Expected: PASS.

### Task 2: Mandatory route persistence

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Test: `backend/tests/integration.test.ts`
- Test: `backend/tests/support-routing.test.ts`

- [ ] **Step 1: Write failing route tests**

Replace the unresolved-email-only expectation with assertions that `createSupportCase` is called, its person/deal IDs are used by `createSupportNote` and `createChatTranscriptNote`, the support email contains the new `dealId`, and the SSE stream contains `done` only after those writes.

Add an ambiguous-match case with the same assertions and a CRM-creation failure case asserting:

```ts
expect(text).toContain('"type":"error"');
expect(text).not.toContain('"type":"done"');
expect(sendSupportNotification).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/integration.test.ts`

Expected: FAIL because unresolved and ambiguous matches do not create CRM cases.

- [ ] **Step 3: Implement route orchestration**

After `resolveSupportPerson`, call `createSupportCase` whenever no `dealId` exists. Require a concrete person and deal, write the compact note using the original match state, send the internal email, and throw after email delivery if CRM persistence failed so `done` is not emitted.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/integration.test.ts tests/support-routing.test.ts`

Expected: PASS.

### Task 3: Regression, build, publish, and live proof

**Files:**
- Modify: integration mocks that implement `PipedriveService`

- [ ] **Step 1: Run complete verification**

Run: `npm test && npm run build`

Expected: 0 failing tests and TypeScript exit code 0.

- [ ] **Step 2: Commit and publish**

Commit the implementation on `codex/unmatched-support-crm`, fast-forward `main`, push `origin/main`, and restart Hostinger project `lippebot-demo` on VPS `1498567`.

- [ ] **Step 3: Verify production health**

Run: `curl --fail --silent --show-error http://187.124.16.6:8085/api/health`

Expected: `status=ok`, with Pipedrive and email enabled.

- [ ] **Step 4: Verify a tagged live support handoff**

Submit a synthetic email-only installation request using a unique tag. Read Pipedrive back by that email and verify one person, one open deal, one compact support note, and one complete transcript note pinned to that deal. Delete the synthetic notes, deal, and person after recording the result.
