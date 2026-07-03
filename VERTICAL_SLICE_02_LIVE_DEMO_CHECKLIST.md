# Vertical Slice 02 - Local Live Demo Checklist

## 1. Purpose

This checklist is the operator evidence template for VS02: Real WhatsApp Local Live Demo.

VS02 is a local-only proof. It is not a production readiness gate and must not be used to claim distributed runtime safety, encrypted production auth storage, or multi-process socket sharing.

The intended proof is:

```text
Start provider-runtime local
-> receive real QR from RealBaileysSocketProvider
-> scan QR
-> persist durable-json auth state
-> restart without QR scan
-> send real text
-> observe inbound/status/connection events in EventLog/SSE safely
```

## 2. Current Automated Proof

Automated checks already cover:

- `RealBaileysSocketProvider` loads auth state before socket creation.
- `creds.update` persists auth through `DurableJsonBaileysAuthStateStore`.
- Recreated provider reloads durable auth state.
- Restart proof can connect without a second QR when stored credentials are accepted by the mocked socket.
- Raw QR is only written to a local-only operator sink when explicitly enabled.
- Public EventLog/SSE surfaces expose safe `challengeRef`, `providerMessageRef`, and `conversationRef` values only.
- Inbound and status provider signals are observable through EventLog/SSE without raw JID, text, or provider message id.
- Local live send orchestration can dispatch through a shared same-process provider socket.

## 3. Preconditions

Before running a live test:

- Use a dedicated test WhatsApp account.
- Use a dedicated test recipient.
- Do not use customer data.
- Ensure `.omniwa-local/` is ignored and treated as sensitive.
- Confirm all quality gates pass before starting the manual live run.
- Confirm Baileys imports remain contained in `packages/infrastructure-provider-baileys`.

Required checks:

```bash
pnpm check
```

Optional build before running compiled runtime:

```bash
pnpm build
```

## 4. Local Environment

Recommended local env:

```bash
export OMNIWA_PROVIDER_RUNTIME_PROFILE=local
export OMNIWA_LIVE_DEMO_MODE=1
export OMNIWA_RUNTIME_STATE_DIR=.omniwa-local/live
export OMNIWA_PROVIDER_RUNTIME_STATE_DIR=.omniwa-local/live/provider-runtime
export OMNIWA_EVENT_LOG_PATH=.omniwa-local/live/event-log.json
export OMNIWA_BAILEYS_AUTH_STATE_PATH=.omniwa-local/live/provider-runtime/baileys-auth-state.json
export OMNIWA_PROVIDER_RUNTIME_DRAIN_INTERVAL_MS=1000
export OMNIWA_LOCAL_QR_OUTPUT=file
export OMNIWA_LOCAL_QR_OUTPUT_PATH=.omniwa-local/live/provider-runtime/local-qr.secret.json
```

The QR output file contains raw QR data and is `secret` local-only data. Do not paste it into logs, issues, pull requests, screenshots, or public terminals.

## 5. Start Runtime

After build:

```bash
node apps/provider-runtime/dist/index.js
```

Expected startup output:

- `status: "started"`
- `profile: "local"`
- `liveMode: "local_live"`
- `readiness.productionReady: false`
- `readiness.authStateEncryption: "not_configured"`
- `readiness.ownershipMode: "single_instance_in_memory"`
- `localQrOutput.mode: "file"`

Do not proceed if the runtime starts with `profile: "production"` or if startup output includes secrets.

## 6. Known Manual Run Gap

At this checkpoint, provider-runtime has a composition root and long-lived drain loop, but there is not yet a committed operator command/API that starts a concrete provider session from the CLI.

Manual live demo cannot be marked complete until an operator-safe control path can call:

```text
ProviderRuntimeSupervisor.startSession(instanceId, providerId, sessionId)
```

for a known local test instance/session.

Acceptable next implementation options:

- Add a local-only dev command that starts one configured `instanceId/sessionId`.
- Add a local-only background harness that composes provider runtime and worker in the same process.
- Add a proper control-plane API later, if it follows Application/Provider boundaries.

Do not add production IPC, distributed leases, or a hidden business workflow as part of this checklist.

## 7. QR Evidence

When session start is available:

- [ ] Start provider-runtime in local live mode.
- [ ] Trigger start session for the test instance/session.
- [ ] Confirm `.omniwa-local/live/provider-runtime/local-qr.secret.json` is created.
- [ ] Confirm the file contains:
  - `localOnly: true`
  - `dataClassification: "secret"`
  - `challengeRef`
  - `expiresAtEpochMilliseconds`
  - `qrCode`
- [ ] Render/scan the QR locally without writing raw QR to logs.
- [ ] Confirm EventLog/SSE contains `provider.auth.v1` with `challengeRef`.
- [ ] Confirm EventLog/SSE does not contain raw QR.

Evidence:

```text
Timestamp:
InstanceId:
SessionId:
ChallengeRef:
QR output file path:
Raw QR exposure checked: PASS/FAIL
Notes:
```

## 8. Auth Restart Evidence

After scanning QR:

- [ ] Confirm auth state file exists at `OMNIWA_BAILEYS_AUTH_STATE_PATH`.
- [ ] Confirm file is not committed.
- [ ] Stop provider-runtime.
- [ ] Restart provider-runtime with the same state dir.
- [ ] Confirm runtime reconnects without a new QR scan.
- [ ] Confirm EventLog/SSE has `provider.connection.v1` connected event.
- [ ] Confirm logs/EventLog/SSE do not contain raw auth state.

Evidence:

```text
Timestamp:
Auth state path:
First connection event id:
Restart connection event id:
New QR required after restart: YES/NO
Raw auth exposure checked: PASS/FAIL
Notes:
```

## 9. Real Send Evidence

For VS02, real send is valid only in a same-process local live setup where worker can access the active provider socket.

- [ ] Confirm the test instance/session is connected.
- [ ] Confirm worker and provider runtime share the same local socket owner.
- [ ] Store outbound text intent through the approved Application boundary.
- [ ] Queue outbound message work.
- [ ] Run worker once or run worker loop.
- [ ] Confirm test recipient receives the message.
- [ ] Confirm message status is updated to sent/delivered/read when provider signal is observed.
- [ ] Confirm EventLog/SSE does not contain raw recipient JID or raw text.

Evidence:

```text
Timestamp:
InstanceId:
SessionId:
MessageId:
OutboundIntentRef:
Recipient test account:
Worker completed count:
Message status observed:
Recipient received message: YES/NO
Raw JID/text exposure checked: PASS/FAIL
Notes:
```

## 10. Inbound And Status Evidence

- [ ] Send a reply from the test recipient.
- [ ] Confirm provider emits inbound message signal.
- [ ] Confirm EventLog has `provider.inbound_message.v1`.
- [ ] Confirm SSE can replay `provider.inbound_message.v1`.
- [ ] Confirm provider emits message status signal.
- [ ] Confirm EventLog has `provider.message_status.v1`.
- [ ] Confirm SSE can replay `provider.message_status.v1`.
- [ ] Confirm raw JID, raw text, and raw provider message id are absent from EventLog/SSE/logs.

Evidence:

```text
Timestamp:
Inbound event id:
Status event id:
ProviderMessageRef:
ConversationRef:
Status:
Raw provider payload exposure checked: PASS/FAIL
Notes:
```

## 11. Safety Checks

Mandatory pass/fail:

| Check                                   | Result | Evidence |
| --------------------------------------- | ------ | -------- |
| `pnpm check` passes before live run     |        |          |
| Local profile only                      |        |          |
| Production readiness remains false      |        |          |
| `.omniwa-local/` not tracked            |        |          |
| Raw QR not in EventLog/SSE/logs         |        |          |
| Raw auth state not in EventLog/SSE/logs |        |          |
| Raw JID not in EventLog/SSE/logs        |        |          |
| Raw text not in EventLog/SSE/logs       |        |          |
| Baileys import containment still passes |        |          |

## 12. Production Blockers

These remain unresolved after VS02:

- No distributed ownership/lease.
- No production encryption for auth state.
- No production multi-process IPC/shared socket bridge.
- No distributed queue/provider coordination.
- No production runbook for account bans, connection replacement, and session revocation.
- No live SLA/SLO validation against WhatsApp network behavior.

## 13. Completion Decision

VS02 is complete only if:

- All automated checks pass.
- A real QR is generated and scanned locally.
- Durable auth state survives restart without a second QR scan.
- A real text message is sent to a test recipient.
- Inbound/status/connection events are visible through EventLog/SSE.
- No raw QR/JID/text/auth state is exposed in public surfaces.

Decision:

```text
VS02 Status: PASS / FAIL / BLOCKED
Reason:
Approver:
Date:
```
