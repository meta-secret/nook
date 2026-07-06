# Issue Scope Management

## Purpose

Ensure agents do not silently drop work when functionality is too large, risky,
blocked, or out of scope. Missing work must be captured in GitHub issues with a
clear aggregate issue and focused sub-issues.

## Problem Pattern

An agent implements part of a feature, then says the rest is "follow-up" or "out
of scope" only in chat or a PR summary. Future agents cannot discover the missing
work from GitHub's flat issue list, and existing issues may already have owners,
comments, or related PRs that get ignored.

## Preferred Pattern

Before deferring work, search existing issues, inspect likely matches, update the
right aggregate issue or create one, and create or attach focused sub-issues for
each missing deliverable. Use GitHub sub-issue relationships for parent/child
tracking; if the CLI cannot attach them, use the GitHub UI or API rather than
skipping the relationship. Also keep explicit parent/sub-issue links in issue
bodies for CLI and search visibility. Respect existing assignees, labels,
milestones, and comments.

## Scope

Applies to:

- Any Nook task where requested functionality will not be fully implemented.
- PR handoffs that mention follow-up work, blockers, risky scope, or deferred
  acceptance criteria.
- Issue authoring and issue cleanup performed by agents.

Does not apply to:

- Tiny TODOs that are fully fixed in the same PR before handoff.
- User-explicit requests to avoid GitHub issue changes.

## Examples

- Before: "CRDT graph merge is out of scope for this PR."
- After: update the event-log aggregate issue, create/attach a sub-issue for
  CRDT graph merge semantics, link the PR, and explain the deferral.
- Before: create a duplicate "sync follow-up" issue without searching.
- After: search existing sync/event-log issues, update the matching aggregate,
  and only create a new focused sub-issue if no focused issue exists.
- Before: edit an issue owned by another agent and replace its checklist.
- After: preserve the body, add a comment with new findings, and avoid changing
  assignment/status unless explicitly requested.

## Application Checklist

- [ ] Identify each missing deliverable before calling it deferred or out of
      scope.
- [ ] Search all GitHub issues with broad and narrow keywords.
- [ ] Inspect likely aggregate and focused issues, including comments,
      assignees, labels, milestone, state, and related PRs.
- [ ] Choose the existing aggregate issue or create one if none exists.
- [ ] Update the aggregate with current status and sub-issue links without
      deleting existing information.
- [ ] Create or attach focused sub-issues for independently deliverable missing
      work.
- [ ] Use GitHub sub-issue relationships, and include explicit parent/sub-issue
      links in issue bodies.
- [ ] Add PR links, affected code paths, acceptance criteria, and the reason for
      deferral.
- [ ] Avoid closing, retitling, reassigning, relabeling, or remilestoning issues
      owned by others unless explicitly required and documented.
- [ ] Verify the final issue hierarchy and mention issue numbers in the handoff.

## Validation

Use `gh issue list` and `gh issue view` to confirm the aggregate issue and
sub-issues exist, cross-link correctly, and preserve existing team-owned
metadata. For markdown-heavy issue bodies, use `--body-file` and re-read the
issue after editing.
