# ADR-0010 Provider Runtime Worker Bridge

## Status

Accepted.

## Context

OmniWA has completed the local-live WhatsApp proof and the current production-hardening track has
closed many queue, EventLog, webhook, authorization, rate-limit, and validation gaps. The remaining
runtime gap is the production boundary between `Worker Runtime` and `Provider Runtime`.

Current evidence and constraints:

- `Provider Runtime` owns Baileys sockets and provider connection lifecycle.
- `Worker Runtime` processes durable outbound jobs and dispatches message work.
- The local live path can work in controlled local compositions, but multi-process worker/provider
  runtime cannot share an in-memory Baileys socket.
- Production compose intentionally keeps worker/provider profiles in controlled-pilot mode until a
  provider-runtime IPC/shared socket ownership strategy exists.
- Baileys imports must remain contained in `packages/infrastructure-provider-baileys`.
- Domain, Application, API, and worker application handlers must not import Baileys or provider-native
  payloads.
- Raw QR, JID, message text, auth state, and provider payloads must not appear in public DTOs, logs,
  metrics, audit records, or event contracts.

This is a runtime process-boundary and provider-abstraction decision. Per `AGENTS.md`, implementation
must stop and use an ADR before changing this boundary.

## Decision

Introduce an internal Provider Command Bridge between `Worker Runtime` and `Provider Runtime`.

The proposed production direction is:

- `Provider Runtime` remains the sole owner of live Baileys sockets and session lifecycle.
- `Worker Runtime` must not create, own, or directly access Baileys sockets in production mode.
- `Worker Runtime` dispatches provider work through an internal bridge adapter behind the existing
  provider port boundary used by outbound worker handling.
- The bridge carries only sanitized provider commands and safe references, such as:
  - `instanceId`
  - `sessionId`
  - `messageId`
  - `outboundIntentRef`
  - operation kind
  - correlation/request metadata
- `Provider Runtime` resolves safe references through approved stores/resolvers before calling the
  provider adapter.
- `Provider Runtime` returns only safe provider outcomes and emits provider signals through
  `SignalIngress` / EventLog. It must not return raw provider payloads to the worker.
- The bridge is internal runtime infrastructure, not public REST API and not part of the SDK contract.
- The bridge must be authenticated with an internal runtime secret or equivalent deployment-private
  credential before any production profile uses it.
- The initial implementation may use a narrow internal HTTP or IPC transport behind a
  `ProviderCommandTransport`-style adapter. The transport choice must remain replaceable behind that
  boundary.
- The existing controlled local same-process composition can remain for local demos and deterministic
  tests, but it must not be represented as the production worker/provider topology.

This ADR does not change the public REST API, OpenAPI, SDK, Domain model, Application command/query
catalog, or product scope.

## Alternatives Considered

| Alternative                                      | Reason Rejected or Deferred                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep worker/provider same-process for production | Simpler, but weakens runtime isolation and scaling; it also hides the production failure mode already identified by the controlled-pilot profile.                   |
| Let `Worker Runtime` create Baileys sockets      | Violates single socket ownership, risks `connectionReplaced` behavior, and leaks provider lifecycle responsibilities outside Provider Runtime.                      |
| Share Baileys sockets through durable storage    | Baileys socket objects are live process resources, not serializable durable state. PostgreSQL/Redis/Object Storage must not become socket transport.                |
| Use Redis pub/sub as the first bridge            | Redis is approved as ephemeral infrastructure, but selecting it as runtime command transport is an additional technology/semantics decision that is not yet proven. |
| Expose provider commands through public REST     | Leaks internal runtime control into the public platform contract and would force clients to understand provider lifecycle details.                                  |
| Have API call Provider Runtime directly          | Breaks the approved `Client -> SDK -> REST API -> Interface -> Application -> Domain` boundary and bypasses accepted async worker semantics.                        |
| Keep `multi-process-unsupported` indefinitely    | Safe as a fail-closed posture, but it blocks production-ready worker/provider evidence and cannot satisfy the target-environment validation matrix.                 |

## Consequences

### Positive

- Preserves Provider Runtime as the single owner of provider sockets and lifecycle.
- Allows Worker Runtime to remain independently deployable without provider-native imports.
- Gives production profiles a path away from `multi-process-unsupported` without broad rewrites.
- Keeps public API and SDK contracts stable.
- Makes target-environment proof explicit: worker, provider runtime, queue, EventLog, and provider
  signal paths can be exercised across real process boundaries.
- Retains existing local same-process demo behavior for development and deterministic tests.

### Negative

- Adds an internal runtime transport that must be secured, observed, and tested.
- Introduces another failure mode between worker job reservation and provider command execution.
- Requires timeout, retry, idempotency, and safe error mapping across the internal bridge.
- Requires target-environment evidence before production profiles can move past controlled pilot.
- May require future refinement if cluster worker, multi-node provider runtime, or multi-region
  runtime ownership is introduced.

## Migration Plan

1. Keep the current `multi-process-unsupported` fail-closed mode until the bridge is implemented and
   verified.
2. Add a bridge-facing provider command transport abstraction at the runtime/infrastructure boundary
   without changing Domain or Application contracts.
3. Implement fake/in-memory transport tests proving command shape, auth boundary, timeout handling,
   idempotent outcomes, and no raw payload exposure.
4. Add an internal Provider Runtime command receiver that maps safe commands to existing provider
   runtime capabilities and emits results/signals through existing safe channels.
5. Wire Worker Runtime to a new explicit provider mode, for example `provider-runtime-bridge`, while
   keeping local same-process mode available for demos.
6. Add production compose validation that rejects `provider-runtime-bridge` unless internal auth,
   provider runtime URL/socket path, queue profile, EventLog backend, and observability sinks are
   configured.
7. Add target-environment runtime evidence for worker startup, provider runtime startup, bridge
   connectivity, outbound dispatch, failure handling, shutdown, and signal/EventLog visibility.
8. Only after evidence passes, update production readiness documents from controlled-pilot wording to
   the proven bridge posture.

## Implementation Constraints

- Baileys imports remain allowed only inside `packages/infrastructure-provider-baileys`.
- `apps/provider-runtime` and `apps/worker` remain composition/runtime layers and must not contain
  business rules.
- Internal bridge commands must use safe references, not raw JID, text, QR, auth state, or provider
  payloads.
- Provider command failures must map to safe worker outcomes and safe EventLog records.
- Bridge retries must be idempotent against `messageId`, `outboundIntentRef`, and provider result
  identity where available.
- The bridge must expose health/readiness evidence without exposing provider-native data.
- Public REST, OpenAPI, SDK, and TUI contracts must not depend on bridge transport details.

## Affected Documents

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md`
- `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`
- `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md`
- `docs/reviews/PRODUCTION_CUT_REVIEW.md`
- `deploy/docker/compose.production.yml`
- `deploy/docker/env/production.env.example`
- `tooling/docker/check-production-compose.mjs`

## Validation

- `pnpm arch:check` must continue to prove Baileys containment and dependency direction.
- Worker/provider bridge tests must prove that Worker Runtime does not import Baileys and does not
  create sockets in production bridge mode.
- Provider Runtime tests must prove command receiver behavior with fake provider dependencies before
  real Baileys wiring is exercised.
- Runtime tests must prove missing bridge configuration fails closed in production profile.
- Security tests must prove internal bridge auth is required and safe failures do not leak raw
  payloads.
- E2E tests must prove a durable outbound job can cross Worker Runtime to Provider Runtime, produce a
  safe provider outcome, and write safe EventLog evidence.
- Target-environment validation must include bridge startup, connectivity, dispatch, timeout/failure,
  shutdown, and observability evidence before `PRODUCTION_READY` can be claimed.
