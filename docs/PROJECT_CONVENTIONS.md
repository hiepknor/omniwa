# OmniWA Project Conventions

This document defines collaboration and documentation conventions for the project. It intentionally avoids source code structure, API shape, database design, and system architecture.

## Naming

### Product Name

The product name is `OmniWA`.

Use `OmniWA` in prose, documentation titles, and product-facing references.

### Domain Terms

Use glossary terms consistently. For example:

- Use `instance` for a managed WhatsApp connection.
- Use `session` for the underlying connection/auth state associated with an instance.
- Use `webhook` for outbound event delivery to external systems.
- Use `queue` for asynchronous work coordination at the product level.

Benefit: shared language reduces design ambiguity.

Trade-off: some terms may differ from Baileys naming. When that happens, document the mapping instead of mixing terms.

## Folder Convention

Documentation should live under `docs/`.

Recommended documentation areas:

- `docs/VISION.md` for product direction.
- `docs/PRODUCT_SCOPE.md` for product boundaries and MVP.
- `docs/NON_FUNCTIONAL_REQUIREMENTS.md` for quality requirements.
- `docs/ROADMAP.md` for phase planning.
- `docs/PROJECT_CONVENTIONS.md` for collaboration rules.
- `docs/GLOSSARY.md` for shared terminology.
- `docs/RISKS.md` for risk tracking.
- `docs/SUCCESS_METRICS.md` for product and operational metrics.
- `docs/OPEN_QUESTIONS.md` for decisions blocking the next phase.
- `docs/DECISIONS.md` for accepted product decisions that resolve phase gates.
- Future `docs/adr/` for Architecture Decision Records.
- Future `docs/rfc/` for larger proposals.

Trade-off: centralizing docs under `docs/` is simple, but large future documentation may need subfolders to remain readable.

## Documentation Rule

Every meaningful product or technical decision should be documented before implementation becomes dependent on it.

Documentation should include:

- Context.
- Decision or proposed direction.
- Assumptions.
- Benefits.
- Trade-offs.
- Future extensibility impact.
- Open questions, if any.

Benefit: decisions become reviewable and durable.

Trade-off: writing documentation slows early execution, but it prevents hidden assumptions and avoids costly rework.

## Commit Convention

Use concise, scoped commit messages.

Recommended format:

`type(scope): summary`

Suggested types:

- `docs` for documentation.
- `feat` for product capability implementation.
- `fix` for defect fixes.
- `refactor` for behavior-preserving changes.
- `test` for test changes.
- `chore` for maintenance.
- `build` for build or tooling changes.
- `ci` for continuous integration changes.

Examples:

- `docs(product): define phase 0 scope`
- `docs(risks): add whatsapp policy risk register`

Trade-off: structured commit messages require discipline, but they make history easier to review.

## Versioning

OmniWA should use semantic versioning once public releases begin.

Version levels:

- Major version for breaking product contracts.
- Minor version for backward-compatible capabilities.
- Patch version for fixes and documentation corrections.

Before the first stable release, use `0.x` versions to communicate that product contracts may still change.

Trade-off: versioning creates compatibility obligations, so stable contracts should not be declared too early.

## Branch Strategy

Recommended branch model:

- `main` represents the latest accepted project state.
- Short-lived feature branches should be used for focused changes.
- Release branches may be introduced once public releases exist.

Branch names should be descriptive:

- `docs/phase-0-product-definition`
- `feature/instance-lifecycle`
- `fix/webhook-retry-visibility`

Trade-off: simple branching keeps early development fast. More complex release workflows can be introduced when release management requires them.

## RFC Process

Use RFCs for product or technical proposals that affect multiple domains, teams, or long-term compatibility.

An RFC should include:

- Problem.
- Goals.
- Non-goals.
- Proposed direction.
- Alternatives considered.
- Product impact.
- Operational impact.
- Security and policy impact.
- Open questions.

RFCs should be reviewed before work begins when the cost of changing direction later would be high.

Trade-off: RFCs should not be required for small, local, reversible changes.

## ADR Process

Use ADRs for accepted architecture or major technical decisions.

ADR status values:

- `proposed`
- `accepted`
- `superseded`
- `deprecated`

An ADR should include:

- Context.
- Decision.
- Consequences.
- Alternatives considered.
- Links to related RFCs or issues.

Trade-off: ADRs document what was decided, not every debate. Keep them short enough to remain useful.

## Review Expectations

Before moving from one phase to the next:

- Documentation must be updated.
- Open questions must be reviewed.
- Risks must be revisited.
- Success metrics must be checked for relevance.
- Decisions that affect future architecture should be recorded.

## Agentmemory Convention

Use agentmemory as the project knowledge map for OmniWA.

Save durable knowledge when:

- A product decision is accepted.
- A risk is identified or retired.
- A phase exit criterion changes.
- A convention is adopted.
- A major open question is answered.

Use OmniWA-specific concepts such as:

- `omniwa-product-definition`
- `omniwa-mvp-scope`
- `omniwa-risk-register`
- `omniwa-phase-gate`

Benefit: future sessions can recall project context without mixing it with nearby OpenWA memories.

Trade-off: memory is only useful when entries are specific and curated.
