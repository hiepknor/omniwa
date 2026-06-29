# OmniWA Runtime Sequence Diagrams

## Purpose

This document defines runtime sequence diagrams for OmniWA Phase 1.4.

The diagrams show interaction order between runtime roles and modules. They do not define REST endpoints, OpenAPI, database schemas, Prisma, Docker, source code, BullMQ implementation, or Baileys internals.

## Send Text Message

```mermaid
sequenceDiagram
  participant Client
  participant API as API Runtime
  participant App as Application
  participant Guardrails as Guardrails Module
  participant Messaging as Messaging Module
  participant Queue as QueueProvider Port
  participant Worker as Worker Runtime
  participant Provider as Provider Runtime
  participant WA as WhatsApp Network
  participant Status as Status Update Flow

  Client->>API: Submit text message intent
  API->>App: Invoke send-message use case
  App->>Guardrails: Evaluate rate-limit and abuse-risk guardrails
  Guardrails-->>App: Allowed, blocked, throttled, or action-required
  App->>Messaging: Create message lifecycle state
  Messaging-->>App: Message Created
  App->>Queue: Schedule outbound message work
  Queue-->>App: Work Queued
  App-->>API: Accepted or rejected product state
  API-->>Client: Product acknowledgement
  Worker->>Queue: Reserve outbound message work
  Worker->>App: Execute outbound message work
  App->>Messaging: Move Queued to Processing
  App->>Provider: Send through MessagingProvider port
  Provider->>WA: Provider-specific send operation
  WA-->>Provider: Provider status signal
  Provider-->>App: Translated provider result
  App->>Messaging: Update Sent, Delivered, Read, Failed, or Action Required
  App->>Status: Emit sanitized status event
```

Notes:

- API Runtime does not wait for final WhatsApp delivery.
- Provider result is translated before product modules consume it.
- Message status updates are product states, not raw provider payloads.

## Receive Message

```mermaid
sequenceDiagram
  participant WA as WhatsApp Network
  participant Provider as Provider Runtime
  participant App as Application
  participant Messaging as Messaging Module
  participant Media as Media Module
  participant Webhook as Webhook Module
  participant WebhookQueue as Webhook Queue
  participant Delivery as Webhook Delivery
  participant Consumer as Webhook Consumer

  WA-->>Provider: Incoming provider message event
  Provider->>Provider: Translate provider-native payload
  Provider-->>App: Translated inbound message event through provider event port
  App->>Messaging: Classify inbound message
  Messaging-->>App: Supported, unsupported, or failed classification
  opt Media payload or media reference
    App->>Media: Classify/process supported media metadata
    Media-->>App: Media processed or failed
  end
  App->>Webhook: Prepare integration event
  Webhook->>WebhookQueue: Schedule webhook delivery work
  Delivery->>WebhookQueue: Reserve delivery work
  Delivery->>Consumer: Deliver integration event
  Consumer-->>Delivery: Acknowledge, fail, or timeout
  Delivery-->>App: Delivery outcome
  App->>Webhook: Update Delivered, Retrying, Failed, or Dead Letter
```

Notes:

- Provider does not publish webhook events directly.
- Webhook delivery is asynchronous and retry-visible.

## QR Login

```mermaid
sequenceDiagram
  participant Operator as Developer / Operator
  participant API as API Runtime
  participant App as Application
  participant Instance as Instance Module
  participant Session as Session Module
  participant Provider as Provider Runtime
  participant Health as Health Module

  Operator->>API: Create instance intent
  API->>App: Invoke instance creation use case
  App->>Instance: Create instance state
  Instance-->>App: Instance Created
  App->>Session: Mark session Empty or Pending
  App->>Provider: Start provider connect through port
  Provider-->>App: QR generated signal through provider event port
  App->>Instance: Move Connecting to QR Pending
  App-->>API: QR Pending product state
  API-->>Operator: Pairing state available
  Operator->>Provider: QR consumed through WhatsApp pairing flow
  Provider-->>App: Authenticated signal
  App->>Session: Mark Session Active
  App->>Instance: Move to Connected
  App->>Health: Update instance health Ready
```

Notes:

- QR rendering and presentation are Interface concerns.
- Provider-native session material remains Secret.

## Reconnect

```mermaid
sequenceDiagram
  participant Provider as Provider Runtime
  participant App as Application
  participant Instance as Instance Module
  participant Session as Session Module
  participant Scheduler as Background Runtime
  participant Worker as Worker Runtime
  participant Health as Health Module
  participant Obs as Observability

  Provider-->>App: Connection lost signal through provider event port
  App->>Instance: Move Connected to Disconnected
  App->>Session: Classify session as Active, Expired, or Revoked
  App->>Health: Mark dependency degraded or action-required
  Scheduler->>App: Trigger reconnect check
  App->>Worker: Schedule reconnect work through queue port
  Worker->>App: Execute reconnect workflow
  App->>Provider: Restore session through provider port
  alt Restore succeeds
    Provider-->>App: Connected signal through provider event port
    App->>Session: Confirm Active
    App->>Instance: Move to Connected
    App->>Obs: Emit reconnect success metric
  else Restore fails
    Provider-->>App: Failure or action-required category through provider event port
    App->>Session: Mark Expired or Revoked when classified
    App->>Instance: Move to Disconnected or Logged Out
    App->>Obs: Emit reconnect failure metric and alert candidate
  end
```

Notes:

- Two reconnect workflows must not run concurrently for the same instance.
- Logout, policy restriction, missing credentials, and device unlink are not counted as auto-recoverable reconnect success.

## Send Media

```mermaid
sequenceDiagram
  participant Client
  participant API as API Runtime
  participant App as Application
  participant Validation as Validation
  participant Guardrails as Guardrails
  participant Messaging as Messaging
  participant Media as Media
  participant Queue as QueueProvider Port
  participant Worker as Worker Runtime
  participant Provider as Provider Runtime
  participant WA as WhatsApp Network

  Client->>API: Submit supported media message intent
  API->>App: Invoke media message use case
  App->>Validation: Validate boundary shape and supported scope
  App->>Guardrails: Evaluate guardrails
  App->>Messaging: Create message lifecycle state
  App->>Media: Validate media category and retention policy
  Media-->>App: Media Accepted
  App->>Queue: Schedule media message work
  App-->>API: Accepted or rejected product state
  Worker->>Queue: Reserve media message work
  Worker->>App: Execute media send workflow
  App->>Media: Move media to Processing
  App->>Provider: Send media through provider port
  Provider->>WA: Provider-specific media operation
  WA-->>Provider: Provider delivery/status signal
  Provider-->>App: Translated result
  App->>Messaging: Update message lifecycle
  App->>Media: Record processed/failed/cleaned state
```

Notes:

- Binary media is not retained by default after processing.
- Provider media upload details stay behind Provider Runtime.

## Webhook Retry

```mermaid
sequenceDiagram
  participant App as Application
  participant Webhook as Webhook Module
  participant Queue as QueueProvider Port
  participant Worker as Worker Runtime
  participant Transport as WebhookTransport
  participant Consumer as Webhook Consumer
  participant Obs as Observability

  App->>Webhook: Product event ready for integration
  Webhook->>Queue: Schedule webhook delivery
  Worker->>Queue: Reserve webhook work
  Worker->>App: Execute webhook delivery use case
  App->>Transport: Deliver integration event
  Transport->>Consumer: Send event
  Consumer-->>Transport: Failure or timeout
  Transport-->>App: Delivery failed
  App->>Webhook: Move Delivering to Retrying
  App->>Queue: Schedule retry with bounded retry policy
  Worker->>Queue: Reserve retry work
  Worker->>App: Execute webhook retry
  App->>Transport: Deliver integration event again
  alt Success
    Transport-->>App: Delivery acknowledged
    App->>Webhook: Move to Delivered
    App->>Obs: Emit success metric
  else Retry budget exhausted
    Transport-->>App: Failure or timeout
    App->>Webhook: Move to Dead Letter
    App->>Obs: Emit dead-letter metric and alert candidate
  end
```

Notes:

- Webhook retry must preserve idempotency semantics.
- Dead Letter is terminal until operator recovery or explicit replay policy is defined later.
