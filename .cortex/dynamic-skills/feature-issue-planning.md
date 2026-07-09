# Feature Issue Planning

## Purpose

Keep feature-sized GitHub work manageable for both humans and agents by creating
a mandatory milestone, one parent issue, focused sub-issues, and a small label
set for every feature issue pack.

## Problem Pattern

A user asks an agent to "create issues for a feature" and the agent creates a
flat list of independent issues. GitHub's issue list stays technically correct,
but developers lose the feature boundary, agents cannot tell which tickets
belong together, and labels alone become too weak to manage progress.

## Preferred Pattern

For every Nook feature issue pack, always create or reuse a milestone first. This
is a hard project requirement. Use a predictable title such as
`Feature: <feature name>` unless the user names the milestone.

Then create or update:

- One parent issue that owns the feature narrative, product decisions, rollout
  shape, open questions, and sub-issue checklist.
- Focused sub-issues for independently deliverable implementation, test,
  security, migration, documentation, or UX slices.
- A feature label such as `feature:<slug>` plus existing area, type, risk, and
  platform labels where useful.
- Milestone assignment on the parent issue and every sub-issue.
- Explicit parent/sub-issue links in issue bodies in addition to GitHub's
  sub-issue relationship.

Milestones are the required feature container. Labels are filters, not ownership.
Sub-issues are the execution plan. Projects are dashboards; prefer adding the
feature pack to one shared roadmap/project when useful, and do not create a new
GitHub Project for every feature unless the user asks or the work is truly
program-scale.

GitHub's public documentation does not document a hard limit on the number of
milestones. It does document one practical scale caveat: a milestone with more
than 500 open issues cannot be manually prioritized. Keep feature milestones far
below that size; split the feature if it grows that large.

## Scope

Applies to:

- User requests to create or organize GitHub issues for a Nook feature.
- Feature decomposition work performed before implementation starts.
- Follow-up issue packs created from large, risky, or deferred feature scope.

Does not apply to:

- A single small bug or chore where the user asked for exactly one issue.
- Direct user instructions to use an existing milestone or skip GitHub changes.
- Existing team-owned issues where changing the milestone would disrupt active
  work; comment and ask instead unless the user explicitly requested the move.

## Examples

- Before: create eight independent "distributed unlock" issues with only a
  shared label.
- After: create milestone `Feature: Distributed unlock`, create one parent issue
  for the security model and UX, create sub-issues for Rust primitives, WASM
  API, QR session exchange, UI flow, and end-to-end tests, attach all of them to
  the milestone and parent.
- Before: create a new GitHub Project for every feature request.
- After: use the milestone as the feature boundary and add the issues to an
  existing roadmap project only if a dashboard view is useful.

## Application Checklist

- [ ] Search existing milestones, issues, and labels before creating anything.
- [ ] Create or reuse the feature milestone first.
- [ ] Create or reuse a feature label.
- [ ] Create the parent issue with summary, product decisions, open questions,
      acceptance criteria, and a sub-issue checklist.
- [ ] Create focused sub-issues for each independently deliverable slice.
- [ ] Attach every issue in the pack to the milestone.
- [ ] Attach sub-issues to the parent with GitHub's sub-issue relationship and
      keep explicit links in the bodies.
- [ ] Preserve existing assignees, labels, milestones, comments, and ownership
      when updating existing issues.
- [ ] Report the milestone, parent issue, sub-issues, and labels back to the
      user.

## Validation

Use `gh` to verify the hierarchy and grouping after editing:

```bash
gh issue list --milestone "<milestone>" \
  --json number,title,state,labels,milestone,url
gh issue view <parent-number> \
  --json number,title,body,state,labels,milestone,url
```

If sub-issue attachment used the GraphQL API or the GitHub UI, re-open the
parent issue and confirm that GitHub shows the child relationship, not only a
markdown link.
