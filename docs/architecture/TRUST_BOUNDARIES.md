# OmniWA Trust Boundaries

## Purpose

This document defines system context-level trust boundaries for OmniWA.

It does not define authentication implementation, authorization model, endpoint design, database schema, queue implementation, or deployment topology.

## Trust Boundary Summary

| Boundary | What Crosses | Authentication Requirement | Validation Requirement | Logging Requirement | Sensitive Data Risk |
| --- | --- | --- | --- | --- | --- |
| Public Internet | Requests from API clients, operators, admins, external callbacks where applicable | Required for OmniWA-controlled surfaces | Treat all input as untrusted | Log metadata with correlation ID, never raw secrets | Credential theft, payload injection, abuse attempts |
| API Boundary | Programmatic client operations | Required | Validate shape, scope, tenant context, guardrail eligibility | Structured logs with request/correlation IDs | Confidential payloads and identifiers may enter |
| Admin Boundary | Operator/admin actions | Strong authentication and authorization required | Validate admin capability and audit intent | Audit-sensitive actions; no Secret disclosure | Misuse of high-trust operations |
| Webhook Boundary | Outbound events to external receivers and their acknowledgements | Receiver identity/signing strategy to be decided later | Validate receiver configuration and delivery outcomes | Log delivery metadata, retries, terminal state | Event payload leakage to downstream systems |
| Provider Boundary | Provider events and provider operations | Provider/session credentials treated as Secret | Translate provider payloads into product concepts | Provider payloads not logged raw | Session material, phone numbers, JIDs, media/message content |
| Data Storage Boundary | Reads/writes of OmniWA-owned recoverable state | Internal service access only | Validate access through ports; retention rules apply | Log operation metadata, not raw Confidential/Secret content | Unauthorized access, retention violation |
| Queue Boundary | Async jobs, retries, dead-letter/action-required states | Internal service access only | Validate job type, idempotency key, lifecycle state | Log job metadata and state transitions | Confidential payloads inside job data |
| Observability Boundary | Logs, metrics, traces, health signals, alerts | Internal-to-observability trust relationship | Redaction and safe-field validation before export | Structured logs, no Secret, redacted Confidential | Sensitive data leakage through telemetry |

## Public Internet Boundary

What crosses:

- Client requests.
- Operator/admin interactions.
- Potential callbacks or external ingress where future design permits.

Authentication requirement:

- OmniWA-controlled entry surfaces require authentication unless explicitly documented as public health or public metadata.

Validation requirement:

- All external input is untrusted.
- Input must be validated before application use cases are invoked.

Logging requirement:

- Log metadata, request/correlation identifiers, and safe failure categories.
- Do not log credentials, secrets, raw provider payloads, message bodies, or webhook payloads.

Sensitive data risk:

- Credential theft.
- Injection.
- Abuse or spam attempts.
- Confidential data submitted by clients.

## API Boundary

What crosses:

- Product operation requests.
- Supported message requests.
- Instance and operational state queries.

Authentication requirement:

- Required.

Validation requirement:

- Validate request shape, allowed operation, product scope, rate-limit/guardrail eligibility, and data classification.

Logging requirement:

- Structured logs with request ID and correlation ID.
- Redact Confidential fields.

Sensitive data risk:

- Message content, media metadata, phone numbers, JIDs, and tenant credentials may enter this boundary.

## Admin Boundary

What crosses:

- Instance lifecycle operations.
- Recovery operations.
- Diagnostic capture enablement.
- Credential or configuration management.

Authentication requirement:

- Strong authentication and authorization required.

Validation requirement:

- Validate role, intent, and action scope.
- Security-sensitive actions require audit records.

Logging requirement:

- Audit action metadata.
- Never log Secret values.

Sensitive data risk:

- Admin actions can affect session material, recovery, diagnostics, and operational safety.

## Webhook Boundary

What crosses:

- Integration events sent out of OmniWA.
- Delivery acknowledgements, failures, and timeouts from receivers.

Authentication requirement:

- Receiver identity and signing/authentication strategy must be decided in a later architecture step.

Validation requirement:

- Validate receiver configuration.
- Treat receiver acknowledgements as untrusted until classified.

Logging requirement:

- Log delivery attempts, status, retry count, terminal state, and correlation ID.
- Redact payload content where required.

Sensitive data risk:

- Webhook events can expose Confidential operational or message metadata to downstream systems.

## Provider Boundary

What crosses:

- Provider events.
- Session state.
- Message and media operations.
- Disconnect and reconnect signals.
- Provider failures.

Authentication requirement:

- Provider/session credentials are Secret data.

Validation requirement:

- Translate provider-native payloads into product concepts.
- Classify provider failures as External Provider Error or action-required states.

Logging requirement:

- No raw provider payload logging.
- Log provider failure categories and safe metadata.

Sensitive data risk:

- Session material, message bodies, media payloads, JIDs, phone numbers, and provider-specific identifiers.

## Data Storage Boundary

What crosses:

- OmniWA-owned recoverable state.
- Audit records.
- Retention-managed operational metadata.
- Session material where permitted by security and backup rules.

Authentication requirement:

- Internal service access only.

Validation requirement:

- All access goes through persistence ports.
- Retention rules must be enforced.

Logging requirement:

- Log safe operation metadata and failure category.
- Do not log raw stored Confidential or Secret values.

Sensitive data risk:

- Unauthorized access, retention violation, backup exposure, session leakage.

## Queue Boundary

What crosses:

- Async jobs.
- Retry and dead-letter state.
- Idempotency metadata.
- Action-required state.

Authentication requirement:

- Internal service access only.

Validation requirement:

- Validate job type, lifecycle state, retry policy, idempotency, and payload classification.

Logging requirement:

- Log job ID, state transition, retry count, and safe correlation metadata.
- Do not log raw job payload when it contains Confidential or Secret data.

Sensitive data risk:

- Job payloads can accidentally retain message, webhook, media, or provider data.

## Observability Boundary

What crosses:

- Structured logs.
- Metrics.
- Traces.
- Alerts.
- Health states.

Authentication requirement:

- Internal-to-observability access must be controlled.

Validation requirement:

- Redaction must happen before export.
- Telemetry fields must be safe for the destination.

Logging requirement:

- Logs must include correlation ID where available.
- Secret data must never cross this boundary.

Sensitive data risk:

- Telemetry becomes a secondary data leak path if redaction is weak.
