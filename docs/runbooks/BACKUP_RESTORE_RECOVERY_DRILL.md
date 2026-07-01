# Backup Restore Recovery Drill Runbook

## Purpose

This runbook defines the repeatable backup and restore drill required before
OmniWA can claim production recovery readiness.

It supports Sprint PR-14 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

## Recovery Targets

| Target           | Value                   | Source                      |
| ---------------- | ----------------------- | --------------------------- |
| Backup frequency | At least every 24 hours | `docs/DECISIONS.md` DEC-008 |
| RPO              | 24 hours                | `docs/DECISIONS.md` DEC-008 |
| RTO              | 4 hours                 | `docs/DECISIONS.md` DEC-008 |
| Backup retention | 14 days                 | `docs/DECISIONS.md` DEC-006 |

## Drill Scope

The drill validates a production-like backup artifact and restored dataset for:

- instance inventory,
- active session references,
- message state,
- queue/job visibility,
- webhook delivery state,
- audit continuity,
- event continuity,
- media object references,
- backup encryption,
- backup integrity,
- RPO/RTO evidence,
- secret material boundaries.

Redis is not treated as recoverable source-of-truth state. Redis data may be
rebuilt or invalidated after restore, but a Redis snapshot must not be required
for product state recovery.

## Secret Boundary

Backup artifacts may contain safe references such as:

- `secretref:session:<safe-id>`,
- `objectref:media:<safe-id>`,
- `manifest:backup:<safe-id>`.

Backup artifacts must not contain:

- session secret plaintext,
- API keys,
- webhook signing material,
- provider credentials,
- raw tokens,
- raw QR or pairing secrets,
- raw provider payloads that include confidential identifiers.

If secret material is required to restore a runtime, it must be recovered
through the approved `SecretProvider` boundary, not from product backup
payloads.

## Drill Procedure

1. Select the latest valid encrypted backup artifact.
2. Verify the backup manifest and artifact integrity.
3. Restore the backup into an isolated replacement environment.
4. Restore or rebind secret references through `SecretProvider`.
5. Rebuild or invalidate Redis-backed ephemeral state.
6. Rebuild or mark read projections according to freshness policy.
7. Run the recovery drill validation.
8. Record:
   - backup age,
   - restore duration,
   - RPO target,
   - RTO target,
   - dataset counters,
   - findings.
9. Keep production readiness blocked until the drill status is `passed`.

## Local Smoke Check

Run the targeted checks:

```text
pnpm exec vitest run apps/background/src/backup-restore-drill.spec.ts apps/background/src/recovery-validation.spec.ts
pnpm release:check
```

Run the full quality gate:

```text
pnpm check
```

## Failure Policy

| Finding                       | Operator Response                                                         |
| ----------------------------- | ------------------------------------------------------------------------- |
| Backup missing encryption     | Treat as P0 recovery blocker; do not release.                             |
| Backup integrity not verified | Rebuild backup and repeat drill before release.                           |
| Backup age exceeds RPO        | Restore coverage is stale; create valid backup and rerun.                 |
| Restore duration exceeds RTO  | Improve restore procedure or lower dataset size before release.           |
| Secret material detected      | Treat as security incident; rotate affected secrets and rebuild artifact. |
| Redis snapshot required       | Correct recovery plan; Redis must not be source of truth.                 |
| Dataset mismatch              | Investigate missing storage ownership or projection rebuild boundary.     |

## Evidence

Implementation evidence:

- `apps/background/src/backup-restore-drill.ts`
- `apps/background/src/backup-restore-drill.spec.ts`
- `apps/background/src/recovery-validation.ts`
- `apps/background/src/recovery-validation.spec.ts`

Release gate:

- `tooling/release/check-readiness.mjs`

## Residual Risk

This drill is a deterministic recovery contract and local validation harness. It
does not create vendor-specific backup jobs, database dumps, object-store
replication, or cloud restore automation. Those deployment-specific mechanisms
must preserve the same RPO/RTO, encryption, integrity, and secret-boundary
rules.
