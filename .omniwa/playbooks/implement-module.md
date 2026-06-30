# Implement Module Playbook

## Goal

Implement one approved module or slice with traceability and boundary safety.

## Workflow

1. Identify the module, use case, workflow, command/query, aggregate, repository port, API resource, infrastructure component, and runtime process involved.
2. Read the matching context summaries and freeze documents.
3. Select `skills/implementation`.
4. Check ADRs for dependencies, package boundaries, provider, async, transaction, logging, and testability.
5. Plan the smallest vertical or inner-layer slice.
6. Implement according to the frozen dependency direction.
7. Add tests at the lowest useful layer first.
8. Add integration or contract tests when an adapter boundary is touched.
9. Update non-freeze documentation only when behavior or operation instructions change.
10. Run validation and summarize residual risk.

## Guardrails

- API maps to Application only.
- Application uses Domain and ports only.
- Domain does not import Infrastructure.
- Infrastructure adapters do not own product policy.
- Provider integration remains behind approved ports.
- Accepted async work must be visible and recoverable.

## Done

- Traceability is documented.
- Tests match risk.
- Sensitive data rules are preserved.
- Definition of Done is satisfied.

