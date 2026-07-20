# Completed Email Contact Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completed-chat emails identify new versus existing CRM contacts while removing internal session, mode, person-ID, and deal-ID fields.

**Architecture:** Add explicit person-creation provenance to Pipedrive results, preserve it through chat orchestration, and render only user-facing contact status in the email service. Keep the exact Pipedrive deal URL as the safe navigation mechanism and leave the summary/transcript lifecycle unchanged.

**Tech Stack:** TypeScript, Hono, Nodemailer, Vitest, Pipedrive REST API

---

### Task 1: Define CRM contact provenance

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing Pipedrive assertions**

Update existing new-person and existing-person expectations so successful results include `createdPerson: true` or `createdPerson: false` respectively.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/pipedrive.test.ts`

Expected: FAIL because `LeadCrmResult` values do not yet expose `createdPerson`.

- [ ] **Step 3: Add the explicit result field**

Add `createdPerson?: boolean` to `LeadCrmResult` and `SupportHandoffResult`. Return `false` from every lead reuse path, `false` when an existing person receives a new deal, and `true` when `createLead` creates the person. Preserve `createSupportCase(...).createdPerson` in the support handoff; direct support matches use `false`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/pipedrive.test.ts`

Expected: all Pipedrive tests pass.

### Task 2: Pass contact provenance into completed emails

**Files:**
- Modify: `backend/src/services/email.ts`
- Modify: `backend/src/routes/chat.ts`
- Test: `backend/tests/email.test.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Assert that an existing-contact email contains `Kontaktstatus`, `Bestehend`, `Kontaktname`, and `Chatende`; assert it does not contain the `Session:`, `Modus:`, `Abgeschlossen:`, `Person-ID:`, or `Fall-ID:` labels. Add a new-contact assertion for `Kontaktstatus: Neu` without `Kontaktname`.

- [ ] **Step 2: Write failing route tests**

Assert that opportunity and case calls to `sendCompletedChatSummary` include the correct `createdPerson` value produced by their CRM flow.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/email.test.ts tests/integration.test.ts`

Expected: FAIL on the new presentation and propagation assertions.

- [ ] **Step 4: Implement minimal renderer and route changes**

Extend completed email contexts with `createdPerson`. Render `Chatende`; omit Session, mode, person ID, and deal ID rows; render `Kontaktstatus` only for a known boolean; and render `Kontaktname` only when the contact is existing. Pass support case provenance through `emitSupportAction` and both completion-email payloads.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- tests/email.test.ts tests/integration.test.ts`

Expected: all focused tests pass.

### Task 3: Verify, prove delivery, and publish

**Files:**
- Verify all modified backend files

- [ ] **Step 1: Run full local verification**

Run: `npm test && npm run build`

Expected: all tests pass and TypeScript exits with status 0.

- [ ] **Step 2: Send a real SMTP rendering test and read it back**

Use the configured production SMTP credentials without printing secrets. Send uniquely named new- and existing-contact samples to the configured internal mailbox, then search/read both messages in Gmail and verify all required and forbidden labels.

- [ ] **Step 3: Commit and publish**

Commit the tested changes, update `main` without overwriting unrelated work, and push `origin/main`.

- [ ] **Step 4: Deploy and live-verify**

Restart Hostinger project `lippebot-demo`, verify `https://lippelift.xyz/health`, run live opportunity/case chat completion as appropriate, and confirm the resulting email through Gmail readback. Remove synthetic CRM records created by the test and verify cleanup.
