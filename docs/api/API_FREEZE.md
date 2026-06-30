# OmniWA API Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Decision

**APPROVED**

**API Phase is FROZEN.**

**Project is ready for Phase 5 - Persistence Design.**

## API Version

Phase 4 API Contract v1.0.

This version freezes:

- Phase 4.1 API Surface and Resource Model.
- Phase 4.2 Request, Response, Error, Pagination, Filtering, Async Operation, and Webhook Contract Model.

## Reviewer Summary

API Review Board roles represented:

- Principal API Architect.
- Principal Software Architect.
- Principal Backend Engineer.
- Security Architect.
- Platform Architect.

Review result:

- Critical findings: 0.
- Major findings: 0.
- Minor findings: 0.
- Suggestions: 5.

The API Review Board found no API design issue that blocks Phase 5.

## Approved Documents

The following documents are approved as the frozen Phase 4 API baseline:

- `docs/api/API_OVERVIEW.md`
- `docs/api/RESOURCE_MODEL.md`
- `docs/api/ENDPOINT_GROUPS.md`
- `docs/api/API_BOUNDARIES.md`
- `docs/api/API_VERSIONING.md`
- `docs/api/AUTHENTICATION_MODEL.md`
- `docs/api/AUTHORIZATION_MODEL.md`
- `docs/api/API_CONVENTIONS.md`
- `docs/api/IDEMPOTENCY_AND_RATE_LIMITS.md`
- `docs/api/REQUEST_MODEL.md`
- `docs/api/RESPONSE_MODEL.md`
- `docs/api/ERROR_MODEL.md`
- `docs/api/PAGINATION_MODEL.md`
- `docs/api/FILTERING_AND_SORTING.md`
- `docs/api/ASYNC_OPERATION_MODEL.md`
- `docs/api/WEBHOOK_CONTRACT.md`
- `docs/api/CONTRACT_GUIDELINES.md`

## Review Scope

| Area | Result | Notes |
|---|---|---|
| API Surface | PASS | Surface covers approved MVP resources and explicitly defers campaign, broadcast, group admin, unsupported message types, contact/chat/group APIs, multi-tenant APIs, and SDK commitments. |
| Resource Model | PASS | Resources trace to Product Scope, Application use cases, commands/queries, and Domain contexts. Deferred resources are clearly marked future. |
| Authentication | PASS | API Key, Admin Key, monitoring identity, internal runtime identity, outbound webhook signing secret, and future OAuth posture are separated. |
| Authorization | PASS | Operation scopes, instance-level boundary, admin-only operations, and Application access decision responsibility are clear. |
| Versioning | PASS | `/v1` URL major versioning, breaking-change policy, deprecation windows, and compatibility rules are defined. |
| Request Model | PASS | Requests map to Application commands/queries and preserve validation boundaries without DTO/schema implementation. |
| Response Model | PASS | Responses preserve command/query semantics and distinguish accepted/queued/waiting async state from external completion. |
| Error Model | PASS | API error taxonomy maps from Application and Domain errors without HTTP status design or raw implementation leakage. |
| Async Model | PASS | Long-running operations, polling, cancellation, retry, and visibility constraints align with Architecture/Application freezes. |
| Webhook Contract | PASS | Webhook delivery is outbound, asynchronous, retry-visible, versioned, signed/verifiable conceptually, and based on approved Integration Events. |
| Traceability | PASS | Resource, endpoint, request, response, error, pagination/filtering, async, webhook, and contract guideline traceability is present. |

## Validation Results

| Validation Area | Result | Notes |
|---|---|---|
| Resource Ownership | PASS | API resources do not override Domain ownership or Application orchestration. |
| Endpoint Boundary | PASS | Public, Admin, Internal Runtime, Health, Monitoring, and Webhook Delivery boundaries are distinct. |
| Contract Consistency | PASS | API Surface and Contract Model use the same resource names, command/query boundary, `/v1` versioning, and data safety rules. |
| Error Consistency | PASS | API errors map to Application and Domain error categories and forbid raw provider/database/queue details. |
| Async Consistency | PASS | API accepted responses require visible owner state or WorkerJob lifecycle and never claim WhatsApp final delivery early. |
| Pagination Strategy | PASS | Cursor pagination is the recommended default with retention, authorization, and opaque cursor constraints. |
| Filtering Strategy | PASS | Filtering/search/sorting are restricted to safe product fields and forbid raw message body, phone/JID, provider payload, and queue/database fields. |
| Versioning | PASS | URL major versioning and compatibility/deprecation policies are coherent with webhook Integration Event versioning. |
| Backward Compatibility | PASS | Unknown optional fields, enum evolution, optional fields, deprecation, and breaking change policy are documented. |
| Naming Convention | PASS | `/v1`, plural resource names, kebab-case paths, snake_case JSON fields, lower_snake_case enums/errors, opaque IDs, and UTC timestamps are defined. |
| Traceability | PASS | Every API contract category traces to approved use cases, Application commands/queries, workflows, and Domain/Integration events where applicable. |

## API Quality Review

| Quality Area | Score | Assessment |
|---|---:|---|
| Consistency | 9 | Strong alignment across API surface, contract model, Application command/query boundary, Domain language, and Architecture guardrails. |
| Discoverability | 8 | Endpoint groups and resource model are clear; concrete endpoint-level docs remain intentionally deferred. |
| RESTfulness | 8 | Resource groups, HTTP method semantics, and command/query separation are coherent without over-designing OpenAPI. |
| Extensibility | 9 | Versioning, provider abstraction, event governance, future OAuth/RBAC, and future resources are cleanly deferred. |
| Compatibility | 9 | Backward compatibility, deprecation, enum evolution, unknown fields, and `/v1` major version rules are explicit. |
| Developer Experience | 8 | API conventions, envelope strategy, idempotency, and async semantics are developer-friendly; examples will belong to later OpenAPI/docs. |
| Testability | 9 | API contracts map to commands/queries and can be validated through traceability, redaction, idempotency, auth, and async visibility tests. |
| Maintainability | 9 | Boundaries prevent API, provider, persistence, and Domain coupling. |
| Security | 9 | Secret/raw Confidential/provider-native payload restrictions are consistent across auth, error, response, webhook, filtering, and logging rules. |
| Documentation | 9 | Coverage is complete for Phase 4.1 and 4.2, with clear PASS checklists and diagrams. |

## Findings

| Severity | Count | Result |
|---|---:|---|
| Critical | 0 | None. |
| Major | 0 | None. |
| Minor | 0 | None. |
| Suggestion | 5 | Track in Phase 5, detailed API/OpenAPI, and implementation planning. |

## Suggestions

| ID | Area | Suggestion | Reason |
|---|---|---|---|
| SUG-API-001 | Detailed API design | Define concrete endpoint paths, request/response schemas, and HTTP status mapping only in a later OpenAPI/API-detail phase. | Current phase intentionally freezes conceptual contract, not OpenAPI. |
| SUG-API-002 | Persistence design | Ensure persistence supports opaque cursor pagination without exposing database IDs or provider IDs. | Cursor pagination is frozen as API contract default. |
| SUG-API-003 | Webhook implementation | Create a future ADR or detailed design for signing algorithm, signing headers, timestamp tolerance, and replay protection. | Phase 4 freezes conceptual signed/verifiable webhook contract only. |
| SUG-API-004 | API testing | Add future contract tests for auth boundary, idempotency replay/conflict, sensitive-data redaction, async visibility, and query side-effect freedom. | These are non-negotiable API behavior rules. |
| SUG-API-005 | Developer docs | Add examples later for async send-message polling, webhook verification, and error retryability. | Improves onboarding without changing frozen contract. |

## Approved API Constraints

- API is an Interface adapter over the frozen Application Layer.
- API must call Application commands and queries.
- API must not call Domain, Provider, Baileys, database, queue, or Infrastructure directly for product behavior.
- Every mutating API operation must map to one approved Application command.
- Every read API operation must map to one approved Application query.
- API authentication must create safe request identity; Application authorization remains the product access decision boundary.
- API errors must map from Application and Domain error categories and must not expose raw exceptions.
- API responses must distinguish accepted/queued/waiting async state from final external provider or webhook completion.
- Duplicate-prone command endpoints must require idempotency.
- Public API major versioning uses `/v1`.
- Webhook Integration Events use versioned external event names such as `.v1`.
- Cursor pagination is the default for list/history APIs.
- Filtering/search/sorting must use safe product fields only.
- Session secret, API/admin key secret, webhook signing secret, raw provider payload, raw phone/JID, and raw Confidential payloads must not be exposed.

## Non Negotiable API Rules

- Do not bypass Application commands or queries.
- Do not introduce OpenAPI/DTO schemas that change product meaning.
- Do not expose provider-native payloads as public API or webhook contract.
- Do not expose Baileys concepts as stable API contract.
- Do not allow query requests to mutate state, enqueue work, call provider, repair projections, or publish events.
- Do not report async acceptance unless owner state or WorkerJob-visible lifecycle exists.
- Do not claim WhatsApp delivery/read state unless translated provider status has produced that product fact.
- Do not make webhook delivery synchronous with source business workflow completion.
- Do not allow webhook receiver responses to mutate source business state.
- Do not expose QR without authentication.
- Do not expose session secret through any response, error, webhook, audit, log, or metric.
- Do not support campaign, broadcast, group admin, unsupported message types, multi-tenant APIs, or SDK commitments through Phase 4 MVP API.

## Deferred Decisions

The following are intentionally deferred beyond Phase 4 freeze:

- Concrete OpenAPI specification.
- Concrete DTO/request/response field schemas.
- HTTP status code mapping.
- Exact endpoint paths for every operation.
- Concrete pagination cursor encoding.
- Default and maximum page size values.
- Concrete filtering query parameter syntax.
- Concrete webhook signing algorithm and header names.
- Concrete webhook retry delay values and timeout values.
- Concrete API key storage, hashing, and rotation implementation.
- Concrete RBAC/OAuth model.
- Concrete persistence technology and schema.
- Concrete repository implementation.
- Concrete query read-model implementation.
- SDK package commitments.

## Phase 4 Readiness

| Area | Status |
|---|---|
| API Surface | PASS |
| Contract | PASS |
| Security | PASS |
| Error Model | PASS |
| Versioning | PASS |
| Traceability | PASS |
| Documentation | PASS |

**API Phase is FROZEN.**

**Project is ready for Phase 5 - Persistence Design.**
