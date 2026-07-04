# ADR-0008 Redis Rate Limit Client

## Status

Proposed.

## Context

N11.5 requires production-grade API rate limiting before OmniWA can move toward production
readiness. The implementation already has:

- an async `ApiRateLimiter` boundary,
- a shared fixed-window limiter,
- a Redis Lua-script counter store,
- hashed Redis keys that avoid raw API key ids, instance refs, target refs, and bucket keys,
- runtime injection through `RedisRateLimitScriptClient`,
- production profile fail-closed validation requiring `OMNIWA_API_RATE_LIMIT_BACKEND=redis`.

The remaining gap is a concrete production Redis client adapter. Adding that adapter requires a
runtime/cache dependency decision, which is controlled by `AGENTS.md` and must be reviewed through
an ADR before implementation.

This ADR does not change Redis's architectural role. Redis remains ephemeral infrastructure and must
not become durable source of truth.

## Decision

Use a dedicated infrastructure adapter for the production Redis rate-limit script client, backed by
the `redis` npm package after this ADR is accepted.

The proposed implementation direction is:

- Add the `redis` dependency only in the API runtime boundary or a dedicated infrastructure package,
  not in Domain, Application, Interface, or shared business packages.
- Implement `RedisRateLimitScriptClient` by adapting the selected Redis client library to the
  existing `eval(script, { keys, arguments })` boundary.
- Keep the existing `RedisRateLimitCounterStore` responsible for Lua script semantics and hashed key
  construction.
- Configure the production adapter through explicit environment variables, including Redis URL,
  TLS mode if required, connection timeout, and key prefix.
- Fail closed on missing Redis configuration, connection errors during readiness validation, or
  unsupported Redis backend settings.
- Keep local/test support for in-memory and fake injected clients.

No public REST, OpenAPI, SDK, Domain, Application, or provider contract changes are required.

## Alternatives Considered

| Alternative                                | Reason Rejected or Deferred                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Keep only injected fake/manual client      | Leaves production profile unable to construct the distributed limiter from runtime configuration.                                    |
| Use in-memory limiter in production        | Not safe for multi-process production; counters diverge per process and make abuse controls ineffective.                             |
| Use `ioredis`                              | Deferred until OmniWA has cluster/sentinel requirements that justify the additional surface area for this narrow rate-limit adapter. |
| Implement Redis protocol manually          | Avoids a dependency but increases security, timeout, reconnection, protocol, and maintenance risk inside OmniWA.                     |
| Move rate limiting into PostgreSQL         | Adds write pressure to durable storage and couples abuse throttling to source-of-truth persistence.                                  |
| Use queue engine Redis client implicitly   | Couples rate limiting to a future queue implementation and makes adapter ownership unclear.                                          |
| Accept Redis as durable rate-limit history | Violates the persistence and recovery posture; rate-limit counters are ephemeral enforcement state, not recoverable business state.  |

## Consequences

### Positive

- Production API runtime can construct a distributed rate limiter without bespoke composition code.
- Existing hashed-key and redaction guarantees remain in the OmniWA-owned store boundary.
- Redis remains replaceable behind `RedisRateLimitScriptClient`.
- Local/test profiles remain lightweight and do not require a Redis process.

### Negative

- Adds the `redis` runtime/cache dependency that must be maintained and patched.
- Production startup/readiness must handle Redis connectivity and timeout failures carefully.
- Redis outages can affect API admission control; failure mode must be fail-closed or explicitly
  documented per production gate.

## Affected Documents

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md`
- `docs/platform-evolution/PR-07_AUTHORIZATION_AND_RATE_LIMITS.md`
- `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`
- `apps/api/src/runtime-composition.ts`
- `apps/api/package.json` or a dedicated infrastructure package manifest, depending on final review.

## Validation

Implementation after this ADR is accepted must prove:

- Redis dependency is not imported outside the approved adapter boundary.
- Redis keys do not contain raw API key ids, instance refs, target refs, bucket keys, JIDs, text, or
  provider payload.
- Production runtime composition can build the Redis-backed limiter from environment configuration.
- Production runtime composition fails closed when Redis configuration or connectivity is missing.
- Local and test runtime composition can still use in-memory or fake injected limiters.
- `pnpm check` passes, including architecture, regression, production, release, OpenAPI, client
  contract, and SDK gates.

## Migration Plan

1. Review and accept or revise this ADR.
2. Add the concrete Redis client dependency at the approved package boundary.
3. Implement the adapter behind `RedisRateLimitScriptClient`.
4. Wire production runtime composition from explicit Redis environment variables.
5. Add unit tests with a fake client and a production composition test that verifies fail-closed
   behavior.
6. Update N11.5 documentation and production profile guidance.
7. Run `pnpm check`.
