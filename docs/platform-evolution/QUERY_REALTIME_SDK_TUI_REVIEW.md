# Query, Realtime, SDK, And TUI Review

## Query Model Review

Current query catalog exists but is not sufficient for platform clients.

Current queries:

- Instance status/list.
- Message status/history.
- Media status.
- Webhook status/history.
- Health.
- Audit records.
- Configuration status.
- Operational metrics.
- Worker job status.
- Provider capability status.

Missing for TUI/Web/CLI:

- Chat list/detail.
- Contact list/detail.
- Group list/detail.
- Group members.
- Message timeline/list by instance/chat/group.
- Job list by status/type.
- Webhook list and delivery list.
- Event log.
- Log view.
- Dashboard summary.
- API client list/settings.

## Proposed Read Models

| Read Model                   | Purpose                       | Source                                     |
| ---------------------------- | ----------------------------- | ------------------------------------------ |
| `DashboardSummaryProjection` | TUI/Web home summary          | Health, metrics, jobs, webhooks, instances |
| `InstanceListProjection`     | Instance screen list          | Instance, Session, Health                  |
| `InstanceDetailProjection`   | Instance detail               | Instance, Session, Provider, Health        |
| `SessionListProjection`      | Session screen                | Session                                    |
| `MessageTimelineProjection`  | Message list/timeline         | Message, Media, WorkerJob                  |
| `MessageDetailProjection`    | Message detail/status         | Message, provider status, delivery history |
| `WebhookListProjection`      | Webhook screen                | WebhookSubscription, delivery summary      |
| `WebhookDeliveryProjection`  | Delivery history              | WebhookDelivery                            |
| `JobListProjection`          | Jobs screen                   | WorkerJob                                  |
| `QueueOverviewProjection`    | Queue screen                  | Queue metrics, WorkerJob                   |
| `EventLogProjection`         | Events screen/realtime cursor | Domain/Application notifications           |
| `OperationalLogProjection`   | Logs screen                   | Logger sink output, redacted               |
| `SettingsProjection`         | Settings screen               | ConfigurationSnapshot                      |
| `ProviderStatusProjection`   | Provider runtime screen       | ProviderProfile, Health                    |
| `ChatListProjection`         | Future chat screen            | Future Chat projection/domain              |
| `ContactListProjection`      | Future contacts screen        | Future Contact domain                      |
| `GroupListProjection`        | Future groups screen          | Future Group domain                        |
| `GroupMembersProjection`     | Future members screen         | Future Group domain                        |

## Pagination, Search, Filter, Sort

All list/history projections should use cursor pagination.

| Screen    |     Pagination | Filter                                  | Sort                   | Search                                |
| --------- | -------------: | --------------------------------------- | ---------------------- | ------------------------------------- |
| Dashboard | No for summary | time window                             | fixed                  | no                                    |
| Instances |            Yes | status, health                          | updated/created/status | safe label                            |
| Sessions  |            Yes | status, instance                        | updated                | no raw secret                         |
| Messages  |            Yes | instance, status, type, direction, time | newest/oldest          | correlation/request id only initially |
| Jobs      |            Yes | status, work type                       | updated/oldest pending | job id/correlation                    |
| Webhooks  |            Yes | status                                  | updated                | safe name/ref                         |
| Events    |            Yes | type, source, time                      | sequence/time          | correlation/request id                |
| Logs      |            Yes | level, runtime, time                    | time                   | safe message/code only                |
| Groups    |            Yes | instance, status                        | name/updated           | safe group name after privacy review  |
| Contacts  |            Yes | instance                                | name/updated           | safe display after privacy review     |
| Chats     |            Yes | instance, unread/status                 | last activity          | safe title after privacy review       |

## Realtime Recommendation

| Use Case                        | Recommended Transport | Reason                                                    |
| ------------------------------- | --------------------- | --------------------------------------------------------- |
| TUI status updates              | SSE                   | Simple read-only stream, works well with terminal clients |
| Dashboard live metrics          | SSE                   | Server-to-client only; reconnect is easy                  |
| CLI `watch` mode                | SSE                   | Easier than WebSocket and script-friendly                 |
| Logs tail                       | SSE                   | Ordered read-only stream                                  |
| Event feed                      | SSE                   | Natural event stream model                                |
| Future collaborative UI/control | WebSocket             | Only if bidirectional semantics are required              |
| Low-change screens              | Polling fallback      | Robust when streaming unavailable                         |

Initial endpoint:

```text
GET /v1/events/stream
```

Future optional:

```text
GET /v1/logs/stream
```

Stream rules:

- Events must be redacted.
- Events must have monotonically comparable cursor/sequence.
- Reconnect must resume from cursor when retained.
- Expired events must not be replayed.
- Provider-native payloads must never be emitted.

## SDK Review

The official SDK should be mandatory for OmniWA TUI, Web Dashboard, CLI, MCP server, and third-party integrations.

### Rust SDK Layout

```text
omniwa-sdk-rs
├── client
├── auth
├── errors
├── pagination
├── streaming
├── instances
├── sessions
├── messages
├── media
├── webhooks
├── jobs
├── metrics
├── health
├── settings
├── audit
├── events
├── groups        # future after domain approval
├── chats         # future after domain approval
└── contacts      # future after domain approval
```

### Generation Strategy

- Generate low-level models/client from OpenAPI.
- Write a small hand-maintained ergonomic layer for:
  - authentication,
  - retries,
  - pagination,
  - streaming,
  - error mapping,
  - idempotency keys.

Do not hand-code every endpoint from scratch unless OpenAPI cannot express a required streaming or pagination contract.

### SDK Error Model

SDK errors should preserve:

- API error category.
- API error code.
- retryable flag.
- request id.
- correlation id.
- optional action-required marker.

SDK errors must not expose:

- stack traces from server.
- provider-native payloads.
- raw secrets.

## TUI Compatibility Matrix

| TUI Screen   | Status  | Related Current Code                                      | Missing                                    |
| ------------ | ------- | --------------------------------------------------------- | ------------------------------------------ |
| Dashboard    | PARTIAL | `GetHealthStatus`, metrics queries, observability package | Dashboard projection, REST, SSE            |
| Instances    | PARTIAL | Instance domain/repository, commands, `ListInstances`     | REST, durable persistence, list projection |
| Sessions     | PARTIAL | Session domain/repository                                 | Session list/detail query/API              |
| Chats        | MISSING | No source module                                          | Domain/projection/API                      |
| Contacts     | MISSING | No source module                                          | Domain/projection/API                      |
| Groups       | MISSING | No source module                                          | Domain/projection/API/provider support     |
| Members      | MISSING | No source module                                          | GroupMember model/actions                  |
| Messages     | PARTIAL | Message domain, send commands, status/history query       | REST, timeline/list projection             |
| Queue        | PARTIAL | Queue provider, WorkerJob                                 | Queue overview projection/API              |
| Jobs         | PARTIAL | WorkerJob domain, `GetWorkerJobStatus`                    | Job list/projection/API                    |
| Webhooks     | PARTIAL | Webhook domain, transport/dispatcher                      | REST route app, list projection            |
| Events       | PARTIAL | Domain event contracts                                    | EventLog projection/SSE                    |
| Logs         | MISSING | Logger contracts                                          | Log storage/projection/API                 |
| API Explorer | MISSING | No OpenAPI                                                | OpenAPI spec                               |
| Settings     | PARTIAL | Configuration domain/commands/query                       | Admin REST routes                          |
