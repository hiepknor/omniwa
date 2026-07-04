# Vertical Slice 01 Completion Report

## 1. Executive summary

Vertical Slice 01 (VS01) has been completed as a local-only, single-process proof of the core outbound messaging path.

The slice proves that OmniWA can accept a safe outbound text intent, apply minimal guardrails, create and queue a message, process the worker job, send through the provider abstraction, and record safe provider/domain events in the EventLog without leaking raw QR, JID, message text, or auth state through the tested public/runtime surfaces.

This is not yet a WhatsApp live production milestone. The local demo currently uses `FakeBaileysSocketProvider`. `RealBaileysSocketProvider` exists and is wired behind the provider package boundary, but a real WhatsApp live demo has not been proven yet.

## 2. Scope completed

- Application dispatcher now uses a handler registry while preserving old command/query behavior.
- Outbound intent storage exists and keeps raw recipient/text out of Domain aggregates.
- Active session resolution exists before provider dispatch.
- Minimal message guardrail and domain event publishing foundations exist.
- `SendTextMessage` creates safe outbound work and enqueues `outbound_message`.
- API/interface path validates `to/text` and converts it into safe outbound intent references.
- Worker can process outbound message jobs.
- Worker job metadata persists safe references required for recovery.
- Baileys socket provider contract/fake exists.
- Baileys auth state store exists with in-memory and durable JSON adapters.
- Provider SignalIngress maps safe translated provider signals into EventLog.
- Provider runtime supervisor exists as a long-lived lifecycle/drain loop.
- Real Baileys socket provider exists behind `packages/infrastructure-provider-baileys`.
- QR lifecycle is async through SignalIngress/EventLog.
- Inbound message and message status provider signal mapping exist.
- Provider-runtime composition root exists and replaces the old stub entrypoint.
- Worker runtime can use Baileys messaging provider in local demo mode.
- Local VS01 orchestrator exists in `apps/background` for single-process demo composition.

## 3. Commit timeline

| Commit # | Git commit | Summary                                                             |
| -------: | ---------- | ------------------------------------------------------------------- |
|        1 | `36e0509`  | `refactor(application): dispatch through handler registry`          |
|        2 | `2d2864c`  | `feat(application): add outbound intent store foundation`           |
|        3 | `ddb6f24`  | `feat(application): add active session resolver`                    |
|        4 | `0281f73`  | `feat(application): add guardrail and event publishing foundations` |
|        5 | `e4e950f`  | `feat(application): implement send text message handler`            |
|        6 | `1817cdd`  | `feat(api): wire send text intent storage`                          |
|        7 | `f7d7ee3`  | `feat(worker): process outbound message jobs`                       |
|        8 | `ebe7b68`  | `feat(worker): persist outbound job metadata`                       |
|        9 | `d66cb3e`  | `test(provider-baileys): add socket provider contract fake`         |
|       10 | `4c36652`  | `feat(provider-baileys): add auth state store`                      |
|       11 | `079ed42`  | `feat(application): add provider signal ingress`                    |
|       12 | `7691239`  | `feat(provider-runtime): add supervisor loop`                       |
|       13 | `621d6b9`  | `feat(provider-baileys): add real socket provider`                  |
|       14 | `fa51fa5`  | `feat(provider-runtime): map disconnect decisions`                  |
|       15 | `527608c`  | `feat(provider-runtime): async QR lifecycle through SignalIngress`  |
|       16 | `7f7850e`  | `feat(provider-baileys): map inbound message signals`               |
|       17 | `68e210b`  | `feat(provider-baileys): map message status signals`                |
|       18 | `ed7e5b7`  | `feat(provider-runtime): wire runtime composition root`             |
|       19 | `0d7b2dd`  | `feat(worker): wire baileys messaging provider`                     |
|       20 | `e37eb00`  | `feat(background): add local vertical slice demo`                   |

Supporting commits during the slice:

- `51d56a9` fixed an unrelated application test lint issue.
- `d3caeb9` updated the VS01 plan after provider runtime architecture review.

## 4. Flow proven

The local orchestrator proves the following flow:

```text
Create Instance / prepare active session
  -> ProviderRuntimeSupervisor receives QR + connected signals
  -> SignalIngress writes safe provider events to EventLog
  -> SendTextMessage stores outbound intent and queues outbound_message work
  -> Worker reserves outbound_message job
  -> Worker dispatches ProcessOutboundMessageWork
  -> BaileysMessagingProviderAdapter resolves outboundIntentRef
  -> FakeBaileysSocketProvider fake socket sends message
  -> Message is marked sent
  -> EventLog contains safe domain/provider events
```

The tested local demo confirms:

- QR and connected events are visible in EventLog.
- `SendTextMessage` enqueues work before worker dispatch.
- Worker dispatch uses a shared fake socket and marks the message `sent`.
- EventLog does not expose raw QR/JID/text/auth state in the tested surfaces.
- Durable EventLog and auth state can be reloaded after local restart.

## 5. Architecture boundaries

VS01 preserves the intended architecture boundaries:

- Domain has no Baileys dependency.
- Application uses ports and handlers, not provider implementation details.
- API/interface validates input and passes safe references to Application.
- Worker invokes Application commands and provider ports, not raw Baileys.
- Provider runtime owns socket lifecycle through `ProviderRuntimeSupervisor`.
- Baileys imports remain contained in `packages/infrastructure-provider-baileys`.
- Apps are composition/runtime layers. The new local demo is explicitly local-only orchestration.

## 6. Runtime behavior current state

- API runtime can receive public `SendTextMessage` input and convert raw `to/text` into safe outbound intent references.
- Worker runtime can process `outbound_message` jobs.
- Provider runtime has a real composition root and drain loop.
- `RealBaileysSocketProvider` exists and uses `makeWASocket` behind the provider package.
- Local demo composition shares queue/store/EventLog/socket provider in one process.
- Worker/provider-runtime multi-process mode does not yet have IPC or shared socket bridge.
- EventLog has safe QR, connected, inbound, and status events.

## 7. Test/check status

Latest full gate status:

- `pnpm check` pass.
- Test count: 102 test files, 503 passed, 1 skipped.
- `pnpm arch:check` pass.
- `pnpm typecheck` pass.
- `pnpm lint` pass.
- OpenAPI check pass.
- OpenAPI compatibility check pass.
- Client contract check pass.
- Rust SDK check/test pass.
- Regression gate pass.
- Production cut gate pass.
- Release readiness check pass.

## 8. Local demo instructions

The local demo composition is available from:

- `apps/background/src/local-vertical-slice-demo.ts`

Intended usage is programmatic/test-driven for now:

```ts
import { createLocalVerticalSliceDemoComposition } from "@omniwa/app-background";

const demo = createLocalVerticalSliceDemoComposition({
  stateDirectory: ".omniwa-local/vertical-slice-01",
});

const result = await demo.runVerticalSlice({
  runRef: "manual-demo-1",
  recipientRef: "12025550188@s.whatsapp.net",
  text: "hello",
});

demo.shutdown();
```

Current local demo behavior:

- Uses `FakeBaileysSocketProvider`.
- Uses durable JSON state directory for local state.
- Uses durable EventLog.
- Uses durable outbound intent store.
- Uses in-process queue/worker/provider supervisor wiring.
- Does not require a real WhatsApp connection.

## 9. Fake/local-only parts

- Local demo uses `FakeBaileysSocketProvider`.
- Fake socket send proves wiring but not real WhatsApp delivery.
- Worker and provider-runtime share socket provider only in single-process local demo mode.
- Multi-process worker/provider-runtime socket sharing is not implemented.
- Durable JSON is local/dev storage, not production-grade persistence.
- Auth state durable JSON is not encrypted for production.
- Ownership guard is local/in-memory and not a distributed lease.

## 10. Production blockers

- WhatsApp live demo has not been proven with `RealBaileysSocketProvider`.
- Multi-process worker/provider-runtime lacks IPC/shared socket bridge.
- Auth state durable-json needs production encryption.
- Production needs distributed ownership/lease for provider socket ownership.
- Production needs hardened persistence/queue/runtime topology beyond local JSON/in-memory wiring.
- Production needs operational validation for reconnect, QR pairing, session recovery, and provider failure behavior against real WhatsApp.

## 11. Remaining risks

- Real Baileys API behavior may differ from mocks/fakes under live WhatsApp network conditions.
- Dual provider-runtime processes for the same instance can still be unsafe until distributed ownership exists.
- Auth state loss or corruption remains high impact until encrypted, durable production storage is implemented.
- Event delivery is safe and idempotent in tests, but production replay/retention policy still needs operational validation.
- Worker retry/dead-letter behavior is tested locally but not yet validated under a distributed queue.
- QR lifecycle is async and safe, but real operator UX for QR retrieval/refresh still needs live validation.

## 12. Recommended next milestone

Recommended next milestone: **VS02 - Real WhatsApp Local Live Demo**.

Suggested goals:

- Run `RealBaileysSocketProvider` in local mode with real QR pairing.
- Confirm auth state survives local restart.
- Confirm connected session can send a real text message.
- Confirm real provider `connection.update`, inbound message, and receipt/status signals reach EventLog safely.
- Add a minimal operator command or script for local live demo startup.
- Keep this local-only until IPC/shared socket bridge and encrypted auth state are implemented.

After VS02, the next milestone should be **VS03 - Multi-process Provider/Worker Bridge**, covering IPC/shared socket access, distributed ownership, and production-safe process boundaries.

## 13. Definition of Done status

| DoD item                                                         | Status                 | Notes                                                                           |
| ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `pnpm check` green                                               | Achieved               | 102 test files, 503 passed, 1 skipped                                           |
| `pnpm arch:check` green                                          | Achieved               | Baileys import containment verified                                             |
| Integration slice test proves end-to-end local flow              | Achieved               | Local single-process orchestrator proves flow with fake socket                  |
| No Baileys import outside provider adapter package               | Achieved               | `@whiskeysockets/baileys` remains in `packages/infrastructure-provider-baileys` |
| Dispatcher registry, no handler switch expansion                 | Achieved               | Registry-based dispatcher implemented                                           |
| `SendTextMessage` durable-before-accept behavior                 | Achieved locally       | Intent, guardrail, message save, queue enqueue, event publish tested            |
| Worker avoids provider call without active session/intent        | Achieved               | Missing/inactive session and missing intent covered                             |
| Raw QR/JID/text/auth state not leaked in test surfaces           | Achieved               | Tests assert no leak in outcomes/EventLog/public runtime reports                |
| Domain event publisher only publishes new events                 | Achieved               | Idempotency/publish-only-new behavior tested                                    |
| Provider adapter receives socket by injection                    | Achieved               | Fake and real provider paths use injected provider/socket abstractions          |
| AuthStateStore has session-scoped revision/checksum durable JSON | Achieved for local/dev | Production encryption remains blocker                                           |
| SignalIngress idempotent safe provider events                    | Achieved               | QR/connection/inbound/status/failure covered                                    |
| ProviderRuntime supervisor long-lived loop exists                | Achieved               | Composition root replaces stub                                                  |
| Real WhatsApp live demo proven                                   | Not achieved           | `RealBaileysSocketProvider` exists, but live demo is pending                    |
| Multi-process worker/provider-runtime bridge                     | Not achieved           | IPC/shared socket bridge is pending                                             |
| Production distributed ownership/lease                           | Not achieved           | Required before horizontal/runtime production                                   |
| Production encrypted auth state                                  | Not achieved           | Required before production use                                                  |

## Final status

VS01 is complete for local architecture and integration proof.

It is not production complete and not yet a real WhatsApp live proof. The next milestone should move from fake local socket proof to a controlled real WhatsApp local live demo while preserving the same architecture boundaries.
