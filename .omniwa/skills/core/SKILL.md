# Core Skill

## Use When

Use this skill for any task before selecting a more specific skill.

## Purpose

Establish context, select the correct workflow, and prevent drift from frozen decisions.

## Required Inputs

- Root `AGENTS.md`.
- `.omniwa/README.md`.
- `.omniwa/SKILL_MAPPING.md`.
- Relevant `.omniwa/context/*.md`.
- Relevant freeze documents.

## Operating Rules

- Start with traceability.
- Prefer approved documents over assumptions.
- Do not modify freeze documents or accepted ADRs during implementation.
- If a decision is missing, stop and create an issue or ADR proposal.
- Keep the task scoped to the user request.

## Output

A plan, implementation, review, or escalation that names the documents used and the boundary being preserved.

