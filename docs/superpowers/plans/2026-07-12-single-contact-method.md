# Sarah Single Contact Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one telephone number or one email address sufficient to complete both Sarah's new-lead and support flows, without ever soliciting the second contact method after one is known.

**Architecture:** Define the phone-or-email rule as a small shared validation boundary, then enforce it in the prompt, Gemini submission contracts, chat action gates, Pipedrive payload construction, and notification rendering. Keep the two existing fields for compatibility, but make both individually optional and require their logical OR at runtime.

**Tech Stack:** TypeScript, Hono, Vertex AI function declarations, Pipedrive API integration, Nodemailer, Vitest

---

## File Structure

- Create `backend/src/contact/contact-method.ts`: shared non-blank contact predicates for lead and support validation.
- Modify `backend/src/prompts/system-prompt.ts`: natural preferred-contact wording and stop-after-one rules in both modes.
- Modify `backend/src/services/gemini.ts`: remove telephone from the lead function's fixed required list and document the phone-or-email contract for both submissions.
- Modify `backend/src/routes/chat.ts`: require one contact method for direct actions and state fallback in both flows.
- Modify `backend/src/services/pipedrive.ts`: normalize, search, cache, create, and update people when either contact field is absent.
- Modify `backend/src/services/email.ts`: omit missing telephone and email rows cleanly.
- Modify `backend/tests/system-prompt.test.ts`: assert natural one-contact instructions.
- Modify `backend/tests/integration.test.ts`: prove phone-only and email-only completion plus neither-contact rejection for both flows.
- Modify `backend/tests/pipedrive.test.ts`: prove email-only lookup and payload behavior without telephone placeholders.
- Modify `backend/tests/email.test.ts`: prove email-only notifications omit undefined telephone content.

### Task 1: Add the shared contact invariant and route-level regression tests

**Files:**
- Create: `backend/src/contact/contact-method.ts`
- Modify: `backend/src/routes/chat.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing route tests for email-only and missing-contact lead state**

Add tests that feed complete lead state through the existing state fallback. The email-only case must emit `create_lead`; the no-contact case must not call `createLead` or emit the action.

```ts
it('creates a lead from complete email-only state', async () => {
  const createLead = vi.fn().mockResolvedValue({ personId: 321, dealId: 654 });
  const leadData = {
    customerSegment: 'Privatperson' as never,
    firstName: 'Max',
    lastName: 'Mustermann',
    email: 'max@example.de',
    street: 'Musterstrasse 1',
    postalCode: '32657',
    city: 'Lemgo',
    availability: '08:00 - 12:00' as const,
  };
  // Build the route with a Gemini state event and configured Pipedrive mock.
  // POST the normal /api/chat request.
  expect(createLead).toHaveBeenCalledWith(leadData);
  expect(await res.text()).toContain('"action":"create_lead"');
});

it('does not create a lead when complete state has neither phone nor email', async () => {
  // Use the same complete state except omit both contact fields.
  expect(createLead).not.toHaveBeenCalled();
  expect(await res.text()).not.toContain('"action":"create_lead"');
});
```

- [ ] **Step 2: Write failing direct-action tests for missing contacts**

Add one lead-action and one service-action test where Gemini directly emits an otherwise complete action without telephone or email. Both must avoid Pipedrive/email side effects and emit a `needs_contact` action result.

```ts
expect(createLead).not.toHaveBeenCalled();
expect(resolveSupportPerson).not.toHaveBeenCalled();
expect(sendSupportNotification).not.toHaveBeenCalled();
expect(text).toContain('"status":"needs_contact"');
```

- [ ] **Step 3: Run the focused integration tests and verify red**

Run: `cd backend && npm test -- --run tests/integration.test.ts`

Expected: the email-only lead fallback and action guards fail under the telephone-only implementation.

- [ ] **Step 4: Create shared non-blank contact predicates**

Create `backend/src/contact/contact-method.ts`:

```ts
type ContactData = { phone?: string; email?: string };

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasContactMethod(data: ContactData): boolean {
  return hasText(data.phone) || hasText(data.email);
}
```

- [ ] **Step 5: Enforce the predicate in route completion and direct actions**

Import `hasContactMethod` in `backend/src/routes/chat.ts`. Change `hasRequiredLeadFields` to replace `data.phone` with `hasContactMethod(data)`. Change `hasRequiredServiceFields` to include `hasContactMethod(data)`.

Before calling external services in `emitLeadAction` and `emitSupportAction`, reject incomplete action payloads with:

```ts
await stream.writeSSE({
  data: JSON.stringify({ type: 'action', action: actionName, data: { status: 'needs_contact' } }),
});
return;
```

Use `create_lead` for the lead action name and `create_service` for support, matching the route's existing action names.

- [ ] **Step 6: Run integration tests and verify green**

Run: `cd backend && npm test -- --run tests/integration.test.ts`

Expected: all integration tests pass, including existing phone-only fixtures and new email-only/missing-contact cases.

### Task 2: Align Sarah's instructions and Gemini submission contracts

**Files:**
- Modify: `backend/src/prompts/system-prompt.ts`
- Modify: `backend/src/services/gemini.ts`
- Test: `backend/tests/system-prompt.test.ts`

- [ ] **Step 1: Write failing prompt assertions**

Add a test that requires the exact preferred-contact instruction and forbids the old telephone-only requirement:

```ts
it('requests one preferred contact method in both handoff flows', () => {
  const prompt = buildSystemPrompt();
  expect(prompt).toContain('Schick mir bitte entweder deine Telefonnummer oder deine E-Mail-Adresse.');
  expect(prompt).toContain('Sobald Telefonnummer oder E-Mail-Adresse vorhanden ist, frage nicht nach der anderen Kontaktmöglichkeit');
  expect(prompt).toContain('Telefon oder E-Mail (genau eine Kontaktmöglichkeit genügt)');
  expect(prompt).not.toContain('Vorname, Nachname, Telefonnummer (Pflicht)');
});
```

Update the existing support assertions so they expect a single preferred-contact rule rather than alternative identifiers such as invoice number satisfying the contact requirement.

- [ ] **Step 2: Run prompt tests and verify red**

Run: `cd backend && npm test -- --run tests/system-prompt.test.ts`

Expected: the new one-contact wording assertions fail.

- [ ] **Step 3: Update the inquiry-mode prompt**

Replace the telephone-required data line with:

```text
- Vorname, Nachname (Pflicht)
- Telefon oder E-Mail (Pflicht; genau eine Kontaktmöglichkeit genügt)
```

Replace the contact sequence entry with `bevorzugte Kontaktmöglichkeit`. Add:

```text
- Wenn weder Telefonnummer noch E-Mail-Adresse bekannt ist, frage genau einmal natürlich: "Wie können wir dich am besten erreichen? Schick mir bitte entweder deine Telefonnummer oder deine E-Mail-Adresse."
- Sobald Telefonnummer oder E-Mail-Adresse vorhanden ist, frage nicht nach der anderen Kontaktmöglichkeit.
- Wenn der Nutzer eine Kontaktmöglichkeit bereits freiwillig genannt hat, frage keine weitere ab.
```

- [ ] **Step 4: Update the support-mode prompt**

Make telephone or email a single required contact slot. Remove language allowing a unique name or a non-contact business identifier to bypass it. Keep business identifiers optional for CRM matching, but state that they do not cause Sarah to request a second contact method.

- [ ] **Step 5: Update Gemini function declarations**

In `submitLeadFn`, change the description to say phone or email is required, and remove `phone` from the schema's fixed `required` array:

```ts
description: 'Submit a qualified lead only when all required information and at least one contact method (phone or email) have been collected. After calling this, generate a warm confirmation message.',
required: ['customerSegment', 'firstName', 'lastName', 'street', 'postalCode', 'city', 'availability'],
```

In `submitServiceRequestFn`, state that one of phone or email is required. Runtime route validation supplies the logical-OR guarantee that the Vertex function schema cannot express directly.

- [ ] **Step 6: Run prompt and integration tests**

Run: `cd backend && npm test -- --run tests/system-prompt.test.ts tests/integration.test.ts`

Expected: all selected tests pass.

### Task 3: Make Pipedrive lead persistence contact-optional per field

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Test: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write a failing email-only Pipedrive lead test**

Add a test that returns no email match, creates a person, and creates a deal. Assert that no phone search occurs and the person body contains only email contact data:

```ts
expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
expect(mockFetch.mock.calls.some(([url]) => String(url).includes('fields=phone'))).toBe(false);
const personBody = JSON.parse(mockFetch.mock.calls[1][1].body);
expect(personBody).not.toHaveProperty('phone');
expect(personBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
expect(JSON.stringify(personBody)).not.toContain('nicht ausgefüllt');
```

- [ ] **Step 2: Run the Pipedrive test and verify red**

Run: `cd backend && npm test -- --run tests/pipedrive.test.ts`

Expected: the old implementation performs a placeholder phone search and writes a placeholder phone value.

- [ ] **Step 3: Make phone normalization optional**

Change:

```ts
function normalizePhoneNumber(phone?: string): string | undefined {
  if (!phone || !phone.trim()) return undefined;
  // retain existing German-number normalization for non-blank values
}
```

- [ ] **Step 4: Make person cache and lookup conditional**

Change `cachePersonId` and `findExistingPerson` to accept optional telephone values. Only read/write phone cache keys and only call `searchPerson(..., 'phone')` when `phone` is present. Preserve email-first lookup ordering.

- [ ] **Step 5: Make person payload fields conditional**

Change the relevant method signatures to `phone: string | undefined` and construct contacts as:

```ts
return {
  name: `${firstName} ${lastName}`,
  owner_id: STEPHANIE_KREUZBUSCH_USER_ID,
  ...(phone ? { phone: [{ value: phone, primary: true }] } : {}),
  ...(email ? { email: [{ value: email, primary: true }] } : {}),
  ...buildPersonCustomFields(data, street, postalCode, city),
};
```

Apply the same conditional-field rule to the legacy `createServiceActivity` person payload.

- [ ] **Step 6: Run Pipedrive tests and verify green**

Run: `cd backend && npm test -- --run tests/pipedrive.test.ts`

Expected: all existing phone/email matching tests and the new email-only test pass.

### Task 4: Render one-contact notifications cleanly

**Files:**
- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/email.test.ts`

- [ ] **Step 1: Write failing email-only notification tests**

For `sendLeadNotification` and the legacy `sendServiceNotification`, pass email-only data and assert:

```ts
expect(call.html).toContain('max@example.de');
expect(call.html).not.toContain('<td>undefined</td>');
expect(call.html).not.toContain('Telefon:</td>');
```

- [ ] **Step 2: Run email tests and verify red**

Run: `cd backend && npm test -- --run tests/email.test.ts`

Expected: telephone rows currently render `undefined`.

- [ ] **Step 3: Render contact rows conditionally**

In both notification builders, replace unconditional phone rows with:

```ts
${data.phone ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>` : ''}
${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
```

- [ ] **Step 4: Run email tests and verify green**

Run: `cd backend && npm test -- --run tests/email.test.ts`

Expected: all email tests pass with no undefined contact values.

### Task 5: Full verification and end-to-end flow checks

**Files:**
- Modify only if verification exposes a defect in the scoped files above.

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && npm test`

Expected: all Vitest files pass.

- [ ] **Step 2: Run TypeScript production compilation**

Run: `cd backend && npm run build`

Expected: `tsc` exits successfully.

- [ ] **Step 3: Run local HTTP end-to-end tests without external writes**

Start the backend with Pipedrive and SMTP disabled via environment overrides while retaining the configured Vertex project. Drive two complete representative conversations over `/api/chat`: one new inquiry that supplies only email and one support request that supplies only phone. Preserve and resend the returned conversation history on every turn.

Expected for the email-only new inquiry:

- Sarah never asks for a telephone number after receiving email.
- the final SSE stream contains `action=create_lead` or a customer-safe completion when persistence is disabled;
- no response asks for both contact methods as separate requirements.

Expected for the phone-only support request:

- Sarah never asks for email after receiving telephone;
- the final SSE stream contains `action=create_service` or a customer-safe completion when persistence is disabled;
- no response requests a second contact method.

- [ ] **Step 4: Review the final diff and worktree ownership**

Run:

```bash
git diff --check
git diff -- backend/src/contact/contact-method.ts backend/src/prompts/system-prompt.ts backend/src/services/gemini.ts backend/src/routes/chat.ts backend/src/services/pipedrive.ts backend/src/services/email.ts backend/tests/system-prompt.test.ts backend/tests/integration.test.ts backend/tests/pipedrive.test.ts backend/tests/email.test.ts
git status --short
```

Expected: no whitespace errors; only scoped feature changes are attributed to this task, while pre-existing unrelated edits remain preserved.
