# Core Examples

## Example: New Module Request

Task: "Implement message sending."

Routing:

- Context: `context/application.md`, `context/domain.md`, `context/api.md`.
- Skill: `skills/implementation`.
- Playbook: `playbooks/implement-module.md`.
- Freeze docs: Application, Domain, API, Architecture, Engineering.

Stop condition:

- The requested message type is not text, image, video, document, or audio.

## Example: Ambiguous Feature Request

Task: "Add campaign sending."

Outcome:

- Do not implement.
- Campaign is outside frozen MVP scope.
- Create an issue or ADR/product decision request.

## Example: Dependency Request

Task: "Use a new queue library."

Outcome:

- Check infrastructure and ADRs.
- If the library choice changes queue semantics or runtime constraints, stop for ADR.

