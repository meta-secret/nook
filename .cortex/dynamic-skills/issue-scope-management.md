# Workbench Scope Management

## Relationships

- [Workbench Issue Management](../workflows/issues.md)
  - Defines focused issue ownership and durable Workbench scope records.
  - Apply when implementation or delivery reaches this workflow boundary.

## Document map

- [Purpose](#purpose)
  - Preserves deferred or blocked work in the versioned Workbench lifecycle.
  - Read when work cannot safely remain in the current pull request.
- [Preferred pattern](#preferred-pattern)
  - Defines search-first update or creation of feature, issue, plan, and worklog records.
  - Read before publishing new scope-management context.
- [Scope](#scope)
  - Identifies the conditions that require durable issue management.
  - Read when classifying oversized, risky, blocked, or future work.
- [Safety](#safety)
  - Protects records owned by another active agent or task.
  - Read before mutating shared Workbench state.
- [Application procedure](#application-procedure)
  - Orders search, ownership, publication, and handoff actions.
  - Follow while applying this skill to a concrete task.
- [Validation](#validation)
  - Requires Workbench validation and rendered-link verification.
  - Read before reporting scope-management work complete.

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
- When a complete feature needs multiple bounded pull requests:
  - keep one feature summary;
  - create one ordered focused issue for each slice;
  - prefer module-, package-, or layer-owned slices with stable interfaces; and
  - complete the full sequence instead of treating later slices as optional.

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
   - Record the ordered issue and PR sequence for a feature above 5,000
     authored changed lines.
   - Keep each issue inside one cohesive module, package, layer, or
     responsibility.
   - Keep acceptance criteria independently deliverable and testable.
6. Link the parent feature, dependencies, historical issue context, and Nook
   PR.
7. Publish a worklog before completion or blocked handoff.
8. Re-open Workbench `main` and verify links and state.

## Validation

Run `node scripts/validate.mjs` in a Workbench checkout and inspect the rendered
Markdown on GitHub. Full workflow: [workflows/issues.md](../workflows/issues.md).
