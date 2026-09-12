# Lightweight Feature Hygiene

## Purpose

Keep local implementation feedback bounded under the
[dev delivery contract](../../../gizmo/architecture/dev-delivery.md).

## Required actions

- Format owned Rust changes with scoped rustfmt when permitted by the task.
- Use only bounded inexpensive TS diagnostics or formatting for local feedback.
- Preserve unrelated changes and commit only the assigned scope.
- Author meaningful tests and required UI flow evidence.
- Push the feature and request remote build-only execution through PR Steward.
- Execute formatting gates, audits, tests, and preflight in the manager's slow
  PR validation stage.

## Prohibited actions

- Do not require local `task loom:pre-push` or a broad `task format` run.
- Do not start a local Docker image or product compilation for formatting.
- Do not run local tests, including Loom tests.
- Do not run feature-stage tests, coverage, e2e, or preflight remotely.
- Do not remove required tests to make feature compilation cheaper.

## Evidence

Report which permitted diagnostics ran and which tests were authored.
Do not claim tests passed before the slow stage executes them.
