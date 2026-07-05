# PR-14 Backup Restore Recovery Drill

## Status

Implemented.

## Scope

PR-14 adds production-readiness evidence for backup, restore, and recovery
validation without introducing provider, database, or cloud-specific backup
implementation.

Implemented capabilities:

- Deterministic backup/restore recovery drill.
- Production-like dataset counters for recoverable state.
- RPO/RTO evidence in drill output.
- Secret material boundary checks for backup artifacts.
- Redis source-of-truth guardrail.
- Release readiness evidence for drill implementation, tests, and runbook.
- Operational runbook for restore procedure and failure policy.

## Recovery Targets

| Target    | Value    |
| --------- | -------- |
| RPO       | 24 hours |
| RTO       | 4 hours  |
| Retention | 14 days  |

The targets align with DEC-006 and DEC-008.

## Drill Coverage

| Area                   | Covered By                                             |
| ---------------------- | ------------------------------------------------------ |
| Backup encryption      | `backup_artifact_not_encrypted` finding                |
| Backup integrity       | `backup_integrity_not_verified` finding                |
| Backup age / RPO       | `backup_age_exceeds_rpo_target` finding                |
| Restore duration / RTO | `restore_duration_exceeds_rto_target` finding          |
| Instance inventory     | Dataset counter comparison                             |
| Sessions               | Active session count and credential references         |
| Messages               | Message counter comparison                             |
| Queue/jobs             | Queue job counter comparison                           |
| Webhooks               | Subscription and delivery counter comparison           |
| Audit/events           | Audit and event counter comparison                     |
| Media                  | Media object count and object reference comparison     |
| Secret material        | Payload scanner and explicit secret-material flag      |
| Redis                  | `redis_snapshot_included_as_recoverable_state` finding |

## Release Gate

Release readiness now requires:

- `apps/background/src/backup-restore-drill.ts`
- `apps/background/src/recovery-validation.ts`
- `tooling/recovery/check-recovery-readiness.mjs`
- `apps/background/src/backup-restore-drill.spec.ts`
- `apps/background/src/recovery-validation.spec.ts`
- `tooling/recovery/check-recovery-readiness.spec.ts`
- `docs/runbooks/BACKUP_RESTORE_RECOVERY_DRILL.md`
- `pnpm recovery:check` in the root quality gate.

## Validation

Targeted checks:

```text
pnpm recovery:check
pnpm release:check
```

Full gate:

```text
pnpm check
```

## Residual Risk

This slice proves the recovery contract and repeatable drill. It does not create
deployment-specific backup jobs, object-store lifecycle rules, cloud restore
automation, or PostgreSQL dump tooling. Those remain environment-specific
implementation work and must pass the same drill before production readiness is
claimed.
