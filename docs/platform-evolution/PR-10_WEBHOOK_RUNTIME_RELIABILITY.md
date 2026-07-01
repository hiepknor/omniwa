# PR-10 Webhook Runtime Reliability

## Status

Implemented.

## Scope

PR-10 turns webhook delivery from a transport adapter concept into a runnable
dispatcher slice.

Implemented capabilities:

- `apps/webhook-dispatcher` exposes a dispatcher app composition boundary.
- `WebhookDispatcherRuntime` records safe metrics and audit entries for dispatch
  outcomes.
- Webhook transport signs outbound deliveries with timestamped HMAC SHA-256
  signatures.
- Signature verification supports timestamp tolerance and replay protection.
- Dispatcher tests cover durable restart recovery through the durable
  `WorkerJob` repository and queue recovery.
- Dispatcher tests cover retry followed by terminal dead-letter handling.

## Runtime Boundary

The dispatcher app follows the approved platform boundary:

```text
Webhook Dispatcher App
  -> QueueProviderPort
  -> WebhookTransportDeliveryHandler
  -> WebhookTransportPort
  -> Webhook Receiver
```

The dispatcher does not import or call the API layer.

## Signing Contract

Signed webhook deliveries include:

| Header                         | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `x-omniwa-signature`           | HMAC signature in `v1=<hex>` form.      |
| `x-omniwa-signature-scheme`    | Current scheme version, currently `v1`. |
| `x-omniwa-signature-timestamp` | Epoch millisecond timestamp for replay. |
| `x-omniwa-delivery-id`         | Safe delivery identifier.               |
| `x-omniwa-webhook-id`          | Safe webhook subscription identifier.   |
| `x-omniwa-correlation-id`      | Correlation id propagated from runtime. |

Signing secrets are resolved through `SecretProvider`; no secret value is stored
in the transport request, metric, audit entry, or test fixture output.

## Restart Recovery

The current queue provider remains in-memory, but recovery is supported through
the durable `WorkerJob` repository:

```text
enqueue webhook_delivery work
  -> persist WorkerJob
  -> process restart
  -> new InMemoryQueueProvider
  -> recoverVisibleJobs()
  -> dispatch delivery
```

This is sufficient for the current incremental slice. A production queue adapter
is still tracked separately in the production execution plan.

## Remaining Work

- Replace in-memory queue recovery with the future production queue adapter.
- Add operational API/read model for webhook dead-letter management.
- Add real HTTP gateway timeout/circuit-breaker implementation when outbound
  network transport is finalized.
- Add full end-to-end tests once the production Application dispatcher,
  persistence adapter, and queue adapter are wired together.

## Verification

Targeted checks used for this slice:

```text
pnpm exec vitest run packages/infrastructure-webhook/src/webhook-signing.spec.ts packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts
```

Full repository quality gate:

```text
pnpm check
```
