# Codex GitHub Review Workflow

Use Codex as Nook's automatic high-signal reviewer on GitHub pull requests.
Codex submits a standard GitHub review, follows the closest `AGENTS.md`, and
limits GitHub findings to P0/P1 issues.

Reference: [Codex code review in GitHub](https://learn.chatgpt.com/docs/third-party/github).

Codex review does **not** replace Nook's required gates:

- `task format:check`
- `task check`
- targeted or full Playwright e2e where relevant
- GitHub Actions and required deployment status
- human review and `.cortex` architecture rules

## Repository setup

The repository must have all of the following:

1. Codex Cloud access to `meta-secret/nook`.
2. Code review enabled for the repository in Codex settings.
3. Repository automatic review set to **Review all PRs**, with the **On every
   push** trigger and exhaustive review enabled. Credit use remains disabled.
4. Review guidance in the root [`AGENTS.md`](../../AGENTS.md), with more
   specific nested `AGENTS.md` files where a subtree needs extra rules.

Codex applies the closest `AGENTS.md` to each changed file. Keep review-only
priorities under `## Review guidelines`; keep the full architecture and workflow
rules in [`.cortex/AGENTS.md`](../AGENTS.md) and its linked documents.

## Automatic review

Automatic review runs when a pull request is opened and again after every push.
Confirm that Codex reacts and submits a review before considering the review gate
observed. A thumbs-up is a valid clean review; actionable findings appear as
standard GitHub review comments.

Codex reviews only serious P0/P1 findings on GitHub. Do not weaken the root
review guidelines merely to produce more comments.

## Manual and focused review

Use the exact PR comment below when automatic review did not run or a one-off
manual pass is needed:

```text
@codex review
```

Add a one-off focus when the change has a specific risk:

```text
@codex review for authentication and plaintext-storage regressions
```

Request one coherent review after the branch is ready. Do not post repeated
review requests for exploratory commits or while another Codex review is still
running.

## Handling findings

Follow [the code-review-comments skill](../dynamic-skills/code-review-comments.md)
for every actionable finding:

1. Verify it against the current branch and `.cortex` rules.
2. Make the minimal correct fix or document why no change is needed.
3. Run the smallest relevant local validation.
4. Push the completed fix.
5. Reply on the original thread with the fix and validation.
6. Resolve only after the targeted reply is visible and the finding is fixed or
   explicitly invalidated.
7. Re-query reviews and unresolved threads before handoff or merge.

Codex can be asked to fix a finding with a PR comment such as `@codex fix the P1
issue`, but that starts a separate cloud task that may push to the branch. Use it
only when the user explicitly wants Codex Cloud to own that fix; the active agent
normally handles findings directly.

## Validation and handoff

Before merge or handoff, report:

- whether automatic or manual Codex review ran on the latest coherent change;
- every P0/P1 finding and how it was handled;
- unresolved review-thread count;
- local validation and GitHub check/deployment state.

If Codex does not react or submit a review, verify repository access, the Codex
Cloud environment, repository code-review settings, automatic-review trigger,
and the exact `@codex review` command before treating it as a product failure.
