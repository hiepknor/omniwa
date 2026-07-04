# Implementation Plan — Vertical Slice 01

> **Trạng thái:** Draft kế hoạch (chỉ tài liệu, chưa sửa source).
> **Ngày lập:** 2026-07-03 · **Branch gốc:** `main` · **Commit tham chiếu:** `042524b`
> **Đối tượng đọc:** Agent/engineer sẽ implement slice này theo từng commit.

---

## 1. Executive summary

OmniWA hiện là một bộ khung **Clean Architecture / Hexagonal rất trưởng thành về thiết kế** (domain thuần, ports/adapters kỷ luật, arch boundary được enforce, queue/webhook runtime chuẩn), **nhưng lõi vận hành end-to-end còn rỗng**: Application dispatcher chỉ thực thi 3 operation (`CreateInstance`, `ListInstances`, `GetHealthStatus`), mọi command/query khác trả `application_handler_not_implemented`; provider Baileys chưa có socket thật; producer của queue/webhook chưa được nối (chỉ `scheduler` gọi `enqueue`); domain events được ghi vào `aggregate.domainEvents` nhưng **không được publish** đi đâu.

**Vertical Slice 01** nối trọn **một** luồng nghiệp vụ chạy thật xuyên các tầng, theo nguyên tắc **tối thiểu nhưng chạy thật**:

```
Create Instance → QR Pairing → Connected Session → Send Text Message → Provider Receipt → Webhook Event
```

Slice này chứng minh boundary hoạt động end-to-end và mở khóa mọi feature sau (mọi handler, event propagation, provider transport, worker producer, webhook producer đều lần đầu được nối).

**Ràng buộc bất di bất dịch:** không refactor lớn, không rewrite architecture, không đưa Baileys vào domain/application, không đưa business logic vào `apps/*`, không sửa file generated/`dist`/`node_modules`/`target`.

---

## 2. Scope của Vertical Slice 01

| # | Bước | Kết quả quan sát được |
|---|---|---|
| 1 | **Create Instance** | `POST /v1/instances` → tạo `Instance(status=created)`, lưu, phát `InstanceCreated` vào EventLog |
| 2 | **QR Pairing** | `POST /v1/instances/{id}/qr/refresh` → provider sinh QR → `Instance(status=qr_pending)`, phát `InstanceQrRequired`, QR ref lộ qua SSE `/v1/events/stream` |
| 3 | **Connected Session** | provider báo connected → `ConfirmSessionActivated` → tạo `Session(active)` + `markInstanceConnected` → phát `InstanceConnected`/`SessionActivated` |
| 4 | **Send Text Message** | `POST /v1/instances/{id}/messages/text` → validate `to/text` → lưu payload ở `OutboundMessageIntentStore` dưới `outboundIntentRef` opaque → guardrail pass → tạo outbound `Message` → bind `messageId` với `outboundIntentRef` → `queueMessage` → **enqueue `outbound_message`** → trả `accepted` (202) |
| 5 | **Provider Receipt** | worker reserve `outbound_message` → `provider.sendOutboundMessage` → `markMessageSent` → nhận receipt → `markMessageDelivered` |
| 6 | **Webhook Event** | message delivered → `ScheduleWebhookDelivery` (match subscription) → enqueue `webhook_delivery` → webhook-dispatcher deliver → `WebhookDeliverySucceeded` |

**Provider mode cho slice này:** dùng **fake Baileys socket** ở lớp thấp nhất của provider adapter để CI xanh trước, sau đó mới wire `makeWASocket` thật sau khi có đủ `AuthStateStore`, `SignalIngress`, và `ProviderRuntimeSupervisor`. Fake chỉ thay ở tầng socket injection, KHÔNG thay adapter.

**Outbound payload boundary:** REST có thể nhận và validate `to/text`, nhưng raw recipient/message body **không** đi vào Domain và **không** trở thành field của `Message`. Interface/Application chỉ truyền `outboundIntentRef`/`safeInputRef` opaque. Worker/provider resolve `outboundIntentRef` qua adapter ở Infrastructure để lấy `{ jid, content }` cho Baileys.

---

## 3. Out of scope (Slice 01 KHÔNG làm)

- Media message đầy đủ, group message, contact/label/chat sync.
- Ownership guard phân tán (đa-process); slice này chỉ khóa **single-instance ownership** có chủ đích.
- Inbound message persistence/chat sync đầy đủ; slice này chỉ mapping inbound provider signal tối thiểu qua `SignalIngress`.
- Postgres cho Message/Session/Webhook (slice này dùng in-memory/durable-json; Postgres chỉ Instance/WorkerJob như hiện tại — xem §12).
- Redis/BullMQ (giữ `InMemoryQueueProvider`).
- Retry/backoff tinh chỉnh nâng cao (dùng default sẵn có).
- Unit of Work đa-aggregate atomic đầy đủ (chỉ "durable-before-accept" tối thiểu — xem §7).
- Refactor lớn dispatcher ngoài việc chuyển sang handler registry.
- Multi-tenant, rate-limit nâng cao, audit đầy đủ.

---

## 4. Current codebase status (đã khảo sát)

**Đã thật, có logic:**
- Domain layer đầy đủ: `Instance`, `Session`, `Message`, `WorkerJob`... đều là immutable record + state transition map tập trung (`packages/domain/src/aggregates/status-transition.ts`) + append `domainEvents`.
- HTTP server thật (`apps/api/src/http-server.ts`, ~2.451 LOC): routing, auth API key, rate limit, resource ownership, SSE, DTO. **Đã map sẵn** `CreateInstance`, `ConnectInstance`, `StartQrPairing`, `SendTextMessage` → command envelope qua `packages/interface-api`.
- `InMemoryQueueProvider` production-grade: reservation, visibility timeout, lease-expiry recovery, idempotency dedup, retry-budget → dead-letter, metrics.
- `WorkerRuntime` (reserve→invoke→ack/retry/dead) và `WebhookDispatcherRuntime` + `WebhookTransportDeliveryHandler` đều thật.
- Postgres adapter thật nhưng chỉ 2/19 repo (`Instance`, `WorkerJob`).

**Đang skeleton (mắt xích slice này phải nối):**
- `ApplicationDispatcher`: 3/~70 handler; phần còn lại `not_implemented`. Là một `switch` — **risk God Object**.
- Domain events **không được publish** (không ai đọc `aggregate.domainEvents`).
- `unit-of-work.ts` chỉ là descriptor, không có commit/rollback, **không được dispatcher import**.
- Baileys adapter chỉ `import type`; **không có `makeWASocket`**; socket inject qua port `BaileysSocketProvider.getSocket` chưa có implementation thật.
- `apps/provider-runtime/src/index.ts` là stub (in JSON `"requires MessagingProviderPort and SecretProvider"`), **không có composition root**.
- Producer trống: chỉ `apps/scheduler/src/scheduler-runtime.ts` gọi `queueProvider.enqueue`.
- Webhook producer (event → schedule → enqueue) và `WebhookDeliveryEnvelopeResolver` adapter chưa nối.

---

## 5. Runtime flow mong muốn

```
Client ──HTTP──> apps/api/http-server
                    │  (đã có: routing/auth/validate → command envelope)
                    ▼
        interface-api/api-interface-adapter ──> ApplicationDispatcher (registry)
                    │
   ┌────────────────┼───────────────────────────────────────────────┐
   ▼                ▼                                                 ▼
CreateInstance   StartQrPairing / ConfirmSessionActivated       SendTextMessage
 handler          handler                                        handler
   │                │                                                 │
   │ save Instance  │ provider.requestQrPairing / mark states         │ createOutboundMessageIntent
   │ publish event  │ provider.requestConnection                      │ → guardrail pass → acceptMessage
   │                │ save + publish                                  │ save Message
   │                │                                                 │ bind messageId ↔ outboundIntentRef
   │                │                                                 │ queueProvider.enqueue(outbound_message)
   │                │                                                 │ publish MessageQueued → trả "accepted"
   └────────────────┴──────────────────┬──────────────────────────────┘
                                        ▼
                              EventLog (port) ──> SSE /v1/events/stream

apps/provider-runtime (composition thật)
   └─ ProviderRuntimeSupervisor + BaileysMessagingProviderAdapter + BaileysSocketProvider(makeWASocket)
        ├─ AuthStateStore read/write per sessionId
        ├─ connection.update → safe QR / connected / disconnected signals
        ├─ messages.update / inbound messages → safe message_status / inbound_message signals
        └─ SignalIngress → EventLog / domain workflow routing

apps/worker (loop)
   └─ WorkerRuntime.reserve("outbound_message")
        └─ DispatchMessage handler → resolve active Session → provider.sendOutboundMessage(outboundIntentRef)
             └─ receipt → markMessageDelivered → publish MessageDelivered
                  └─ ScheduleWebhookDelivery → enqueue("webhook_delivery")

apps/webhook-dispatcher (loop)
   └─ WebhookDispatcherRuntime.dispatchNext
        └─ envelopeResolver.resolve → WebhookTransportPort.deliver → WebhookDeliverySucceeded
```

---

## 6. File/module cần sửa (bản đồ chi tiết)

> Đường dẫn tương đối repo root. **Không** đụng `dist/`, `node_modules/`, `target/`, `*.d.ts` generated, hay OpenAPI generated trừ khi ghi rõ.

### Application (`packages/application/src`)
- `services/application-dispatcher.ts` — **sửa**: chuyển switch → handler registry (Map), đăng ký handler mới. Giữ nguyên interface `executeCommand/executeQuery`.
- `ports/outbound-message-intent-store.ts` — **mới**: application port lưu/resolve `outboundIntentRef` opaque; Application dùng ref an toàn, Infrastructure/provider resolver mới được đọc raw `to/text`.
- `services/handlers/` — **mới (thư mục)**: một handler/file.
  - `connect-instance.handler.ts`
  - `start-qr-pairing.handler.ts`
  - `confirm-session-activated.handler.ts`
  - `send-text-message.handler.ts`
  - `schedule-webhook-delivery.handler.ts`
  - `dispatch-outbound-message.handler.ts` (dùng bởi worker qua command `ProcessOutboundMessageWork`)
  - `command-handler.ts` — **mới**: type `CommandHandler` / `QueryHandler` + kiểu registry.
- `services/active-session-resolver.ts` — **mới hoặc helper nội bộ handler**: load active session từ `InstanceRepositoryPort` + `SessionRepositoryPort`, fail closed nếu missing/inactive/stale.
- `services/domain-event-publisher.ts` — **mới**: publish only-new-events từ aggregate → append vào `EventLogPort` với idempotency key an toàn.
- `services/provider-signal-ingress.ts` — **mới**: consume `TranslatedProviderSignal` đã sanitize, map auth/connection/message_status/inbound_message/failure sang EventLog/domain workflow tối thiểu, idempotent theo `occurrenceRef`.
- `index.ts` — **sửa**: export các type/handler cần cho composition (KHÔNG export adapter cụ thể).

### Interface API (`packages/interface-api/src`)
- `api-interface-adapter.ts` — **sửa tối thiểu**: khi nhận command send text/media, lưu input đã validate vào `OutboundMessageIntentStorePort` và đưa `outboundIntentRef` vào `safeInputRef`. Adapter không tự quyết định nghiệp vụ, không gọi provider, không expose command name ra public API.

### Provider (`packages/infrastructure-provider-baileys/src`)
- `baileys-socket-provider.fake.ts` hoặc test fixture tương đương — **mới**: fake socket provider để test adapter/runtime không cần WhatsApp thật.
- `baileys-auth-state-store.ts` — **mới**: `AuthStateStore` port + fake/in-memory/durable-json adapter cho Baileys auth state read/write theo `sessionId`; không dùng `SecretProvider` để ghi auth state liên tục.
- `baileys-socket-provider.ts` — **mới**: `BaileysSocketProvider` contract/fake trước, implementation thật bằng `makeWASocket` sau khi có AuthStateStore + SignalIngress + supervisor.
- `baileys-signal-mapper.ts` hoặc phần tách trong provider implementation — **mới**: subscribe events → dịch sang safe `TranslatedProviderSignal` lifecycle/message status/inbound/failure.
- `baileys-outbound-message-resolver.ts` — **mới**: implement `BaileysOutboundMessageResolver`, resolve `outboundIntentRef` từ intent store thành `{ jid, content }` và redaction-safe logs.
- `index.ts` — **sửa**: export thêm.

### Apps
- `apps/provider-runtime/src/provider-runtime-supervisor.ts` — **mới**: long-lived supervisor/loop giữ socket sống, start/stop session, drain signals, enforce single-instance ownership guard.
- `apps/provider-runtime/src/runtime-composition.ts` — **mới**: composition root thật, wire AuthStateStore + SignalIngress + supervisor.
- `apps/provider-runtime/src/index.ts` — **sửa**: thay stub bằng composition thật (giữ guard fail-fast profile production).
- `apps/api/src/runtime-composition.ts` — **sửa**: inject `OutboundMessageIntentStorePort`, `MessagingProviderPort` (qua queue, không gọi trực tiếp cho send), `QueueProviderPort`, message/session/webhook/guardrail repos, EventLog vào dispatcher.
- `apps/worker/src/worker-application-handlers.ts` — **sửa**: thêm handler `outbound_message` → gọi command `ProcessOutboundMessageWork`.
- `apps/worker/src/runtime-composition.ts` — **sửa**: inject provider port + message/instance/session repos + outbound intent store vào dispatcher.
- `apps/provider-runtime/src/runtime-composition.ts` — **sửa**: wire `BaileysOutboundMessageResolver` cùng `BaileysSocketGateway`, để provider mới resolve được `outboundIntentRef` thành Baileys payload.
- `apps/webhook-dispatcher/src/runtime-composition.ts` — **sửa**: nối `WebhookDeliveryEnvelopeResolver` adapter.
- `apps/webhook-dispatcher/src/webhook-envelope-resolver.ts` — **mới (nếu cần)**: adapter resolve envelope từ `WebhookDeliveryRepositoryPort`.

### Persistence (`packages/infrastructure-persistence/src`)
- `repository-set.ts` (hoặc helper hiện có) — **sửa (tùy chọn, commit dọn)**: tách builder repository-set dùng chung cho api/worker để hết trùng lặp.

> **KHÔNG** thêm business logic vào `apps/*`: app chỉ compose (khởi tạo adapter + wire) và chạy loop. Mọi quyết định nghiệp vụ nằm trong `packages/application` (handler) và `packages/domain`.

---

## 7. Ports/interfaces cần dùng hoặc bổ sung

**Dùng lại (đã tồn tại — KHÔNG đổi contract):**
- `MessagingProviderPort` — `requestConnection`, `requestQrPairing`, `disconnect`, `sendOutboundMessage`, `getCapabilitySummary` (`packages/application/src/ports/messaging-provider.ts`).
- `QueueProviderPort` — `enqueue`, `reserve`, `acknowledge`, `releaseForRetry`, `moveToDeadLetter` (`ports/queue-provider.ts`). Work types: `outbound_message`, `webhook_delivery` (đã có trong `queueWorkTypes`).
- `EventLogPort` (`ports/event-log.ts`) — `PlatformEventRecord` / `PlatformEventAppendInput` / event outbox.
- `WebhookTransportPort` (`ports/webhook-transport.ts`), `SessionStorePort` (`ports/session-store.ts`).
- Repository ports (`packages/domain/src/repositories/repository-ports.ts`): `InstanceRepositoryPort`, `SessionRepositoryPort`, `MessageRepositoryPort`, `GuardrailDecisionRepositoryPort`, `WebhookSubscriptionRepositoryPort`, `WebhookDeliveryRepositoryPort`, `WorkerJobRepositoryPort`.

**Bổ sung (mới, nằm trong application/provider — KHÔNG phá boundary):**
- `CommandHandler` / `QueryHandler` type + `CommandHandlerRegistry` (application).
- `OutboundMessageIntentStorePort` (application port) — lưu payload outbound đã validate dưới `outboundIntentRef` opaque; hỗ trợ `storeTextIntent`, `bindMessageIntent(messageId, outboundIntentRef)`, `resolveIntentRefForProvider(outboundIntentRef)` hoặc operation tương đương. Application chỉ dùng opaque ref; provider resolver mới đọc raw payload.
- `ActiveSessionResolver` (application service/helper) — dùng `InstanceRepositoryPort.getCurrentSessionId` + `SessionRepositoryPort.load` + `isSessionSendCapable`; trả `SessionId` active hoặc lỗi application safe. Missing/inactive/stale session **không được gọi provider**.
- `DomainEventPublisher` type (application) — nhận only-new domain events → append EventLog; không publish toàn bộ `aggregate.domainEvents` nhiều lần.
- `ProviderSignalIngress` / `SignalIngress` (application service hoặc infrastructure bridge phía trong boundary application) — consume `TranslatedProviderSignal` từ provider runtime `drainSignals`/signal sink; map tối thiểu `auth`, `connection`, `message_status`, `inbound_message`, `failure` sang EventLog/domain workflow phù hợp; idempotent theo deterministic `occurrenceRef`; không nhận raw provider payload.
- `WebhookDeliveryEnvelopeResolver` đã có ở `infrastructure-webhook`; slice này thêm **adapter** đọc từ repo (không đổi port).
- `BaileysAuthStateStore` / `AuthStateStorePort` (provider infrastructure port) — read/write auth state liên tục theo `sessionId`; mỗi save có `revision`, `updatedAtEpochMilliseconds`, `checksum` nếu đơn giản; `dataClassification=secret`; durable-json adapter không expose raw public DTO; production encryption là follow-up bắt buộc trước public production nếu chưa làm trong slice.
- `BaileysSocketProvider` (đã là port trong adapter package) — giữ contract/fake; implementation thật chỉ được thêm sau AuthStateStore + SignalIngress + ProviderRuntime supervisor.
- `BaileysOutboundMessageResolver` (đã tồn tại trong adapter package) — thêm implementation đọc `OutboundMessageIntentStorePort`/adapter store để dịch `outboundIntentRef` thành `{ jid, content }`; không expose Baileys types ra Application.
- `ProviderRuntimeSupervisor` (runtime/app boundary) — long-lived loop start/stop session, giữ socket sống, drain signals đều đặn, enforce single-instance ownership guard; không chứa business logic.
- `SingleInstanceOwnershipGuard` (runtime utility tối thiểu) — slice này khóa deliberate single-instance ownership, không distributed lease; nếu chạy nhiều provider-runtime process là unsupported deployment mode.

> **Nguyên tắc UoW tối thiểu:** handler async (SendTextMessage) phải **store outbound intent + pass guardrail + save Message + bind message↔intent + enqueue WorkerJob + publish only-new MessageQueued** trước khi trả `accepted` (durable-before-accept theo `assertAsyncVisibilityBeforeAcceptance`). Chưa cần transaction đa-aggregate atomic đầy đủ; với in-memory là tuần tự, với Postgres (tương lai) bọc trong 1 transaction.

### Outbound intent boundary

- REST body `to/text` chỉ được validate ở Interface và lưu vào intent store qua application port. Raw body không được map vào `Message`, `GuardrailDecision`, EventLog payload, log, audit, metric, hay DTO.
- `outboundIntentRef` là safe opaque reference, có thể dùng làm `safeInputRef`/provider `outboundIntentRef`.
- `SendTextMessage` handler chỉ biết `outboundIntentRef`, `InstanceId`, idempotency key, actor/correlation context.
- `ProcessOutboundMessageWork` tạo `ProviderOutboundMessageRequest` với `outboundIntentRef`; `BaileysOutboundMessageResolver` ở Infrastructure mới resolve ref đó thành `{ jid, content }`.
- Nếu resolver không tìm thấy intent hoặc intent đã expired/retired, worker fail message bằng provider/application failure an toàn và **không** gọi `socket.sendMessage`.

### Domain event publish idempotency

- Handler phải capture `baseEventCount` trước khi gọi domain transition, rồi gọi publisher với `aggregate.domainEvents.slice(baseEventCount)`.
- Nếu không thêm được drain/clear event vào aggregate trong slice này, `DomainEventPublisher` phải tạo deterministic event id từ `commandRef`/`correlationId` + `aggregateType` + `aggregateId` + `eventName` + `eventIndex` và EventLog append phải skip/return existing khi gặp duplicate id.
- Không handler nào được publish trực tiếp toàn bộ `aggregate.domainEvents` sau khi load aggregate cũ từ repository.

### Provider signal ingress boundary

- `SignalIngress` chỉ nhận `TranslatedProviderSignal`, không nhận Baileys native event, QR raw value, JID raw payload, message body, hoặc provider error object nguyên bản.
- `occurrenceRef` phải deterministic với cùng provider/session/message observation để retry/drain lại không tạo duplicate EventLog/domain event.
- `SignalIngress` map tối thiểu:
  - `auth` → QR/action-required/paired events phù hợp.
  - `connection` → connected/disconnected/logged-out workflow.
  - `message_status` → message status domain workflow hoặc EventLog observation.
  - `inbound_message` → safe inbound observation event tối thiểu, chưa sync chat/contact đầy đủ.
  - `failure` → provider failure event với `failureCategory` safe.
- Nếu signal thiếu hoặc corrupt required refs, ingress quarantine/drop safe và ghi observability safe metadata; không gọi domain workflow bằng payload không hợp lệ.

---

## 8. Application handlers cần implement

| Handler (file) | Command | Dependency (inject qua constructor) | Logic tối thiểu |
|---|---|---|---|
| `connect-instance.handler.ts` | `ConnectInstance` | `InstanceRepositoryPort`, `MessagingProviderPort`, `DomainEventPublisher` | load Instance → `markInstanceConnecting` → `provider.requestConnection` → save → publish events |
| `start-qr-pairing.handler.ts` | `StartQrPairing` | `InstanceRepositoryPort`, `MessagingProviderPort`, `DomainEventPublisher` | `provider.requestQrPairing` → `markInstanceQrPending` → save → publish `InstanceQrRequired` |
| `confirm-session-activated.handler.ts` | `ConfirmSessionActivated` | `InstanceRepositoryPort`, `SessionRepositoryPort`, `DomainEventPublisher` | `createSession`→`startSessionPairing`→`activateSession`; `markInstanceConnected(sessionId)`; save 2 aggregate; publish |
| `send-text-message.handler.ts` | `SendTextMessage` | `InstanceRepositoryPort`, `SessionRepositoryPort` hoặc `ActiveSessionResolver`, `MessageRepositoryPort`, `GuardrailDecisionRepositoryPort`, `OutboundMessageIntentStorePort`, `QueueProviderPort`, `DomainEventPublisher`, UUID/Clock | resolve active session → load/store `outboundIntentRef` → create/pass minimal `GuardrailDecision` → `createOutboundMessageIntent` → `acceptMessage(guardrailDecisionId)` → `queueMessage` → save Message → bind `messageId ↔ outboundIntentRef` → `enqueue(outbound_message)` → publish only-new guardrail/message events → trả `accepted` |
| `dispatch-outbound-message.handler.ts` | `ProcessOutboundMessageWork` | `MessageRepositoryPort`, `InstanceRepositoryPort`, `SessionRepositoryPort` hoặc `ActiveSessionResolver`, `OutboundMessageIntentStorePort`, `MessagingProviderPort`, `DomainEventPublisher` | load Message → resolve active Session; nếu missing/inactive/stale thì fail/retry safe và **không gọi provider** → `markMessageProcessing` → `provider.sendOutboundMessage({ sessionId, outboundIntentRef })` → `markMessageSent`; nếu receipt `accepted` → `markMessageDelivered` → publish only-new events; trả outcome completed/retry/dead |
| `apply-provider-receipt` (gộp vào dispatch hoặc `ApplyProviderMessageStatus`) | `ApplyProviderMessageStatus` | `MessageRepositoryPort`, `DomainEventPublisher` | map receipt → `markMessageDelivered`/`failMessage` → publish |
| `schedule-webhook-delivery.handler.ts` | `ScheduleWebhookDelivery` | `WebhookSubscriptionRepositoryPort`, `WebhookDeliveryRepositoryPort`, `QueueProviderPort`, `DomainEventPublisher` | match subscription theo event name → tạo `WebhookDelivery` → save → `enqueue(webhook_delivery)` → publish `WebhookDeliveryScheduled` |

**Registry:** `application-dispatcher.ts` build `Map<ApplicationCommandName, CommandHandler>` từ danh sách handler được inject; `executeCommand` chỉ lookup + invoke; command không có handler vẫn trả `application_handler_not_implemented` (giữ hành vi cũ). Tương tự cho query nếu cần (`GetInstance`, `ListInstances` giữ nguyên).

### Guardrail tối thiểu cho slice

- `SendTextMessage` không được gọi `acceptMessage` nếu chưa có `GuardrailDecision` ở trạng thái pass/allow.
- Tối thiểu slice tạo decision bằng factory/domain functions hiện có (`requestGuardrailDecision` + `passGuardrailDecision`, hoặc `createGuardrailDecisionAggregate` với outcome `allow`) và lưu qua `GuardrailDecisionRepositoryPort`.
- `evaluatedIntentRef` phải là safe opaque ref (`outboundIntentRef` hoặc derived safe id), không phải raw `to/text`.
- Nếu guardrail fail/block/throttle/action_required, handler trả rejected/action_required tương ứng, không tạo queued worker job và không gọi provider.
- Đây là MVP guardrail pass tối thiểu để nối slice; rate-limit/abuse scoring nâng cao vẫn ở slice sau, nhưng không được bypass requirement `GuardrailDecision` trước `MessageAccepted`.

---

## 9. Provider Baileys work cần implement

**Files chính:** `packages/infrastructure-provider-baileys/src/baileys-auth-state-store.ts`, `packages/infrastructure-provider-baileys/src/baileys-socket-provider.ts`, signal mapper trong package Baileys, `packages/application/src/services/provider-signal-ingress.ts`, và `apps/provider-runtime/src/provider-runtime-supervisor.ts`.

Implement provider thật theo thứ tự **không được đảo**:

1. **AuthStateStore trước `makeWASocket`**
   - Tạo `AuthStateStore` port trong `infrastructure-provider-baileys`, không đặt trong domain/application.
   - Baileys auth state cần read/write liên tục theo `sessionId`; tuyệt đối **không** nhét write path vào `SecretProvider`.
   - Store phải hỗ trợ tối thiểu `load(sessionId)`, `save(sessionId, state)`, `update(sessionId, patch)` hoặc operation tương đương theo Baileys auth state adapter.
   - Mỗi record có metadata safe: `revision`, `updatedAtEpochMilliseconds`, `checksum` nếu đơn giản.
   - `dataClassification=secret`; durable-json adapter không tạo public DTO chứa raw auth material; production encryption là follow-up nếu chưa implement trong slice.
   - Test bắt buộc: save/load/update revision/checksum, missing state safe, durable-json không leak raw public DTO.

2. **SignalIngress trước `makeWASocket`**
   - Provider socket chỉ emit/drain `TranslatedProviderSignal`.
   - `SignalIngress` consume từ `drainSignals`/signal sink, map tối thiểu `auth`, `connection`, `message_status`, `inbound_message`, `failure` sang EventLog/domain workflow phù hợp.
   - `occurrenceRef` deterministic và idempotent; ingest lại cùng signal không append duplicate EventLog/domain event.
   - Không expose raw provider payload, QR raw, JID, text, Baileys error object vào public DTO/log/EventLog payload.

3. **ProviderRuntime supervisor trước `makeWASocket`**
   - Runtime phải là long-lived loop giữ socket sống, không chỉ request/response `runOnce`.
   - `runOnce` hiện có có thể giữ làm control-plane/test hook nếu hợp lý, nhưng production socket lifecycle thuộc supervisor.
   - Supervisor hỗ trợ start/stop session, drain signal định kỳ, failure-safe shutdown, và state machine:
     `CREATED → STARTING → QR_REQUIRED → PAIRING → CONNECTED → RECONNECTING → DISCONNECTED → LOGGED_OUT → DESTROYED`.
   - Slice này chốt **single-instance ownership** có chủ đích: một provider-runtime process sở hữu một active socket/session tại một thời điểm. Không distributed lease; deploy nhiều provider-runtime process cho cùng instance là unsupported và phải fail fast bằng guard.

4. **Sau đó mới implement RealBaileysSocketProvider**
   - `getSocket(request, context)` → tạo/khôi phục `WASocket` bằng `makeWASocket` + `AuthStateStore`.
   - Subscribe:
     - `connection.update` → QR (`qr`) và trạng thái `open`/`close` → safe `TranslatedProviderSignal` (kind `connection`/`auth`).
     - `messages.update` / receipt → signal `message_status`.
     - inbound messages → signal `inbound_message` tối thiểu.
     - provider failures/disconnect reasons → signal `failure` hoặc state transition safe.
   - **Sanitize lỗi** Baileys → ném `BaileysProviderError` hoặc emit safe failure signal để adapter/ingress map sang `ApplicationPortFailure`/EventLog.
   - Wire `BaileysOutboundMessageResolver` trong provider runtime: resolver đọc `outboundIntentRef` từ intent store, validate/redact, rồi trả `{ jid, content }` cho `BaileysSocketGateway.sendOutboundMessage`.

### AuthStateStore requirements

- Read/write theo `sessionId`, không theo process global.
- Store operation là provider infrastructure concern; domain/application không biết Baileys auth state.
- `SecretProvider` chỉ dùng cho secret/config/key material nếu cần, không dùng làm mutable auth-state repository.
- In-memory fake dùng cho tests; durable-json dùng local/dev; production encryption được ghi là follow-up nếu chưa có.
- Không log raw auth state, không đưa vào API response, EventLog public payload, audit public evidence, hoặc snapshot test.

### SignalIngress requirements

- Input duy nhất là `TranslatedProviderSignal` đã sanitize.
- Mapping tối thiểu:
  - `auth`: QR required / pairing required / authenticated safe event.
  - `connection`: connected / disconnected / logged out / reconnecting.
  - `message_status`: sent/delivered/read/failure observation.
  - `inbound_message`: safe inbound observation; chưa cần full chat/contact sync.
  - `failure`: provider failure with safe `failureCategory`.
- Idempotency dựa trên deterministic `occurrenceRef`; nếu signal đã ingest thì return existing/skip.
- QR lifecycle là async qua SignalIngress/SSE/EventLog, không mô hình request/response blocking.

### ProviderRuntime supervisor requirements

- Long-lived loop có `startSession`, `stopSession`, `tick/drain`, `shutdown`.
- Supervisor chỉ giữ lifecycle/runtime state và gọi ports; không chứa business rules.
- State machine tối thiểu:
  - `CREATED`: session runtime được đăng ký nhưng chưa start.
  - `STARTING`: đang tạo socket/auth state.
  - `QR_REQUIRED`: provider yêu cầu QR.
  - `PAIRING`: QR/pairing đang được user xử lý.
  - `CONNECTED`: socket usable.
  - `RECONNECTING`: transient disconnect đang retry.
  - `DISCONNECTED`: socket đóng nhưng session chưa logged out.
  - `LOGGED_OUT`: provider báo logout/revoked, cần operator action.
  - `DESTROYED`: terminal runtime cleanup.
- Single-instance ownership guard:
  - Một `instanceId/sessionId` chỉ có một active socket owner trong process.
  - Slice này không có distributed lease; production multi-node phải chặn hoặc thêm ADR/commit riêng trước khi scale provider-runtime ngang.

**Ràng buộc:**
- Chỉ file trong package `infrastructure-provider-baileys` được `import` Baileys (arch rule `baileys-contained-in-provider-adapter`). Giữ nguyên: adapter chỉ import **type**; implementation mới import runtime `@whiskeysockets/baileys` — **được phép** vì ở đúng package.
- **Fake cho test:** cung cấp `BaileysSocketProvider` fake (hoặc fake `WASocket`) trong test, KHÔNG cần WhatsApp thật. Fake nằm ở tầng socket, adapter/handler không biết.
- Resolver không log raw text/JID. Test phải assert log/metadata chỉ chứa safe refs/redacted values.

---

## 10. API composition cần wire

**File:** `apps/api/src/runtime-composition.ts`.

- Build repository-set (giữ profile in-memory/durable-json/postgresql hiện có) nhưng **inject thêm** vào `createApplicationDispatcher`: `messageRepository`, `sessionRepository`, `guardrailDecisionRepository`, `webhookSubscriptionRepository`, `webhookDeliveryRepository` (từ repo set), `OutboundMessageIntentStorePort`, `queueProvider` (`InMemoryQueueProvider`), `eventLog` (durable-json event log store — đã có `createDurableJsonEventLogStore`).
- Đăng ký handler: `CreateInstance` (đã có), `ConnectInstance`, `StartQrPairing`, `ConfirmSessionActivated`, `SendTextMessage`, `ScheduleWebhookDelivery`.
- `MessagingProviderPort` cho API: API **không gọi provider trực tiếp để send** (send đi qua queue → worker). Với connect/qr, API chỉ gửi command/control-plane request; QR/connected state đi async qua ProviderRuntime supervisor + SignalIngress + EventLog/SSE. API runtime không được sở hữu long-lived socket.
- Giữ `assertRuntimeProfileIsComposable` (production vẫn throw đến khi đủ adapter).

**File:** `apps/api/src/index.ts` — không đổi logic, chỉ dùng composition mới.

---

## 11. Worker/queue/webhook work cần implement

**Worker (`apps/worker`):**
- `worker-application-handlers.ts` — thêm `WorkerJobHandler` cho `workType = "outbound_message"`: reserve → gọi dispatcher `ProcessOutboundMessageWork` với `jobId`/message ref → map outcome (completed/retry/dead) theo cơ chế hiện có.
- `runtime-composition.ts` — inject `MessagingProviderPort` (thật hoặc fake) + `messageRepository` + `instanceRepository` + `sessionRepository` + `OutboundMessageIntentStorePort` + `eventLog` vào dispatcher; đăng ký `ProcessOutboundMessageWork`, `ApplyProviderMessageStatus`, `ScheduleWebhookDelivery` handler.
- `ProcessOutboundMessageWork` phải resolve active session trước khi gọi provider. Missing/inactive/stale session → return retryable hoặc failed safe outcome theo trạng thái Message, không gọi `provider.sendOutboundMessage`.

**Provider Runtime (`apps/provider-runtime`):**
- Supervisor giữ socket sống và drain signals; `runOnce` nếu giữ lại chỉ là control-plane/test hook, không thay thế long-lived loop.
- Supervisor gọi `SignalIngress` để chuyển safe provider signals vào EventLog/domain workflow.
- Single-instance ownership guard phải chặn dual socket cho cùng `instanceId/sessionId` trong slice này.

**Queue:** giữ `InMemoryQueueProvider` (không sửa). Chỉ thêm **producer** (handler `SendTextMessage` gọi `enqueue`).

**Webhook (`apps/webhook-dispatcher`):**
- Thêm `WebhookDeliveryEnvelopeResolver` adapter: đọc `WebhookDelivery` từ repo theo reservation.jobId → build `WebhookDeliveryEnvelope` (payload là public event, đã redact).
- `runtime-composition.ts` — wire resolver + `WebhookTransportPort` (fake HTTP transport ở test) vào `WebhookDispatcherRuntime` + `WebhookTransportDeliveryHandler` (đã có).

---

## 12. Persistence requirement

- **Slice 01 dùng in-memory (test) và durable-json (local)** cho tất cả repo — đã đủ để chạy thật end-to-end.
- `OutboundMessageIntentStore` dùng in-memory cho test và durable-json/local encrypted-or-redacted storage cho local. Retention ngắn, keyed bằng `outboundIntentRef`; không ghi raw `to/text` vào EventLog, logs, metrics, DTO hoặc Domain aggregate.
- `AuthStateStore` dùng in-memory cho test và durable-json cho local/dev; keyed theo `sessionId`; record có `revision`, `updatedAtEpochMilliseconds`, `checksum`; `dataClassification=secret`; không được expose raw auth state qua public DTO/log/EventLog.
- Production encryption cho auth state là follow-up bắt buộc trước public production nếu slice này chỉ hoàn tất durable-json plaintext/redacted-at-boundary.
- **Postgres**: giữ nguyên phạm vi hiện tại (chỉ `Instance`, `WorkerJob`). **KHÔNG** bắt buộc thêm bảng Message/Session/Webhook trong slice này (đưa vào slice sau). Nếu chạy profile `postgresql`, message/session/webhook repos lấy từ in-memory projection (như pattern `localProjectionRepositories` hiện có) — chấp nhận cho slice.
- EventLog dùng `createDurableJsonEventLogStore` (đã có) cho local; in-memory cho test.
- **Không** migration mới bắt buộc. Nếu thêm, phải qua migration review gate (§17).

---

## 13. Tests cần thêm

> Tất cả test dùng fake ports + deterministic Clock/UUID (`@omniwa/testing`, `@omniwa/shared`). KHÔNG cần WhatsApp/Postgres/Redis thật.

**Domain (nếu cần):**
- `packages/domain/src/session/session.spec.ts` — bổ sung edge activate/expire (nếu chưa đủ).

**Application (handler unit):**
- `services/handlers/send-text-message.handler.spec.ts` — accepted, `enqueue(outbound_message)` được gọi, `MessageQueued` publish, guardrail-missing → reject, duplicate `SendTextMessage` cùng idempotency key **không double enqueue**, accepted chỉ trả sau khi Message save + queue enqueue thành công.
- `services/outbound-message-intent-store.spec.ts` hoặc adapter spec tương đương — store/resolve `outboundIntentRef`, bind `messageId`, không expose raw `to/text` qua Domain/Application outcome.
- `services/handlers/connect-instance.handler.spec.ts`
- `services/handlers/start-qr-pairing.handler.spec.ts`
- `services/handlers/confirm-session-activated.handler.spec.ts`
- `services/active-session-resolver.spec.ts` — active session resolved, missing/inactive/stale session fail closed.
- `services/handlers/dispatch-outbound-message.handler.spec.ts` — provider.send gọi khi session active, `markMessageSent`→`markMessageDelivered`, retry/dead mapping, missing/inactive/stale session **không gọi provider**.
- `services/handlers/schedule-webhook-delivery.handler.spec.ts`
- `services/application-dispatcher.spec.ts` — **sửa**: registry lookup đúng handler; command không đăng ký vẫn `not_implemented`.
- `services/domain-event-publisher.spec.ts` — append đúng số event vào EventLog, publish only-new-events, không publish trùng khi cùng aggregate được save/publish lại.
- `services/provider-signal-ingress.spec.ts` hoặc adapter test tương đương — ingest `TranslatedProviderSignal` idempotent, deterministic `occurrenceRef`, map `auth`/`connection`/`message_status`/`inbound_message`/`failure` sang EventLog/domain workflow safe.
- SignalIngress test phải assert QR signal đi qua ingress, connected/disconnected đi qua ingress, message_status/inbound_message đi qua ingress, và duplicate signal không tạo duplicate EventLog/domain event.

**Provider:**
- `packages/infrastructure-provider-baileys/src/baileys-socket-provider.spec.ts` — với fake socket: QR emit, open→connected, receipt→message_status signal; error→BaileysProviderError.
- `packages/infrastructure-provider-baileys/src/baileys-auth-state-store.spec.ts` — save/load/update auth state theo `sessionId`, tăng revision/update timestamp/checksum, missing state safe, durable-json adapter không expose raw public DTO.
- `packages/infrastructure-provider-baileys/src/baileys-outbound-message-resolver.spec.ts` — resolve `outboundIntentRef` thành `{ jid, content }`, missing intent fail safe, log/metadata không chứa raw text/JID.
- `packages/infrastructure-provider-baileys/src/baileys-signal-mapper.spec.ts` — mapping QR/connection/disconnect reason/message status/inbound/failure thành `TranslatedProviderSignal` safe, không leak provider payload.

**Worker:**
- `apps/worker/src/worker-application-handlers.spec.ts` — **sửa**: outbound_message handler → dispatcher gọi đúng.
- `apps/worker/src/message-dispatch.worker.spec.ts` — **mới**: enqueue → runOnce → message sent/delivered → `webhook_delivery` được enqueue.

**Provider Runtime:**
- `apps/provider-runtime/src/provider-runtime-supervisor.spec.ts` — state transitions `CREATED → STARTING → QR_REQUIRED → PAIRING → CONNECTED → RECONNECTING → DISCONNECTED → LOGGED_OUT → DESTROYED`.
- `apps/provider-runtime/src/provider-runtime-supervisor.spec.ts` — ownership single-instance guard: không cho 2 active socket owner cùng `instanceId/sessionId`.
- `apps/provider-runtime/src/provider-runtime-supervisor.spec.ts` — drain signals vào `SignalIngress`, stop/shutdown cleanup, no raw payload leakage.

**API / Integration (1 bài E2E-lite):**
- `apps/api/src/vertical-slice-01.integration.spec.ts` — **mới**: create instance → qr/refresh → confirm session → messages/text → worker.runOnce → webhook-dispatcher.dispatchNext → assert EventLog chứa `InstanceCreated`, `InstanceQrRequired`, `InstanceConnected`, `MessageQueued`, `MessageDelivered`, `WebhookDeliveryScheduled`, `WebhookDeliverySucceeded`. Dùng in-memory repos + fake Baileys socket + fake webhook transport.
- Integration test cũng phải assert duplicate send cùng `idempotency-key` không tạo thêm WorkerJob, và EventLog không có duplicate `MessageQueued`/`MessageDelivered`.

**Regression:** cập nhật `package.json` script `regression:check` nếu thêm spec mới cần vào danh sách (chỉ thêm, không xóa).

---

## 14. Commit plan nhỏ theo thứ tự

> Mỗi commit phải giữ **toàn bộ `pnpm check` xanh** (hoặc tối thiểu lint+typecheck+test+arch). Commit message kết thúc bằng dòng `Co-Authored-By`.

| # | Commit | File chính | Test chạy sau commit |
|---|---|---|---|
| 1 | `refactor(application): dispatcher dùng handler registry (giữ 3 handler cũ)` | `application-dispatcher.ts`, `services/handlers/command-handler.ts` | `pnpm exec vitest run packages/application` + `pnpm arch:check` |
| 2 | `feat(application): outbound intent store` | `ports/outbound-message-intent-store.ts`, in-memory/durable-json adapter nếu đã có boundary phù hợp | `pnpm exec vitest run packages/application packages/infrastructure-persistence` |
| 3 | `feat(application): active session resolver` | `services/active-session-resolver.ts` (+spec) | `pnpm exec vitest run packages/application packages/infrastructure-persistence` |
| 4 | `feat(application): guardrail minimum + domain event publish policy` | `minimal-message-guardrail`, `domain-event-publisher`, tests publish only-new-events | `pnpm exec vitest run packages/domain packages/application packages/infrastructure-persistence` |
| 5 | `feat(application): SendTextMessage handler enqueue outbound_message` | `send-text-message.handler.ts` (+spec), guardrail decision repo usage, message↔intent binding | `pnpm exec vitest run packages/application/src/services/handlers/send-text-message.handler.spec.ts` |
| 6 | `feat(api): wire send text intent storage` | `interface-api`, `apps/api` runtime composition tối thiểu | `pnpm exec vitest run packages/interface-api packages/application apps/api` |
| 7 | `feat(worker): process outbound_message jobs` | `ProcessOutboundMessageWork`, worker handler, provider fake | `pnpm exec vitest run packages/application apps/worker` |
| 8 | `feat(worker): persist outbound job metadata` | WorkerJob metadata/recovery path, no raw payload | `pnpm exec vitest run packages/application packages/infrastructure-queue packages/infrastructure-persistence apps/worker` |
| 9 | `test(provider-baileys): socket-provider contract and fake socket` | fake socket provider/test fixture + adapter tests | `pnpm exec vitest run packages/infrastructure-provider-baileys packages/application` + `pnpm arch:check` |
| 10 | `feat(provider-baileys): AuthStateStore port and adapters` | `baileys-auth-state-store.ts`, fake/in-memory/durable-json, revision/updatedAt/checksum | `pnpm exec vitest run packages/infrastructure-provider-baileys` + `pnpm arch:check` |
| 11 | `feat(provider-runtime): SignalIngress consumer and signal event mapping` | `SignalIngress`, signal→EventLog/domain mapping, deterministic `occurrenceRef` idempotency | `pnpm exec vitest run apps/provider-runtime packages/application packages/infrastructure-persistence` + `pnpm arch:check` |
| 12 | `feat(provider-runtime): supervisor loop and single-instance ownership` | ProviderRuntime supervisor/loop, lifecycle state machine, ownership guard, keep `runOnce` as control-plane/test hook | `pnpm exec vitest run apps/provider-runtime` + `pnpm arch:check` |
| 13 | `feat(provider-baileys): RealBaileysSocketProvider using makeWASocket` | `baileys-socket-provider.ts`, `makeWASocket`, AuthStateStore integration, safe error mapping | `pnpm exec vitest run packages/infrastructure-provider-baileys apps/provider-runtime` + `pnpm arch:check` |
| 14 | `feat(provider-runtime): reconnect supervisor and DisconnectReason mapping` | reconnect policy, `DisconnectReason` → safe state/failure mapping, no dual socket | `pnpm exec vitest run packages/infrastructure-provider-baileys apps/provider-runtime` |
| 15 | `feat(provider-runtime): async QR lifecycle through SignalIngress` | QR signal emission/drain/ingress/EventLog/SSE path, no request/response QR blocking | `pnpm exec vitest run apps/provider-runtime apps/api packages/infrastructure-provider-baileys` |
| 16 | `feat(provider-baileys): inbound message signal mapping` | inbound provider event → safe `TranslatedProviderSignal(kind=inbound_message)` → SignalIngress | `pnpm exec vitest run packages/infrastructure-provider-baileys apps/provider-runtime` |
| 17 | `feat(provider-baileys): receipt and message status signal mapping` | receipt/messages.update → `message_status` signal → message status workflow/EventLog | `pnpm exec vitest run packages/infrastructure-provider-baileys apps/provider-runtime packages/application` |
| 18 | `feat(provider-runtime): composition root thật thay stub index.ts` | `apps/provider-runtime/src/runtime-composition.ts`, `index.ts`, wire resolver + auth store + signal ingress + supervisor | `pnpm exec vitest run apps/provider-runtime` |
| 19 | `feat(webhook): envelope resolver adapter + wire dispatcher` | `webhook-envelope-resolver.ts`, `apps/webhook-dispatcher/src/runtime-composition.ts` | `pnpm exec vitest run apps/webhook-dispatcher packages/infrastructure-webhook` |
| 20 | `feat(api): wire provider control-plane + queue + repos + eventlog` | `apps/api/src/runtime-composition.ts`, interface input store wiring, async provider control-plane | `pnpm exec vitest run apps/api` |
| 21 | `test(api): integration slice create→qr→connect→send→receipt→webhook` | `vertical-slice-01.integration.spec.ts` | `pnpm exec vitest run apps/api/src/vertical-slice-01.integration.spec.ts` |
| 22 | `chore(persistence): tách repository-set builder dùng chung api/worker` (dọn trùng lặp) | `infrastructure-persistence` helper, `apps/api` + `apps/worker` composition | `pnpm check` |

**Lệnh kiểm tra tổng cuối slice:** `pnpm check` (lint + typecheck + test + arch + openapi + client-contract + sdk + regression + production + release).

> **Quan trọng:** Commit #1 (registry) phải làm **trước** mọi handler. Nếu thêm handler vào switch trước rồi mới refactor sẽ phải sửa lại toàn bộ và tăng risk God Object.

---

## 15. Definition of Done

- [ ] `pnpm check` xanh toàn bộ (lint, typecheck, test, arch, openapi, client-contract, sdk, regression, production, release).
- [ ] `pnpm arch:check` xanh — boundary không bị phá (270+ file).
- [ ] Integration slice test chạy trọn 6 bước và assert đủ chuỗi domain event trong EventLog.
- [ ] Không có `import` Baileys ngoài package `infrastructure-provider-baileys`.
- [ ] Không có business logic mới trong `apps/*` (app chỉ compose + loop).
- [ ] Dispatcher là registry, không phải switch phình to; command chưa hỗ trợ vẫn trả `application_handler_not_implemented`.
- [ ] `SendTextMessage` trả `accepted` **chỉ sau khi** outbound intent đã store, guardrail đã pass, Message đã save, message↔intent đã bind, WorkerJob đã enqueue (durable-before-accept).
- [ ] Worker không gọi provider nếu không resolve được active session hoặc outbound intent.
- [ ] Raw `to/text` không xuất hiện trong Domain aggregate, EventLog payload, log, metric, API response, audit evidence hoặc test snapshots.
- [ ] Domain event publisher publish only-new-events/idempotent; save/publish aggregate lại không tạo duplicate platform events.
- [ ] Provider adapter vẫn chỉ nhận socket qua injection; fake socket chạy được toàn bộ test không cần WhatsApp thật.
- [ ] `AuthStateStore` read/write theo `sessionId`, có revision/updatedAt/checksum, không dùng `SecretProvider` làm mutable auth-state repository.
- [ ] `SignalIngress` ingest `TranslatedProviderSignal` idempotent theo deterministic `occurrenceRef`; QR/connection/message_status/inbound/failure đều đi qua ingress, không qua request/response blocking.
- [ ] ProviderRuntime supervisor là long-lived loop, có state machine tối thiểu và single-instance ownership guard; API runtime không sở hữu long-lived socket.
- [ ] Không sửa `dist/`, `node_modules/`, `target/`, file generated.
- [ ] Provider-runtime chạy được `node` entrypoint thật (không còn stub JSON).

---

## 16. Risk & mitigation

| Risk | Mức | Mitigation |
|---|---|---|
| Dispatcher phình thành **God Object** | Cao | Commit #1 chuyển registry trước; mỗi handler 1 file, chỉ inject dependency cần thiết |
| **Event propagation** vẫn hở nếu handler quên publish | Cao | `DomainEventPublisher` tập trung; integration test assert đủ event trong EventLog |
| Duplicate domain event publish do aggregate giữ lại `domainEvents` | Cao | Publisher nhận only-new-events hoặc deterministic event id + EventLog idempotency; test save/publish lại không duplicate |
| Raw message payload leakage/retention (`to/text`) | Cao | `OutboundMessageIntentStore` opaque ref, retention ngắn, redaction; tests assert raw text/JID không xuất hiện trong Domain/EventLog/log/response |
| Provider send không có content resolver | Cao | Wire `BaileysOutboundMessageResolver` trong provider-runtime; missing intent fail safe trước `socket.sendMessage` |
| Active session race/stale session khi worker gửi | Cao | `ActiveSessionResolver` load current session ngay trước provider call; missing/inactive/stale session không gọi provider và trả retry/fail safe |
| Idempotent duplicate send tạo nhiều Message/WorkerJob | Cao | Idempotency lookup trước tạo Message; queue idempotency key stable; integration test duplicate send không double enqueue |
| Mất session nếu auth state không persist đúng | Cao | Commit #10 tạo `AuthStateStore` read/write theo `sessionId`, durable-json local/dev, tests revision/checksum/load-after-restart |
| Dual socket cho cùng instance/session gây `connectionReplaced` hoặc ban risk | Cao | Commit #12 single-instance ownership guard; chỉ một active owner/socket per `instanceId/sessionId`; distributed lease là follow-up trước horizontal scale |
| Signal mất nếu không có ingress loop | Cao | Commit #11 + #12 SignalIngress + supervisor drain loop; tests QR/connection/status/inbound/failure đi qua ingress |
| Duplicate event nếu `occurrenceRef` không deterministic | Cao | Signal mapper tạo deterministic occurrenceRef; SignalIngress/EventLog idempotency skip duplicate; tests ingest lại cùng signal |
| QR async không phù hợp request/response | Trung bình | QR đi qua provider signal → SignalIngress → EventLog/SSE; API chỉ trigger/control-plane và đọc event/status |
| Production encryption for auth state chưa xong | Trung bình | Durable-json local/dev được phép; public production phải có encrypted AuthStateStore hoặc SecretProvider-backed encryption key trước release gate |
| API runtime sở hữu provider socket lâu dài có thể phá provider-runtime boundary | Trung bình | API không sở hữu socket; connect/qr chuyển sang provider-runtime control-plane + SignalIngress; test đảm bảo socket lifecycle thuộc supervisor |
| Ownership guard in-memory không đảm bảo single-owner đa-process | Trung bình | Đây là quyết định có chủ đích của slice; deploy nhiều provider-runtime process cho cùng instance unsupported, fail-fast; distributed lease là phase sau |
| UoW không atomic đa-aggregate (save Message + enqueue) | Trung bình | Thứ tự: save trước, enqueue sau, publish cuối; idempotency key ở queue chống double-enqueue |
| Baileys `7.0.0-rc13` API đổi | Thấp | Cô lập trong `baileys-socket-provider.ts`; test bằng fake socket |
| Thêm spec nhưng quên vào `regression:check` | Thấp | Commit tương ứng cập nhật `package.json` (chỉ thêm) |
| Postgres profile thiếu repo Message/Session | Thấp | Slice dùng in-memory projection cho các repo đó; Postgres đầy đủ ở slice sau |

---

## 17. Không được phá Clean Architecture boundary

Ràng buộc enforced bởi `tooling/architecture/check-boundaries.mjs` (chạy trong `pnpm arch:check` / `pnpm check`):

- `packages/shared` **không** import gói `@omniwa/*` nào.
- `packages/domain` **không** import application/interface/infrastructure/baileys. Handler mới **không** đặt trong domain.
- `packages/application` **chỉ** dùng **ports**, **không** import adapter cụ thể, **không** import `@whiskeysockets/baileys`. Các handler mới nằm ở đây và chỉ nhận **port** qua constructor.
- `packages/application` chỉ được truyền `outboundIntentRef`/safe refs cho outbound payload; không giữ raw `to/text`, không tạo Baileys `AnyMessageContent`, không biết JID provider-native.
- `packages/application` chỉ consume `TranslatedProviderSignal` đã sanitize; không biết Baileys native event, raw QR, raw JID/message body, hoặc auth state material.
- `packages/interface-api` **không** bypass Application (không import domain/infra trực tiếp).
- **Chỉ** `packages/infrastructure-provider-baileys` được import Baileys — `BaileysSocketProvider` thật đặt đúng ở đây.
- `AuthStateStore` là provider infrastructure concern; Domain/Application không import hoặc persist Baileys auth state.
- `BaileysOutboundMessageResolver` là nơi duy nhất dịch outbound intent thành `{ jid, content }`; resolver phải redact logs và không leak payload ra EventLog/API response.
- `SignalIngress` không đưa raw `to/text`/JID/provider payload/auth state vào public DTO, log, audit public evidence hoặc EventLog public payload.
- `apps/*` **chỉ compose/runtime** (khởi tạo adapter + wire dependency + chạy loop/supervisor). **Không** đặt quyết định nghiệp vụ trong app — nếu thấy `if` nghiệp vụ trong `apps/`, phải chuyển vào handler application hoặc domain.
- `packages/testing` chỉ dùng trong test.
- **Không** sửa file generated (OpenAPI generated, Rust operations generated, `dist`, `*.d.ts`), `node_modules`, `target`. Nếu đổi API surface phải qua `openapi:check` + `openapi:compat` + `client-contract:check` + `sdk:check` (slice 01 **không** đổi API surface — mọi route đã tồn tại trong OpenAPI).

**Quy tắc vàng:** implement từ contract Domain/Application, không từ tiện lợi của DB hay provider. Giữ payload provider-native sau adapter. Giữ query side-effect free.

---

*Hết kế hoạch Vertical Slice 01.*
