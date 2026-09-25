# Lightweight Feature Hygiene

## Purpose

Keep local implementation feedback bounded under the
[dev delivery contract](../../../gizmo-prime/architecture/dev-delivery.md).
Use the root [delivery and validation policy](../../../AGENTS.md#delivery-and-validation)
for any local diagnostic.

## Required actions

- Format owned Rust changes with scoped rustfmt when permitted by the task.
- Keep routine local feedback to bounded inexpensive TS diagnostics or
  formatting. The root policy governs the narrow exception for local tests,
  checks, or E2E.
- Preserve unrelated changes and finish only the assigned worker-branch scope.
- Author meaningful tests and required UI flow evidence.
- Return the worker branch and focused evidence to Team Gizmo for upstream local
  integration. Team Gizmo assigns feature-branch publication and PR check
  observation to PR Lifecycle, and required workflow execution to upstream
  CI/CD with Nook SRE context.
- Hosted execution is the default. Required hosted PR checks remain mandatory
  for delivery and readiness. Local
  results do not replace them. A specific preflight, coverage, or build target
  may be selected directly only when it is the smallest suitable diagnostic for
  the recorded task need under the root policy. A selected Taskfile target may
  also execute its actually declared necessary prerequisites through that task.
  Do not run unrelated or broader local targets or use this policy to authorize
  a broad local gate.

## Prohibited actions

- Do not require local `task loom:pre-push` or a broad `task format` run.
- Do not start a local Docker image or product compilation for formatting.
- Do not dispatch tests, coverage, E2E, or preflight through the remote build-only
  task route. Required PR checks continue through their hosted workflows.
- Do not remove required tests to make feature compilation cheaper.

## Evidence

Report which permitted diagnostics ran and which tests were authored.
Do not claim tests passed before the slow stage executes them.
