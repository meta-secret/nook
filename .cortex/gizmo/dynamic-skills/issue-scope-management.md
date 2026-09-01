# Workbench Scope Management

## Purpose

Preserve deferred, risky, blocked, or out-of-scope work in the versioned
development cycle instead of losing it in chat or a flat GitHub issue list.

## Preferred pattern

Use this ownership hierarchy:

- Search `meta-secret/nook-workbench` first.
- When an existing feature and focused Markdown record own the work:
  - preserve existing progress and decisions;
  - update those records;
  - link the Nook PR; and
  - publish a task worklog.
- Otherwise create `issues/<feature>/README.md` and the smallest independently
  deliverable issue files.
- Keep the feature inside one focused issue and one PR.
- Prefer a cohesive module, package, layer, or stable-interface boundary.
- Do not move implemented work into a successor PR as size recovery.

## Scope

Apply when work is described as too large, risky, blocked, deferred, future, or
outside the current PR. Do not apply to a fully completed in-scope task merely
to generate bookkeeping.

## Safety

- Never claim another owner's `in_progress` record.
- Never mutate another active task's branch.
- Never mutate another active task's pull request.
- Never reply to or resolve another active task's reviews.
- Never trigger another active task's checks.
- Never change another active task's merge state.
- Require an explicit handoff before ownership changes.
- Never erase prior findings, decisions, blockers, or validation evidence.
- Automation also requires an assigned Nook GitHub collaborator as owner.
- Never store prompts, chats, secrets, credentials, vault data, private user
  information, environment values, or raw logs.

## Application procedure

1. Search Workbench issues and worklogs with user and code vocabulary.
2. Inspect likely feature summaries, dependencies, owners, status, and PRs.
3. Treat every other active task as read-only.
4. Update the existing record or create a focused non-duplicate.
5. Bound the work:
   - Record one positive authored additions estimate at or below
     2,000 for the PR.
   - Keep the issue inside one cohesive module, package, layer, or
     responsibility.
   - Keep acceptance criteria deliverable and testable in that PR.
   - Copy the plan's stable Gizmo ID into the canonical `gizmo_id` frontmatter.
   - Do not split, stack, rebuild, or replace an oversized PR.
   - If planned work cannot fit below 2,000 authored additions, stop and record
     the blocker.
   - If review work reaches 3,000 authored additions, stop and produce the report required by
     [pull requests](../workflows/pull-requests.md#review-growth-stop).
6. Link the parent feature, dependencies, historical issue context, and Nook
   PR.
7. Publish a worklog before completion or blocked handoff.
8. Re-open Workbench `main` and verify links and state.

## Validation

Run `node scripts/validate.mjs` in a Workbench checkout and inspect the rendered
Markdown on GitHub. Full workflow: [workflows/issues.md](../workflows/issues.md).
