# Pre-Push Hygiene

## Purpose

Prevent avoidable PR Verify failures from formatting lag and missing UI demo
contract updates without turning local pre-push into a product build.

This is the **only required local product work for Gizmo after integration**.

Every other gate runs on GitHub Actions.

## Problem Pattern

Gizmo pushes a coherent integrated change, then burns a full remote cycle on:

- Prettier / rustfmt failures because format never wrote the host tree
- Missing `nook-web-app/e2e/demos/*.demo.spec.ts` updates after UI path changes
- Treating format as optional
- Running heavy local product gates instead of hosted remote tasks

These show up in Workbench `stats/ai-agent` records as waste.

## Preferred Pattern

After integrating accepted Team Agent handoffs, Gizmo calls Loom `pre-push`
before every push. Ordinary Team Agents return coherent exact commits without
pushing or operating external delivery state.

Request:

```yaml
prePush:
  stageHostUpdates: true
  fetchOriginMain: true
```

Invoke:

```bash
task loom:pre-push
```

- **Default:** `task loom:pre-push` uses the in-code pre-push example.
- **Success:** `ok: true`, `result.formatOk: true`, and `result.uiDemoOk: true`.
- **Decode failure:** run `task loom:tools-list` and fix the YAML request.

Loom always:

1. Runs host-applied `task format`
2. Fetches `origin/main` when `fetch: true`
3. Runs `.github/scripts/ui-demo-contract.sh` against that base
4. Stages host format updates when `stageHostUpdates: true`

Then Gizmo commits any hygiene updates → pushes → optionally runs focused
`task remote` → explicitly validates.

See [remote-execution.md](../workflows/remote-execution.md)
and [loom-tools.md](../../ai/references/loom-tools.md).

### Shared formatter rule

- Loom invokes host-applied `task format` internally.
- The integrated-delivery entrypoint is `task loom:pre-push`; ordinary Team
  Agent handoffs do not run the parent-owned integration gate.
- `task format` may build its content-addressed tool-only image once.
- Every worktree reuses that image without per-worktree Rust or Bun dependency
  installation.
- Prettier formats only branch or working-tree changes. It must not rewrite an
  unrelated legacy source tree merely because a file predates the current style.
- The formatter image context contains no product source.
- `task format` must not invoke BuildKit product graphs, compilation, tests, or
  remote cache reads or writes.
- Never use `task extension:format` as the only format step before push.

### UI demo contract paths

The contract fails when HEAD vs the base SHA changes UI-facing paths without
also changing a `nook-web-app/e2e/demos/*.demo.spec.ts` file.

UI-facing paths include app, shared, vault UI, and extension `src` trees.

## Scope

Applies to every normal implementation PR push.

Does not apply to Workbench issue, worklog, or statistics commits.

Does not apply to read-only sessions with no commits.

## Examples

- Before: format runs a product build → local CPU and cache bandwidth are wasted.
- After: the shared tool-only formatter writes the same source changes in
  seconds without per-worktree dependency trees.
- After: Team Agent exact commit → Gizmo integration →
  `task loom:pre-push` → push; Verify sees a formatted integrated head.
- Before: change shared UI → push → demo contract fails.
- After: Loom fails closed until a demo spec is updated.

## Application Checklist

- [ ] Ordinary Team Agents return one coherent exact commit without pushing.
- [ ] Gizmo runs `task loom:pre-push` after integration and before every push.
- [ ] Do not use `task extension:format` as the sole format step.
- [ ] Do not run local `task check` / `task ci:pr` after the push.

## Validation

A first Verify attempt should not fail solely on Prettier, rustfmt, or the UI
demo contract.

If Workbench stats still flag those as waste, tighten this card and
[Gizmo mission delivery](../../../gizmo/workflows/mission-delivery.md) in the same task.
