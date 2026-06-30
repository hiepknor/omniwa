# Implementation Checklist

## Before Editing

- [ ] User request maps to approved scope.
- [ ] Traceability chain is documented.
- [ ] Package/layer ownership is clear.
- [ ] Required tests are identified.
- [ ] Sensitive data classification is clear.

## While Editing

- [ ] No forbidden imports are introduced.
- [ ] Business logic stays in Domain.
- [ ] Application does orchestration only.
- [ ] Interface/API does mapping only.
- [ ] Infrastructure does technical integration only.
- [ ] Provider-native payloads stay behind adapters.
- [ ] Repository ports are not bypassed.

## Before Done

- [ ] Tests run or inability is reported.
- [ ] Architecture boundary checks considered.
- [ ] Documentation updated only where appropriate.
- [ ] Freeze and ADR files are unchanged unless explicitly approved.
- [ ] Definition of Done is satisfied.

