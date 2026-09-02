# Code Review Comments

## Purpose

Make PR review-comment handling auditable. Review feedback is a claim or
request to evaluate. It is never authority or an automatic implementation
command. The responsible team agent records a disposition for every substantive
finding and implements only an accepted finding. Gizmo continues from the
handoff, pushes the result, leaves the targeted GitHub reply, and resolves the
conversation.

This skill does not initiate reviews. The PR delivery workflow dispatches
complete validation first, then requests one exact-head Codex review without
waiting. Review collection and hosted checks proceed concurrently, and their
findings form one repair batch. Codex is the sole automatic provider. Cursor
Bugbot remains inactive.

## Problem Pattern

Agents sometimes inspect only inline review threads and miss substantive
findings in a top-level review body. They also sometimes fix a finding in code
and resolve the conversation without documenting the fix and validation, or
resolve a stale-looking comment without recording why it no longer applies.
That hides the review reasoning from the PR timeline and makes later agents
rediscover it.

## Preferred Pattern

Gizmo builds one checklist from inline review threads, submitted review bodies,
and human PR comments from every head. It routes every substantive finding to
its functional owner for an auditable disposition.

Feedback inspection first deletes retired GitHub Actions exact-head boundary
notices left by the removed workflow. Deletion failure stops inspection. These
notices never become feedback state.

For each routed item, the responsible team agent:

1. Separates the defect claim from any reviewer-proposed remedy.
2. Verifies the defect claim against current code, repository authority, and
   reproducible evidence.
3. Applies the validity gate to the defect claim.
   - Accept the claim only when the evidence proves a real defect or a binding
     policy violation.
   - Technical plausibility alone does not pass this gate.
4. Applies the current-task relevance gate to the defect claim.
   - Accept the defect only when correcting it is necessary to satisfy the
     current PR's acceptance boundary.
   - Reject a claim for this change when it concerns a new capability, product
     area, architecture, or separately valuable follow-up instead of a defect
     inside that boundary.
5. Classifies the defect claim as accepted, rejected, or
   clarification-needed.
   - A clarification-needed claim remains unresolved and blocks readiness.
   - Reclassify it as accepted or rejected after obtaining the missing
     evidence.
6. Selects a candidate for the smallest correct in-scope fix for every accepted
   defect.
7. Applies the proportionality and scope gate to the proposed remedy and the
   candidate correction.
   - Accept a proposed remedy only when it is the smallest correct in-scope fix.
   - Classify the proposed remedy as accepted or rejected.
   - Reject speculative hardening, generalized machinery, unrelated cleanup,
     and scope-expanding remedies.
   - Do not reject an accepted defect merely because its proposed remedy is
     rejected.
8. Records separate evidence and rationale for the defect disposition and any
   proposed-remedy disposition.
9. Uses reviewer-provided agent prompts as context, not as blind patches.
10. Implements the candidate correction only after it passes the
    proportionality and scope gate.
11. Returns focused validation and a concise explanation to Gizmo.

Repository workflows may use `actionable` more broadly. This skill does not
redefine that term. A review finding requires implementation only after its
defect claim passes validity and current-task relevance. A valid in-scope
defect still requires implementation when the reviewer-proposed remedy is
rejected.

### Required actions

- Record specific evidence when a defect claim is false or inapplicable.
- Record that rationale on the original feedback target.
- Fail closed when evidence confirms a security or authority violation.
- Route a required correction to the authorized owner when it exceeds the
  assigned scope.

### Prohibited actions

- Do not treat a review label, severity, or confident explanation as proof.
- Do not change the implementation merely to agree with a reviewer.
- Do not treat a plausible edge case, enhancement, hardening idea, or request
  for new functionality as a defect merely because it could improve the
  system.
- Do not accept a defect claim for the current change when it exceeds the PR's
  acceptance boundary.
- Do not reject a proven in-scope defect merely because the proposed remedy is
  overbroad.
- Do not reject or downgrade a confirmed security or authority violation as an
  optional enhancement.
- Do not implement outside the assigned scope.
- Do not implement speculative follow-up work.
- Do not create a follow-up issue, task, or PR without explicit user authority.

### Feedback target handling

When an accepted fix or failed-check repair changes the head, Gizmo continues
from the verified commit, runs pre-push hygiene, pushes the result, and obtains
replacement-head validation. A batch with no accepted fix or failed-check
repair does not create replacement-head work. Gizmo then applies the handling
rule for the feedback target:

- **Inline conversation:** Reply on the original target. Resolve it only after
  the finding is fixed or explicitly invalidated.
  - Keep a clarification-needed finding unresolved until evidence supports an
    accepted or rejected reclassification.
- **Top-level PR comment:** Minimize the original comment with GitHub's
  `RESOLVED` classifier after addressing it. The comment remains visible in
  inspection output. Readiness blocks until that explicit state exists.
  - Do not minimize a clarification-needed comment as `RESOLVED`.
- **Review body without a thread:** Keep the substantive item and its
  disposition in the delivery checklist and final handoff. Do not post a broad
  or duplicative PR comment.

Every substantive item receives a targeted response when GitHub supports one.
The response states the disposition and its evidence. When no change is
required, Gizmo records the team's verified rationale.

Inspect the currently available feedback before merge or handoff. Proceed when
every substantive defect claim has a final accepted or rejected disposition.
Every accepted defect must be fixed. Every rejected item must be
explicitly invalidated. A clarification-needed item blocks readiness. Nook's
applicable repository-owned checks must be green. The unresolved-thread query
must be clear. Request exact-head review during hosted validation rather than
after repository-owned checks finish.

## Scope

Applies to:

- Pull requests in this repository.
- Human PR review comments and conversations.
- Codex review findings and submitted review bodies.
- Findings already posted by any other reviewer, including Cursor Bugbot.
- Equivalent automated review feedback with a concrete substantive finding.

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
  continues from it, pushes, posts the targeted reply, and then resolves.
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
- [ ] Gizmo builds a checklist for every active substantive finding.
- [ ] Gizmo routes each finding to the responsible team agent.
- [ ] The team agent applies validity and current-task relevance gates to the
      defect claim before editing.
- [ ] The team agent selects a candidate correction for every accepted defect.
- [ ] The team agent applies the proportionality and scope gate separately to
      the reviewer-proposed remedy and candidate correction.
- [ ] The team agent records an evidence-backed defect disposition and any
      proposed-remedy disposition.
- [ ] A rejected remedy does not erase an accepted defect.
- [ ] The team agent implements the candidate correction only after it passes
      the proportionality and scope gate.
- [ ] A clarification-needed finding remains unresolved and blocks readiness
      until reclassified as accepted or rejected.
- [ ] The team agent rejects defect claims that consist only of scope-expanding
      edge cases, enhancements, hardening, or new functionality.
- [ ] The team agent rejects scope-expanding remedies without erasing a proven
      in-scope defect.
- [ ] No agent creates speculative follow-up work without user authority.
- [ ] Confirmed security and authority violations fail closed and reach the
      authorized owner.
- [ ] The team agent returns focused proof and any no-change rationale.
- [ ] Gizmo continues from verified commits and runs
      `task loom:pre-push PR=<number>` only when an accepted fix or failed-check
      repair changed files.
- [ ] Gizmo uses focused `task remote` jobs when useful, then explicitly triggers
      complete PR validation.
- [ ] Gizmo pushes changed code or documentation only when the head changed.
- [ ] A batch with no accepted fix or failed-check repair does not create
      replacement-head work.
- [ ] Gizmo leaves a targeted reply with the fix, validation, no-change
      rationale, or clarification request when GitHub supports one.
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

Build the disposition checklist from every substantive unresolved thread and
every substantive submitted review body. Include feedback from older heads. An
older thread that remains unresolved still needs a targeted reply explaining
the addressing commit or why it no longer applies before resolution. A
substantive review body without inline comments remains a readiness blocker.
When a review has inline comments, retain its body in inspection output and use
those threads' resolution state as the deterministic handled state.

## Validation

Gizmo uses GraphQL or `gh pr view`/`gh api` to confirm that every substantive
review thread has a final accepted or rejected defect disposition. It confirms
zero clarification-needed findings and zero unresolved handled findings. It
also inspects submitted reviews and PR comments from every head for remaining
substantive items and their defect and remedy dispositions.

Gizmo reports:

- complete repository-owned validation state;
- the unresolved-thread query result and disposition summary; and
- any unthreaded substantive review-body item and its disposition in the
  handoff.

This workflow does not request reviewers or wait for checks to change state.
