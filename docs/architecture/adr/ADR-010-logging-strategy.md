# ADR-010 Logging Strategy

## Status

Accepted.

## Context

OmniWA requires structured troubleshooting while protecting Secret and Confidential data. Phase 0 states that Secret data must never be logged and Confidential content must be redacted from normal logs.

## Decision

OmniWA will use structured logging with correlation identifiers and mandatory redaction.

Logging concepts:

- Correlation ID: follows a business workflow across boundaries.
- Request ID: identifies a single external request or entry interaction.
- Trace ID: links logs to future tracing/telemetry.
- Instance ID: identifies the product instance context where safe.
- Event or job ID: identifies async work where safe.

Logging rules:

- Secret data is never logged.
- Confidential payloads are redacted, hashed, truncated, or replaced with references in normal logs.
- Provider payloads are not logged directly.
- Diagnostic capture requires explicit enablement, expiration, and operator awareness.

## Consequences

- Logs support debugging without normalizing sensitive data exposure.
- Async and provider flows can be correlated.
- Redaction must be tested and centrally enforced.

## Trade-offs

- Redaction reduces raw debugging detail.
- Structured logs require consistent field naming.

## Alternatives Considered

- Plain text logs: insufficient for operations and correlation.
- Raw payload logging: unacceptable for privacy and security.
- Provider-native logging as primary source: too noisy and unsafe.
