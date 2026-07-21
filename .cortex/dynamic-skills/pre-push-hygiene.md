# Pre-Push Hygiene

## Purpose

Prevent avoidable PR Verify failures from sealed-image formatting lag and missing
UI demo contract updates by making cheap host-side hygiene unconditional before
every push. This is the **only required local product work**; every other gate
runs on GitHub Actions.

## Problem Pattern

Agents push a coherent change, then burn a full remote cycle on:

- Prettier / rustfmt failures because `task format` / `task extension:format`
  ran only inside a sealed image and never wrote the host tree
- Missing `nook-web-app/e2e/demos/*.demo.spec.ts` updates after touching UI,
  shared vault UI, or extension `src` paths
- Treating format as optional ("I barely changed anything") even though Verify
  always runs `format:check`
- Running heavy local product gates (`task check`, `task ci:pr`) instead of
  pushing and letting GitHub Actions validate

These show up in `.stats/ai-agent` as waste-flagged PRs with early cancelled or
failed Verify runs, or as duplicated local+remote validation time.

## Preferred Pattern

**Always format on the host before every push.** Do not decide whether
formatting is needed — it is cheap; skip logic is not. Do **not** follow format
with a required local `task check` / `task ci:pr`.

```bash
# Unconditional. Formats in sealed images AND applies the diff to the host.
task format
git add -u

# When the change set vs origin/main includes UI-facing paths:
git fetch origin main
.github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"
# If it fails: add/update nook-app/nook-web/nook-web-app/e2e/demos/<name>.demo.spec.ts
# then re-run task format && git add -u
```

Then commit → push → monitor GitHub Actions. See
[github-actions-only-validation.md](github-actions-only-validation.md).

### Sealed-image rule

- `task format` is the agent entrypoint. It applies the sealed-image diff to the
  host. Prefer this over `task format | git apply`.
- `task format:diff` prints the diff without applying (debug only).
- `task extension:format` formats inside the sealed image and **discards** the
  result when the container exits. Never use it as the only format step before
  push.

### UI demo contract paths

The contract fails when HEAD vs the base SHA changes any of:

- `nook-web-app` `src/`, `public/`, `static/`, or app `index.html`
- `nook-web-shared/src/`
- `nook-vault-simple` / `nook-vault-sentinel` UI sources
- `nook-web-extension/src/`

without also changing a `nook-web-app/e2e/demos/*.demo.spec.ts` file.

## Scope

Applies to:

- Every normal implementation PR push (first push and every fix push).
- Web, extension, Rust, docs-touched-with-scripts, and mixed changes.

Does not apply to:

- Stats-only PRs that touch only `.stats/ai-agent/<pr>.yaml`.
- Read-only / question-only sessions with no commits.

## Examples

- Before: edit an extension smoke spec → push → Verify fails Prettier →
  discover `task extension:format` never wrote the host → extra head cycle.
- After: `task format` → `git add -u` → commit → push; Verify sees a formatted
  head on the first attempt.
- Before: change `nook-web-shared/src` → push → Verify fails UI demo contract.
- After: run `ui-demo-contract.sh` against `origin/main` before open/push; add
  or touch a `*.demo.spec.ts`, format, then push.

## Application Checklist

- [ ] Run `task format` unconditionally before the push (no "small change" skip).
- [ ] Stage host-applied format changes (`git add -u`).
- [ ] If UI-facing paths changed, pass `.github/scripts/ui-demo-contract.sh`
      against `origin/main` before push.
- [ ] Do not use `task extension:format` as the sole format step.
- [ ] Do not require `task check` / e2e / `task ci:pr` after the push; monitor
      GitHub Actions instead.

## Validation

A first Verify attempt should not fail solely on Prettier, rustfmt, or the UI
demo contract. If `.stats/ai-agent` still flags those as waste, tighten this card
and the coding-bro pre-push section in the same task.
