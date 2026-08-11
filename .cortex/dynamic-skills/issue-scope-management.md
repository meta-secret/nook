# Workbench Scope Management

## Purpose

Preserve deferred, risky, blocked, or out-of-scope work in the versioned
development cycle instead of losing it in chat or a flat GitHub issue list.

## Preferred pattern

Search `meta-secret/nook-workbench` first. Update the existing feature and
focused Markdown record when it owns the work; otherwise create
`issues/<feature>/README.md` plus the smallest independently deliverable issue
files. Preserve existing progress and decisions, link the Nook PR, and publish a
task worklog.

When a complete feature needs more than one bounded pull request, keep one
feature summary and create an ordered focused issue for each slice.

Prefer module-, package-, or layer-owned slices with stable interfaces.

Complete the sequence instead of treating later slices as optional follow-up
work.

## Scope

Apply when work is described as too large, risky, blocked, deferred, future, or
outside the current PR. Do not apply to a fully completed in-scope task merely
to generate bookkeeping.

## Safety

- Never claim another owner's `in_progress` record.
- Never mutate another active task's branch, pull request, review state, checks,
  or merge state.
- Require an explicit handoff before ownership changes.
- Never erase prior findings, decisions, blockers, or validation evidence.
- Only `status: ready` plus `automation: agent` authorizes automation.
- Never store prompts, chats, secrets, credentials, vault data, private user
  information, environment values, or raw logs.

## Checklist

- [ ] Search Workbench issues and worklogs with user and code vocabulary.
- [ ] Inspect likely feature summaries, dependencies, owners, status, and PRs.
- [ ] Treat every other active task as read-only.
- [ ] Update the existing record or create a focused non-duplicate.
- [ ] Record the ordered issue and PR sequence for a feature above 5,000
      authored changed lines.
- [ ] Keep each issue inside one cohesive module, package, layer, or
      responsibility.
- [ ] Keep acceptance criteria independently deliverable and testable.
- [ ] Link parent feature, dependencies, historical issue context, and Nook PR.
- [ ] Publish a worklog before completion or blocked handoff.
- [ ] Re-open Workbench `main` and verify links and state.

## Validation

Run `node scripts/validate.mjs` in a Workbench checkout and inspect the rendered
Markdown on GitHub. Full workflow: [workflows/issues.md](../workflows/issues.md).
