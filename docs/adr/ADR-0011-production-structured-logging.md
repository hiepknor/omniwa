# ADR-0011 Production Structured Logging

## Status

Proposed.

## Context

OmniWA already has a Clean Architecture-compliant logging foundation, but production runtimes are
effectively blind on the log axis:

- `packages/observability` defines the `StructuredLogger` port and `LogEntry` with
  `correlationId`/`requestId`/`traceId`/`runtimeRole`/`failureCategory` context.
- Redaction is safe by construction: log fields must pass `toSafeLogFields` (classification-based,
  `confidential`/`secret` values are replaced with `[redacted:*]`) and errors are logged through
  `SafeErrorShape` only.
- `packages/infrastructure-observability` provides `JsonLineStructuredLogBackendAdapter` and
  `JsonLineFileSink`.

Observed gaps (2026-07-06 review, verified against a running local Docker stack):

1. `toPublicLogRecord` emits no timestamp, no schema version, and no stable event code.
2. Almost nothing is wired. Only `provider-runtime-app` accepts an optional logger (defaulting to
   the null logger). Apps emit a single `console.log` JSON at start/stop. Production runtime paths
   produce no logs; only metrics JSONL and the EventLog exist.
3. Secret leakage to stdout: the `libsignal` dependency prints raw Signal `SessionEntry` dumps,
   including `privKey`, `rootKey`, and `chainKey` buffers, to container stdout. The Baileys pino
   logger is already silenced (`createSilentBaileysLogger`), but that does not cover libsignal's
   own console output. This was observed live in `docker logs` of the provider runtime.
4. `JsonLineFileSink` uses `appendFileSync` plus `mkdirSync` per line — acceptable for low-rate
   evidence files, unsafe for hot paths.
5. No `OMNIWA_LOG_LEVEL` control and no log-event catalog (metrics already have
   `metric-catalog.ts` with a spec-based fitness function; logs have no equivalent).

## Decision

Adopt a production structured-logging standard built on the existing `StructuredLogger` port,
with stdout as the primary transport and safe-by-construction redaction preserved.

### Log record schema v1 (JSONL, one line per record)

```json
{
  "schemaVersion": 1,
  "ts": "2026-07-06T15:30:00.123Z",
  "level": "info",
  "event": "provider.session.connected",
  "msg": "Provider session connected",
  "runtimeRole": "provider",
  "correlationId": "corr:...",
  "requestId": "http:...",
  "traceId": "...",
  "failureCategory": "provider",
  "fields": { "sessionRef": "local-demo-session", "attempt": 2 },
  "error": {
    "category": "provider",
    "code": "socket_closed",
    "message": "...",
    "retryable": true,
    "metadata": {}
  }
}
```

Rules:

- `msg` is a static, low-cardinality English template. Variable data goes into `fields` and must
  pass `toSafeLogFields`.
- `event` is a dot-namespaced code drawn from a log-event catalog (mirroring the
  `metric-catalog.ts` approach, enforced by a spec test). Alerting and grep target `event`, never
  `msg`.
- Never logged: message content, `qrCode`, auth state, API keys. Phone numbers/JIDs are classified
  `confidential` and are redacted by construction.

### Transport

- Containers write JSON lines to stdout (12-factor); the Docker log driver collects them. JSONL
  file sinks (`OMNIWA_*_JSONL_PATH`) remain evidence/audit channels, not the primary log channel.
- Every service in both Compose files sets bounded rotation:
  `logging: { driver: json-file, options: { max-size: "50m", max-file: "5" } }`.
- Centralized shipping (Vector/Fluent Bit to Loki/OpenSearch) is a later step; the schema joins
  with metrics and EventLog through `correlationId` when it lands.

### Level policy

| Level   | Used for                                                                                                                                      | Production      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `error` | Actionable failures, with the `error` shape attached                                                                                          | on              |
| `warn`  | Degraded behavior, retries, lease contention                                                                                                  | on              |
| `info`  | Lifecycle state transitions (start/stop, session connect/logout, job completion). One line per event; never per-message (metrics cover rates) | on              |
| `debug` | Diagnostic detail                                                                                                                             | off (env-gated) |

Controlled by `OMNIWA_LOG_LEVEL` (production default `info`, local default `debug`).

### Wiring

- Add `createStructuredLoggerFromEnv(env, runtimeRole)` to
  `packages/infrastructure-observability`: stdout JSON sink by default, level filter, optional
  file sink.
- Wire per runtime composition:
  - `apps/api`: one `info` line per completed request — route template (not raw path), status,
    durationMs, keyId. Never bodies.
  - `apps/provider-runtime`: session lifecycle
    (`connecting`/`qr_required`/`connected`/`reconnecting`/`logged_out`), mirroring existing
    EventLog signals; log `challengeRef`, never `qrCode`.
  - `apps/worker` and `apps/webhook-dispatcher`: job/delivery lifecycle — webhookId, attempt,
    status code. Never payloads.
- Fail closed: production profiles add a configured-logger requirement to their composition
  assertions (same pattern as `assertProviderRuntimeProfileIsComposable`).

### libsignal leak containment (highest priority)

- Suppress libsignal console output inside the Baileys adapter boundary
  (`packages/infrastructure-provider-baileys`), keeping provider containment intact.
- Add a "no secrets in stdout" regression test: capture stdout during socket activity and assert
  `privKey|chainKey|rootKey` never appear. This turns the observed leak into a fitness function
  alongside `redaction.spec.ts`.

This ADR does not change the public REST API, OpenAPI contract, Rust SDK contract, provider
abstraction, webhook payloads, or the Domain model.

## Alternatives Considered

| Alternative                                               | Reason Rejected or Deferred                                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt pino/winston as the logging API across the codebase | Replaces a working Clean Architecture port with a vendor API; loses safe-by-construction redaction typing. Libraries may still back a sink adapter later. |
| Log primarily to JSONL files with external rotation       | Duplicates what Docker log drivers already do, complicates containers, and diverges from 12-factor stdout collection.                                     |
| Free-form `msg`-based logging without an event catalog    | High-cardinality, unstable grep/alert targets; the metric catalog already proved the catalog + spec approach.                                             |
| OpenTelemetry logs pipeline now                           | Heavier dependency surface than the current blocker requires; the schema keeps `traceId` so OTel export can be added at the sink level later.             |
| Leave libsignal stdout as-is (silent pino only)           | Confirmed secret material (private keys) reaches `docker logs`; unacceptable for production evidence and log shipping.                                    |

## Consequences

### Positive

- Production runtimes emit greppable, joinable, redaction-safe logs with stable event codes.
- Secret leakage to stdout is eliminated and guarded by a regression test.
- Log/metric/EventLog records join through `correlationId` for incident forensics.
- Bounded disk usage via Docker log rotation on every service.

### Negative

- Touches every runtime composition plus both Compose files.
- A log-event catalog adds a maintenance surface (mitigated by the spec test).
- stdout-only transport means log shipping depends on host-level collection until a shipper lands.

## Affected Documents

- `packages/observability/src/logger.ts`
- `packages/observability/src/redaction.ts`
- `packages/infrastructure-observability/src/structured-log-backend.ts`
- `packages/infrastructure-observability/src/json-line-observability.ts`
- `packages/infrastructure-provider-baileys/src/baileys-socket-provider.ts`
- Runtime composition files under `apps/*/src/runtime-composition.ts`
- `deploy/docker/compose.local.yml`
- `deploy/docker/compose.production.yml`
- `docs/IMPLEMENTATION_STATUS.md`

## Validation

Implementation after this ADR is accepted must prove:

- `pnpm arch:check` passes; no Infrastructure imports enter Domain/Application contracts.
- Every emitted record carries `schemaVersion`, `ts`, `level`, `event`, `msg`, `runtimeRole`.
- All variable fields pass `toSafeLogFields`; `confidential`/`secret` values never appear raw.
- Captured stdout of a live provider socket contains no `privKey`, `chainKey`, or `rootKey`
  material.
- The log-event catalog spec rejects events not registered in the catalog.
- Production runtime composition fails closed when the structured logger is not configured.
- `OMNIWA_LOG_LEVEL` filtering works and `debug` is off by default in production profiles.
- `pnpm check` passes.

## Migration Plan

1. Review and accept this ADR.
2. Contain the libsignal stdout leak in the Baileys adapter and add the no-secrets-in-stdout
   regression test.
3. Extend the log record with `ts`, `event`, `schemaVersion`; add the log-event catalog and its
   spec test.
4. Add `createStructuredLoggerFromEnv` with stdout sink and `OMNIWA_LOG_LEVEL` support.
5. Wire `apps/api` request-completion logging, then `apps/provider-runtime` session lifecycle
   logging.
6. Wire `apps/worker` and `apps/webhook-dispatcher` lifecycle logging.
7. Add Docker log rotation to both Compose files and a short operations note under
   `docs/runbooks/`.
8. Add the configured-logger requirement to production profile composition assertions.
9. Update `docs/IMPLEMENTATION_STATUS.md`.
10. Run `pnpm check`.
