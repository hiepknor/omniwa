# @omniwa/infrastructure-webhook

Infrastructure package for webhook transport, signing, and dispatcher runtime behavior.

## Boundary

- Delivers integration events to external webhook consumers.
- Owns transport concerns such as signing, retry delivery mechanics, and dispatch runtime behavior.
- Must not mutate domain state or create domain events.

## Current Status

This package is the infrastructure side of webhook delivery. It must stay behind application/runtime
contracts so webhook transport can evolve without changing domain or public API contracts.

## Quality Expectations

- Webhook delivery must be idempotent and observable.
- Signatures and retry metadata must follow the API contract documents.
- External receiver failures must be isolated from API and domain execution paths.
