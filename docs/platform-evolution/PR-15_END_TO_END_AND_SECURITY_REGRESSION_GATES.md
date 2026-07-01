# PR-15 End-to-End And Security Regression Gates

## Status

Implemented.

## Scope

PR-15 converts production-readiness blockers into automated deterministic
regression gates.

Implemented capabilities:

- `regression:check` root script.
- Production regression tooling gate.
- HTTP E2E/security regression spec for REST -> Interface Adapter ->
  Application dispatcher with in-memory state, queue, and provider stub.
- Gate wiring into `pnpm check`.
- Release readiness evidence for regression gate implementation, tests, and
  runbook.
- Operational runbook for local production regression checks.

## Gate Coverage

| Area                         | Evidence                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REST -> Application boundary | `apps/api/src/platform-regression.spec.ts`                                                                                                                                                                                                                                     |
| Public envelope stability    | `apps/api/src/platform-regression.spec.ts`, `apps/api/src/http-server.spec.ts`                                                                                                                                                                                                 |
| Authentication               | `apps/api/src/api-key-auth.spec.ts`, `apps/api/src/platform-regression.spec.ts`                                                                                                                                                                                                |
| Authorization                | `apps/api/src/resource-ownership.spec.ts`, `apps/api/src/platform-regression.spec.ts`                                                                                                                                                                                          |
| Rate limiting                | `apps/api/src/api-rate-limiter.spec.ts`, `apps/api/src/platform-regression.spec.ts`                                                                                                                                                                                            |
| Runtime composition          | `apps/api/src/runtime-composition.spec.ts`                                                                                                                                                                                                                                     |
| Application contract         | `packages/interface-api/src/api-interface-adapter.spec.ts`, `packages/application/src/commands/command-query-model.spec.ts`, `packages/application/src/workflows/workflow-service.spec.ts`                                                                                     |
| Domain contract              | `packages/domain/src/services/phase-24-domain-contracts.spec.ts`                                                                                                                                                                                                               |
| Persistence                  | `packages/infrastructure-persistence/src/durable-json-repositories.spec.ts`                                                                                                                                                                                                    |
| Queue                        | `packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts`                                                                                                                                                                                                           |
| Provider                     | `packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts`, `apps/provider-runtime/src/provider-runtime.spec.ts`                                                                                                                                |
| Worker                       | `apps/worker/src/worker-runtime.spec.ts`                                                                                                                                                                                                                                       |
| Webhook security/runtime     | `packages/infrastructure-webhook/src/webhook-signing.spec.ts`, `packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts`, `packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts`, `apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts` |
| Redaction/observability      | `packages/observability/src/redaction.spec.ts`, `packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts`                                                                                                                                            |
| Object storage secret safety | `packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts`                                                                                                                                                                                        |

## Validation

Targeted checks:

```text
pnpm regression:check
pnpm release:check
```

Full gate:

```text
pnpm check
```

## Residual Risk

This slice establishes deterministic production regression coverage. It does
not replace deployment-specific smoke tests, load testing, penetration testing,
or real external dependency exercises.
