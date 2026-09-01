# Code Review Comments

## Purpose

Make PR review-comment handling auditable. The responsible team agent verifies
each active actionable finding and implements any required fix. Gizmo integrates
the handoff, pushes the result, leaves the targeted GitHub reply, and resolves
the conversation. Gizmo also coordinates findings that require no change.

This skill does not initiate reviews. The PR delivery workflow dispatches
complete validation first, then requests one exact-head Codex review without
waiting. Review collection and hosted checks proceed concurrently, and their
findings form one repair batch. Codex is the sole automatic provider. Cursor
Bugbot remains inactive.

## Problem Pattern

Agents sometimes inspect only inline review threads and miss actionable findings
in a top-level review body. They also sometimes fix a finding in code and resolve
the conversation without documenting the fix and validation, or resolve a
stale-looking comment without recording why it no longer applies. That hides the
review reasoning from the PR timeline and makes later agents rediscover it.

## Preferred Pattern

Gizmo builds one checklist from inline review threads, submitted review bodies,
and human PR comments from every head. It verifies each finding against the
current code and routes every actionable item to its functional owner.

For each routed item, the responsible team agent:

1. Verifies the finding against current code.
2. Uses reviewer-provided agent prompts as context, not as blind patches.
3. Implements the minimal correct fix when a change is required.
4. Returns focused validation and a concise explanation to Gizmo.

Gizmo integrates the verified handoff, completes applicable validation, and
pushes the result. It then applies the handling rule for the feedback target:

- **Inline conversation:** Reply on the original target. Resolve it only after
  the finding is fixed or explicitly invalidated.
- **Top-level PR comment:** Minimize the original comment with GitHub's
  `RESOLVED` classifier after addressing it. The comment remains visible in
  inspection output. Readiness blocks until that explicit state exists.
- **Review body without a thread:** Keep the actionable item in the delivery
  checklist and final handoff. Do not post a broad or duplicative PR comment.

When no change is required, Gizmo records the team's verified rationale.

Inspect the currently available feedback before merge or handoff. Proceed when
all actionable items are handled, Nook's applicable repository-owned checks are
green, and the unresolved-thread query is clear. Request exact-head review
during hosted validation rather than after repository-owned checks finish.

## Scope

Applies to:

- Pull requests in this repository.
- Human PR review comments and conversations.
- Codex review findings and submitted review bodies.
- Findings already posted by any other reviewer, including Cursor Bugbot.
- Equivalent automated review feedback with a concrete actionable finding.

Does not apply to:

- Already-resolved review threads.
- Outdated threads that are clearly addressed by a later commit, except when the
  PR still shows them as unresolved; in that case, reply with the addressing
  commit/context before resolving.
- Non-actionable summaries, praise, or status-only bot messages.
- Reviews or comments from optional services that have not arrived. No external
  reviewer is a required exception.

## Examples

- Before: Gizmo implements a fix and resolves the thread without a reply.
- After: the responsible team implements and validates the fix. Gizmo
  integrates it, pushes, posts the targeted reply, and then resolves.
- Before: Gizmo resolves an outdated formatting comment because it looks
  obsolete.
- After: the responsible team verifies the current file. Gizmo replies with the
  addressing commit and proof before resolving.
- Before: Gizmo inspects only unresolved inline threads and misses a P1 finding
  in the submitted Codex review body.
- After: Gizmo checks submitted reviews, routes the finding, and tracks any
  unthreaded result in the handoff.
- Before: Gizmo leaves one generic review-audit comment for several findings.
- After: Gizmo replies only on targets that support a specific reply. It tracks
  unthreaded review-body items in the handoff.

## Application Checklist

- [ ] Gizmo fetches submitted reviews, active review threads, and PR comments.
- [ ] Gizmo inspects review bodies and top-level PR comments from every head.
- [ ] Gizmo builds a checklist for every active actionable finding.
- [ ] Gizmo routes each finding to the responsible team agent.
- [ ] The team agent verifies the finding before editing.
- [ ] The team agent implements the minimal correct fix when required.
- [ ] The team agent returns focused proof and any no-change rationale.
- [ ] Gizmo integrates verified handoffs and runs `task loom:pre-push` when files
      changed.
- [ ] Gizmo uses focused `task remote` jobs when useful, then explicitly triggers
      complete PR validation.
- [ ] Gizmo pushes changed code or documentation.
- [ ] Gizmo leaves a targeted reply with the fix, validation, or no-change
      rationale when GitHub supports one.
- [ ] Gizmo minimizes each handled top-level PR comment as `RESOLVED`.
- [ ] Gizmo resolves a conversation only after the targeted reply is visible.
- [ ] Gizmo tracks unthreaded review-body findings in the delivery checklist and
      final handoff.
- [ ] Gizmo re-queries submitted reviews and unresolved threads before handoff.

## GitHub Queries

Record the current head before interpreting submitted review bodies. Include
each review's `commit_id` so a finding attached to an older push is not mistaken
for a current-head finding:

```bash
head_sha="$(gh pr view <pr-number> --json headRefOid --jq .headRefOid)"
gh api repos/meta-secret/nook/pulls/<pr-number>/reviews \
  --jq ".[] | {user: .user.login, state, body, html_url, commit_id, current_head: (.commit_id == \"$head_sha\")}"
```

Fetch inline review conversations with their resolution and outdated state. The
`--paginate` form follows `reviewThreads` beyond the first 100 entries by using
GitHub CLI's required `$endCursor` variable:

```bash
gh api graphql --paginate \
  -F owner=meta-secret \
  -F repo=nook \
  -F number=<pr-number> \
  -f query='query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid
        reviewThreads(first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 100) {
              nodes {
                id
                author { login }
                body
                url
                createdAt
              }
            }
          }
        }
      }
    }
  }'
```

Build the actionable checklist from every unresolved thread and every submitted
review body, including feedback from older heads. An older thread that remains
unresolved still needs a targeted reply explaining the addressing commit or why
it no longer applies before resolution. A substantive review body without
inline comments remains a readiness blocker. When a review has inline comments,
retain its body in inspection output and use those threads' resolution state as
the deterministic handled state.

## Validation

Gizmo uses GraphQL or `gh pr view`/`gh api` to confirm zero unresolved actionable
review threads. It also inspects submitted reviews and PR comments from every
head for remaining actionable items.

Gizmo reports:

- complete repository-owned validation state;
- the unresolved-thread query result; and
- any unthreaded actionable review-body item in the handoff.

This workflow does not request reviewers or wait for checks to change state.
