# OmniWA Domain Invariants

## Purpose

This document defines domain invariants for OmniWA Phase 2.2.

Invariants are business rules that must remain true regardless of API, database, provider, queue, or deployment implementation.

## Global Invariants

| ID | Invariant | Owner | Consistency Expectation |
| --- | --- | --- | --- |
| INV-G-001 | Domain model must not use provider-native payloads as aggregate, entity, or value object input. | Provider Integration / all contexts | Strong at boundary. |
| INV-G-002 | Domain objects must not publish directly to EventBus, Queue, Webhook, Log, Provider, or external systems. | All contexts | Strong. |
| INV-G-003 | Secret data must never be logged, emitted to telemetry, sent in webhook payloads, or stored in audit records. | Security and Access, Session, Audit, Observability | Strong. |
| INV-G-004 | Raw Confidential payloads must not appear in normal logs, telemetry, or audit evidence. | All contexts | Strong. |
| INV-G-005 | Message and media bodies are not retained by default after processing. | Messaging, Media | Strong. |
| INV-G-006 | Mandatory guardrails cannot be silently disabled by configuration. | Configuration, Guardrails | Strong. |
| INV-G-007 | Accepted async work must have visible lifecycle state and terminal or pending classification. | Operations | Strong. |
| INV-G-008 | External provider failures must be translated into product-level failure categories before product state changes. | Provider Integration | Strong at provider boundary. |
| INV-G-009 | Webhook failure must not mutate the original business fact. | Webhook Delivery | Strong. |
| INV-G-010 | Product scope must remain MVP: text, image, video, document, and audio only for send support. | Messaging, Media | Strong. |

## Instance Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-I-001 | One Instance has one InstanceId for its lifetime. | Identity is opaque and product-owned. |
| INV-I-002 | Destroyed Instance is terminal. | No normal lifecycle transition can leave Destroyed. |
| INV-I-003 | One Instance has at most one active Session reference at a time. | Session owns session state; Instance may hold safe current reference. |
| INV-I-004 | Connected or send-capable state requires translated provider/session readiness. | No direct provider-native state. |
| INV-I-005 | Logged Out is not the same as Disconnected. | Logged Out usually requires operator action. |
| INV-I-006 | Instance health summary must distinguish OmniWA, provider/account, downstream, and dependency causes where known. | Prevents misleading operator action. |

## Session Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-S-001 | One Session belongs to exactly one Instance. | Session cannot move between instances. |
| INV-S-002 | Session cannot be Active and Revoked simultaneously. | Active/Revoked are mutually exclusive states. |
| INV-S-003 | Revoked Session is not send-capable. | Message workflows must not treat revoked session as usable. |
| INV-S-004 | Expired Session requires new pairing or explicit recovery path. | Expired is recoverable only through approved flow. |
| INV-S-005 | Session material is Secret in every lifecycle state. | Applies even when expired/revoked. |
| INV-S-006 | Session cleanup must respect retention and backup policy. | No retention mechanics defined here. |

## Message Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-M-001 | One Message has exactly one current lifecycle state. | State changes are owned by Message root. |
| INV-M-002 | Accepted outbound Message must be an MVP-supported type. | Text, image, video, document, audio only. |
| INV-M-003 | Outbound Message acceptance requires a GuardrailDecision outcome. | Guardrails must run before acceptance. |
| INV-M-004 | Message must not represent campaign, broadcast, audience management, or marketing automation. | Out of MVP scope. |
| INV-M-005 | Message body is not retained by default after processing. | Diagnostic capture requires explicit bounded policy. |
| INV-M-006 | Provider status cannot update Message until translated into product delivery status. | Protects against provider-native leakage. |
| INV-M-007 | Failed Message must carry a safe failure category where possible. | Supports observability and recovery. |
| INV-M-008 | Delivered or Read does not mean OmniWA guarantees upstream WhatsApp delivery beyond translated signal. | Avoids false guarantee. |

## Media Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-ME-001 | MediaAsset category must be image, video, document, or audio for MVP. | Unsupported media is not accepted as supported send capability. |
| INV-ME-002 | Media binary is not retained by default after processing. | Metadata may be retained under policy. |
| INV-ME-003 | Diagnostic capture requires explicit enablement and bounded expiration. | Must be auditable and safe. |
| INV-ME-004 | MediaAsset does not own Message lifecycle. | Media readiness is consumed by Messaging. |
| INV-ME-005 | Provider media transport details must not enter MediaAsset as domain state. | Provider Integration translates. |

## Webhook Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-W-001 | WebhookSubscription must be valid before delivery is scheduled. | Invalid subscriptions cannot create normal deliveries. |
| INV-W-002 | WebhookDelivery has exactly one current lifecycle state. | Delivery root owns attempts/retry/dead-letter. |
| INV-W-003 | Delivered WebhookDelivery is terminal. | No further retry after delivered. |
| INV-W-004 | Retry budget is bounded and visible. | No infinite hidden retry. |
| INV-W-005 | Dead Letter is operator-visible. | Prevents silent failure. |
| INV-W-006 | Webhook payload is Confidential and must be redacted from normal logs. | Secret values never included. |
| INV-W-007 | Webhook delivery status does not change Message, Instance, Session, Media, or Guardrail state. | Webhook owns delivery only. |

## Guardrail Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-GR-001 | GuardrailDecision outcome must be explicit. | Allowed outcomes are passed, blocked, throttled, or action-required. |
| INV-GR-002 | GuardrailDecision must be created before outbound message work is accepted. | Guardrails run before acceptance. |
| INV-GR-003 | Blocked/throttled/action-required outcomes must be visible. | Operators must understand why work is not accepted. |
| INV-GR-004 | Configuration cannot silently bypass spam, broadcast, rate-limit, or abuse-risk guardrails. | Frozen product posture. |
| INV-GR-005 | Guardrails do not provide legal compliance automation or provider policy guarantee. | Responsibility boundary. |

## Provider Integration Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-P-001 | ProviderProfile cannot own product business policy. | It is an ACL support aggregate. |
| INV-P-002 | ProviderProfile cannot expand product message scope by itself. | Product decision required. |
| INV-P-003 | Provider failures must be classified before product contexts consume them. | External provider error category or equivalent safe classification. |
| INV-P-004 | Provider-native identifiers are external references, not aggregate identities. | Product identities remain OmniWA-owned. |

## Operations Invariants

| ID | Invariant | Notes |
| --- | --- | --- |
| INV-O-001 | WorkerJob has exactly one current lifecycle state. | Queued, reserved, running, completed, retrying, or dead. |
| INV-O-002 | One job lineage must not be running in two workers simultaneously. | Runtime implementation deferred, invariant remains. |
| INV-O-003 | Dead WorkerJob is terminal unless explicit recovery creates new work. | Dead is operator-visible. |
| INV-O-004 | WorkerJob does not decide owner aggregate business outcome. | Owner context interprets job result. |
| INV-O-005 | Retry policy must be bounded. | No infinite hidden retry. |

## Security, Audit, Health, Configuration, Observability Invariants

| ID | Invariant | Owner | Notes |
| --- | --- | --- | --- |
| INV-SA-001 | Privileged action requires explicit AccessDecision. | Security and Access | Access decision can be referenced by owner context. |
| INV-SA-002 | Denied access cannot perform product mutation. | Security and Access | Enforced before domain mutation. |
| INV-A-001 | AuditRecord must not store Secret or raw Confidential payload. | Audit | Only safe evidence summary. |
| INV-A-002 | AuditRecord retention category must be explicit. | Audit | Retention mechanics deferred. |
| INV-H-001 | HealthStatus cannot mutate source business state. | Health | Projection only. |
| INV-H-002 | HealthStatus must distinguish cause category where possible. | Health | OmniWA/provider/downstream/dependency. |
| INV-C-001 | Invalid ConfigurationSnapshot cannot become active. | Configuration | Configuration safety first. |
| INV-C-002 | Guardrail-bypass configuration must be rejected. | Configuration | Cannot silently disable mandatory guardrails. |
| INV-T-001 | TelemetrySignal must apply redaction before projection. | Observability | No raw Secret/Confidential values. |
| INV-T-002 | TelemetrySignal is not source of business truth. | Observability | Observability cannot drive business state directly. |

## Invariant Validation Guidance

| Validation Target | How It Should Be Checked Later |
| --- | --- |
| Aggregate lifecycle invariants | Domain behavior tests around aggregate roots. |
| Cross-aggregate invariants | Application orchestration tests with fake ports and explicit consistency expectations. |
| Provider translation invariants | Provider contract tests using translated product signals. |
| Sensitive data invariants | Redaction/secret scanning and audit/telemetry tests. |
| Architecture invariants | Import and dependency fitness functions from Phase 1. |
