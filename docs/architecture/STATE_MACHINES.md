# OmniWA Runtime State Machines

## Purpose

This document defines runtime state machines for OmniWA Phase 1.4.

It does not define database schemas, persistence mechanics, REST APIs, source code, Docker, BullMQ, or Baileys internals.

## State Machine Principles

- State machines describe product/runtime lifecycle behavior, not storage implementation.
- State transitions that affect product behavior are owned by Application and product modules.
- Provider-native signals must be translated before entering state machines.
- Terminal states must be observable.
- Unknown states should be minimized and classified where possible.

## Instance State Machine

Required states:

- Created.
- Connecting.
- QR Pending.
- Connected.
- Disconnected.
- Logged Out.
- Destroyed.

```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> Connecting: connect requested
  Created --> Destroyed: destroy requested
  Connecting --> QRPending: provider requires pairing
  Connecting --> Connected: session restored or authenticated
  Connecting --> Disconnected: recoverable failure
  Connecting --> LoggedOut: logout or revoked
  QRPending --> Connected: QR consumed and authenticated
  QRPending --> Disconnected: QR timeout or provider failure
  QRPending --> Destroyed: destroy requested
  Connected --> Disconnected: connection lost
  Connected --> LoggedOut: logout or device unlink
  Connected --> Destroyed: destroy requested
  Disconnected --> Connecting: reconnect requested
  Disconnected --> LoggedOut: unrecoverable auth state
  Disconnected --> Destroyed: destroy requested
  LoggedOut --> Connecting: new pairing requested
  LoggedOut --> Destroyed: destroy requested
  Destroyed --> [*]
```

Transition rules:

- Destroyed is terminal.
- Connected requires usable provider connection.
- Logged Out requires operator action before normal messaging resumes.
- Disconnected is recoverable only when Session is Active or recoverable.

## Session State Machine

Required states:

- Empty.
- Pending.
- Active.
- Expired.
- Revoked.

```mermaid
stateDiagram-v2
  [*] --> Empty
  Empty --> Pending: pairing or restore started
  Pending --> Active: authentication accepted
  Pending --> Expired: restore expired
  Pending --> Revoked: logout or unlink detected
  Active --> Expired: session cannot be restored
  Active --> Revoked: logout, unlink, policy, or account signal
  Active --> Empty: instance deletion cleanup
  Expired --> Pending: re-pairing started
  Expired --> Empty: cleanup
  Revoked --> Pending: new pairing started
  Revoked --> Empty: cleanup
```

Transition rules:

- Active and Revoked are mutually exclusive.
- Session material is Secret data in all states.
- Empty means no usable product session material exists.
- Expired and Revoked are not automatically equivalent; Revoked is stronger and usually action-required.

## Message State Machine

Required states:

- Created.
- Queued.
- Processing.
- Sent.
- Delivered.
- Read.
- Failed.
- Cancelled.

```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> Queued: accepted for async work
  Created --> Failed: validation, business, or guardrail failure
  Created --> Cancelled: cancelled before queue
  Queued --> Processing: worker reserved
  Queued --> Cancelled: cancellation accepted
  Queued --> Failed: queue terminal failure
  Processing --> Sent: provider accepted send
  Processing --> Delivered: provider reports delivered directly
  Processing --> Read: provider reports read directly
  Processing --> Failed: provider, business, or unexpected failure
  Processing --> Cancelled: cancellation accepted
  Sent --> Delivered: provider delivery signal
  Sent --> Read: provider read signal
  Sent --> Failed: provider correction or terminal failure
  Delivered --> Read: provider read signal
  Failed --> [*]
  Cancelled --> [*]
  Read --> [*]
```

Transition rules:

- Created to Queued is required for accepted async outbound work.
- API Runtime must not report Delivered or Read unless provider status has been translated.
- Failed must include a failure category where possible.
- Message body is not retained by default after processing.

## Webhook State Machine

Required states:

- Pending.
- Delivering.
- Delivered.
- Retrying.
- Failed.
- Dead Letter.

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Delivering: worker reserved delivery
  Delivering --> Delivered: receiver acknowledged
  Delivering --> Retrying: retryable failure or timeout
  Delivering --> Failed: non-retryable failure
  Delivering --> DeadLetter: retry budget exhausted
  Retrying --> Pending: retry scheduled
  Retrying --> Delivering: retry reserved
  Retrying --> DeadLetter: retry budget exhausted
  Failed --> [*]
  DeadLetter --> [*]
  Delivered --> [*]
```

Transition rules:

- Delivered is terminal.
- Webhook work must be retry-visible.
- Dead Letter is terminal until operator recovery or explicit replay is defined.
- Webhook payloads are Confidential and must be redacted from normal logs.

## Worker Job State Machine

Required states:

- Queued.
- Reserved.
- Running.
- Completed.
- Retrying.
- Dead.

```mermaid
stateDiagram-v2
  [*] --> Queued
  Queued --> Reserved: worker claims work
  Reserved --> Running: worker starts execution
  Reserved --> Queued: reservation released or expired
  Running --> Completed: work finished
  Running --> Retrying: retryable failure
  Running --> Dead: non-retryable failure or retry exhausted
  Retrying --> Queued: retry scheduled
  Retrying --> Dead: retry budget exhausted
  Completed --> [*]
  Dead --> [*]
```

Transition rules:

- A job must not be Running in two workers simultaneously.
- Reservation must be visible as a lifecycle state.
- Dead is terminal for that job attempt lineage unless operator recovery creates new work.
- Job payloads must follow data classification and retention rules.

## Cross-State Invariants

| Invariant | Applies To |
| --- | --- |
| Worker cannot process outbound message when Instance is not Connected or send-capable. | Message, Instance, Provider Connection |
| Session Revoked moves Instance toward Logged Out or action-required state. | Session, Instance |
| Webhook Delivered does not change original Message lifecycle. | Webhook, Message |
| Provider Connection Closed cannot continue to emit product state transitions except final shutdown classification. | Provider Connection, Instance |
| Message Failed does not imply Webhook Failed; each lifecycle is independently owned. | Message, Webhook |
| Queue Dead state must be visible to operators. | Worker Job, Health, Observability |

## State Transition Ownership

| State Machine | State Owner | Transition Coordinator | External Signal Source |
| --- | --- | --- | --- |
| Instance | Instance module | Application | Provider Runtime, API Runtime, Scheduler |
| Session | Session module | Application | Provider Runtime, API Runtime |
| Message | Messaging module | Application | API Runtime, Worker Runtime, Provider Runtime |
| Webhook | Webhook module | Application/Worker | Product events, WebhookTransport outcomes |
| Worker Job | Worker module | Application/Worker | QueueProvider outcomes, Worker Runtime |
| Provider Connection | Provider module translates, Instance/Session own product state | Application | Provider Runtime |
