# OmniWA Ubiquitous Language

## Purpose

This document defines the shared product language for OmniWA domain design.

Each term must have one meaning. Provider-native meanings, database meanings, HTTP meanings, and queue-engine meanings must not replace these product meanings.

## Language Rules

- Use OmniWA product terms before provider terms.
- Do not use Baileys-native payload names as domain terms.
- Do not use database table names as domain terms.
- Do not use REST or HTTP response terms as domain terms.
- Do not use "event" ambiguously. In Phase 2.1, event names are conceptual product signals only.
- Do not use "message" to mean webhook, job, provider packet, or queue payload.
- Do not use "session" to mean instance.

## Terms

| Term | Definition | Owning Context | Not To Mean |
| --- | --- | --- | --- |
| OmniWA | The product platform providing a production-minded WhatsApp API surface over provider adapters. | Product-wide | A Baileys wrapper, WhatsApp Cloud API replacement, or spam/broadcast tool. |
| Tenant | A product ownership boundary. MVP is Single Tenant. | Future product decision | A database schema, customer account table, or current MVP multi-tenant feature. |
| Instance | A product-managed WhatsApp connection unit under the single tenant. | Instance | Session, device, provider socket, phone number record, or worker. |
| Session | Product-level authentication/session state associated with an instance. | Session | Instance lifecycle, provider-native auth payload, or QR display. |
| Provider | An external messaging capability behind an adapter, initially Baileys. | Provider Integration | Business policy owner or domain source of truth. |
| Messaging Provider | Product-oriented provider capability that can send/receive supported messages and report translated status. | Provider Integration | A direct Baileys type or provider-specific object. |
| Provider Signal | A translated provider observation made safe for product contexts. | Provider Integration | Raw provider payload or business event. |
| Message | A product-level communication item within MVP-supported types. | Messaging | Webhook delivery, queue job, provider packet, log entry, or campaign. |
| Outbound Message | A message intent initiated by an API client and accepted or rejected by OmniWA. | Messaging | Guaranteed WhatsApp delivery or broadcast. |
| Inbound Message | A provider-received message translated into OmniWA product language. | Messaging | Raw provider callback payload. |
| Supported Message Type | One of text, image, video, document, or audio for MVP. | Messaging | Sticker, location, contact card, reaction, poll, interactive, status, newsletter, commerce, campaign, or broadcast. |
| Conversation | A product-level view of message exchange context where needed later. | Messaging | Database chat row or provider-native chat object. |
| Chat | WhatsApp conversation-like grouping as described in product language. | Messaging | Group administration capability or provider-specific chat payload. |
| Delivery | A message lifecycle observation after accepted work begins. | Messaging | A guarantee that WhatsApp or the recipient accepted/read the message. |
| Delivery Status | Product state such as queued, processing, sent, delivered, read, failed, or cancelled. | Messaging | Provider-specific status enum. |
| Media | Product-level metadata and processing state for image, video, document, or audio content. | Media | Raw binary payload retained by default. |
| Attachment | A media item associated with a media-bearing message intent. | Media | Provider upload object or storage object implementation. |
| Media Metadata | Safe descriptive data such as category, size classification, processing status, and retention category. | Media | Raw media body or object storage internals. |
| Webhook | A product integration mechanism for delivering approved product signals to an external receiver. | Webhook Delivery | Provider callback, inbound message, or direct business state change. |
| Webhook Subscription | Product-level intent describing which approved signals should be delivered externally. | Webhook Delivery | REST endpoint schema or transport implementation. |
| Webhook Delivery | A lifecycle-tracked attempt to deliver an approved integration signal to a webhook consumer. | Webhook Delivery | Original business fact or external receiver uptime. |
| Integration Event | A product signal approved for external integration delivery. | Webhook Delivery | Domain event schema, provider event, or queue implementation payload. |
| Domain Event Signal | A conceptual business fact produced by a domain context. | Owning domain context | Event class, transport topic, webhook payload, or database record. |
| Async Work | Product-accepted work that will be completed by background processing with visible lifecycle state. | Operations | Fire-and-forget execution. |
| Queue | A conceptual mechanism for durable asynchronous work. | Operations | A specific queue engine or product business owner. |
| Job | A visible unit of async work lifecycle. | Operations | Message, webhook payload, provider packet, or worker process. |
| Worker | Runtime role that processes async work. | Operations | Business policy owner or API layer. |
| Retry | A controlled follow-up attempt after an eligible temporary failure. | Operations | Infinite loop, hidden resend, or policy bypass. |
| Dead Letter | Terminal or operator-visible failed async work that cannot continue automatically. | Operations | Silent drop or successful completion. |
| Guardrail | Product-enforced responsible-usage decision boundary. | Guardrails | Legal advice, WhatsApp policy enforcement, or provider account protection guarantee. |
| Spam | Unwanted or abusive messaging behavior that OmniWA must not facilitate. | Guardrails | Any high-volume legitimate integration by default. |
| Broadcast | Sending the same or substantially similar outbound message to many recipients as a campaign-like workflow. | Guardrails | One normal outbound message. |
| Rate Limit | Product-level control limiting how much work may be accepted or processed within a defined window. | Guardrails | Provider quota guarantee or infrastructure-only throttle. |
| Abuse Detection | Rule-based product classification of risky usage requiring block, throttle, or action-required outcome. | Guardrails | Automated legal compliance or Meta policy enforcement. |
| Admin | Actor with privileged control over configuration, instances, sessions, and recovery actions. | Security and Access | End customer or external webhook receiver. |
| Operator | Technical user responsible for running, observing, and recovering OmniWA. | Security and Access | Automated client or end customer. |
| API Client | External system calling OmniWA product capabilities through future interface boundaries. | Security and Access / Application | Human operator, provider, or webhook consumer. |
| End Customer | The person or business contact communicating through WhatsApp. | Product-wide | OmniWA tenant, admin, operator, or API client. |
| API Key | Secret credential used to authenticate an API client. | Security and Access | User identity, provider token, or non-secret configuration. |
| Secret Data | Data that must never be logged or exposed in plaintext outside controlled secret-handling flows. | Security and Access / Session | Confidential data that can be redacted and retained under policy. |
| Confidential Data | Sensitive business or personal data that must be redacted in normal logs and handled under retention rules. | Product-wide | Secret credentials. |
| Correlation ID | Identifier used to connect related work across boundaries. | Observability | Message ID, request payload, or user identity. |
| Request ID | Identifier for one inbound request at the interface boundary. | Observability | Correlation ID for an entire workflow. |
| Trace ID | Identifier for tracing execution across runtime components. | Observability | Business entity identity. |
| JID | WhatsApp identifier treated as Confidential data in OmniWA. | Messaging | Public username or unrestricted log value. |
| Contact | Product-level representation of a WhatsApp contact reference. | Messaging | Contact-card message type support in MVP. |
| Participant | A member of a group-like WhatsApp context when observed inbound. | Messaging | MVP group administration capability. |
| Group | WhatsApp group context that may appear in provider observations. | Messaging | MVP group messaging or group administration feature. |
| QR Pairing | Session pairing flow requiring user/device action. | Session | QR rendering implementation or provider-native QR payload. |
| Reconnect | Controlled attempt to restore provider connection/session readiness. | Instance / Session / Operations | Concurrent uncontrolled provider reconnect loop. |
| Action Required | Product state indicating operator intervention is needed. | Owning context | Generic error or hidden failure. |
| Health State | Product/dependency status classification used for operator visibility. | Health | Raw metrics or provider-specific status. |
| Configuration Snapshot | A validated view of effective product configuration. | Configuration | Environment file, database row, or unvalidated settings object. |
| Audit Record | Secret-safe evidence of security-sensitive or operational action. | Audit | Application log, raw payload, or telemetry event. |
| Retention | Product policy describing how long a category of data may be kept. | Owning context / Configuration | Backup strategy or storage schema. |
| Backup | Product recovery support for recoverable state under defined policy. | Session / Operations | Raw copy of all data by default. |
| Recovery | Product workflow to restore service or state after failure. | Operations / owning context | Guaranteed restoration of upstream WhatsApp state. |
| Provider Error | Product-level classification of a failure originating from a provider boundary. | Provider Integration | Raw provider exception type. |
| Business Error | Failure caused by product rule or lifecycle constraint. | Owning context | Infrastructure failure or validation shape error. |
| Validation Error | Failure caused by invalid input shape or unacceptable boundary data. | Validation boundary / Application | Business decision or provider failure. |
| Idempotency | Product expectation that repeated processing of the same accepted work does not create duplicate side effects. | Operations / owning context | Exactly-once infrastructure guarantee. |

## Ambiguity Controls

| Ambiguous Word | Required Clarification |
| --- | --- |
| Event | Specify domain event signal, application event, integration event, async event, or telemetry signal. |
| Status | Specify instance status, session status, message delivery status, webhook delivery status, job status, or health status. |
| Provider | Specify provider integration boundary, provider adapter, or external provider/network. |
| Message | Specify inbound message, outbound message, provider signal, or webhook delivery. |
| Session | Specify product session state, Secret session material, or provider-native session payload. Provider-native payload is not a domain term. |
| Delivery | Specify message delivery visibility or webhook delivery lifecycle. |
| Failure | Specify business, validation, provider, webhook, network, configuration, queue, worker, media, session, security, or unexpected failure category. |

## Forbidden Language In Domain Model

- Baileys-native type names as domain concepts.
- REST request/response names as domain concepts.
- Database table or ORM model names as domain concepts.
- Queue engine job payload names as domain concepts.
- Provider-native delivery enums as domain status.
- Marketing/campaign language as MVP capabilities.
- Broadcast as a supported send capability.
