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
- When a complete feature needs multiple bounded pull requests:
  - keep one feature summary;
  - create one ordered focused issue for each slice;
  - prefer module-, package-, or layer-owned slices with stable interfaces; and
  - complete the full sequence instead of treating later slices as optional.

When implemented work moves between pull requests, preserve it first.

- Create the successor branch from the full-work commit.
- Open the linked draft successor PR.
- Record both PRs and their order in Workbench.
- Map every removed file and behavior to the successor.
- Reduce the predecessor only after that evidence is durable.

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
   - Record an ordered native GitHub Stacked Pull Request sequence for a feature
     above 2,000 authored changed lines or an in-progress PR that may exceed the
     ceiling. Exactly 2,000 may remain one PR.
   - Use same-repository predecessor branches as temporary GitHub bases,
     cross-link adjacent PRs, register them as one GitHub-recognized stack, and
     record bottom-up merge order. Prefer `gh stack`; the GitHub website is also
     valid. Stacking is not required for small independent PRs below the
     ceiling.
   - If native stack operations are unavailable, stop and record the delivery
     blocker. Do not use an informal PR chain or add a third-party dependency.
   - Open and link the successor draft PR before reducing an implemented PR.
   - Record a preservation inventory for every removed file and behavior.
   - Keep each issue inside one cohesive module, package, layer, or
     responsibility.
   - Keep acceptance criteria independently deliverable and testable.
   - Record one positive authored additions-plus-deletions estimate at or below
     2,000 for every consecutively numbered slice; require their sum to equal
     the complete feature estimate.
   - After each predecessor merges, retarget the immediate successor to `main`,
     update it from current `origin/main`, re-measure authored additions plus
     deletions, and validate the new exact head before its bottom-up squash
     merge.
6. Link the parent feature, dependencies, historical issue context, and Nook
   PR.
7. Publish a worklog before completion or blocked handoff.
8. Re-open Workbench `main` and verify links and state.

## Validation

Run `node scripts/validate.mjs` in a Workbench checkout and inspect the rendered
Markdown on GitHub. Full workflow: [workflows/issues.md](../workflows/issues.md).
