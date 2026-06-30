# OmniWA Release Strategy

## Purpose

This document defines the release strategy for OmniWA implementation and future public distribution.

It does not create release tooling, changelog automation, CI/CD workflows, package files, Docker artifacts, or deployment manifests.

## Release Principles

- Release only from a green, reviewed, traceable state.
- Preserve SemVer once public releases begin.
- Use `0.x` versions before stable compatibility commitments.
- Do not release behavior that bypasses frozen Product, Architecture, Domain, Application, API, Persistence, or Infrastructure decisions.
- Treat security and redaction failures as release blockers.
- Treat backup/restore and rollback readiness as production release requirements.

## Versioning

OmniWA should use Semantic Versioning once public releases begin.

| Version Level | Meaning |
|---|---|
| Major | Breaking product contracts after stable release. |
| Minor | Backward-compatible capabilities or improvements. |
| Patch | Bug fixes, documentation corrections, safe operational fixes. |
| Pre-1.0 | Contracts may evolve, but breaking changes must still be documented. |

Initial implementation milestones may use internal tags before public `0.x` releases.

## Release Cadence

| Cadence | Recommendation |
|---|---|
| Internal implementation milestones | End of each implementation phase or sprint when gates pass. |
| Public preview releases | Only after core instance, messaging, webhook, observability, and recovery paths pass readiness review. |
| Stable release | Only after API compatibility, operational runbooks, security review, backup/restore, and production validation are approved. |

The project should prefer reliable releases over fixed calendar releases until real usage data exists.

## Release Branching

| Branch Type | Usage |
|---|---|
| `main` | Latest accepted state. Required to stay green. |
| `release/x.y` | Stabilization branch when a public release needs patch support. |
| `hotfix/x.y.z` | Urgent patch branch for a released version. |
| feature branches | Short-lived implementation branches. |

Release branches are introduced only when public releases exist.

## Release Candidate Policy

A release candidate requires:

- all CI gates passing,
- architecture fitness checks passing,
- critical unit/contract/integration tests passing,
- no Critical or Major unresolved security findings,
- no known Secret/raw Confidential leakage,
- no accepted async silent-drop path,
- release notes drafted,
- rollback plan documented,
- backup/restore status reviewed for production candidates.

## Hotfix Policy

Hotfixes are allowed for:

- security issues,
- data safety issues,
- production outage fixes,
- critical workflow regressions,
- provider compatibility breakages,
- release-blocking documentation corrections.

Hotfixes must still pass relevant tests and must not bypass architecture or data safety rules.

## Rollback Policy

Rollback planning must include:

- version to roll back to,
- data compatibility assessment,
- migration rollback or forward-fix plan when persistence changes exist,
- queue/WorkerJob reconciliation plan,
- provider session impact assessment,
- webhook duplicate/idempotency impact assessment,
- operator communication notes.

Rollback must not resurrect expired data or expose secrets.

## Changelog Policy

Every release note should classify changes as:

- Added,
- Changed,
- Fixed,
- Deprecated,
- Removed,
- Security,
- Operational Notes,
- Migration Notes.

Changelog entries must reference affected product area and, when meaningful, the approved docs or ADR.

## Compatibility Policy

| Area | Compatibility Expectation |
|---|---|
| API | `/v1` compatibility and deprecation policy from API Freeze. |
| Webhook | Versioned Integration Event names such as `.v1`. |
| Domain/Application | Internal contracts may evolve only with tests and affected docs/ADR review. |
| Persistence | Repository semantics must remain stable; migrations require review. |
| Provider | Baileys upgrades require exact pinning, regression validation, and rollback. |
| Runtime | Runtime roles may scale or split only without changing product semantics. |

## Release Gates

| Gate | Required For Internal Milestone | Required For Public Release |
|---|---|---|
| Build green | Yes | Yes |
| Unit tests | Yes | Yes |
| Contract tests | Affected areas | Yes |
| Architecture tests | Yes | Yes |
| Security/redaction checks | Yes | Yes |
| E2E smoke tests | Main flows | Yes |
| Performance validation | Targeted | Yes for production readiness |
| Backup/restore validation | When persistence/runtime touched | Yes for production readiness |
| Documentation updates | Yes | Yes |
| Changelog | Optional | Yes |

## Checklist

| Item | Status |
|---|---|
| Versioning defined | PASS |
| Release cadence defined | PASS |
| Branch policy defined | PASS |
| Hotfix policy defined | PASS |
| Rollback policy defined | PASS |
| Changelog policy defined | PASS |
| Release gates defined | PASS |

**Release strategy is ready.**
