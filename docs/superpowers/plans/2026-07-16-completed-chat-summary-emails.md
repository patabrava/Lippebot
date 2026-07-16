# Completed Chat Summary Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send exactly one mandatory internal summary-and-full-transcript email after every completed Sarah chat, including Pipedrive opportunity and case context.

**Architecture:** Add a focused completed-chat email payload and renderer to the email service, then move notification orchestration to the post-stream completion section of the chat route. Reuse the existing post-stream transcript, add per-session in-flight/idempotency and three-attempt retry behavior, and gate SSE `done` on both required Pipedrive transcript persistence and SMTP success.

**Tech Stack:** TypeScript, Hono SSE routes, Nodemailer, Vitest, Pipedrive REST service, Supabase conversation tracking.

---

### Task 1: Completed-chat email renderer

**Files:**
- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/email.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Add tests that call a new `sendCompletedChatSummary(to, input)` method for general, opportunity, and case payloads. Assert summary appears before the transcript, all history and final assistant text appear, CRM links use `/deal/{id}`, and hostile HTML in summary/transcript is escaped.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/email.test.ts`

Expected: TypeScript/Vitest failure because `sendCompletedChatSummary` does not exist.

- [ ] **Step 3: Implement the payload and renderer**

Add these public concepts to `email.ts`:

```ts
export type CompletedChatKind = 'general' | 'opportunity' | 'case';

export interface CompletedChatSummary {
  sessionId: string;
  mode: string;
  kind: CompletedChatKind;
  summary: string;
  transcript: string;
  completedAt: string;
  leadData?: LeadData;
  leadContext?: LeadNotificationContext;
  supportData?: SupportData;
  supportContext?: {
    matchState: SupportMatchState;
    noteStatus: SupportNoteStatus;
    noteError?: string;
    intendedInbox: string;
    dealId?: number;
  };
}
```

Implement `sendCompletedChatSummary` with one escaped HTML document containing a `Zusammenfassung` section before `Vollständiges Transkript`, optional structured data tables, and a validated Pipedrive deal button. Return it from `createEmailService`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/email.test.ts`

Expected: all email tests pass.

- [ ] **Step 5: Commit the renderer**

```bash
git add backend/src/services/email.ts backend/tests/email.test.ts
git commit -m "feat: render completed chat summary emails"
```

### Task 2: Post-stream email orchestration and completion gate

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Modify: `backend/src/services/conversation-tracking.ts`
- Test: `backend/tests/integration.test.ts`
- Test: `backend/tests/conversation-tracking.test.ts`

- [ ] **Step 1: Write failing route regression tests**

Add focused integration tests proving that ordinary response turns do not trigger a premature completion email, while completed opportunity and case handoffs do:

```ts
expect(sendCompletedChatSummary).toHaveBeenCalledWith(
  'berg@lippelift.de',
  expect.objectContaining({
    kind: 'opportunity',
    summary: expect.stringContaining('Anfrage'),
    transcript: expect.stringContaining('Sarahs finale Antwort'),
  }),
);
```

Add opportunity and case variants that assert the structured payload and deal ID, verify the call occurs after the last token, verify the old early notification methods are not called, and verify recipient selection. Add retry, unconfigured SMTP, permanent failure/no-`done`, sequential duplicate, and concurrent duplicate cases. Keep the existing abandoned-chat test as coverage for general and incomplete conversation closure.

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm test -- tests/integration.test.ts`

Expected: failures because completed-chat email orchestration and completion gating are absent.

- [ ] **Step 3: Add tracking event types**

Extend `ConversationEventType` with:

```ts
| 'completed_summary_email_sent'
| 'completed_summary_email_failed'
```

Update the tracker tests to accept and persist both event types.

- [ ] **Step 4: Implement deterministic summary construction**

In `chat.ts`, add focused helpers that select:

- opportunity summary from lead name, message, location, availability, and CRM outcome;
- case summary from customer, category, issue description, and match state;
- no summary for ordinary intermediate turns; general/incomplete sessions continue through the existing abandoned-chat summary builder.

Use the existing transcript builder output so email and Pipedrive contain the same complete exchange.

- [ ] **Step 5: Implement mandatory idempotent email persistence**

Add route-scoped `completedSummaryEmails` and `inFlightSummaryEmails`. Implement a helper keyed by `sessionId` that awaits an existing write, retries SMTP up to three times, records success/failure tracking events, marks success only after SMTP resolves, and rethrows the final error.

- [ ] **Step 6: Move notification timing to post-stream**

Remove the `sendLeadNotification` and `sendSupportNotification` calls from `emitLeadAction` and `emitSupportAction`. Retain their CRM behavior and return enough normalized action data to construct the completed payload. After streaming and transcript-note persistence, choose the kind and recipient, await `sendCompletedChatSummary`, then emit `done`.

Use `berg@lippelift.de` as the fallback for both empty recipient settings. If email is not configured, treat this as a mandatory completion failure rather than silently succeeding.

- [ ] **Step 7: Run route and tracking tests and verify GREEN**

Run: `npm test -- tests/integration.test.ts tests/conversation-tracking.test.ts`

Expected: all focused integration and tracking tests pass.

- [ ] **Step 8: Commit orchestration**

```bash
git add backend/src/routes/chat.ts backend/src/services/conversation-tracking.ts backend/tests/integration.test.ts backend/tests/conversation-tracking.test.ts
git commit -m "feat: require summary email before chat completion"
```

### Task 3: Configuration fallback and regression alignment

**Files:**
- Modify: `deploy/hostinger-lippebot-demo.compose.yml`
- Modify: `backend/tests/config.test.ts` only if a config-level assertion is needed
- Modify: existing email/route mocks under `backend/tests/*.test.ts`

- [ ] **Step 1: Add the deployment fallback**

Set:

```yaml
NOTIFICATION_EMAIL_TO: ${NOTIFICATION_EMAIL_TO:-berg@lippelift.de}
SERVICE_EMAIL_TO: ${SERVICE_EMAIL_TO:-berg@lippelift.de}
```

- [ ] **Step 2: Update all typed EmailService mocks**

Add `sendCompletedChatSummary: vi.fn()` to every typed mock and replace expectations for early lead/support emails with post-stream completed-email expectations where applicable.

- [ ] **Step 3: Run full verification**

Run: `npm test && npm run build`

Expected: 0 failed tests and TypeScript exit code 0.

- [ ] **Step 4: Verify regression-test sensitivity**

Temporarily disable the post-stream completed email call, run the core completion-email test and confirm it fails, restore the implementation, and rerun the test to confirm it passes.

- [ ] **Step 5: Commit configuration and alignment**

```bash
git add deploy/hostinger-lippebot-demo.compose.yml backend/tests
git commit -m "chore: configure completed chat email recipients"
```

### Task 4: Review, publish, deploy, and live verification

**Files:**
- Inspect: all branch changes
- Modify: only defects found during review

- [ ] **Step 1: Review the branch diff**

Run: `git diff --check origin/main...HEAD` and `git diff --stat origin/main...HEAD`.

Check requirement coverage, secrets, accidental unrelated changes, HTML escaping, idempotency, failure gating, and recipient routing.

- [ ] **Step 2: Re-run final local verification**

Run: `cd backend && npm test && npm run build`

Expected: all test files pass and build exits 0.

- [ ] **Step 3: Push the feature branch and integrate to production main**

Push `codex/completed-chat-emails`, then fast-forward or intentionally merge it into `origin/main` without overwriting the dirty local main checkout.

- [ ] **Step 4: Restart the production project**

Restart Hostinger project `lippebot-demo` on VPS `1498567`, because the compose service clones `origin/main` during container startup.

- [ ] **Step 5: Verify production health**

Request `http://187.124.16.6:8085/api/health` and require `status:ok`, `pipedrive:true`, `email:true`, and `conversationTracking:true`.

- [ ] **Step 6: Run three tagged live chats**

Run unique tagged general, opportunity, and case conversations through the production API. For each, require final `done`; verify the internal mailbox received exactly one message with summary before full transcript. For opportunity and case, read Pipedrive back and verify the exact deal plus transcript note, then remove synthetic CRM records where newly created.

- [ ] **Step 7: Report exact evidence**

Report commit SHA, test count, build result, deployment health response, live session tags, mail message IDs/recipients, and Pipedrive IDs/readback. If mailbox readback is unavailable, report SMTP acceptance separately and do not claim inbox delivery.
