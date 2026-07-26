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

## Scope

Apply when work is described as too large, risky, blocked, deferred, future, or
outside the current PR. Do not apply to a fully completed in-scope task merely
to generate bookkeeping.

## Safety

- Never claim another owner's `in_progress` record.
- Never erase prior findings, decisions, blockers, or validation evidence.
- Only `status: ready` plus `automation: agent` authorizes automation.
- Never store prompts, chats, secrets, credentials, vault data, private user
  information, environment values, or raw logs.

## Checklist

- [ ] Search Workbench issues and worklogs with user and code vocabulary.
- [ ] Inspect likely feature summaries, dependencies, owners, status, and PRs.
- [ ] Update the existing record or create a focused non-duplicate.
- [ ] Keep acceptance criteria independently deliverable and testable.
- [ ] Link parent feature, dependencies, historical issue context, and Nook PR.
- [ ] Publish a worklog before completion or blocked handoff.
- [ ] Re-open Workbench `main` and verify links and state.

## Validation

Run `node scripts/validate.mjs` in a Workbench checkout and inspect the rendered
Markdown on GitHub. Full workflow: [workflows/issues.md](../workflows/issues.md).
