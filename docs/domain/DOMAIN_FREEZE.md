# OmniWA Domain Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Decision

**APPROVED**

**Domain Phase is FROZEN.**

The Domain Review Board approves OmniWA Phase 2 Domain Model for handoff to Phase 3 - Application Design.

## Domain Version

Phase 2 Domain Model v1.0.

This version freezes:

- Phase 2.1 Strategic Domain Design.
- Phase 2.2 Tactical Domain Design.
- Phase 2.3 Domain Events.
- Phase 2.4 Repository Ports and Domain Services.

## Reviewer Summary

DRB roles represented:

- Principal Domain Architect.
- Principal Software Architect.
- Senior Backend Engineer.
- Platform Architect.

Review result:

- Critical findings: 0.
- Major findings: 0.
- Minor findings: 0.
- Suggestions: 4.

The DRB found no DDD, ownership, consistency, event, or repository/service issue that blocks Phase 3.

## DDD Quality Score

| Area | Score |
| --- | ---: |
| Strategic Design | 9 |
| Tactical Design | 9 |
| Aggregate Design | 9 |
| Domain Model | 9 |
| Event Design | 9 |
| Repository Design | 9 |
| Service Design | 8 |
| Policy Design | 9 |
| Testability | 9 |
| Maintainability | 9 |
| Scalability | 8 |

## Approved Documents

The following documents are approved as the frozen Phase 2 domain baseline:

- `docs/domain/DOMAIN_OVERVIEW.md`
- `docs/domain/BOUNDED_CONTEXTS.md`
- `docs/domain/DOMAIN_MAP.md`
- `docs/domain/UBIQUITOUS_LANGUAGE.md`
- `docs/domain/CONTEXT_RELATIONSHIPS.md`
- `docs/domain/DOMAIN_BOUNDARIES.md`
- `docs/domain/DOMAIN_RESPONSIBILITIES.md`
- `docs/domain/AGGREGATES.md`
- `docs/domain/ENTITIES.md`
- `docs/domain/VALUE_OBJECTS.md`
- `docs/domain/AGGREGATE_BOUNDARIES.md`
- `docs/domain/DOMAIN_INVARIANTS.md`
- `docs/domain/LIFECYCLE_RULES.md`
- `docs/domain/CONSISTENCY_BOUNDARIES.md`
- `docs/domain/IDENTITY_MODEL.md`
- `docs/domain/DOMAIN_EVENTS.md`
- `docs/domain/EVENT_CATALOG.md`
- `docs/domain/EVENT_LIFECYCLE.md`
- `docs/domain/EVENT_CONTRACTS.md`
- `docs/domain/EVENT_VERSIONING.md`
- `docs/domain/EVENT_CONSISTENCY.md`
- `docs/domain/EVENT_GOVERNANCE.md`
- `docs/domain/REPOSITORY_PORTS.md`
- `docs/domain/DOMAIN_SERVICES.md`
- `docs/domain/DOMAIN_POLICIES.md`
- `docs/domain/DOMAIN_SPECIFICATIONS.md`
- `docs/domain/DOMAIN_FACTORIES.md`
- `docs/domain/DOMAIN_ERRORS.md`
- `docs/domain/DOMAIN_SERVICE_BOUNDARIES.md`

## Approved Context

| Context | Classification | Approval Notes |
| --- | --- | --- |
| Instance | Core | Approved as owner of product instance lifecycle and action-required state. |
| Session | Core | Approved as owner of session lifecycle, pairing, recovery, and Secret-sensitive session policy. |
| Messaging | Core | Approved as owner of supported message lifecycle and delivery visibility. |
| Webhook Delivery | Core | Approved as owner of external integration delivery lifecycle, retry, and dead-letter visibility. |
| Guardrails | Core | Approved as owner of product-enforced responsible-usage decisions. |
| Media | Supporting | Approved as owner of supported media metadata, processing state, and retention decisions. |
| Provider Integration | Supporting | Approved as anti-corruption context for provider capability and failure language. |
| Operations | Supporting | Approved as owner of visible async job lifecycle only. |
| Security and Access | Supporting | Approved as owner of capability/access decisions and privileged action control. |
| Audit | Supporting | Approved as owner of Secret-safe audit evidence and retention semantics. |
| Health | Supporting | Approved as owner of product/dependency health projection. |
| Configuration | Generic | Approved as owner of validated configuration safety and active snapshot semantics. |
| Observability | Generic | Approved as owner of sanitized telemetry and correlation vocabulary. |

## Approved Aggregate

| Aggregate | Root | Owner Context | Approval Notes |
| --- | --- | --- | --- |
| Instance | Instance | Instance | Correct aggregate boundary for lifecycle, readiness summary, and action-required state. |
| Session | Session | Session | Correctly separated from Instance to protect Secret session policy and recovery semantics. |
| Message | Message | Messaging | Correct core aggregate for one current message lifecycle state and MVP message scope. |
| MediaAsset | MediaAsset | Media | Correctly separated from Message to keep media retention/processing independent. |
| WebhookSubscription | WebhookSubscription | Webhook Delivery | Correct boundary for subscription validity before delivery scheduling. |
| WebhookDelivery | WebhookDelivery | Webhook Delivery | Correct boundary for retry, terminal delivery, and dead-letter visibility. |
| GuardrailDecision | GuardrailDecision | Guardrails | Correct boundary for explicit allow/block/throttle/action-required outcome. |
| ProviderProfile | ProviderProfile | Provider Integration | Approved as provider compatibility/failure vocabulary, not business policy. |
| WorkerJob | WorkerJob | Operations | Correct boundary for accepted async work visibility and retry/dead lineage. |
| AccessDecision | AccessDecision | Security and Access | Correct boundary for explicit capability decision before privileged mutation. |
| AuditRecord | AuditRecord | Audit | Correct boundary for Secret-safe evidence and retention category. |
| HealthStatus | HealthStatus | Health | Correct projection aggregate that cannot mutate source business state. |
| ConfigurationSnapshot | ConfigurationSnapshot | Configuration | Correct boundary for validated active configuration and guardrail-bypass rejection. |
| TelemetrySignal | TelemetrySignal | Observability | Approved as sanitized projection aggregate, not source of business truth. |

## Approved Events

Domain event design is approved with these event families:

| Event Family | Producer Aggregate | Approval Notes |
| --- | --- | --- |
| Instance events | Instance | Approved for lifecycle, connection readiness, logged-out, action-required, and destroyed facts. |
| Session events | Session | Approved for pairing, pending, active, expired, revoked, recovery-required, and cleaned facts. |
| Message events | Message | Approved for inbound, unsupported inbound, accepted, rejected, queued, processing, dispatched, delivered, read, failed, and cancelled facts. |
| Media events | MediaAsset | Approved for accepted, processing, processed, attached, failed, expired, cleaned, and diagnostic capture facts. |
| Webhook subscription events | WebhookSubscription | Approved for proposed, validated, activated, suspended, invalidated, and retired facts. |
| Webhook delivery events | WebhookDelivery | Approved for scheduled, started, succeeded, retry-scheduled, failed, dead-lettered, and cancelled facts. |
| Guardrail events | GuardrailDecision | Approved for evaluated, passed, blocked, throttled, and action-required facts. |
| Provider profile events | ProviderProfile | Approved for supported, degraded, unsupported, capability changed, and failure classified facts. |
| Worker job events | WorkerJob | Approved for queued, reserved, started, completed, retry-scheduled, dead, and recovery-required facts. |
| Access events | AccessDecision | Approved for granted, denied, privileged action marked, secret access requested, and expired facts. |
| Audit events | AuditRecord | Approved for requested, recorded, redaction applied, and retention expired facts. |
| Health events | HealthStatus | Approved for changed, degraded, recovered, and action-required facts. |
| Configuration events | ConfigurationSnapshot | Approved for validated, rejected, activated, guardrail-bypass rejected, and superseded facts. |
| Telemetry events | TelemetrySignal | Approved for captured, sanitized, dropped, and projected facts. |

Event governance, versioning, consistency, and contracts are approved with the rule that Domain Events remain aggregate-created facts and Application controls publication timing.

## Approved Services

Approved domain service concepts:

- MessageAcceptanceDomainService.
- MessageDeliveryStatusDomainService.
- InstanceSessionCoordinationDomainService.
- SessionRecoveryDomainService.
- WebhookSchedulingDomainService.
- RetryEligibilityDomainService.
- MediaReadinessDomainService.
- GuardrailEvaluationDomainService.
- ProviderCompatibilityDomainService.
- AuditEvidenceSafetyDomainService.
- HealthClassificationDomainService.
- ConfigurationSafetyDomainService.

Approved repository ports:

- InstanceRepositoryPort.
- SessionRepositoryPort.
- MessageRepositoryPort.
- MediaAssetRepositoryPort.
- WebhookSubscriptionRepositoryPort.
- WebhookDeliveryRepositoryPort.
- GuardrailDecisionRepositoryPort.
- ProviderProfileRepositoryPort.
- WorkerJobRepositoryPort.
- AccessDecisionRepositoryPort.
- AuditRecordRepositoryPort.
- HealthStatusRepositoryPort.
- ConfigurationSnapshotRepositoryPort.
- TelemetrySignalRepositoryPort.

Approved policy families:

- MessageSendingPolicy.
- MessageStatusPolicy.
- WebhookRetryPolicy.
- SessionRevocationPolicy.
- InstanceConnectionPolicy.
- MediaRetentionPolicy.
- ComplianceGuardrailPolicy.
- ProviderCapabilityPolicy.
- WorkerJobRetryPolicy.
- ConfigurationSafetyPolicy.
- AuditRedactionPolicy.
- PrivilegedActionPolicy.
- HealthProjectionPolicy.
- TelemetrySafetyPolicy.

Approved factory concepts:

- InstanceFactory.
- SessionFactory.
- MessageFactory.
- MediaAssetFactory.
- WebhookSubscriptionFactory.
- WebhookDeliveryFactory.
- GuardrailDecisionFactory.
- ProviderProfileFactory.
- WorkerJobFactory.
- AccessDecisionFactory.
- AuditRecordFactory.
- HealthStatusFactory.
- ConfigurationSnapshotFactory.
- TelemetrySignalFactory.

Approved error categories:

- BusinessRuleViolation.
- InvalidStateTransition.
- UnsupportedCapability.
- PolicyViolation.
- IdentityError.
- ConsistencyError.
- SensitiveDataViolation.
- RetentionRuleViolation.
- AccessDecisionViolation.
- ExternalSignalClassificationError.
- ConfigurationDomainError.

## Validation Findings

| Category | Count | Result |
| --- | ---: | --- |
| Critical | 0 | None. |
| Major | 0 | None. |
| Minor | 0 | None. |
| Suggestion | 4 | Track in Phase 3 and implementation planning. |

## Suggestions

| ID | Area | Suggestion | Reason |
| --- | --- | --- | --- |
| SUG-D-001 | Entity implementation | Do not automatically implement every child/internal entity as a concrete class. | Some child concepts may remain value objects, records, or private aggregate state until behavior justifies entity identity. |
| SUG-D-002 | Domain services | Re-check each domain service during Phase 3 use-case design and move logic back into an aggregate if it becomes single-aggregate behavior. | Prevents overuse of service objects and keeps invariants close to aggregate roots. |
| SUG-D-003 | Repository ports | Keep repository queries minimal until application command/query boundaries are documented. | Prevents accidental reporting/read-model or infrastructure leakage through repository ports. |
| SUG-D-004 | Future projections | Treat Analytics, Billing, and AI Agent as future projection/consumer contexts until product decisions approve otherwise. | Prevents projections from becoming source of business truth or raw payload retention paths. |

## Strategic Validation

| Review Area | Result |
| --- | --- |
| Bounded Context size | PASS - contexts are separated by ownership and capability. No core context is too large for Phase 3. |
| Context overlap | PASS - overlap between Instance/Session, Messaging/Media, and Webhook/Operations is explicitly controlled by Application coordination and published language. |
| Terminology | PASS - ubiquitous language prevents provider, database, HTTP, queue, and campaign terminology from replacing product language. |
| Context Map | PASS - Partnership, Customer/Supplier, ACL, Published Language, Open Host Service, Conformist, and Shared Kernel usage is appropriate. |

## Tactical Validation

| Review Area | Result |
| --- | --- |
| Aggregate boundaries | PASS - transaction and consistency boundaries are one aggregate unless Application coordinates explicit preconditions. |
| Aggregate ownership | PASS - each aggregate has one owning context and clear non-owner constraints. |
| Entity model | PASS - aggregate roots and child/internal entities are identified with ownership. Implementation should remain selective. |
| Value objects | PASS - VOs are immutable, equality-based, side-effect-free, and do not hide provider identity. |
| Invariants | PASS - core invariants preserve session, message, webhook, guardrail, data classification, and async visibility constraints. |
| Lifecycle rules | PASS - lifecycle language is explicit and aligned with runtime state machines without duplicating implementation. |
| Consistency boundaries | PASS - strong and eventual consistency expectations are clear and do not imply database mechanics. |
| Identity model | PASS - identities are opaque and avoid JID, phone, provider ID, content, Secret, or tenant leakage. |

## Event Validation

| Review Area | Result |
| --- | --- |
| Business meaning | PASS - events are product facts, not commands or provider callbacks. |
| Duplicates | PASS - apparent lifecycle event granularity is intentional for reliability and operator visibility. |
| Technical leakage | PASS - event docs reject provider, queue, database, HTTP, and transport vocabulary. |
| Missing events | PASS - MVP workflows have enough facts for message, media, webhook, session, guardrail, job, audit, health, config, and telemetry. |
| Versioning | PASS - versioning and deprecation rules are sufficient for Phase 3. |
| Consistency | PASS - synchronous preconditions and async projections are documented without event bus implementation. |

## Repository And Service Validation

| Review Area | Result |
| --- | --- |
| Repository responsibility | PASS - each port is aggregate-scoped and expresses semantic persistence only. |
| Query leakage | PASS - query limitations explicitly reject reporting/search/product analytics leakage. |
| Infrastructure leakage | PASS - SQL, ORM, database, provider, queue, transport, and logging details are excluded. |
| Domain service placement | PASS - services are cross-aggregate or classification services and do not load repositories. |
| Policy placement | PASS - policies represent product decisions, not middleware. |
| Specification model | PASS - specifications validate product semantics and return domain error categories. |
| Factory responsibility | PASS - factories create valid aggregates without persistence, publication, provider calls, or queue side effects. |
| Error model | PASS - domain errors are separated from infrastructure/application errors and use safe product categories. |

## Future Evolution Review

| Future Change | Contexts Likely To Change | Aggregates Likely To Change | Events Reused | New Decision Required |
| --- | --- | --- | --- | --- |
| Telegram | Provider Integration, Messaging, Media, Guardrails, Ubiquitous Language | ProviderProfile, Message, MediaAsset only if product semantics differ | Message lifecycle, Media lifecycle, WebhookDelivery, WorkerJob, Audit, Health, Telemetry | Product decision and ADR. |
| Messenger | Provider Integration, Messaging, Media, Guardrails | ProviderProfile, Message, MediaAsset if capability mapping differs | Message lifecycle, Media lifecycle, WebhookDelivery, Guardrail, Audit/Health/Telemetry | Product decision and ADR. |
| WhatsApp Cloud API | Provider Integration, Configuration, Health, possibly Session semantics | ProviderProfile and possibly Session/Instance if auth model changes | Most Instance, Message, Media, Webhook, Guardrail, WorkerJob, Audit/Health/Telemetry | Provider ADR and compatibility review. |
| Analytics | New Analytics/Reporting context | None in source contexts by default | Existing Domain/Integration events as projections | Product decision; must not become source of truth. |
| Campaign | New Campaign and Audience contexts | Do not modify Message into campaign aggregate; Message remains single-message lifecycle | GuardrailBlocked/Throttled, WorkerJob, Audit/Health/Telemetry may be reused | Product decision and ADR; out of MVP. |
| Billing | New Billing/Usage context | None in source contexts by default | MessageAccepted/Dispatched, WebhookDeliverySucceeded, WorkerJobCompleted as usage signals | Product decision and ADR. |
| AI Agent | New AI Agent/Automation context if approved | Must not modify Messaging into autonomous agent aggregate by default | Message, Webhook, Guardrail, Audit/Health/Telemetry events as inputs/outputs where safe | Product decision, security review, and ADR. |

## Deferred Decisions

The following remain intentionally deferred to Phase 3 or later:

- Application command and query models.
- Use case catalog and orchestration sequence.
- Application service boundaries.
- Application-level transaction policy.
- Command/query validation and mapping.
- Read model/projection design.
- Concrete persistence implementation.
- Database technology, schema, ORM, and migration strategy.
- Queue engine and worker implementation.
- Event bus implementation and publication mechanics.
- Webhook transport implementation.
- API and OpenAPI design.
- Provider/Baileys implementation details.
- Security implementation for authentication, authorization, secret storage, and audit sink.
- Observability tooling/export implementation.
- Analytics, Billing, Campaign, AI Agent, multi-tenancy, new providers, and non-WhatsApp channels.

## Non Negotiable Domain Rules

- Domain must preserve Phase 0 product scope and Phase 1 architecture freeze.
- MVP remains Single Tenant + Multi Instance.
- MVP send support remains text, image, video, document, and audio only.
- Broadcast, campaign, group administration, group messaging send capability, and advanced message types remain out of MVP.
- Business policy must stay in owning domain context.
- Provider-native payloads must not become domain input or domain state.
- Baileys must remain behind Provider Integration and provider ports.
- Aggregate roots are the only mutation point for aggregate-owned state.
- Entities and value objects do not publish events.
- Domain Events are facts created by aggregate roots; Application controls publication timing.
- Domain must not call EventBus, Queue, Webhook, Log, Provider, external systems, persistence implementations, or infrastructure adapters.
- Repository ports must remain semantic and aggregate-scoped.
- Domain services must not load repositories or orchestrate workflows.
- Webhook Delivery must not mutate source business state.
- Operations must not decide owner aggregate business outcome.
- Audit, Health, and Observability must not become source-of-truth business contexts.
- Secret data must never be logged, emitted, audited raw, or sent in webhook payloads.
- Raw Confidential payloads must not be stored in audit/telemetry/logs and must not be retained by default.
- Message and media bodies are not retained by default after processing.
- Guardrails cannot be silently disabled by configuration.
- Future scope changes require product decision and ADR.

## Phase 2 Readiness

| Area | Status |
| --- | --- |
| Strategic Domain | PASS |
| Aggregate Design | PASS |
| Entity Design | PASS |
| Value Object Design | PASS |
| Event Design | PASS |
| Repository Port | PASS |
| Domain Service | PASS |
| Policy | PASS |
| Specification | PASS |
| Factory | PASS |
| Error Model | PASS |

**Domain Phase is FROZEN.**

**Project is ready for Phase 3 - Application Design.**

## Summary

The DRB approves the Phase 2 domain model because it:

- Preserves frozen product and architecture constraints.
- Uses clear bounded contexts and product language.
- Defines small aggregate boundaries with explicit invariants and consistency rules.
- Keeps provider, API, database, queue, transport, and observability mechanics outside domain.
- Defines meaningful business events with governance and versioning.
- Keeps repository ports, services, policies, specifications, factories, and errors at domain-contract level.
- Provides enough stable domain baseline for Phase 3 Application Design.
