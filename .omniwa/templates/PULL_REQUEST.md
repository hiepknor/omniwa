# Pull Request: [Title]

## Summary

[What changed and why.]

## Traceability

| Area           | Reference   |
| -------------- | ----------- |
| Product        | [Reference] |
| Architecture   | [Reference] |
| Domain         | [Reference] |
| Application    | [Reference] |
| API            | [Reference] |
| Persistence    | [Reference] |
| Infrastructure | [Reference] |
| Engineering    | [Reference] |

## Boundary Checks

- [ ] API does not bypass Application.
- [ ] Application does not depend on concrete Infrastructure.
- [ ] Domain contains business rules and no infrastructure concepts.
- [ ] Repository Ports are not bypassed.
- [ ] Provider-native payloads do not leak.
- [ ] Sensitive data rules are preserved.
- [ ] Freeze documents and ADRs are unchanged unless explicitly approved.

## Diff And Self Review

- [ ] Working diff reviewed.
- [ ] No unexpected files, generated artifacts, secrets, env files, or local-only files included.
- [ ] Self review completed for boundary, safety, test, and documentation impact.
- [ ] Staged diff reviewed before commit.

## Tests

- [ ] Unit
- [ ] Integration
- [ ] Contract
- [ ] Architecture
- [ ] Security/redaction
- [ ] E2E or not applicable

## Risk and Rollback

[Risk, mitigation, rollback notes.]
