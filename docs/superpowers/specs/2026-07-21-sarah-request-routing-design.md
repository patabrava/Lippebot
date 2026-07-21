# Sarah Request Routing and Service Request Design

## Goal

Preserve Sarah's natural conversational interface while enforcing the approved sales and service decision tree deterministically. Every actionable concern must be matched, written to Pipedrive when permitted, routed to the responsible email address, and verified without guessing a person or case.

The original ownership-based structure remains authoritative. The new rules add safe identity matching, exact factory-number matching, departmental recipients, emergency handling, independent request tracking, and live end-to-end verification.

## Architectural Approach

Use a hybrid workflow:

- Sarah interprets the conversation, asks naturally for missing information, and answers general informational questions.
- A backend state machine owns request state, validation, CRM matching, allowed side effects, routing, idempotency, and completion.
- The model may propose a structured transition or submission, but only deterministic backend policy may authorize CRM or email operations.

This keeps the chat flexible without relying on prompt compliance for business-critical actions.

## Request Lifecycle

Every actionable concern receives a unique `requestId` and progresses through:

`collecting -> matching -> ready -> processing -> completed | failed`

Only one request is active at a time within a visible chat. After a request completes, Sarah asks whether the customer has another concern. A new concern receives a new `requestId` and clean workflow state, while previously verified name and contact information may be reused.

Idempotency is scoped to `requestId`, not the browser session. The backend stores the outcome of each required side effect so a retry continues from the missing step instead of creating another person, opportunity, Serviceanfrage, note, or email.

## When the Decision Tree Starts

Sarah answers general informational questions directly. She starts the ownership decision tree only when the customer wants an actionable quote, purchase, service, repair, maintenance, invoice, payment, spare-parts, installation, warranty, contract, order-status, or related handoff.

Sarah must not repeatedly ask for information already supplied and verified in the current chat.

## Safety Override

At any point, language indicating that a person is trapped, injured, or exposed to immediate danger interrupts the ordinary questionnaire.

- For injury or immediate danger, Sarah displays `112`.
- For urgent LIPPE Lift service, Sarah displays `+49 (0)5261 9666-0`.
- Sarah must not describe the LIPPE Lift number as a 24-hour hotline.
- The emergency response is shown immediately and does not wait for CRM or email operations.

If the customer also wants a normal follow-up request, Sarah may collect it only after displaying the emergency instructions.

## Required Handoff Data

Before completing any ordinary email-only or CRM-linked handoff, Sarah must have:

- first and last name;
- one usable contact method: telephone or email;
- a concise description of the concern;
- the request category;
- manufacturer and factory number when the selected branch requires them.

New-opportunity flows retain the existing qualification fields, including lift type, staircase or installation location, building type, intended user, accessibility needs, address, and preferred contact time.

## Customer Does Not Own a Lift

Sarah asks whether the customer has already spoken with a LIPPE Lift employee about this exact intended purchase.

### Identity and opportunity lookup

The logical lookup sequence is:

1. first and last name to establish candidates;
2. telephone to corroborate or reduce candidates;
3. email to corroborate or reduce candidates.

Name alone never authorizes automatic linking. Strong supplied identifiers must agree. Conflicting identifiers, multiple candidates, or multiple open sales opportunities produce manual review without an automatic CRM write.

### Prior employee contact: yes

- One uniquely confirmed person and one uniquely confirmed open sales opportunity: reuse that opportunity and attach the request context according to the existing sales workflow.
- No unique match, conflicting identity, or multiple possible opportunities: send an internal email for manual review and create or change nothing in Pipedrive.

### Prior employee contact: no

The same lookup still runs to prevent duplicates.

- One uniquely confirmed open sales opportunity: reuse it.
- No existing person or open opportunity: create the new sales opportunity using the existing qualified-lead format.
- Conflicting identity, multiple people, or multiple open opportunities: send an internal email for manual review and create or change nothing in Pipedrive.

Sales matching must be restricted to sales opportunities. A service deal must never be reused as a sales opportunity, and a sales opportunity must not be treated as an existing Serviceanfrage.

## Customer Owns a Lift

Sarah asks whether the installed lift is a LIPPE Lift.

### Lift from another manufacturer

The concern is classified as a service request, but the handoff is email-only. Sarah does not search for, create, update, or annotate a Pipedrive person or deal.

### LIPPE Lift

Sarah displays a fixed image or GIF showing the label location and asks the customer to type the factory number. This version does not accept a label photo and does not perform OCR.

The backend searches the Pipedrive deal field named `Fabriknummer` for an exact normalized value. The field identity must be discovered and verified against live Pipedrive metadata during implementation; the human-readable field name is the stable design contract.

Outcomes:

- Exactly one matching case: the person and original deal are safe to reference.
- No match, multiple matches, unavailable number, or search failure: email-only manual review with no Pipedrive mutation.

Search failure must not be treated as zero results.

## Maintenance and Repair

Maintenance and repair are always email-only, including when the factory number uniquely identifies a case.

When a unique match exists, the internal email contains the exact original Pipedrive case URL and deal ID. The match is read-only: no new deal, note, activity, person update, or existing-deal update is permitted.

## Eligible Serviceanfrage Creation

For a non-maintenance and non-repair service concern with exactly one factory-number match, create a separate Pipedrive deal in the location demonstrated by the approved screenshot:

- pipeline: `Akquise`;
- stage: `Kontaktieren`;
- title: `Serviceanfrage - <Vorname Nachname>`;
- person: the uniquely matched customer;
- owner: Marco Lossau;
- value: `0 EUR`;
- original case: record its exact deal ID and canonical Pipedrive URL in the new deal's note.

The Serviceanfrage note must contain:

- request ID;
- source: Sarah chat;
- category;
- concise issue summary;
- first and last name;
- supplied telephone or email;
- manufacturer;
- factory number;
- original deal ID and direct URL;
- full conversation transcript for this request;
- creation timestamp in `Europe/Berlin`.

Live readback during design confirmed the current IDs as pipeline `1`, stage `2`, and Marco Lossau user `24093328`. The implementation must verify these ID-to-name mappings against live Pipedrive metadata before writing and fail safely if any mapping has changed or does not resolve uniquely.

## Departmental Email Routing

The configured category addresses become actual recipients rather than metadata:

- maintenance, repair, and technical concerns: `technik@lippelift.de`;
- invoices and payments: `finance@lippelift.de`;
- sales, contracts, and order status: `sales@lippelift.de`;
- spare parts, installation, manufacturing, warranty, and after-sales coordination: `lossau@lippelift.de`.

Routing must yield exactly one primary department for each request. The recipient is selected by backend policy, not generated freely by the model.

## Internal Email Format

Every internal email uses the existing approved notification structure and adds the new routing fields. It must contain:

- a unique, readable subject identifying the request category and customer;
- request ID;
- category and department;
- customer name and supplied contact method;
- concise issue summary;
- manufacturer and factory number when applicable;
- CRM matching status;
- exact Pipedrive person and deal links only when uniquely resolved;
- original-case link and newly created Serviceanfrage link when applicable;
- full transcript for the individual request.

Unresolved cases state `Manuelle Prüfung erforderlich` internally and contain no guessed CRM link. CRM details and recipient addresses remain invisible to the customer.

## Side-Effect Ordering and Completion

For a request that requires a CRM write:

1. validate the request data;
2. resolve identity and case;
3. create or reuse the permitted CRM record;
4. read back and validate the resulting CRM record;
5. send the departmental email;
6. mark the request completed;
7. show the customer a generic success confirmation.

For email-only branches, steps 3 and 4 are replaced by a recorded decision proving that CRM mutation is forbidden.

If CRM creation succeeds and email delivery fails, the created deal ID is retained. A retry sends only the missing email and must not create a second deal. If a required operation fails, Sarah says that the request could not be submitted yet and offers a retry. She must not claim completion prematurely.

## Customer-Facing Behavior

Sarah remains natural and concise. She must:

- ask only for missing data;
- never expose Pipedrive terminology, internal recipients, match candidates, or failure details;
- use a generic successful-handoff confirmation only after all required operations succeed;
- complete permitted email-only fallbacks without telling the customer that CRM matching failed;
- ask `Haben Sie noch ein weiteres Anliegen?` after a successful request;
- create a fresh request for the next concern while retaining verified contact information.

## Automated Verification

Unit and integration tests must cover:

- informational questions that do not start a workflow;
- new buyers with and without prior employee contact;
- name candidates corroborated by telephone or email;
- unique, missing, ambiguous, and conflicting identity results;
- zero, one, and multiple open sales opportunities;
- LIPPE and third-party lifts;
- exact, absent, zero-match, duplicate, and failed factory-number searches;
- maintenance and repair email-only behavior;
- eligible Serviceanfrage creation in `Akquise -> Kontaktieren`;
- exact person attachment and original-case URL and ID in the note;
- all four departmental recipients;
- emergency interruption;
- two concerns in one chat with different request IDs;
- CRM failure, email failure, retry, process restart, and duplicate prevention;
- absence of CRM data from customer-facing responses.

The backend test suite, widget tests, TypeScript build, and relevant lint checks must pass before deployment.

## Mandatory Live End-to-End Matrix

Implementation is not complete until the production-like or approved live environment has exercised every use-case family below and the evidence has been read back from Pipedrive and email delivery.

Each live case receives a visible identifier in its email subject and test data:

`[LIPPEBOT E2E][UC-<number>][<run-id>] <use-case name>`

The same `UC-<number>` and run ID must appear in the request ID, test customer's identifying data or note, and any created deal title or note. This allows the user to understand exactly which use case produced each email and CRM record.

Required live cases:

| ID | Use case | Expected CRM result | Expected email |
| --- | --- | --- | --- |
| UC-01 | New buyer, no prior contact, no existing record | New sales opportunity | `sales@lippelift.de` |
| UC-02 | New buyer, no prior contact, unique existing opportunity | Reuse exact sales opportunity | `sales@lippelift.de` |
| UC-03 | New buyer, prior contact, unique existing opportunity | Reuse exact sales opportunity | `sales@lippelift.de` |
| UC-04 | New buyer, prior contact, no unique match | No CRM mutation | `sales@lippelift.de` manual review |
| UC-05 | New buyer, ambiguous person or multiple opportunities | No CRM mutation | `sales@lippelift.de` manual review |
| UC-06 | Third-party lift service concern | No CRM mutation | Category department |
| UC-07 | LIPPE lift, factory number unavailable or unmatched | No CRM mutation | Category department, manual review |
| UC-08 | LIPPE lift, duplicate factory-number matches | No CRM mutation | Category department, manual review |
| UC-09 | LIPPE lift, exact match, maintenance | No CRM mutation | `technik@lippelift.de` with original-case link |
| UC-10 | LIPPE lift, exact match, repair | No CRM mutation | `technik@lippelift.de` with original-case link |
| UC-11 | LIPPE lift, exact match, eligible technical service | New Serviceanfrage in `Akquise -> Kontaktieren` | `technik@lippelift.de` |
| UC-12 | LIPPE lift, exact match, invoice or payment | New Serviceanfrage in `Akquise -> Kontaktieren` | `finance@lippelift.de` |
| UC-13 | LIPPE lift, exact match, sales/contract/order status | New Serviceanfrage in `Akquise -> Kontaktieren` | `sales@lippelift.de` |
| UC-14 | LIPPE lift, exact match, spare parts/installation/warranty/after-sales | New Serviceanfrage in `Akquise -> Kontaktieren` | `lossau@lippelift.de` |
| UC-15 | Two sequential concerns in one chat | Two independent outcomes, no suppression | Two subjects with distinct request IDs |
| UC-16 | Retry after simulated email failure | No duplicate CRM record | One eventual successful delivery |
| UC-17 | Emergency wording | No automatic CRM mutation before warning | Immediate `112` and company-number response |

Additional automated failure injection covers Pipedrive unavailability and email transport failure. Live destructive failure injection is not required against production when it would risk customer operations; the retry behavior must still be proven in an isolated environment and followed by a safe live idempotency check.

## Live Pipedrive Readback Requirements

For every CRM-writing live case, verification must query Pipedrive after the chat completes and record:

- person ID and exact identity fields used;
- deal ID, title, pipeline, stage, status, owner, and value;
- direct deal URL;
- note contents;
- original referenced deal ID and URL;
- factory number on the matched source deal;
- count of matching deals before and after the test;
- request ID and use-case subject marker.

For every email-only live case, verification must query Pipedrive by the run ID, customer identifiers, and factory number and prove that the deal, note, activity, and person counts did not increase unexpectedly.

The expected Serviceanfrage format is:

- title `Serviceanfrage - <Vorname Nachname>`;
- pipeline `Akquise` (currently ID `1`);
- stage `Kontaktieren` (currently ID `2`);
- owner Marco Lossau (currently user ID `24093328`);
- value `0 EUR`;
- uniquely matched person attached;
- structured note with issue, contact, manufacturer, factory number, request ID, transcript, and original-case deal ID and URL.

Screenshots alone are insufficient. Verification uses API readback as the source of truth, with screenshots or direct URLs added as human-readable evidence.

## Completion Gate

The work must not be reported as complete while any required automated test, build, live use case, email delivery, or Pipedrive readback is missing or inconsistent. The final handoff must present a use-case-by-use-case table with subject, request ID, expected result, actual result, email recipient, Pipedrive IDs and links, and pass/fail status.

If an external dependency prevents a required check, the work remains incomplete and the exact blocker is reported; it is not converted into an assumed pass.

## Out of Scope

- Customer photo upload or OCR for the factory label.
- Guessing between ambiguous people, factory numbers, or deals.
- Automatically merging historical duplicate people or deals.
- Creating Pipedrive records for maintenance, repair, third-party lifts, or unresolved matches.
- Advertising the main company number as a 24-hour emergency hotline.
