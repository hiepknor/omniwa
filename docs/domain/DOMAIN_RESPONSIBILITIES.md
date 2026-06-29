# OmniWA Domain Responsibilities

## Purpose

This document assigns product capabilities to bounded contexts.

Each capability must have one owner. Non-owner contexts may coordinate through Application, consume published signals, or use approved ports, but they must not become alternate sources of truth.

## Responsibility Matrix

| Capability | Owner Context | Reason | Not Owner |
| --- | --- | --- | --- |
| Instance lifecycle | Instance | Instance is the product resource operators manage. | Session, Provider Integration, Worker, Interface |
| Instance health summary | Instance | Instance owns its own visible status, with Health supplying dependency classification. | Health alone, Observability, Provider Integration |
| Instance action-required state | Instance | Operator action must be attached to the product resource. | Provider Integration, Operations |
| QR pairing product state | Session | Pairing is part of session authentication lifecycle. | Instance, Provider Integration, Interface |
| Session active/expired/revoked state | Session | Session owns authentication/session lifecycle. | Instance, Messaging, Provider Integration |
| Session retention policy | Session | Session is the owner of Secret-backed session state semantics. | Persistence, SecretProvider, Configuration |
| Session recovery requirement | Session | Session decides whether recovery is needed; Operations tracks recovery work visibility. | Operations, Provider Integration |
| Outbound message acceptance | Messaging | Messaging owns supported type and message lifecycle decision. | Interface, Provider Integration, Worker |
| Supported message type scope | Messaging | Product scope says MVP supports text, image, video, document, and audio. | Provider Integration, Media, Configuration |
| Inbound message classification | Messaging | Inbound provider signals must become product message concepts. | Provider Integration alone, Webhook Delivery |
| Message delivery lifecycle | Messaging | Messaging owns queued, processing, sent, delivered, read, failed, and cancelled meaning. | Provider Integration, Operations, Webhook Delivery |
| Provider delivery signal translation | Provider Integration | Provider-specific observations must be translated before product contexts consume them. | Messaging, Session, Instance |
| Media metadata validation | Media | Media owns supported media category and metadata policy. | Messaging, Provider Integration, Object Storage |
| Media processing lifecycle | Media | Media owns accepted, processing, processed, failed, and retention-expired meaning. | Operations, Provider Integration |
| Media body retention decision | Media | Media owns product retention classification for media content. | Storage adapter, Messaging |
| Webhook subscription product intent | Webhook Delivery | Webhook Delivery owns external integration delivery configuration at product level. | Messaging, Interface, External Receiver |
| Webhook delivery lifecycle | Webhook Delivery | Webhook delivery attempt/retry/dead-letter state is a core integration capability. | Messaging, Operations, External Receiver |
| Webhook dead-letter visibility | Webhook Delivery | Dead-letter is part of integration delivery lifecycle. | Queue engine, Worker runtime |
| Guardrail evaluation | Guardrails | Responsible-usage policy is frozen as product-enforced guardrails. | Messaging, Configuration, Provider Integration |
| Rate-limit decision | Guardrails | Rate-limit is a product-level responsible-usage outcome. | Queue engine, Reverse Proxy |
| Abuse-risk classification | Guardrails | Abuse-risk belongs to product guardrail semantics. | Provider Integration, Observability |
| Unsupported broadcast/campaign classification | Guardrails | MVP excludes broadcast/campaign; Guardrails detects and rejects these intents. | Messaging alone, Interface |
| Async job lifecycle visibility | Operations | Accepted async work must not disappear silently. | Queue engine alone, Worker runtime alone |
| Retry/dead-letter support for jobs | Operations | Operations owns generic async lifecycle support, while owning product context interprets business outcome. | Messaging, Webhook Delivery, Media |
| Backpressure classification | Operations | Backpressure is a runtime work visibility concern. | Guardrails, Provider Integration |
| Access decision | Security and Access | Access and capability decisions protect privileged actions. | Interface alone, Product contexts |
| Privileged action classification | Security and Access | Security owns whether an action needs elevated control and audit evidence. | Audit, Interface |
| Audit evidence semantics | Audit | Audit owns what safe evidence must exist and how it is redacted. | Observability, Logs, Product contexts |
| Audit retention category | Audit | Audit owns retention semantics for audit records. | Persistence, Configuration alone |
| Health classification | Health | Health owns operator-readable health categories and dependency status. | Observability alone, Provider Integration |
| Dependency health projection | Health | Health distinguishes OmniWA, provider/account, downstream, and infrastructure degradation. | Instance alone, Operations alone |
| Configuration validation | Configuration | Configuration owns whether effective settings are valid and safe. | Environment loader, Interface |
| Configuration safety validation | Configuration | Configuration rejects unsafe settings, including settings that would silently bypass required guardrails. | Deployment environment, Guardrails |
| Guardrail policy meaning | Guardrails | Guardrails owns the product meaning of allow, block, throttle, abuse-risk, and unsupported-usage outcomes. | Configuration, Deployment environment |
| Correlation vocabulary | Observability | Observability owns correlation/request/trace terminology and safe projection. | Messaging, Audit |
| Sanitized telemetry projection | Observability | Observability owns telemetry safety and redaction vocabulary. | Product contexts, raw logs |
| Provider capability mapping | Provider Integration | Provider Integration owns compatibility translation. | Messaging, Media, Session |
| Provider failure classification | Provider Integration | Provider failures must be translated into product-level categories. | Domain contexts directly |

## Capabilities Intentionally Not Owned In MVP

| Capability | Status | Reason |
| --- | --- | --- |
| Multi-tenant product model | Deferred | Phase 0 freezes MVP as Single Tenant + Multi Instance. |
| Broadcast/campaign sending | Out of scope | Explicitly excluded by Phase 0 and architecture freeze. |
| Group administration | Out of scope | Not an MVP send capability. |
| Stable SDK packages | Deferred | MVP may include documentation/examples later, not stable SDK commitments. |
| Advanced message types | Out of scope | Sticker, location, contact card, reaction, poll, interactive, status, newsletter, commerce, campaign, and broadcast are outside MVP scope. |
| WhatsApp Cloud API provider | Deferred | Future provider requires ADR/product decision. |
| Telegram, Messenger, Instagram | Deferred | Future channels require product decision and ADR. |
| Billing | Deferred | Not part of Phase 0 product scope. |
| Analytics product | Deferred | Can consume published language later, but is not MVP. |

## Future Evolution

| Future Change | Contexts Likely To Change | Contexts That Should Stay Stable | Notes |
| --- | --- | --- | --- |
| WhatsApp Cloud API | Provider Integration, possibly Messaging/Media provider contracts, Configuration, Health | Guardrails, Webhook Delivery, Audit, Observability, core message lifecycle unless product semantics change | Requires provider ADR and compatibility evaluation. |
| Telegram | Provider Integration, Messaging, Media, Guardrails, Ubiquitous Language | Webhook Delivery delivery lifecycle, Operations generic job lifecycle, Observability safety rules | Requires product decision because non-WhatsApp concepts may not fit current language. |
| Messenger | Provider Integration, Messaging, Media, Guardrails | Operations, Audit, Observability, Health classification framework | Requires product decision and likely new channel vocabulary. |
| Instagram | Provider Integration, Messaging, Media, Guardrails | Webhook Delivery, Audit, Observability | Requires product decision; media/message semantics may differ. |
| Multi Tenant | Security and Access, Configuration, Audit, Observability, all ownership rules requiring tenant boundary | Provider ACL pattern, no provider-native domain rule, Webhook async lifecycle | Requires product decision, ADR, and review of every context's data ownership boundary. |
| Campaign | New Campaign context, possibly Audience/Recipient contexts, Guardrails | Messaging as single accepted message workflow, Provider ACL, Webhook Delivery | Campaign must not be smuggled into Messaging. It is out of MVP. |
| Analytics | New Analytics/Reporting context consuming published language | Core source-of-truth contexts | Analytics must not become source of business state or raw payload retention. |
| Billing | New Billing/Usage context consuming approved usage signals | Core message/session/webhook lifecycle | Billing requires product decision and ADR. |
| Horizontal scaling | Operations, Provider Integration, Health, Configuration | Domain ownership rules and context contracts | Runtime coordination changes must not alter source-of-truth ownership. |
| Cluster workers | Operations, Health, Configuration | Messaging/Webhook/Media product lifecycle meaning | Worker concurrency details require future ADR. |

## Contexts That Must Not Change Without ADR

- Provider Integration as Anti-Corruption Layer.
- Domain independence from provider, queue, persistence, API, logging, telemetry, and framework concerns.
- Messaging ownership of message lifecycle.
- Session ownership of session lifecycle and Secret-sensitive session policy.
- Webhook Delivery ownership of external delivery lifecycle only.
- Guardrails ownership of responsible-usage decisions.
- No default retention of raw message/media bodies.
- No Secret logging.
- MVP scope boundaries for tenancy and supported message types.

## Domain Ownership Review Rules

Before assigning a capability, reviewers must ask:

| Question | Passing Answer |
| --- | --- |
| Is there exactly one owner? | Yes. |
| Is the owner the context with the business vocabulary for the rule? | Yes. |
| Does a non-owner mutate the owner's state? | No. |
| Does this depend on provider-native data? | No, provider data is translated first. |
| Does this introduce out-of-scope MVP capability? | No. |
| Does this require API/database/queue implementation to be meaningful? | No. |
