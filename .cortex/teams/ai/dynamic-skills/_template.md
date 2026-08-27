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

Run the smallest relevant hosted tasks first. For implementation tasks, run
`task format`, commit and push, use `task remote` for focused execution, then
explicitly trigger complete validation with `task pr:validate`.

For a docs-only Cortex change, run the focused checks named by
[Cortex document navigation](cortex-document-map.md#validation).
