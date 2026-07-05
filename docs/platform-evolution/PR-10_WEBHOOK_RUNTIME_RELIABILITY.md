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
- `FetchWebhookHttpGateway` can send the already-sanitized outbound webhook
  body over HTTP with safe timeout, network failure, and receiver header
  handling.
- Local webhook dispatcher runtime composition can opt in to that gateway with
  `OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch`; enabling it requires
  `OMNIWA_WEBHOOK_SIGNING_SECRET_NAME` so outbound deliveries are signed.
- `POST /v1/webhook-deliveries/{deliveryId}/retry` queues a controlled retry for
  eligible pending/retrying deliveries through the Application queue boundary.
- `POST /v1/webhook-deliveries/{deliveryId}/redrive` queues a new controlled
  delivery for eligible dead-lettered deliveries without mutating the terminal
  original delivery.
- `POST /v1/webhook-deliveries/redrive` queues controlled redrive work for a
  selected set of dead-lettered deliveries through a safe operation intent.
- `GET /v1/webhook-deliveries?status=dead_letter` is covered as the safe
  operator read surface for dead-letter remediation views with reason codes.
- Dispatcher processing persists `WebhookDelivery` aggregate status for
  delivered, retrying, and dead-letter outcomes instead of relying only on
  `WorkerJob` state.
- The dispatcher can opt into `OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job`
  to use the durable `WorkerJob`-backed queue provider.
- Webhook dispatcher production profile composition is fail-closed and requires
  PostgreSQL repositories, the durable worker-job queue profile, fetch HTTP
  gateway, a configured signing secret value, metric recorder, and webhook
  dispatch audit sink before composition is allowed.
- Runtime composition can create JSONL metric and webhook dispatch audit
  adapters from `OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH` and
  `OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH` when deployment code does not
  inject observability adapters directly. Production composition rejects a
  shared metric/audit JSONL target path so operational signals remain separable
  in target environments.
- `pnpm test:postgres` includes a production-profile dispatcher validation path
  that persists webhook delivery and worker-job state through PostgreSQL,
  dispatches through the durable worker-job queue profile and fetch gateway,
  signs the outbound request, and records JSONL metric/audit evidence.
- Signature verification supports timestamp tolerance and replay protection.
- Dispatcher tests cover durable restart recovery through the durable
  `WorkerJob` repository and queue recovery.
- Dispatcher tests cover retry followed by terminal dead-letter handling and
  the corresponding persisted `WebhookDelivery` status transitions.

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

The default local queue provider remains in-memory for compatibility. Recovery
is supported through the durable `WorkerJob` repository, and the dispatcher can
select the durable queue profile for runtime tests and local hardening:

```text
enqueue webhook_delivery work
  -> persist WorkerJob
  -> process restart
  -> new InMemoryQueueProvider
  -> recoverVisibleJobs()
  -> dispatch delivery
```

This is sufficient for the current incremental slice. Final production queue
validation is still tracked separately in the production execution plan.

## Remaining Work

- Add richer operational management for webhook dead letters, such as filtered
  operator dashboards, remediation notes, and higher-level campaign-style
  recovery workflows.
- Expand production end-to-end validation beyond the webhook dispatcher path and
  run it in the target deployment environment.
- Validate JSONL observability sink writability/rotation in the target
  deployment environment and replace it with richer exporters when P0-13
  introduces them.
- Add circuit-breaker behavior if production receiver failure rates require it.
- Add full end-to-end tests once the production Application dispatcher,
  persistence adapter, and queue adapter are wired together.

## Verification

Targeted checks used for this slice:

```text
pnpm exec vitest run packages/infrastructure-webhook/src/webhook-http-gateway.spec.ts packages/infrastructure-webhook/src/webhook-signing.spec.ts packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts
```

The PostgreSQL-backed production-profile validation is included in:

```text
pnpm test:postgres
```

Full repository quality gate:

```text
pnpm check
```
