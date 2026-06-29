# OmniWA Event Lifecycle

## Purpose

This document defines business-level event lifecycles for Phase 2.3.

It does not redefine runtime state machines and does not design event bus, queue, Kafka, BullMQ, REST API, database, Prisma, repository, or service implementation.

## Event Lifecycle Principles

- Domain Events are created after aggregate invariants pass.
- Application decides publication timing and downstream transformation.
- Integration Events are prepared only by Webhook Delivery from approved and sanitized product facts.
- Event lifecycle must preserve observability without turning every event into an external contract.
- Event failure handling must not mutate original source facts unless Application invokes the owning aggregate through approved workflow.

## Generic Event Lifecycle

| Stage | Meaning | Owner | Rule |
| --- | --- | --- | --- |
| Fact Created | Aggregate root records a business fact. | Owning aggregate. | Only aggregate root creates Domain Event. |
| Captured By Application | Application receives event as part of aggregate outcome. | Application. | Domain does not publish directly. |
| Classified | Application classifies event as local, async, audit, health, observability, or integration candidate. | Application. | Classification must respect data sensitivity. |
| Sanitized | Sensitive values are removed or replaced with safe references. | Application / Observability / Audit / Webhook. | Secret never included; raw Confidential excluded. |
| Routed | Event is routed to approved consumer path. | Application. | No bypass of guardrails or ownership. |
| Projected Or Delivered | Event contributes to projection, async job, audit, health, telemetry, or external delivery. | Consumer context. | Consumer owns its own lifecycle only. |
| Archived Or Expired | Event is no longer needed for business visibility or retention. | Owning retention policy. | Retention rules are product-level; storage mechanics deferred. |

## Instance Event Lifecycle

```mermaid
flowchart LR
  Created[InstanceCreated]
  QR[InstanceQrRequired]
  Connected[InstanceConnected]
  Disconnected[InstanceDisconnected]
  LoggedOut[InstanceLoggedOut]
  Action[InstanceActionRequired]
  Destroyed[InstanceDestroyed]

  Created --> QR
  Created --> Connected
  QR --> Connected
  Connected --> Disconnected
  Disconnected --> Connected
  Disconnected --> LoggedOut
  LoggedOut --> QR
  Disconnected --> Action
  LoggedOut --> Action
  Created --> Destroyed
  Connected --> Destroyed
  Disconnected --> Destroyed
  LoggedOut --> Destroyed
```

Business rules:

- InstanceDestroyed is terminal.
- InstanceConnected requires translated provider/session readiness.
- InstanceDisconnected does not imply InstanceLoggedOut.

## Session Event Lifecycle

```mermaid
flowchart LR
  Pairing[SessionPairingStarted]
  Pending[SessionPending]
  Active[SessionActivated]
  Expired[SessionExpired]
  Revoked[SessionRevoked]
  Recovery[SessionRecoveryRequired]
  Cleaned[SessionCleaned]

  Pairing --> Pending --> Active
  Pending --> Expired
  Pending --> Revoked
  Active --> Expired
  Active --> Revoked
  Expired --> Recovery
  Revoked --> Recovery
  Expired --> Cleaned
  Revoked --> Cleaned
  Active --> Cleaned
```

Business rules:

- Session material is Secret in every lifecycle event and is never included.
- SessionActivated and SessionRevoked cannot both represent the current session state.

## Message Event Lifecycle

```mermaid
flowchart LR
  Inbound[InboundMessageReceived]
  Unsupported[UnsupportedMessageReceived]
  Accepted[MessageAccepted]
  Rejected[MessageRejected]
  Queued[MessageQueued]
  Processing[MessageProcessingStarted]
  Dispatched[MessageDispatched]
  Delivered[MessageDelivered]
  Read[MessageRead]
  Failed[MessageFailed]
  Cancelled[MessageCancelled]

  Accepted --> Queued --> Processing --> Dispatched --> Delivered --> Read
  Accepted --> Cancelled
  Queued --> Cancelled
  Processing --> Failed
  Dispatched --> Failed
  Delivered --> Failed
  Inbound --> Delivered
  Inbound --> Read
  Inbound --> Failed
  Unsupported --> Rejected
  Rejected --> Failed
```

Business rules:

- MessageAccepted requires prior GuardrailPassed for outbound work.
- MessageQueued means accepted async work is visible.
- MessageDelivered and MessageRead depend on translated provider status and are not delivery guarantees beyond available status.
- Message body is not retained by default.

## Media Event Lifecycle

```mermaid
flowchart LR
  Accepted[MediaAccepted]
  Processing[MediaProcessingStarted]
  Processed[MediaProcessed]
  Attached[MediaAttached]
  Failed[MediaFailed]
  Capture[DiagnosticCaptureRequested]
  Expired[MediaExpired]
  Cleaned[MediaCleaned]

  Accepted --> Processing --> Processed --> Attached
  Accepted --> Failed
  Processing --> Failed
  Processed --> Capture
  Processed --> Expired --> Cleaned
  Failed --> Cleaned
  Capture --> Expired
```

Business rules:

- Media events contain metadata and safe references, not binary payloads.
- DiagnosticCaptureRequested requires explicit bounded policy.

## Webhook Event Lifecycle

```mermaid
flowchart LR
  Validated[WebhookSubscriptionValidated]
  Activated[WebhookSubscriptionActivated]
  Suspended[WebhookSubscriptionSuspended]
  Invalidated[WebhookSubscriptionInvalidated]
  Retired[WebhookSubscriptionRetired]
  Scheduled[WebhookDeliveryScheduled]
  Started[WebhookDeliveryStarted]
  Succeeded[WebhookDeliverySucceeded]
  Retry[WebhookDeliveryRetryScheduled]
  Failed[WebhookDeliveryFailed]
  Dead[WebhookDeliveryDeadLettered]
  Cancelled[WebhookDeliveryCancelled]

  Proposed[WebhookSubscriptionProposed]

  Proposed --> Validated --> Activated
  Activated --> Scheduled --> Started --> Succeeded
  Started --> Retry --> Started
  Retry --> Dead
  Started --> Failed
  Scheduled --> Cancelled
  Activated --> Suspended
  Suspended --> Activated
  Activated --> Invalidated
  Invalidated --> Retired
  Activated --> Retired
```

Business rules:

- WebhookSubscription must be valid before WebhookDeliveryScheduled.
- WebhookDeliverySucceeded is terminal.
- WebhookDeliveryDeadLettered is operator-visible.
- Webhook delivery outcome does not mutate original business fact.

## Guardrail Event Lifecycle

```mermaid
flowchart LR
  Evaluated[GuardrailEvaluated]
  Passed[GuardrailPassed]
  Blocked[GuardrailBlocked]
  Throttled[GuardrailThrottled]
  Action[GuardrailActionRequired]

  Evaluated --> Passed
  Evaluated --> Blocked
  Evaluated --> Throttled
  Evaluated --> Action
```

Business rules:

- Exactly one final outcome should apply to one GuardrailDecision.
- Blocked, throttled, and action-required outcomes must be visible.

## Worker Job Event Lifecycle

```mermaid
flowchart LR
  Queued[WorkerJobQueued]
  Reserved[WorkerJobReserved]
  Started[WorkerJobStarted]
  Completed[WorkerJobCompleted]
  Retry[WorkerJobRetryScheduled]
  Dead[WorkerJobDead]
  Recovery[WorkerJobRecoveryRequired]

  Queued --> Reserved --> Started --> Completed
  Started --> Retry --> Queued
  Started --> Dead
  Retry --> Dead
  Dead --> Recovery
```

Business rules:

- WorkerJobCompleted means job lifecycle success, not necessarily business outcome success.
- WorkerJobDead is terminal for the lineage unless explicit recovery creates new work.

## Configuration, Audit, Health, Telemetry Lifecycle

| Area | Normal Event Flow | Business Rule |
| --- | --- | --- |
| Configuration | ConfigurationValidated -> ConfigurationActivated -> ConfigurationSuperseded. Rejection path: ConfigurationRejected or ConfigurationGuardrailBypassRejected. | Invalid or unsafe configuration cannot become active. |
| Audit | AuditRecordRequested -> AuditRedactionApplied -> AuditRecorded -> AuditRetentionExpired. | No Secret or raw Confidential data. |
| Health | HealthStatusChanged -> HealthDegraded/HealthActionRequired -> HealthRecovered. | Health is projection and cannot mutate source business state. |
| Telemetry | TelemetryCaptured -> TelemetrySanitized -> TelemetryProjected, or TelemetryCaptured -> TelemetryDropped. | Telemetry is not source of business truth. |

## Integration Event Lifecycle

```mermaid
flowchart LR
  DomainFact[Domain Event]
  AppApproval[Application Approval]
  Sanitized[Sanitized Product Fact]
  Prepared[Integration Event Prepared]
  Scheduled[WebhookDeliveryScheduled]
  Delivering[WebhookDeliveryStarted]
  Delivered[WebhookDeliverySucceeded]
  Retry[WebhookDeliveryRetryScheduled]
  Failed[WebhookDeliveryFailed]
  Dead[WebhookDeliveryDeadLettered]

  DomainFact --> AppApproval --> Sanitized --> Prepared --> Scheduled --> Delivering --> Delivered
  Delivering --> Retry --> Delivering
  Retry --> Dead
  Delivering --> Failed
```

Integration rules:

- Integration Event lifecycle is owned by Webhook Delivery.
- Integration Event preparation does not change source aggregate facts.
- External delivery is asynchronous and retry-visible.
