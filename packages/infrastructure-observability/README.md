# @omniwa/infrastructure-observability

Infrastructure package for runtime observability components.

## Boundary

- Provides logging, metrics, health, and dependency-readiness infrastructure.
- Consumes public runtime signals and application outcomes.
- Must not own business state or mutate domain/application decisions.

## Current Status

This package supports operational visibility for platform runtime components. It is infrastructure,
not the source of audit truth and not a replacement for domain/application error handling.

## Quality Expectations

- Logs must preserve request/correlation context.
- Metrics must avoid sensitive data labels.
- Health/readiness checks must be deterministic and safe to run repeatedly.
