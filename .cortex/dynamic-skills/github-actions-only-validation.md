# GitHub Actions-Only Validation

## Purpose

Keep agent machines on the lightest possible local work — host-applied
formatting — and let GitHub Actions own every product gate.

## Problem Pattern

Agents burn wall-clock running `task check`, `task ci:pr`, full e2e, or other
Docker product mirrors locally in parallel with (or before) PR CI. That
duplicates the repository-owned gate, delays pushes, and still leaves merge
blocked until GitHub Actions is green.

## Preferred Pattern

**Required locally:** only `task format` (host-applied), plus the light UI demo
contract when UI-facing paths change.

**Required remotely:** applicable repository-owned GitHub Actions workflows
(`PR / Verify and preview`, and path-applicable `Web research`).
For a PR fixing a failure observed on `main`, add `ci:full-e2e`; the same `PR`
workflow then runs the Main-equivalent full browser suite before merge.

```bash
task format
git add -u
# When UI paths change vs origin/main:
#   git fetch origin main
#   .github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"
git commit …
git push -u origin HEAD
# monitor PR workflows; do not start task check / task ci:pr
```

On a red remote run: read `gh run view <id> --log-failed` (and app logs for
web/e2e) → fix → `task format` → push → wait for the refreshed Actions run.
Optional single-spec local repro is allowed; required local product gates are
not.

## Scope

Applies to:

- Every normal implementation PR owned by an AI agent.
- Coding-bro, pull-request, CI-pipeline, and quality workflow docs.
- Pre-push hygiene and efficient PR delivery skills.

Does not apply to:

- Humans who choose to run local mirrors for their own feedback.
- Verified one-file stats-only PRs under `.stats/ai-agent/**` or
  `.stats/main-build/**`.
- Read-only / question-only sessions with no commits.
- Optional focused debug commands while investigating a specific red finding.

## Examples

- Before: format → push → `task check` ‖ PR CI → merge only after both green.
- After: format → push → PR CI green → `task pr:ready` → squash merge.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: remote Verify fails → fix from CI logs → `task format` → push → wait.

## Application Checklist

- [ ] Run `task format` unconditionally before every push.
- [ ] Pass the UI demo contract when UI-facing paths changed.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      locally for merge or handoff.
- [ ] Treat optional local Task commands as debug-only.
- [ ] Add `ci:full-e2e` when the PR repairs a Main failure.
- [ ] Merge only after green applicable Actions checks and `task pr:ready`.

## Validation

A first Verify attempt should not fail solely on Prettier/rustfmt/demo-contract
misses. Product correctness is proven by green applicable GitHub Actions on the
exact head, not by a local Docker mirror. See
[coding-bro.md](../workflows/coding-bro.md) and
[ci-pipeline.md § Local vs remote CI](../workflows/ci-pipeline.md#local-vs-remote-ci).
