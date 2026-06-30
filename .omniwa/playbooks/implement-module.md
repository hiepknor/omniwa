# Implement Module Playbook

## Goal

Implement one approved module or slice with traceability and boundary safety.

## Workflow

1. Identify the module, use case, workflow, command/query, aggregate, repository port, API resource, infrastructure component, and runtime process involved.
2. Read the matching context summaries and freeze documents.
3. Select `skills/implementation`.
4. Check ADRs for dependencies, package boundaries, provider, async, transaction, logging, and testability.
5. Plan the smallest vertical or inner-layer slice.
6. Run pre-flight validation: clean/understood git status, no hidden ADR need, no freeze-doc change planned, no scope creep.
7. Implement according to the frozen dependency direction.
8. Add tests at the lowest useful layer first.
9. Add integration or contract tests when an adapter boundary is touched.
10. Review the working diff for scope, accidental files, generated artifacts, secrets, env files, freeze/ADR drift, and unexpected edits.
11. Self-review the change for architecture boundaries, business-rule placement, data safety, error handling, test adequacy, and residual risk.
12. Run required gates.
13. Update non-freeze documentation only when behavior or operation instructions change.
14. Review staged diff before commit.
15. Summarize validation and residual risk.

## Guardrails

- API maps to Application only.
- Application uses Domain and ports only.
- Domain does not import Infrastructure.
- Infrastructure adapters do not own product policy.
- Provider integration remains behind approved ports.
- Accepted async work must be visible and recoverable.

## Done

- Traceability is documented.
- Working diff was reviewed.
- Self review was completed.
- Staged diff was reviewed before commit.
- Tests match risk.
- Sensitive data rules are preserved.
- Definition of Done is satisfied.
