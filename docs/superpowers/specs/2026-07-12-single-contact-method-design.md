# Sarah Single Contact Method Design

**Date:** 2026-07-12
**Status:** Approved
**Scope:** New sales or consultation requests and existing-customer support requests

## 1. Goal

Sarah must collect at most one contact method from a user. A usable telephone number or a usable email address satisfies the contact requirement. After receiving either value, Sarah proceeds with the handoff and does not request the other value.

This rule applies consistently to both the new-lead flow and the support flow.

## 2. Conversation Behavior

If the user already supplied a telephone number or email address, Sarah preserves it and does not ask another contact question.

If neither contact method is available when contact information is required, Sarah asks one natural preferred-contact question:

> Wie können wir dich am besten erreichen? Schick mir bitte entweder deine Telefonnummer oder deine E-Mail-Adresse.

Sarah accepts whichever value the user supplies. She must not ask for both values, and she must not follow a telephone number with an email request or an email address with a telephone request.

If the supplied value is missing or unusable, Sarah may repeat the single preferred-contact request without switching to a second mandatory contact field. At least one usable telephone number or email address remains required for completing either flow.

## 3. Application Rules

### 3.1 New-lead flow

- Replace the telephone-only requirement with a single contact-method requirement.
- The lead submission contract accepts telephone-only and email-only leads.
- The backend completion gate treats `phone OR email` as complete, provided all other required lead fields are present.
- Pipedrive person lookup, creation, and update use whichever contact values are present and never write placeholder telephone data for an email-only lead.
- Lead notification emails render missing contact fields cleanly.

### 3.2 Support flow

- When support requires a contact or identity disambiguator, Sarah requests one preferred contact method and accepts telephone or email.
- Receiving either contact method is enough; Sarah does not request the other.
- The support submission contract and backend validation enforce the same `phone OR email` invariant.
- Existing support routing, category selection, note creation, and team email behavior remain unchanged.

## 4. System Boundaries

The invariant must be enforced in every layer that can otherwise reintroduce the old behavior:

1. The system prompt describes one preferred-contact step in both modes.
2. Gemini function declarations allow either contact method without requiring telephone specifically.
3. Backend completion checks share an explicit contact-method predicate.
4. Pipedrive payload construction conditionally includes telephone and email fields.
5. Notification formatting omits unavailable values rather than showing placeholders.

The widget requires no visual or interaction redesign because Sarah's message remains the user-facing control.

## 5. Data Flow

1. Sarah collects the flow-specific business information.
2. If the conversation state already contains `phone` or `email`, Sarah skips contact collection.
3. Otherwise, Sarah asks the single preferred-contact question.
4. The first usable telephone number or email address satisfies the contact requirement.
5. Gemini submits the lead or support request.
6. The backend validates that at least one contact method exists.
7. Pipedrive and notification services receive only the available contact fields.
8. Sarah confirms the handoff without requesting additional contact information.

## 6. Error Handling

- Neither contact method present: do not submit; ask the one preferred-contact question.
- Telephone-only input: submit without requesting email.
- Email-only input: submit without requesting telephone.
- Both values volunteered in the same or earlier messages: preserve both, but never solicit the second value.
- Invalid or blank contact value: keep the request incomplete and ask again for either one usable value.
- Pipedrive or email delivery failure: retain existing server-side failure handling and customer-safe wording.

## 7. Testing

Automated coverage must prove:

- new-lead completion with telephone only;
- new-lead completion with email only;
- new-lead rejection when both are absent;
- support completion with telephone only;
- support completion with email only;
- support rejection when both are absent;
- Pipedrive person search and payload generation for telephone-only and email-only leads;
- no placeholder telephone value in email-only Pipedrive payloads;
- prompt assertions that Sarah asks for one preferred contact method and never requires both;
- existing behavior remains valid when users volunteer both values.

The relevant backend test suite, type checking, and production build must pass before completion.

## 8. Non-Goals

- Changing the remaining lead qualification fields or their order.
- Redesigning the widget UI.
- Changing support routing destinations or Pipedrive matching rules beyond accepting either contact method.
- Making contact information optional altogether.
