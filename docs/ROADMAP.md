# OmniWA Roadmap

This roadmap defines product progression. It does not prescribe implementation architecture.

## Phase 0 - Product Definition

### Goal

Define what OmniWA is, who it serves, which problems it solves, what it will not do, how success is measured, and what decisions are required before architecture begins.

### Deliverables

- Product vision.
- Product scope.
- Non-functional requirements.
- Roadmap.
- Project conventions.
- Glossary.
- Risk register.
- Success metrics.
- Open questions for Phase 1.
- Product decisions resolving Phase 0 blocked findings.

### Exit Criteria

- Team agrees on MVP scope.
- Out-of-scope boundaries are accepted.
- Non-functional targets are reviewed.
- Critical open questions are resolved or explicitly deferred when they do not block architecture.
- Phase 0 product decisions are recorded.
- Phase 1 can begin without debating the basic product identity.

## Phase 1 - System Architecture

### Goal

Design the technical architecture that can support the approved product definition.

### Deliverables

- System context.
- Core domain boundaries.
- Runtime component model.
- Data ownership model.
- Integration boundaries.
- Reliability and observability approach.
- Security model.
- Architecture Decision Records for major choices.

### Exit Criteria

- Architecture supports the MVP scope without blocking future phases.
- Major trade-offs are documented.
- Architecture review is completed.
- Implementation plan can be created.

## Phase 2 - MVP Foundation

### Goal

Create the minimum product foundation needed to validate instance lifecycle, messaging, events, and operations.

### Deliverables

- Product skeleton for core domains.
- Instance lifecycle workflow.
- QR pairing workflow.
- Basic messaging workflow.
- Basic event model.
- Initial operator visibility.
- Developer setup documentation.

### Exit Criteria

- A developer can run the MVP foundation locally.
- A WhatsApp instance can be paired and observed.
- Basic send/receive workflow can be validated.
- Failure states are visible enough for debugging.

## Phase 3 - Messaging And Webhooks

### Goal

Make OmniWA useful for real integrations by stabilizing message handling and outbound event delivery.

### Deliverables

- Text message workflow.
- Basic media workflow.
- Incoming message events.
- Message status events.
- Webhook delivery visibility.
- Retry and failure handling product behavior.
- Integration documentation.

### Exit Criteria

- External systems can rely on documented webhook behavior.
- Message failures are visible and categorized.
- Basic integration tests or acceptance checks validate core workflows.

## Phase 4 - Operations And Reliability

### Goal

Strengthen production readiness around reconnects, queues, logs, metrics, and recovery.

### Deliverables

- Reconnect behavior documentation.
- Queue visibility and operator controls.
- Operational logs and metrics.
- Failure dashboards.
- Runbooks for common incidents.
- Recovery procedures for failed messages and webhooks.

### Exit Criteria

- Operators can diagnose common failures without inspecting raw internals first.
- Reconnect and webhook failure paths are tested.
- Production readiness review can be scheduled.

## Phase 5 - Dashboard And Developer Experience

### Goal

Improve usability for developers and operators through documentation, dashboard workflows, and SDK planning.

### Deliverables

- Dashboard for instance, message, webhook, and queue visibility.
- Developer onboarding guide.
- Troubleshooting guide.
- SDK requirements planning.
- Example integration journeys.

### Exit Criteria

- A new developer can complete onboarding within the target time.
- Dashboard supports the most common operator tasks.
- Documentation explains product behavior and known limits.

## Phase 6 - Multi-Instance And Scale Validation

### Goal

Validate OmniWA with multiple active instances and higher event volume.

### Deliverables

- Multi-instance operational workflows.
- Load testing plan.
- Scale metrics.
- Resource usage reporting.
- Limits documentation.
- Degradation behavior.

### Exit Criteria

- The product demonstrates the agreed scale target.
- Bottlenecks are documented.
- Limits are visible to users and operators.

## Phase 7 - Security, Governance, And Enterprise Readiness

### Goal

Prepare OmniWA for teams with stronger governance, audit, and compliance requirements.

### Deliverables

- Access control requirements.
- Audit event requirements.
- Secret handling review.
- Data retention implementation guidance based on Phase 0.5 retention decisions.
- Tenant governance requirements if multi-tenant usage is approved.
- Security review checklist.

### Exit Criteria

- Production security baseline is approved.
- Sensitive data rules are documented.
- Enterprise adoption risks are understood.

## Phase 8 - Ecosystem And Extensibility

### Goal

Expand OmniWA beyond the core platform through SDKs, connectors, extension points, and community-facing documentation.

### Deliverables

- SDK maturity plan.
- Connector strategy.
- Extension guidelines.
- Compatibility policy.
- Public documentation structure.
- Contribution model if the project becomes open source or partner-extensible.

### Exit Criteria

- Extension points are stable enough for external use.
- Compatibility expectations are documented.
- Ecosystem work does not compromise core reliability.
