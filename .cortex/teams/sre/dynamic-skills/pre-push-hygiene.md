# Lightweight Feature Hygiene

## Purpose

Keep local implementation feedback bounded under the
[dev delivery contract](../../../gizmo-prime/architecture/dev-delivery.md).

## Required actions

- Format owned Rust changes with scoped rustfmt when permitted by the task.
- Use only bounded inexpensive TS diagnostics or formatting for local feedback.
- Preserve unrelated changes and finish only the assigned worker-branch scope.
- Author meaningful tests and required UI flow evidence.
- Return the worker branch and focused evidence to Team Gizmo for upstream local
  integration. Team Gizmo assigns feature-branch publication and PR check
  observation to PR Lifecycle, and required workflow execution to upstream
  CI/CD with Nook SRE context.
- Execute formatting gates, audits, tests, and preflight only through the
  feature PR required-check stage under Nook's hosted execution policy.

## Prohibited actions

- Do not require local `task loom:pre-push` or a broad `task format` run.
- Do not start a local Docker image or product compilation for formatting.
- Do not run local tests, including Loom tests.
- Do not run feature-stage tests, coverage, e2e, or preflight remotely.
- Do not remove required tests to make feature compilation cheaper.

## Evidence

Report which permitted diagnostics ran and which tests were authored.
Do not claim tests passed before the slow stage executes them.
