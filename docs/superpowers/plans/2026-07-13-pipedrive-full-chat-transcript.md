# Pipedrive Full Chat Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a complete Pipedrive transcript note a required completion step for every safely resolved opportunity or support case created or opened through chat.

**Architecture:** Format the complete transcript only after Gemini finishes streaming, using the browser history plus the current user message and final assistant response. Keep CRM creation/resolution where it is, retain its safe person/deal target, then call a dedicated Pipedrive transcript-note method through an awaited, retried, session-idempotent route hook before emitting `done`.

**Tech Stack:** TypeScript, Hono SSE routes, Pipedrive REST API, Vitest, existing Supabase conversation-event tracking.

---

## File Structure

- Create `backend/src/chat/transcript.ts`: build and HTML-escape the full Berlin-timestamped transcript note.
- Create `backend/tests/chat-transcript.test.ts`: focused transcript formatting contract.
- Modify `backend/src/services/pipedrive.ts`: add the pinned transcript-note API operation.
- Modify `backend/src/routes/chat.ts`: retain CRM targets and persist their transcript after streaming.
- Modify `backend/src/services/conversation-tracking.ts`: add transcript-note success and failure audit event types.
- Modify `backend/tests/pipedrive.test.ts`: verify person/deal pinning payloads.
- Modify `backend/tests/integration.test.ts`: verify opportunity/support completion, retries, idempotency, failure behavior, and updated service mocks.

### Task 1: Full Transcript Formatter

**Files:**
- Create: `backend/src/chat/transcript.ts`
- Create: `backend/tests/chat-transcript.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

Add tests that call the wished-for `buildPipedriveTranscriptNote()` API with two historical messages, a current user message, and a final Sarah response. Assert the result preserves all four in order, labels speakers, formats the supplied dates through `Europe/Berlin`, contains the session ID, and escapes `<`, `>`, `&`, quotes, and multiline content.

- [ ] **Step 2: Run the formatter test and verify RED**

Run: `npm test -- tests/chat-transcript.test.ts`

Expected: FAIL because `src/chat/transcript.ts` and `buildPipedriveTranscriptNote()` do not exist.

- [ ] **Step 3: Implement the minimal formatter**

Define an input containing `sessionId`, `history`, `currentMessage`, `assistantText`, `currentUserTimestamp`, and `assistantTimestamp`. Append the final exchange to history, omit only a genuinely empty assistant response, use `formatBerlinDateTime()`, escape every dynamic value, convert embedded newlines to `<br>`, and return one HTML note headed `Vollständiges Sarah-Chatprotokoll`.

- [ ] **Step 4: Run the formatter test and verify GREEN**

Run: `npm test -- tests/chat-transcript.test.ts`

Expected: PASS.

### Task 2: Pipedrive Transcript Note Operation

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write failing service tests**

Add one test that calls `createChatTranscriptNote(501, 7001, '<strong>Transcript</strong>')` and expects a `/notes` POST containing `person_id`, `deal_id`, `pinned_to_person_flag: 1`, `pinned_to_deal_flag: 1`, and the content unchanged. Add a second test with no deal ID and assert the note is pinned only to the person.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/pipedrive.test.ts -t "chat transcript"`

Expected: FAIL because `createChatTranscriptNote()` does not exist.

- [ ] **Step 3: Implement the minimal Pipedrive method**

Add an awaited `createChatTranscriptNote(personId, dealId, content)` method that requires configured Pipedrive, posts exactly one pinned note, and returns its note ID. Export it in the service return object.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- tests/pipedrive.test.ts -t "chat transcript"`

Expected: PASS.

### Task 3: Mandatory End-of-Stream Persistence

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/src/services/conversation-tracking.ts`
- Modify: `backend/tests/integration.test.ts`

- [ ] **Step 1: Update test doubles for the new service contract**

Add `createChatTranscriptNote: vi.fn()` to the common Pipedrive mock and every explicit Pipedrive test double so TypeScript continues to validate the real service interface.

- [ ] **Step 2: Write failing opportunity and support integration tests**

For an opportunity, stream historical messages, a final user message, lead data, and a final assistant token. Assert `createChatTranscriptNote()` receives the returned person/deal IDs and content containing the entire ordered exchange, including Sarah's final token. Assert the `done` event appears only after the note promise resolves.

For support, resolve a person and deal, write the compact note, finish Sarah's response, and assert a separate full transcript note is pinned to the same target.

- [ ] **Step 3: Write failing retry, idempotency, and terminal-failure tests**

Assert two rejected transcript writes followed by success produce three calls and a `crm_transcript_note_created` event. Assert repeating the same completed session after success does not create another transcript note. Assert three failures produce `crm_transcript_note_failed` with safe IDs, emit the existing generic stream error, and do not emit `done`.

- [ ] **Step 4: Run the focused route tests and verify RED**

Run: `npm test -- tests/integration.test.ts -t "transcript"`

Expected: FAIL because the route does not retain CRM results or write a final transcript.

- [ ] **Step 5: Implement the completion hook**

Make lead and support action helpers return their internal CRM results, including cached duplicate results. Retain those results during streaming. After the stream and state fallbacks finish, build the full transcript and persist it for every safe person/deal target through a helper that:

- uses a `sessionId:personId:dealId-or-person` completion key;
- returns immediately for no target or an already successful key;
- awaits up to three Pipedrive attempts;
- records `crm_transcript_note_created` after success;
- records `crm_transcript_note_failed` and rethrows after the third failure;
- adds the key only after success.

Run this hook before `chat_done` tracking and before the final `done` SSE event.

- [ ] **Step 6: Run the focused route tests and verify GREEN**

Run: `npm test -- tests/integration.test.ts -t "transcript"`

Expected: PASS.

### Task 4: Regression, Build, and Live Verification

**Files:**
- Verify all modified backend files.
- Deploy using the repository's existing Hostinger `lippebot-demo` path.

- [ ] **Step 1: Run local verification**

Run: `npm test && npm run build`

Expected: all backend tests pass and TypeScript exits 0.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat HEAD~1..HEAD`

Expected: no whitespace errors and only the planned transcript files plus documentation are changed.

- [ ] **Step 3: Commit the implementation**

Stage only the planned files and commit with `feat: save complete chat transcripts to pipedrive`.

- [ ] **Step 4: Integrate without overwriting local work**

Fast-forward or cherry-pick the implementation commits onto the main checkout while preserving its existing email-recipient and deployment edits. Resolve only overlapping transcript-related lines, then rerun `npm test && npm run build` in the integrated checkout.

- [ ] **Step 5: Deploy and verify health**

Use the existing Hostinger `lippebot-demo` deployment mechanism, then verify both `/api/health` and the public chat endpoint are served by the updated backend.

- [ ] **Step 6: Verify controlled live CRM records**

Complete one controlled opportunity chat and one controlled support chat. Read each resulting Pipedrive note back through the API and verify the note is pinned to the correct person/deal and includes the first historical message, final user message, and final Sarah response. Remove controlled test records only when they were created exclusively for this verification and cleanup is safe.

## Plan Self-Review

- Every design requirement maps to a formatter, service, route, audit, test, or live-verification step.
- No new worker, database table, customer-facing copy, or unrelated CRM behavior is introduced.
- The route and service method signatures are consistent across all tasks.
- Failure semantics never emit `done` after a terminal transcript-note failure.
