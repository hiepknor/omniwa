# OmniWA Agent Operating Guide

## Mission

This file is the entry point for AI coding agents working in this repository.

Your mission is to implement OmniWA exactly from the frozen product, architecture, domain, application, API, persistence, infrastructure, and engineering specifications. Treat this guide and `.omniwa/` as the AI control layer. It is not product documentation and it does not override any freeze document.

## Repository Status

- Product is frozen.
- Architecture is frozen.
- Domain is frozen.
- Application is frozen.
- API is frozen.
- Persistence is frozen.
- Infrastructure is frozen.
- Engineering planning is frozen.
- The project is ready for Phase 8 - Implementation.
- Phase 8 Sprint 0 repository bootstrap skeleton is present.
- Business feature implementation has not started unless a later commit adds it.

## Required Reading

Before doing any implementation work, read in this order:

1. `README.md`
2. `AGENTS.md`
3. `.omniwa/README.md`
4. `.omniwa/context/architecture.md`
5. The `.omniwa/context/` file for the area you will touch
6. `.omniwa/SKILL_MAPPING.md`
7. The relevant `.omniwa/skills/*/SKILL.md`, `CHECKLIST.md`, and `EXAMPLES.md`
8. The relevant `.omniwa/playbooks/*.md`
9. The relevant freeze documents under `docs/`
10. The relevant ADRs under `docs/architecture/adr/`

For implementation tasks, also read:

- `docs/engineering/IMPLEMENTATION_FREEZE.md`
- `docs/engineering/ENGINEERING_PLAN.md`
- `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md`
- `docs/engineering/PACKAGE_LAYOUT.md`
- `docs/engineering/CODING_STANDARD.md`
- `docs/engineering/TESTING_STRATEGY.md`
- `docs/engineering/DEFINITION_OF_DONE.md`

## AI Workflow

Use this workflow for every non-trivial task:

```text
Classify Task
  -> Read Required Context
  -> Build Traceability
  -> Select Skill + Playbook + Template
  -> Plan
  -> Pre-flight Validation
  -> Implement
  -> Review Diff
  -> Self Review
  -> Run Gates
  -> Review Staged Diff
  -> Update Docs / Memory
  -> Commit / Report Done
```

Do not skip validation just because a change is small. Small changes can still violate a frozen boundary.

Review Diff and Self Review are different gates:

- Review Diff checks mechanical scope: changed files, generated artifacts, freeze/ADR drift, secrets, env files, and unexpected edits.
- Self Review checks technical quality: boundaries, business-rule placement, test coverage, data safety, error handling, and residual risk.
- Review Staged Diff is the final commit gate: verify exactly what will be committed.

Minimum diff commands before commit:

```text
git diff --name-only
git diff --stat
git diff --cached --name-only
git diff --cached --stat
```

## Non-negotiable Rules

- Do not modify freeze documents unless the user explicitly requests a formal review/ADR flow.
- Do not modify accepted ADRs to fit implementation convenience.
- Do not add product scope outside the frozen MVP.
- Do not add dependencies that affect architecture, runtime, persistence, provider, queue, security, or deployment without ADR review.
- Do not bypass Application for product behavior.
- Do not let API call Domain, Provider, Baileys, database, queue, Redis, Object Storage, or Infrastructure directly for product behavior.
- Do not put business rules in Interface, Infrastructure, Provider, Persistence, Queue, Webhook, or Observability code.
- Do not bypass Repository Ports.
- Do not let provider-native payloads become Domain, API, webhook, audit, telemetry, or persistence contracts.
- Do not log, cache, project, trace, expose, archive, or place Secret/raw Confidential values in object paths.
- Do not make Redis durable source of truth.
- Do not make Object Storage business metadata source of truth.
- Do not implement unsupported message types, Multi Tenant, campaign, broadcast, analytics, billing, AI agent features, or group features without approved future decisions.

## ADR Policy

An ADR is required when a task would change or select:

- architecture style or dependency direction,
- package boundaries or module ownership,
- provider abstraction or Baileys coupling,
- runtime process boundaries,
- database, queue, cache, object storage, framework, or deployment technology,
- security, secret, retention, backup, or recovery posture,
- event, transaction, idempotency, or async job semantics.

If an ADR is needed, stop implementation work and prepare an ADR proposal using `.omniwa/templates/ADR.md`.

## Freeze Policy

Frozen documents are baselines, not suggestions. Implementation can add code and implementation-time docs, but it must not change frozen decisions.

If a task cannot trace to approved documents, do not implement it. Create an issue or ADR proposal explaining the gap.

## Implementation Rules

- Build in the order defined by `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md`.
- Keep implementation traceable to Product Feature -> Use Case -> Workflow -> Command/Query -> Aggregate -> Repository Port -> API Resource -> Infrastructure Component -> Runtime Process.
- Implement inner layers before outer adapters.
- Use fakes and contract tests before concrete infrastructure adapters.
- Protect redaction, Clock, UUID, correlation, and SecretProvider boundaries early.
- Keep accepted async work durable and visible before returning accepted/queued state.
- Keep queries side-effect free.

## Definition of Done

A task is done only when:

- the change maps to approved documents,
- implementation follows dependency and package boundaries,
- tests required by the changed area pass,
- architecture fitness expectations are preserved,
- sensitive data rules are preserved,
- documentation is updated when behavior or operating instructions change,
- no freeze document or ADR was modified without approval,
- diff review, self review, and staged diff review are complete,
- review findings are resolved or explicitly accepted.

## Escalation Rules

Stop and escalate when:

- a frozen document blocks the requested implementation,
- a new dependency or technology choice is needed,
- a business rule appears missing or contradictory,
- a data retention/security decision is unclear,
- a direct provider/API/persistence shortcut looks necessary,
- the task would expand product scope,
- tests require real WhatsApp credentials for normal PR validation.

Use `.omniwa/templates/ISSUE.md`, `.omniwa/templates/ADR.md`, or the relevant review template to document the escalation.
