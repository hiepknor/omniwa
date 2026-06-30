# OmniWA AI Runtime Kit

## Purpose

This kit helps AI coding agents work inside OmniWA without drifting from the frozen specification.

It is developer infrastructure for agents. It is not product documentation, not implementation, not source code, and not a replacement for the documents under `docs/`.

## How To Use This Kit

Start from root `AGENTS.md`, then use this directory as the operational map:

```text
README.md
  -> AGENTS.md
  -> .omniwa/context/
  -> .omniwa/SKILL_MAPPING.md
  -> .omniwa/skills/
  -> .omniwa/playbooks/
  -> .omniwa/templates/
  -> implementation work
```

## Directory Map

| Path | Purpose |
|---|---|
| `context/` | Short summaries of frozen design areas for quick agent onboarding. |
| `skills/` | Small reusable task modes for core work, implementation, review, and release. |
| `playbooks/` | Workflows for common implementation activities. |
| `templates/` | Blank templates for ADRs, issues, PRs, reviews, sprint reports, and release checks. |
| `prompts/` | Implementation sprint prompts only. No design-phase prompts live here. |
| `SKILL_MAPPING.md` | Task routing table from work type to skill, playbook, template, freeze docs, and ADR policy. |

## Ten Minute Agent Path

1. Read root `AGENTS.md`.
2. Read `context/architecture.md`.
3. Read the context file for the area being changed.
4. Read `SKILL_MAPPING.md`.
5. Load one skill category.
6. Load one playbook.
7. Open one template if the task requires written output.
8. Read the referenced freeze documents.
9. Plan with traceability.
10. Implement only after the boundary checks are clear.

## Agent Agnostic Design

The kit uses plain Markdown and repository-relative paths so it can be used by Codex, Claude Code, Cursor, Gemini CLI, Aider, GitHub Copilot Agent, or a human maintainer.

No file in this kit assumes a specific AI runtime, MCP server, IDE, shell, package manager, test runner, or CI provider.

## Safety Model

When implementation pressure conflicts with a freeze document, the freeze wins.

When a needed decision is missing, stop and produce an issue or ADR proposal. Do not encode a guessed architecture decision in code.

