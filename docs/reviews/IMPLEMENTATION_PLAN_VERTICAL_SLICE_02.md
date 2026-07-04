# Implementation Plan - Vertical Slice 02

## 1. Executive summary

Vertical Slice 02 (VS02) proves a **Real WhatsApp Local Live Demo** for OmniWA.

VS02 takes the architecture proven by VS01 and replaces the fake local provider path with a controlled local run using `RealBaileysSocketProvider`. The milestone must prove that a local provider runtime can emit a real QR challenge, the operator can scan the QR, Baileys auth state is persisted to durable JSON, a restart can reuse auth state without a new QR scan, a real text message can be sent, and connection/inbound/status events can be observed safely through EventLog/SSE.

VS02 is **local live demo only**. It is not a production milestone.

## 2. Scope VS02

VS02 scope:

- Start provider-runtime locally with `RealBaileysSocketProvider`.
- Receive a real QR signal from Baileys `connection.update.qr`.
- Expose only safe QR metadata through EventLog/SSE, not raw QR payload in public DTO/log.
- Provide a local operator-safe way to inspect or render the QR for manual scan if needed.
- Scan QR with a real WhatsApp account.
- Persist Baileys auth state to durable JSON.
- Restart local runtime and verify auth state is reused without scanning QR again.
- Send a real text message through the existing `SendTextMessage -> Worker -> MessagingProviderPort` flow.
- Record safe connection, inbound, message status, and failure events into EventLog.
- Confirm EventLog/SSE surfaces do not leak raw QR, JID, text, provider payload, or auth state.
- Keep Baileys imports contained in `packages/infrastructure-provider-baileys`.
- Keep apps as composition/runtime only.

## 3. Out of scope

VS02 explicitly does not include:

- Distributed ownership or distributed lease.
- Production encryption for auth state.
- Multi-process IPC/shared socket bridge unless local demo cannot work without the smallest local-only bridge.
- Production deployment hardening.
- Horizontal scaling.
- Real webhook delivery productionization.
- Full TUI integration.
- WhatsApp Cloud API provider.
- Group management.
- Broadcast/campaign features.
- New public API expansion beyond what is necessary to operate the local demo safely.

## 4. Current VS01 status

VS01 completed the local architecture proof:

- Local demo currently uses `FakeBaileysSocketProvider`.
- `RealBaileysSocketProvider` exists.
- Provider runtime composition root exists.
- Worker can call `BaileysMessagingProviderAdapter` in local demo mode.
- `AuthStateStore` supports durable JSON, revision, updatedAt, checksum, and `dataClassification=secret`.
- SignalIngress maps safe provider signals into EventLog.
- EventLog has QR/connected/inbound/status safe events.
- Tests assert raw QR/JID/text/auth state do not leak through tested surfaces.
- Multi-process worker/provider-runtime has no IPC/shared socket bridge yet.
- Auth state durable JSON is not production encrypted.
- Production still needs distributed ownership/lease.
- Latest reported `pnpm check` status: 102 test files, 503 passed, 1 skipped.

## 5. Real runtime architecture

Target VS02 runtime for local live demo:

```text
Local operator
  -> provider-runtime local process
  -> RealBaileysSocketProvider
  -> DurableJsonBaileysAuthStateStore
  -> SignalIngress
  -> Durable EventLog
  -> API/SSE or local operator read path

Send text:

API/Application or local demo command
  -> SendTextMessage
  -> OutboundMessageIntentStore
  -> Queue
  -> Worker
  -> BaileysMessagingProviderAdapter
  -> shared local provider socket path
  -> WhatsApp network
  -> Provider signals
  -> EventLog/SSE
```

Important architectural constraints:

- Baileys stays only in `packages/infrastructure-provider-baileys`.
- Domain and Application must not import Baileys.
- API must not call provider directly for business operations.
- Apps must only compose runtime dependencies and run loops.
- Raw QR/JID/text/auth state must not appear in public DTO/log/EventLog payload.

## 6. Local live demo flow

Expected manual flow:

1. Configure local state directory.
2. Start provider-runtime local live mode.
3. Start or trigger a session for an instance.
4. Baileys emits QR signal.
5. Operator obtains safe QR display path or local-only QR renderer output.
6. Operator scans QR in WhatsApp.
7. `creds.update` persists auth state through `DurableJsonBaileysAuthStateStore`.
8. Provider emits connected signal.
9. Restart provider-runtime.
10. Runtime reloads auth state and reconnects without QR scan.
11. Send a text message to an explicit test recipient.
12. Worker sends through provider adapter and real socket.
13. Provider emits message status and/or receipt updates.
14. Optional: receive inbound message from test recipient.
15. EventLog/SSE shows safe connection, inbound, message status, and failure events.

## 7. Required config/env

Recommended local env:

```bash
OMNIWA_PROVIDER_RUNTIME_PROFILE=local
OMNIWA_PROVIDER_RUNTIME_STATE_DIR=.omniwa-local/live/provider-runtime
OMNIWA_EVENT_LOG_PATH=.omniwa-local/live/event-log.json
OMNIWA_BAILEYS_AUTH_STATE_PATH=.omniwa-local/live/provider-runtime/baileys-auth-state.json
OMNIWA_PROVIDER_RUNTIME_DRAIN_INTERVAL_MS=1000
OMNIWA_LIVE_DEMO_MODE=1
OMNIWA_LIVE_DEMO_INSTANCE_ID=local_live_instance_1
OMNIWA_LIVE_DEMO_SESSION_ID=local_live_session_1
OMNIWA_LOCAL_QR_OUTPUT=file
OMNIWA_LOCAL_QR_OUTPUT_PATH=.omniwa-local/live/provider-runtime/local-qr.secret.json

OMNIWA_WORKER_RUNTIME_PROFILE=local
OMNIWA_WORKER_PROVIDER_MODE=same-process-local-demo
OMNIWA_WORKER_REPOSITORY_PROFILE=durable-json
OMNIWA_WORKER_REPOSITORY_STATE_DIR=.omniwa-local/live/repositories

OMNIWA_API_RUNTIME_PROFILE=local
OMNIWA_API_REPOSITORY_PROFILE=durable-json
OMNIWA_API_REPOSITORY_STATE_DIR=.omniwa-local/live/repositories
OMNIWA_API_KEY=local-dev-secret-change-me
```

Potential VS02-only env additions:

```bash
OMNIWA_LIVE_DEMO_TEST_RECIPIENT=...
```

Any env value containing secrets must not be echoed in logs.

## 8. Files/modules to change

Likely files/modules:

- `packages/infrastructure-provider-baileys/src/baileys-socket-provider.ts`
  - Verify real auth state shape against Baileys expectations.
  - Verify `creds.update` persistence.
  - Add local-safe QR challenge metadata if current signal is insufficient.

- `packages/infrastructure-provider-baileys/src/baileys-socket-provider.spec.ts`
  - Expand mocked `makeWASocket` tests for auth reload/reconnect and QR update behavior.

- `apps/provider-runtime/src/runtime-composition.ts`
  - Add explicit local live mode guard/config if needed.
  - Make startup surfaces safe and clear.

- `apps/provider-runtime/src/index.ts`
  - If needed, expose local live startup status without secrets.

- `apps/background/src/local-vertical-slice-demo.ts`
  - Add a real-provider local live variant only if same-process demo is needed.

- `apps/background/src/local-vertical-slice-demo.spec.ts`
  - Keep fake/integration tests for deterministic local CI.

- `apps/api/src/realtime-event-stream.ts`
  - Verify EventLog/SSE can expose safe provider events needed by local operator.

- `apps/api/src/http-server.ts`
  - Only if an existing API route is insufficient to start/observe pairing safely.

- `docs or root report`
  - Add manual test checklist evidence if requested after implementation.

## 9. Small commits in order

### Commit 1 - Validate real Baileys auth-state adapter contract

Goal:

- Verify `RealBaileysSocketProvider` can load/save auth state through `DurableJsonBaileysAuthStateStore`.
- Ensure persisted state can be reloaded after restart in mocked Baileys tests.

Expected tests:

- `load` called before socket creation.
- `creds.update` calls `save`.
- Restart/recreate provider loads saved state.
- Auth state result/log/error does not expose raw auth payload.

### Commit 2 - Local live provider runtime mode

Goal:

- Add explicit local live config/readiness path in provider-runtime.
- Fail safe if someone attempts production live runtime without encryption/lease.

Expected tests:

- Local live env composes real provider deps.
- Production still blocked.
- Startup errors do not include env secrets, raw QR, auth state, JID, or provider payload.

### Commit 3 - Safe QR operator path

Goal:

- Ensure QR signal from real provider can be consumed in local demo.
- Provide safe local-only QR operator path.
- Public EventLog/SSE must not expose raw QR.

Expected tests:

- QR signal creates safe EventLog event.
- Local-only QR renderer/output is explicitly marked non-public if added.
- SSE/EventLog public payload contains challenge refs/metadata only.

### Commit 4 - Auth restart proof

Goal:

- Prove local durable auth state lets provider restart without a new QR scan when Baileys mock indicates existing credentials are valid.

Expected tests:

- First run stores auth.
- Second run loads auth.
- No new QR required in mocked restart path.
- No auth payload leak.

### Commit 5 - Real-send local orchestration path

Goal:

- Wire a controlled local live demo path for sending a text after connection.
- Use existing Application/Worker/Provider ports.

Expected tests:

- Fake/local test still proves send via shared socket.
- Live manual checklist documents how to run real send.
- Missing shared socket remains fail-safe.

### Commit 6 - Inbound/status live event observation

Goal:

- Confirm real provider inbound and status mapping paths are observable through EventLog/SSE.

Expected tests:

- Mocked inbound event reaches EventLog safe payload.
- Mocked status event reaches EventLog safe payload.
- EventLog/SSE does not leak JID/text/provider IDs beyond safe refs.

### Commit 7 - Manual live demo checklist and evidence template

Goal:

- Add a local-only manual checklist for the live WhatsApp run.
- Record what must be observed before VS02 can close.

Expected tests/checks:

- Documentation only plus `pnpm check`.

## 10. Tests to add

Automated tests:

- Real provider mocked `makeWASocket` loads auth before creating socket.
- `creds.update` persists auth state.
- Restart path reloads auth state.
- QR signal maps to safe EventLog event.
- Connected/disconnected/reconnect signals map safely.
- Inbound message signal maps safely without raw JID/text leak.
- Message status signal maps safely without raw JID/text leak.
- SSE/EventLog event payloads are public-safe.
- Provider-runtime local live composition blocks production if encryption/lease missing.
- Worker/provider send path remains fail-safe without socket sharing.
- No `@whiskeysockets/baileys` imports outside `packages/infrastructure-provider-baileys`.

Manual tests:

- Start provider runtime local live mode.
- Observe QR.
- Scan QR.
- Confirm auth state JSON file exists and changes revision/checksum.
- Restart runtime.
- Confirm no QR scan required after restart.
- Send real text to test recipient.
- Receive message from test recipient.
- Observe connection/inbound/status events in EventLog/SSE.
- Confirm logs/EventLog/API/SSE do not contain raw QR, raw auth state, raw message text, or raw JID.

## 11. Manual test checklist

Before running:

- Use a test WhatsApp account or an account approved for local development.
- Use an explicit test recipient.
- Do not use production customer data.
- Clear `.omniwa-local/live` if a clean QR scan is required.

Checklist:

- [ ] `pnpm check` passes before manual live run.
- [ ] Local state directory is configured.
- [ ] Provider runtime starts in local profile.
- [ ] QR is generated by `RealBaileysSocketProvider`.
- [ ] QR scan succeeds.
- [ ] Connected event appears in EventLog/SSE.
- [ ] Auth state durable JSON file exists.
- [ ] Restart provider runtime.
- [ ] Runtime reconnects without a new QR scan.
- [ ] Send text to test recipient.
- [ ] Test recipient receives message.
- [ ] Message status event appears in EventLog/SSE.
- [ ] Inbound test reply appears as safe inbound event.
- [ ] Logs/EventLog/SSE do not expose raw QR/JID/text/auth state.
- [ ] Stop runtime cleanly.

## 12. Safety/privacy constraints

- Do not log raw QR.
- Do not expose raw QR in public DTO/EventLog/SSE.
- Do not log raw JID.
- Do not expose raw message text in Domain aggregate, EventLog public payload, logs, metrics, or public DTO.
- Do not log or expose raw auth state.
- Durable auth state is `secret`.
- Baileys stays only in `packages/infrastructure-provider-baileys`.
- Apps stay composition/runtime only.
- Manual live demo must use test account/test recipient.
- Any generated local state must be treated as sensitive and excluded from git.

## 13. Production blockers still unresolved

VS02 does not solve these:

- No distributed ownership/lease.
- No production encryption for auth state.
- No production multi-process IPC/shared socket bridge.
- No distributed queue provider for production worker/provider coordination.
- No horizontal provider-runtime scaling.
- No production-grade secret rotation for Baileys auth state encryption keys.
- No full operational runbook for account bans, connection replacement, or session revocation.
- No real SLA/SLO validation against WhatsApp network behavior.

## 14. Definition of Done

VS02 is done only when:

- `pnpm check` passes.
- `pnpm arch:check` passes.
- Baileys imports remain contained in `packages/infrastructure-provider-baileys`.
- Provider runtime local live mode starts with real provider deps.
- Real QR is produced and can be scanned manually.
- Auth state persists to durable JSON.
- Restart reuses auth state without requiring QR scan again.
- A real text message can be sent to a test recipient.
- Inbound, status, and connection events appear as safe EventLog/SSE events.
- No raw QR/JID/text/auth state appears in public DTO/log/EventLog/SSE test surfaces.
- Production blockers remain clearly documented and fail-safe.

## Final note

VS02 should prove the real WhatsApp local path without changing the production architecture contract. If implementation pressure requires multi-process socket sharing, stop and create a separate architecture decision before adding IPC.
