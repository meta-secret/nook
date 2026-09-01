# Skill name

## Purpose

One or two sentences describing the refactor pattern or invariant this skill
protects.

## Problem pattern

Describe the code smell, logic error, boundary violation, or organizational
mistake. Include where it usually appears.

## Preferred pattern

Describe the desired structure or behavior. Name the owning module, abstraction,
or workflow when that matters.

## Scope

Applies to:

- `<package/module/path>`

Does not apply to:

- `<exceptions or boundaries>`

## Examples

- Before: `<file or symbol reference, or concise pseudocode>`
- After: `<file or symbol reference, or concise pseudocode>`

## Application procedure

1. Search for the problem pattern in the requested scope.
2. Refactor to the preferred pattern without broad unrelated cleanup.
3. Update tests or checks that protect the invariant.
4. Update this card if the refactor reveals a sharper rule.
5. Keep relationships and the document map synchronized with the card.

## Validation

For implementation tasks, run focused proof and required formatters. Commit
every resulting mutation in the allowed source or Cortex paths. Gizmo
integrates the handoff and runs `task loom:pre-push`. If hygiene mutates those
team-owned paths, the team returns a fresh formatted commit before Gizmo
continues from it, reruns hygiene, and pushes. Gizmo dispatches a relevant focused
remote task when the pushed head is not validation-ready. Gizmo dispatches
complete exact-head validation immediately when the head is ready.

For a docs-only Cortex change, run the focused checks named by
[Cortex document navigation](cortex-document-map/SKILL.md#validation).
