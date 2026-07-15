# Unmatched Support Requests in Pipedrive

## Goal

Every completed Sarah service handoff must have a durable, searchable Pipedrive deal and a complete transcript, even when no existing customer or case can be matched safely.

## CRM behavior

- A unique match with an open deal continues to reuse that deal.
- A unique person without an open deal gets a new support deal linked to that person.
- An unresolved or ambiguous match creates a new contact record from the submitted name and contact method, then creates a new support deal marked for manual assignment. Existing ambiguous candidates are never guessed or modified.
- The compact support note records the original match state (`unique`, `unresolved`, or `ambiguous`) and is pinned to the person and deal.
- The complete chat transcript is written after Sarah finishes streaming and is pinned to the same person and deal before the route emits `done`.

## Deal shape

New support deals use the configured Sarah pipeline and stage, the existing inbound Sarah channel, the Berlin-local request date, and a title in the form `Sarah Support [category]: customerName`. They use the existing Sarah/Pipedrive owner and visibility settings.

## Failure behavior

The internal support email remains independent and is attempted even when Pipedrive fails. A completed handoff is not cached and the route does not emit `done` when it cannot create or resolve a concrete Pipedrive person and deal. This keeps a retry possible and prevents false completion.

## Verification

- Unit tests cover creating a new person and deal, reusing a matched person without a deal, and preserving ambiguous/unresolved state in the note.
- Route tests cover unresolved and ambiguous handoffs, transcript pinning, internal email delivery context, and CRM failure gating.
- The full backend suite and TypeScript build must pass.
- A tagged live support chat must create a Pipedrive person, deal, compact note, and complete transcript. The synthetic records are deleted after verification.
