# AI Skill Mapping

Use this table to route work before planning.

| Task | Skill | Playbook | Template | Freeze Documents | ADR |
|---|---|---|---|---|---|
| Repository bootstrap | `skills/core` | `playbooks/bootstrap.md` | `templates/SPRINT_REPORT.md`, `templates/PULL_REQUEST.md` | `docs/engineering/IMPLEMENTATION_FREEZE.md`, `docs/architecture/ARCHITECTURE_FREEZE.md` | ADR-003, ADR-011, ADR-015 |
| Implement foundation package | `skills/implementation` | `playbooks/implement-module.md` | `templates/PULL_REQUEST.md` | Engineering, Architecture | ADR if package boundary or dependency changes |
| Implement Domain behavior | `skills/implementation` | `playbooks/implement-module.md` | `templates/DOMAIN_REVIEW.md` | `docs/domain/DOMAIN_FREEZE.md`, Engineering | Stop if aggregate, invariant, event, or policy must change |
| Implement Application workflow | `skills/implementation` | `playbooks/implement-module.md` | `templates/PULL_REQUEST.md` | `docs/application/APPLICATION_FREEZE.md`, Domain, Engineering | ADR if workflow boundary or transaction semantics change |
| Implement API adapter | `skills/implementation` | `playbooks/implement-module.md` | `templates/PULL_REQUEST.md` | `docs/api/API_FREEZE.md`, Application, Architecture | Stop if public contract must change |
| Implement persistence adapter | `skills/implementation` | `playbooks/implement-module.md` | `templates/ARCHITECTURE_REVIEW.md` | `docs/persistence/PERSISTENCE_FREEZE.md`, Domain, Application | ADR if storage technology or ownership changes |
| Implement provider adapter | `skills/implementation` | `playbooks/implement-module.md` | `templates/ARCHITECTURE_REVIEW.md` | Architecture, Application, Infrastructure | ADR-006, ADR-007; ADR for provider boundary change |
| Implement worker/async runtime | `skills/implementation` | `playbooks/implement-module.md` | `templates/PULL_REQUEST.md` | Architecture, Application, Infrastructure, Engineering | ADR-012, ADR-013, ADR-014 |
| Review module | `skills/review` | `playbooks/review-module.md` | `templates/ARCHITECTURE_REVIEW.md`, `templates/DOMAIN_REVIEW.md` | All affected freeze documents | ADR if review finds structural change needed |
| Refactor | `skills/review`, `skills/core` | `playbooks/refactor.md` | `templates/PULL_REQUEST.md` | Affected freeze documents | ADR if dependency/package/runtime boundary changes |
| Hotfix | `skills/release`, `skills/review` | `playbooks/hotfix.md` | `templates/ISSUE.md`, `templates/PULL_REQUEST.md` | Affected freeze documents | ADR if fix changes approved behavior or technology |
| Release | `skills/release` | `playbooks/release.md` | `templates/RELEASE_CHECKLIST.md` | Engineering, Infrastructure, Persistence | ADR if release changes topology or runtime constraints |

## Default Rule

If the task does not fit a row, use `skills/core`, read the affected context files, and create an issue describing the missing decision before implementing.

