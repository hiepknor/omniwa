# Review Skill

## Use When

Use this skill for code review, architecture review, design review, or readiness review.

## Purpose

Find boundary violations, behavioral regressions, missing tests, unsafe data handling, and freeze drift.

## Review Posture

Lead with findings. Order by severity. Use file and line references when reviewing code.

Severity:

- Critical: must block.
- Major: should block unless explicitly accepted.
- Minor: should fix soon.
- Suggestion: optional improvement.

## Required Inputs

- Relevant freeze documents.
- Relevant ADRs.
- `docs/engineering/DEFINITION_OF_DONE.md`.
- Changed files.
- Test results when available.

## Output

Findings first, then open questions, then a short summary. If no issues are found, state that and mention residual risk or missing tests.

