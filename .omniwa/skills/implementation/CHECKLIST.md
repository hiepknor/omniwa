# Implementation Checklist

## Before Editing

- [ ] User request maps to approved scope.
- [ ] Traceability chain is documented.
- [ ] Package/layer ownership is clear.
- [ ] Required tests are identified.
- [ ] Sensitive data classification is clear.
- [ ] Git status is checked and existing changes are understood.
- [ ] No freeze/ADR edit is planned unless explicitly requested.
- [ ] No architecture-affecting dependency or technology choice is hidden in the task.

## While Editing

- [ ] No forbidden imports are introduced.
- [ ] Business logic stays in Domain.
- [ ] Application does orchestration only.
- [ ] Interface/API does mapping only.
- [ ] Infrastructure does technical integration only.
- [ ] Provider-native payloads stay behind adapters.
- [ ] Repository ports are not bypassed.

## Before Done

- [ ] Working diff reviewed with `git diff --name-only` and `git diff --stat`.
- [ ] No unexpected file, generated artifact, secret, env file, or freeze/ADR drift is present.
- [ ] Self review completed against architecture, domain, application, API, persistence, infrastructure, security, and test boundaries as applicable.
- [ ] Tests run or inability is reported.
- [ ] Architecture boundary checks considered.
- [ ] Documentation updated only where appropriate.
- [ ] Freeze and ADR files are unchanged unless explicitly approved.
- [ ] Staged diff reviewed with `git diff --cached --name-only` and `git diff --cached --stat` before commit.
- [ ] Definition of Done is satisfied.
