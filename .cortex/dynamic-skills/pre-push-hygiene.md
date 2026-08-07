# Pre-Push Hygiene

## Purpose

Prevent avoidable PR Verify failures from sealed-image formatting lag and missing
UI demo contract updates.

This is the **only required local product work**.

Every other gate runs on GitHub Actions.

## Problem Pattern

Agents push a coherent change, then burn a full remote cycle on:

- Prettier / rustfmt failures because format never wrote the host tree
- Missing `nook-web-app/e2e/demos/*.demo.spec.ts` updates after UI path changes
- Treating format as optional
- Running heavy local product gates instead of hosted remote tasks

These show up in Workbench `stats/ai-agent` records as waste.

## Preferred Pattern

Run Loom before every push:

```bash
task loom:pre-push
```

Equivalent Bun entry:

```bash
bun run --cwd agentic-ai/loom loom -- pre-push
```

Loom always:

1. Runs host-applied `task format`
2. Fetches `origin/main`
3. Runs `.github/scripts/ui-demo-contract.sh` against that base
4. Stages host format updates with `git add -u`

Then commit → push → focused `task remote` → explicit `task pr:validate`.

See [remote-execution.md](../workflows/remote-execution.md).

### Sealed-image rule

- `task format` is the agent entrypoint through Loom.
- `task format:diff` prints the diff without applying.
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

- Before: sealed-only format → Verify fails Prettier → extra head cycle.
- After: `task loom:pre-push` → commit → push; Verify sees a formatted head.
- Before: change shared UI → push → demo contract fails.
- After: Loom fails closed until a demo spec is updated.

## Application Checklist

- [ ] Run `task loom:pre-push` before every push.
- [ ] Do not use `task extension:format` as the sole format step.
- [ ] Do not run local `task check` / `task ci:pr` after the push.

## Validation

A first Verify attempt should not fail solely on Prettier, rustfmt, or the UI
demo contract.

If Workbench stats still flag those as waste, tighten this card and coding-bro
in the same task.
