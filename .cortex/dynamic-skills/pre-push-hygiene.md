# Pre-Push Hygiene

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.
- [Remote execution](../workflows/remote-execution.md)
  - Defines the hosted execution boundary used after pre-push hygiene.
  - Read before selecting focused remote validation.
- [Loom tools](../references/loom-tools.md)
  - Defines the typed pre-push request and related Loom entrypoints.
  - Read when changing or invoking pre-push automation.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Preferred Pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
  - [Sealed-image rule](#sealed-image-rule)
    - Defines how host formatting becomes the authoritative staged diff.
    - Read when local and sealed formatter versions differ.
  - [UI demo contract paths](#ui-demo-contract-paths)
    - Lists the UI paths that activate focused demo coverage requirements.
    - Read before pushing a web or extension change.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Application Checklist](#application-checklist)
  - Lists the steps needed to apply and maintain the skill.
  - Use during implementation and review.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

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

Call Loom `pre-push` before every push.

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

Then commit → push → focused `task remote` → explicit validate.

See [remote-execution.md](../workflows/remote-execution.md)
and [loom-tools.md](../references/loom-tools.md).

### Sealed-image rule

- Loom invokes host-applied `task format` internally.
- The agent entrypoint is `task loom:pre-push`.
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
