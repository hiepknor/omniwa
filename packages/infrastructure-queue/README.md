# @omniwa/infrastructure-queue

Infrastructure package for queue-provider implementations.

## Boundary

- Provides queue behavior behind application/runtime ports.
- Must not own message, webhook, or worker business rules.
- Must not replace application idempotency or domain lifecycle decisions.

## Current Status

The current implementation is an in-memory queue provider for development and controlled runtime
composition. Production queue hardening remains governed by the production execution plan.

## Quality Expectations

- Queue behavior must preserve retry and idempotency semantics expected by application workflows.
- Redis or external queue adapters must remain replaceable behind the same port.
- Dead-letter and backpressure behavior must be observable before production promotion.
