# Platform Evolution ADRs

This directory contains ADRs created after the original architecture freeze to govern incremental
platform evolution.

## Scope

- `docs/architecture/adr/` contains the frozen Phase 1 architecture ADR set.
- `docs/adr/` contains post-freeze platform decisions required to evolve the implementation toward
  OmniWA Platform.
- ADRs here must not silently override frozen architecture documents. If a decision conflicts with a
  freeze document, the ADR must state the conflict and migration path explicitly.

## Numbering Convention

OmniWA intentionally has two ADR number spaces:

- Three-digit ADRs (`ADR-0NN`) belong to the frozen Phase 1 architecture set in
  [`docs/architecture/adr/`](../architecture/adr/).
- Four-digit ADRs (`ADR-0NNN`) belong to post-freeze platform evolution in this directory.

When citing an ADR, include the exact number of digits so `ADR-005` from the frozen architecture set
is not confused with `ADR-0005` from platform evolution.

## Status Policy

- `Accepted` means the decision is active and implementation must follow it.
- `Proposed` means the decision is still open and implementation must not rely on it as final.
- Superseded decisions must remain in history and link to their replacement ADR.

## Implementation Rule

Implementation work should read this directory together with:

- `docs/platform-evolution/ARCHITECTURE_FREEZE.md`
- `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`
- `../../AGENTS.md`

When code pressure reveals a new architecture decision, stop the implementation change and create or
update an ADR before continuing.
