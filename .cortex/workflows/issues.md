# GitHub Issue Management

Use this workflow whenever a task reveals missing functionality that is too
large, risky, blocked, or outside the current PR's safe scope. Agents must not
hide unfinished work in chat history or PR summaries alone.

GitHub issues are a shared, flat list used by many agents and humans. Manage
them carefully: search first, preserve existing ownership, prefer comments over
destructive edits, and keep related work discoverable through one aggregate
issue plus focused sub-issues.

## Trigger

Before an agent says any of the following, it must run this workflow:

- "too big for this PR"
- "too risky to implement now"
- "out of scope"
- "follow-up"
- "not implemented"
- "future work"
- "blocked by ..."

The workflow also applies when tests, review comments, or implementation work
discover missing functionality that the current PR will not finish.

## Required Issue Shape

Every broad problem needs one aggregate issue. The aggregate issue owns the
overall goal, current status, links to PRs, and the list of sub-issues.

Every independently deliverable missing part needs a focused sub-issue. A
sub-issue should have acceptance criteria small enough that another agent can
implement and validate it without rereading the entire original conversation.

Use GitHub's sub-issue relationship for parent/child tracking. If the local CLI
does not expose sub-issue attachment, use the GitHub UI or API; do not skip the
relationship. The issue body should still include explicit links so the
relationship remains understandable from the flat issue list, search results,
and CLI output.

## Search First

Before creating or editing issues, inspect existing work:

```bash
gh issue list --state all --search "<keywords> repo:meta-secret/nook" \
  --json number,title,state,labels,assignees,milestone,updatedAt,url
gh issue view <number> --json number,title,body,state,labels,assignees,milestone,comments,url
```

Search with both user-facing words and code terms. For cross-cutting work, also
search likely parent concepts such as `vault sync`, `event log`, `enrollment`,
`password envelope`, `schema`, or the affected package names.

## Choose Update vs Create

Update an existing issue when it already owns the broad problem or the exact
missing deliverable. Prefer a comment when adding new findings, implementation
notes, PR links, or validation gaps. Edit the issue body only when the issue
itself needs a durable checklist, acceptance criteria update, or parent/sub-issue
link.

Create a new issue when no existing issue covers the missing work. If no
aggregate issue exists, create the aggregate first, then create or attach
sub-issues underneath it. If an aggregate exists but the missing piece is
independently deliverable, create a sub-issue and link it to the aggregate.

Do not create duplicates. If overlap is uncertain, comment on the likely parent
with the finding and ask/mark that a sub-issue may be needed rather than
splitting ownership blindly.

## Team Safety

Issues are shared by a team of agents and humans. Before changing an issue,
check its assignees, labels, milestone, state, latest comments, and related PRs.

Agents must not:

- Close, reopen, retitle, reassign, relabel, or move milestones on someone
  else's active issue unless the user explicitly asked or the reason is obvious
  and documented.
- Remove existing body sections, checklists, links, or acceptance criteria while
  adding new information.
- Convert a focused issue into a broad aggregate if another aggregate already
  exists.
- Claim all sub-issues for themselves unless they are actively implementing
  them in the current task.

When in doubt, add a comment with the proposed relationship or missing scope
instead of rewriting the issue.

## Aggregate Issue Template

Use `--body-file` for markdown bodies with backticks or paths.

```markdown
## Summary

<one paragraph describing the whole problem>

## Current Status

- <what is already implemented or covered by PRs>
- <what remains missing>

## Sub-Issues

- [ ] #<sub-issue>: <focused deliverable>
- [ ] #<sub-issue>: <focused deliverable>

## Acceptance Criteria

- <end-to-end outcome for the aggregate problem>
- <invariants that must hold across sub-issues>

## References

- PR: #<number>
- Code: `<path>`
- Discussion: <link if available>
```

## Sub-Issue Template

```markdown
## Parent

Part of #<aggregate-issue>.

## Problem

<specific missing behavior or risk>

## Scope

- <what this issue must implement>
- <what this issue must not include>

## Acceptance Criteria

- <testable outcome>
- <required unit/e2e/docs coverage>

## Notes

- Found while working on PR #<number>.
- Deferred because <size/risk/blocker/out-of-scope reason>.
```

## Required Handoff

When deferring functionality, the final response or PR comment must include:

- The aggregate issue number.
- Each new or updated sub-issue number.
- A concise reason why the work was deferred.
- What was implemented in the current PR versus what remains.

Before handoff, re-open the issue list or issue views and verify that links and
relationships are visible.
