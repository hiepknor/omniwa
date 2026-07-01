# ADR-0003 Official SDK

## Status

Accepted.

## Context

The target platform includes OmniWA TUI, Web Dashboard, CLI, MCP server, and third-party integrations. Without an SDK, each client must implement auth, error handling, pagination, retry, and streaming.

## Decision

Create an official SDK boundary. OmniWA TUI must use the official Rust SDK rather than direct `reqwest` calls.

SDK strategy:

- Generate low-level client/models from OpenAPI.
- Maintain ergonomic Rust modules for auth, errors, pagination, retries, and streaming.

## Alternatives

| Alternative             | Reason Rejected                                        |
| ----------------------- | ------------------------------------------------------ |
| TUI calls REST directly | Duplicates protocol concerns and weakens compatibility |
| Handwrite entire SDK    | High drift risk from OpenAPI                           |
| Generate SDK only       | Usually too low-level for TUI ergonomics               |

## Consequences

- OpenAPI becomes a prerequisite for SDK.
- SDK versioning must follow API compatibility.
- TUI remains free of business logic and transport boilerplate.

## Migration Plan

1. Freeze initial OpenAPI.
2. Generate low-level Rust client.
3. Add ergonomic modules.
4. Write SDK contract tests against API fixtures.
5. Build TUI on SDK.
