# Review Checklist

- [ ] Product scope preserved.
- [ ] Architecture dependency direction preserved.
- [ ] Package boundaries preserved.
- [ ] Domain invariants stay in Domain.
- [ ] Application does not contain business rules.
- [ ] API does not bypass Application.
- [ ] Infrastructure does not leak into Domain/Application.
- [ ] Provider-native payloads are contained.
- [ ] Repository ports are not bypassed.
- [ ] Queries are side-effect free.
- [ ] Async accepted work is visible and recoverable.
- [ ] Sensitive data is redacted and not persisted in unsafe places.
- [ ] Tests match risk and blast radius.
- [ ] Docs and traceability are updated where needed.
- [ ] No freeze or ADR drift exists.

