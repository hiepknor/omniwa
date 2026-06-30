# Review Examples

## Critical Finding

Critical: API handler calls a provider adapter directly instead of an Application command.

Impact:

- Violates API boundary and provider abstraction.
- Bypasses Application authorization, idempotency, and event timing.

Recommendation:

- Route through the approved Application command.

## Major Finding

Major: Repository implementation returns provider-native payload fields.

Impact:

- Leaks external provider details into Domain/Application.
- Risks making provider payload a product contract.

Recommendation:

- Translate to approved product concepts or keep payload internal to adapter diagnostics.

## Minor Finding

Minor: Test covers success path but not invalid state transition.

Impact:

- Domain invariant may regress.

Recommendation:

- Add a negative Domain test.

