# PR-08 - Provider Runtime Vertical Slice

## Status

Implemented as a production-readiness foundation.

This PR turns the provider lifecycle boundary into a runnable app-level slice while keeping Baileys
behind the approved provider adapter package.

## Scope Implemented

| Area                     | Status   | Notes                                                                                  |
| ------------------------ | -------- | -------------------------------------------------------------------------------------- |
| Provider runtime app     | Complete | `ProviderRuntimeApp` runs connect, reconnect, QR pairing, and disconnect commands.     |
| Socket lifecycle owner   | Complete | `ProviderRuntime` remains the single owner of provider lifecycle state per instance.   |
| Session restore path     | Complete | Runtime restores session secrets through `SecretProvider` before provider calls.       |
| Signal translation       | Complete | Runtime records safe connection, auth, and failure signals without provider payloads.  |
| One active runtime guard | Complete | Shared guard rejects duplicate runtime ownership for the same instance.                |
| Provider error handling  | Complete | Provider failures classify source, retryability, provider port category, and category. |
| Runtime logs and metrics | Complete | Runtime emits structured logs and `provider_runtime.operation.total` metrics.          |
| Regression coverage      | Complete | Runtime and app tests cover lifecycle, duplicate guard, secrets, signals, and errors.  |

## Boundary Rules Preserved

- `apps/provider-runtime` depends on `MessagingProviderPort`, not Baileys.
- `@whiskeysockets/baileys` imports remain isolated to
  `packages/infrastructure-provider-baileys`.
- Runtime snapshots and signals do not include raw session material, QR payloads, socket objects,
  or provider-native payloads. QR/auth runtime signals are classified as `confidential`; the QR
  challenge itself remains `secret` at the provider port boundary.
- API and Application layers do not import provider adapters.

## Runtime Flow

```text
ProviderRuntimeApp
  -> ProviderRuntime
  -> SecretProvider
  -> MessagingProviderPort
  -> Provider adapter
```

Connect and reconnect share the same runtime path but keep distinct operation labels for metrics,
logs, and translated signals.

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  apps/provider-runtime/src/provider-runtime.spec.ts \
  apps/provider-runtime/src/provider-runtime-app.spec.ts \
  packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Wire the app to the selected production Baileys socket provider.
- Add durable cross-process ownership fencing if provider runtime is scaled beyond one process.
- Feed translated provider signals into the durable EventLog/outbox path in PR-9.
- Add production readiness health checks for live provider socket dependencies.
