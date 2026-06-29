# OmniWA Product Scope

## Problem Statement

Baileys gives developers direct access to WhatsApp Web automation primitives, but using Baileys directly in production creates product and operational gaps.

Common developer problems include:

- Session lifecycle is difficult to manage consistently.
- QR pairing, reconnects, disconnect reasons, and device state require careful handling.
- Message sending and receiving are easy to prototype but harder to operate at scale.
- Webhook delivery, retries, idempotency, and failure visibility are usually rebuilt by every team.
- Media handling introduces file size, storage, timeout, and cleanup concerns.
- Queueing and background workers are often added late, after production instability appears.
- Logs and troubleshooting are inconsistent across teams.
- Baileys changes can affect applications unless there is a stable product layer.

Evolution API and similar wrappers help by packaging common capabilities, but they can still be limiting for teams that need long-term control.

Observed limitations in that category include:

- Product behavior can be coupled to implementation choices that are hard to replace.
- Extension points may not match a team's domain needs.
- Teams can inherit operational behavior without fully understanding it.
- The platform can become a dependency that is easier to use at first but harder to evolve later.
- Internal product boundaries may not be clear enough for teams that want modular growth.

OmniWA solves this by defining a clean, production-minded WhatsApp API platform around Baileys, with explicit product domains, operational expectations, and responsible usage boundaries.

## Product Goal

The product goal is to provide a dependable platform for WhatsApp connectivity and automation that lets developers integrate messaging features without building the entire production wrapper themselves.

OmniWA should make the following jobs easier:

- Connect and operate WhatsApp instances.
- Send, receive, and track messages.
- Deliver events to external systems.
- Manage contacts, chats, groups, and media at a product level.
- Observe system health and troubleshoot failures.
- Extend the platform without forking core behavior.

## Target Users

### MVP Persona Decision

For the MVP, OmniWA targets:

- Primary persona: developer-led SaaS builder.
- Secondary persona: internal technical team operating WhatsApp automation for one organization.

This narrows the MVP toward developers who need reliable WhatsApp connectivity, messaging, webhooks, troubleshooting, and clear operating limits.

Startup teams remain an important audience when they match the primary persona. CRM systems and automation platforms are integration targets, not the primary MVP persona. Enterprise teams are supported as a secondary persona only when their needs fit the single-tenant MVP model.

### Developers

Developers need a stable product surface over Baileys so they can build WhatsApp features faster without owning every protocol detail.

### Startup Teams

Startups need a pragmatic platform that supports customer communication workflows, automation, and fast iteration without adopting a heavy enterprise stack too early.

### SaaS Builders

SaaS builders need multi-customer messaging capabilities, predictable integration behavior, and clear boundaries for future tenant-level controls.

### Internal Enterprise Teams

Internal teams need operational visibility, security expectations, auditability, and maintainable documentation before they can run WhatsApp automation inside a company.

### CRM Systems

CRM systems need contact, chat, message, and webhook capabilities that can integrate with customer records and workflow tools.

### Automation Platforms

Automation platforms need event-driven WhatsApp connectivity, reliable webhook delivery, queue behavior, and safe retry semantics.

## Core Product Capabilities

### Instance Management

Instances represent WhatsApp connections that can be paired, monitored, disconnected, reconnected, and operated over time.

Expected product value:

- Make connection state visible.
- Reduce manual handling of QR pairing and reconnect workflows.
- Give operators a clear unit of ownership.

Trade-off:

- Instance management must expose enough detail to be useful without leaking unnecessary Baileys internals.

### Messaging

Messaging covers sending, receiving, status tracking, and basic message lifecycle visibility.

Expected product value:

- Give applications a predictable way to use WhatsApp messaging.
- Support common message types needed by real business workflows.
- Make send failures and delivery state easier to diagnose.

Trade-off:

- The MVP should avoid every exotic WhatsApp message type until the core lifecycle is stable.

### Webhooks

Webhooks notify external systems about incoming messages, status changes, instance events, and operational events.

Expected product value:

- Let OmniWA integrate with CRMs, automation platforms, and internal systems.
- Support event-driven workflows without polling.

Trade-off:

- Webhooks become a reliability surface and need clear product expectations around retry, visibility, and failure handling.

### Groups

Group capabilities cover reading group metadata, tracking participants, and supporting controlled group messaging workflows.

Expected product value:

- Support teams that use WhatsApp groups for operations, communities, or internal coordination.

MVP boundary:

- Group product capabilities are deferred from MVP.
- Unsupported incoming group-related events may be surfaced for visibility where safe and useful, but group administration and group messaging are not MVP send capabilities.

Trade-off:

- Group automation can increase policy and abuse risk, so support should be careful and transparent.

### Media

Media capabilities cover sending and receiving supported media assets such as images, audio, documents, and videos.

Expected product value:

- Enable real business communication beyond text.
- Make media handling observable and predictable.

Trade-off:

- Media introduces storage, bandwidth, file lifecycle, and timeout concerns that must be treated as product constraints.

### Contacts

Contact capabilities help applications identify, retrieve, and sync WhatsApp contacts where supported.

Expected product value:

- Improve CRM and customer support workflows.

Trade-off:

- Contact data is sensitive and requires strong privacy and security expectations.

### Chats

Chat capabilities expose conversation-level context such as chat identity, recent activity, unread state, and message association.

Expected product value:

- Help applications organize communication around conversations rather than isolated messages.

Trade-off:

- Chat state can be large and inconsistent if sync behavior is not clearly bounded.

### Queue

Queue capability represents product-level support for controlled background processing of messages, webhook delivery, media tasks, and retries.

Expected product value:

- Improve reliability under load and during transient failures.
- Prevent all work from depending on request-time execution.

Trade-off:

- Queue behavior must be visible and manageable; otherwise it hides failures.

### Dashboard

The dashboard gives operators and developers a visual surface for instances, health, logs, events, and troubleshooting.

Expected product value:

- Reduce operational friction.
- Make the platform understandable without reading raw logs.

Trade-off:

- Dashboard should not become the only way to operate the product; automation and integration remain important.

### SDK

SDKs help developers integrate OmniWA into applications with less boilerplate and fewer mistakes.

Expected product value:

- Reduce onboarding time.
- Encourage consistent integration patterns.

MVP boundary:

- Stable SDK packages are deferred until core platform behavior is proven.
- MVP may include documentation and examples, but SDK compatibility commitments are not part of the MVP.

Trade-off:

- SDKs create compatibility commitments and should follow the maturity of the core product.

## MVP Scope

The MVP should prove that OmniWA can operate as a reliable WhatsApp API platform, not only as a demo wrapper.

MVP capabilities should include:

- Instance creation and lifecycle visibility.
- QR pairing workflow.
- Connection status and reconnect visibility.
- Send and receive text messages.
- Send and receive supported basic media: image, video, document, and audio.
- Webhook delivery for key events.
- Basic retry and queue visibility for asynchronous work.
- Operator-facing dashboard for instance and event inspection.
- Basic logs and metrics for troubleshooting.
- Security baseline for credentials, access control, and sensitive data handling.
- Clear documentation for setup, usage boundaries, and failure modes.

### MVP Tenancy Model

The MVP tenancy model is Single Tenant + Multi Instance.

One deployment represents one organization, workspace, or operational owner. That owner can manage multiple WhatsApp instances. MVP does not provide multi-tenant isolation.

### MVP Supported Message Types

MVP send and receive capabilities are limited to:

- Text.
- Image.
- Video.
- Document.
- Audio, including voice-note-like audio where supported by the underlying WhatsApp behavior.

Unsupported incoming message types should be visible as unsupported events where safe and useful, but they are not MVP send capabilities.

### MVP Compliance Guardrails

OmniWA is an API platform with MVP product-enforced guardrails:

- Broadcast and campaign sending are not supported in MVP.
- Bulk recipient import for sending is not supported in MVP.
- Sending workflows must expose rate-limit and abuse-risk states before production readiness.
- Documentation must state that users are responsible for opt-in, consent, and policy compliance.
- Operators must be able to see when activity is blocked, throttled, failed, or marked action-required.

### MVP Dashboard Scope

The MVP dashboard is limited to the top operator tasks:

- Instance health.
- QR pairing state.
- Recent message and event inspection.
- Webhook delivery status.
- Queue and failure visibility.

## Out Of Scope

OmniWA explicitly does not aim to:

- Replace Meta's official WhatsApp Business Platform or WhatsApp Cloud API.
- Bypass WhatsApp, Meta, or device-level policy restrictions.
- Enable spam, scraping, mass unsolicited messaging, or deceptive automation.
- Circumvent rate limits, bans, account checks, or user consent expectations.
- Guarantee delivery when WhatsApp, device state, account state, network state, or upstream behavior prevents delivery.
- Support every WhatsApp feature in the MVP.
- Hide all Baileys behavior from operators.
- Become a general CRM.
- Become a general workflow automation product.
- Become a full customer support suite.
- Provide legal advice on WhatsApp compliance.
- Provide multi-tenant isolation in MVP.
- Provide stable SDK packages in MVP.
- Provide group administration or group messaging in MVP.
- Provide campaign, broadcast, audience-management, or marketing-automation workflows in MVP.
- Support sticker, location, contact card, reaction, poll, button, list, template, status, story, newsletter, channel, payment, catalog, order, or commerce-specific messages in MVP.

## Product Boundaries

OmniWA should own:

- Product-level WhatsApp connection management.
- Messaging workflows exposed through a stable platform surface.
- Event delivery to integrated systems.
- Operational visibility for teams running the platform.
- Documentation of product behavior, assumptions, and limits.

OmniWA should not own:

- End-user consent collection outside the platform.
- Business-specific CRM workflows.
- Marketing campaign strategy.
- Meta policy interpretation beyond documented guardrails.
- Customer data governance outside the OmniWA boundary.

## Future Expansion Areas

Potential future areas include:

- Multi-tenant administration.
- Advanced SDK support.
- Workflow connectors.
- Enterprise audit controls.
- Usage analytics.
- Policy guardrails.
- Advanced routing and worker controls.
- Pluggable storage and deployment profiles.

These are future-facing product directions, not MVP commitments.
