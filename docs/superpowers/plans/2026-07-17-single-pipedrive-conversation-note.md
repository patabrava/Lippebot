# Single Pipedrive Conversation Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist exactly one Pipedrive note per completed Sarah sales or support conversation, containing a structured summary followed by the complete transcript.

**Architecture:** Lead and support action handlers will only resolve or create CRM entities. The post-stream completion hook will build the structured summary and transcript together, then use the existing marker-based idempotent writer as the single note write and completion gate.

**Tech Stack:** TypeScript, Hono, Vitest, Pipedrive REST API

---

### Task 1: Format the combined summary and transcript

**Files:**
- Modify: `backend/src/chat/transcript.ts`
- Test: `backend/tests/chat-transcript.test.ts`

- [ ] **Step 1: Write the failing formatter test**

Add a test that calls `buildPipedriveTranscriptNote` with `summary: 'E-Mail: test@example.com\nErreichbarkeit: 08:00 - 12:00'` and asserts that the output contains a `Kurzfassung` heading, escaped summary lines, the stable session marker, and both user and Sarah transcript messages in that order.

- [ ] **Step 2: Run the focused formatter test and verify RED**

Run: `npm test -- tests/chat-transcript.test.ts`

Expected: FAIL because `summary` is not accepted and no `Kurzfassung` section is rendered.

- [ ] **Step 3: Implement the minimal formatter change**

Extend `PipedriveTranscriptInput` with `summary: string` and render the note as:

```ts
return [
  '<strong>Kurzfassung</strong>',
  `<p>${formatContent(input.summary)}</p>`,
  '<hr>',
  '<strong>Vollständiges Sarah-Chatprotokoll</strong>',
  `<small>Sitzung: ${escapeHtml(input.sessionId)} · ${buildPipedriveTranscriptMarker(input.sessionId)}</small>`,
  '<hr>',
  ...messages.map(formatMessage),
].join('\n');
```

- [ ] **Step 4: Run the focused formatter test and verify GREEN**

Run: `npm test -- tests/chat-transcript.test.ts`

Expected: all formatter tests pass.

### Task 2: Eliminate preliminary sales and support note writes

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/src/routes/chat.ts`
- Test: `backend/tests/pipedrive.test.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing Pipedrive service tests**

Update the sales creation, exact-reference reuse, open-deal reuse, and multiple-open-deal tests to assert that `createLead` performs no `/notes` POST. Keep assertions for person/deal resolution and returned identifiers.

- [ ] **Step 2: Write failing route tests for the one-note contract**

For opportunity and support completion tests, assert:

```ts
expect(createSupportNote).not.toHaveBeenCalled();
expect(createChatTranscriptNote).toHaveBeenCalledTimes(1);
expect(createChatTranscriptNote.mock.calls[0][3]).toContain('<strong>Kurzfassung</strong>');
expect(createChatTranscriptNote.mock.calls[0][3]).toContain('<strong>Vollständiges Sarah-Chatprotokoll</strong>');
```

Also assert that the summary contains the relevant sales or support fields and that retry/concurrency tests still call `createChatTranscriptNote` only once per successful session.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/pipedrive.test.ts tests/integration.test.ts`

Expected: FAIL because sales and support handlers still create standalone compact notes and the transcript formatter has no summary input at the route call.

- [ ] **Step 4: Remove sales-side preliminary writes**

In `createLead`, remove the `/notes` POSTs from exact-reference reuse, multiple-open-deal review, single-open-deal reuse, and newly created deals. Preserve person updates, deal creation, custom fields, return values, and ambiguity behavior.

- [ ] **Step 5: Remove the support-side preliminary write**

In `emitSupportAction`, resolve or create the concrete person/deal but do not call `createSupportNote`. Leave the note status pending as `skipped` until the combined note is persisted after streaming.

- [ ] **Step 6: Build the structured summaries and persist one combined note**

Add focused helpers in `chat.ts` that return newline-separated sales and support summaries. Sales lines cover name, email/phone, address, availability, prior-contact state/reference, message, and CRM outcome. Support lines cover customer, category, problem, email/phone, prior-contact state/reference, supplied case/technical identifiers, and CRM match state.

Pass the applicable summary to `buildPipedriveTranscriptNote`. Persist the note once for the applicable result. Make `persistTranscriptNote` return the created/reconciled note ID; after a support write succeeds, set `supportResult.noteStatus = 'created'`, clear `noteError`, and update the tracked session before constructing the completed-chat email.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npm test -- tests/chat-transcript.test.ts tests/pipedrive.test.ts tests/integration.test.ts`

Expected: all focused tests pass.

### Task 3: Regression verification and delivery

**Files:**
- Verify all modified backend files
- Update: `docs/superpowers/plans/2026-07-17-single-pipedrive-conversation-note.md` checkboxes as work completes

- [ ] **Step 1: Run complete backend verification**

Run: `npm test && npm run build`

Expected: all backend tests pass and TypeScript exits successfully.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors and only the approved note-flow, tests, spec, and plan are changed.

- [ ] **Step 3: Commit the implementation**

Stage only the approved files and commit with:

```bash
git commit -m "fix: save one combined pipedrive conversation note"
```

- [ ] **Step 4: Publish and deploy**

Push `codex/single-pipedrive-note`, integrate the verified commit into `origin/main` using the repository's established delivery path, restart the Hostinger `lippebot-demo` project, and verify `/api/health` before live CRM testing.

- [ ] **Step 5: Perform controlled live Pipedrive tests**

Submit one unique sales conversation and one unique support conversation through the deployed chat API. Read each resulting deal's notes through Pipedrive, filter by the unique Sarah session marker, and assert exactly one matching note with both `Kurzfassung` and `Vollständiges Sarah-Chatprotokoll` sections. Confirm no separate `Sarah Folgeanfrage` or compact support note exists for either test conversation.

- [ ] **Step 6: Clean up synthetic live records**

Delete or deactivate only the uniquely named synthetic test persons, deals, and notes created by Step 5, then read back their state to confirm cleanup.
