# Prior-Contact Case Routing Design

## Goal

Ask naturally whether the user has already contacted Lippelift about the same matter, then use an existing reference when available to route the conversation to the correct open Pipedrive case. Preserve the rule that Sarah requests only one contact method and never guesses between people or opportunities.

The behavior applies to both the sales/new-inquiry funnel and the support funnel.

## Approaches Considered

### Prompt wording only

Sarah could ask about prior contact and then continue with the existing flow. This would make the contact question feel more natural, but it would not improve backend case selection because the answer would not reach the CRM resolver.

### Recorded prior-contact status with reference-first routing

Sarah records whether prior contact happened. A returning user is asked for an offer, order, invoice, customer, lead, contract, payment, spare-part, or case reference when one is available. The backend uses an exact unique reference to select the correct open deal; otherwise it falls back to the existing exact email/normalized-phone identity and single-open-deal policy.

This is the selected approach because it improves routing among multiple opportunities without weakening the existing safety rules.

### Automatic reuse from a yes answer or fuzzy context

The backend could treat “yes” or a similar description as sufficient to reuse a deal. This is rejected because prior contact does not identify a person or case and could attach sensitive context to the wrong customer.

## Conversation Design

### Shared prior-contact question

Once Sarah understands the broad intent and before she asks for personal contact details, she asks at most once:

> Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?

Sarah does not ask when the answer is already clear from the user's words:

- “Ich habe schon angerufen”, “ich hatte bereits geschrieben”, “Folgeanfrage”, or an existing reference implies `yes`.
- “Das ist meine erste Anfrage”, “noch nie”, or equivalent wording implies `no`.
- If the user cannot remember, does not know, or declines to answer, Sarah records `unknown` and continues instead of blocking the handoff.

### Returning-contact path

When the answer is `yes`, Sarah asks one follow-up question:

> Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?

Category-specific references already supplied by the user count as an answer. Examples include invoice, customer, payment, lead, contract, spare-part, offer, and order numbers. Sarah must not ask for a generic reference after one of these has already been provided.

If no reference is available, Sarah responds briefly and later asks:

> Kein Problem. Welche E-Mail-Adresse oder Telefonnummer hast du damals verwendet?

This remains one choice: the user may provide email or telephone, and Sarah must not request the other after receiving one valid contact method.

Even when a reference is available, the existing requirement to collect one contact method remains. The reference improves case routing; it does not replace the contact method needed for follow-up.

### First-contact and unknown paths

When the answer is `no` or `unknown`, Sarah continues the existing funnel. The normal contact question stays conversational and still requests either email or telephone, never both.

A `no` answer is not permission to create a duplicate. The backend still performs its normal identity and open-deal lookup because users can forget earlier contact or misunderstand the question.

### Funnel placement

In the sales funnel, Sarah asks after understanding the lift situation and whether the inquiry is private or business, but before name, address, and contact details.

In the support funnel, Sarah asks after recognizing that the matter concerns an existing lift and understanding the issue category, but before requesting contact details. If the user already describes a repeated support contact or supplies a reference, Sarah infers `yes` and skips the question.

All existing rules remain in force: one new information request per response, at most one question mark, no CRM terminology, and generic confirmation after handoff.

## Conversation Data and Tool Contracts

Add a shared status type:

```ts
type PriorContactStatus = 'yes' | 'no' | 'unknown';
```

Add these fields to both lead and support data:

```ts
priorContact?: PriorContactStatus;
priorContactReference?: string;
```

Expose the fields in `report_state`, `submit_lead`, and `submit_service_request`. A completed tool submission must include `priorContact`; `unknown` is the non-blocking value when the question cannot be answered.

The function descriptions and system prompt must tell Gemini to:

- infer prior contact from explicit user language;
- ask the shared question only when it is not already known;
- ask for a reference only after `yes` and only when no reference is already present;
- preserve all supplied reference values in conversation state and final submission;
- never invent a reference or prior-contact answer.

## CRM Resolution

### Reference collection

Build a deduplicated list from `priorContactReference` and the existing support identifiers: invoice number, customer number, payment reference, order number, offer number, lead ID, contract reference, and spare-part reference.

Only non-empty references of a usable minimum length are searched. Searches use Pipedrive deal custom fields and title where supported. API failures propagate and must never be interpreted as “no match.”

### Reference result rules

- Exactly one matching open deal with a person: select that person and deal.
- The same reference returning the same deal through more than one search path still counts once.
- Multiple matching open deals: do not select a deal or create another one; return an internal review outcome.
- A matching deal without a person: do not auto-link; return internal review.
- A reference match and an exact email/phone match pointing to different people: do not mutate either record; return identity review.
- A unique open reference match with no existing email/phone match may be used because the exact reference identifies the case. The newly supplied contact method can update the matched person only after safe case resolution.
- Closed, won, or lost deals are never reopened automatically.

When no reference resolves a case, use the existing policy unchanged:

- exact normalized email and phone are the strongest person identifiers;
- normalized name requires address corroboration in the lead funnel;
- exactly one open deal is reused;
- zero open deals permits creation;
- multiple open deals require manual review.

The `priorContact` answer alone never changes these rules.

### Notes and internal notification

Created or reused notes include the prior-contact status and supplied reference so the team understands why the conversation was routed. Internal notification email includes the same fields.

The browser continues to receive only a generic accepted result and never receives Pipedrive IDs, matching outcomes, ambiguity details, or internal errors.

## Failure Handling

- Refusing or being unable to answer the prior-contact question must not block the flow; record `unknown`.
- Missing references after `yes` fall back to one prior email or telephone number.
- Invalid or very short references are retained as conversation context but are not used for automatic CRM matching.
- Reference-search failures do not fall through to person or deal creation.
- Conflicting identifiers and multiple candidate cases go to internal review without exposing the reason to the user.
- Notification delivery remains independent of CRM success.
- In-memory session deduplication and cross-session CRM reuse remain active.

## Testing

### Prompt and tool-contract tests

- Both funnels contain the prior-contact question and the selected reference-first wording.
- Explicit prior-contact language or an existing reference prevents redundant questions.
- `yes`, `no`, and `unknown` survive `report_state` buffering and final tool submission.
- `yes` asks for a reference before contact details.
- A missing reference falls back to either email or telephone.
- Supplying one valid contact method prevents Sarah from asking for the other.
- Every response still asks for at most one new piece of information.

### Pipedrive service tests

- A unique open reference deal is reused and receives a pinned note.
- Duplicate search hits for the same deal are deduplicated.
- Reference plus exact contact agreement reuses the case.
- Reference/contact conflict creates no person, deal, update, or note.
- Multiple reference-matched deals create no deal and produce review.
- Closed reference matches are not reopened.
- A reference-search API failure produces no CRM mutation.
- `no` and `unknown` still use the safe existing case-reuse logic.

### Route and email tests

- Prior-contact fields reach Pipedrive and internal email in both funnels.
- Browser actions remain generic for created, reused, review, and failed outcomes.
- Email is still attempted when CRM lookup fails.
- Repeated events in one session remain idempotent.

### End-to-end verification

Run the full backend suite and TypeScript build. After deployment, create clearly labeled test records and verify both funnels with separate, empty-history sessions:

1. Establish one person and one open case.
2. Submit a returning request that answers `yes` and supplies an exact test reference plus only one contact method.
3. Close the session completely.
4. Submit a second returning request with a new session ID and empty history.
5. Read Pipedrive back directly and confirm the same person and same single open deal received new pinned notes.
6. Confirm browser responses contain no CRM details and production remains healthy.

## Non-Goals

- Fuzzy reference matching.
- Treating a yes answer as sufficient identity evidence.
- Asking for both email and telephone.
- Automatically choosing among multiple matching open deals.
- Reopening closed deals or changing deal pipeline, stage, owner, or status.
- Merging historical duplicate people or deals.
