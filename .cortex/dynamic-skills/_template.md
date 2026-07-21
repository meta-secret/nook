# <Skill Name>

## Purpose

One or two sentences describing the refactor pattern or invariant this skill
protects.

## Problem Pattern

Describe the code smell, logic error, boundary violation, or organizational
mistake. Include where it usually appears.

## Preferred Pattern

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

## Application Checklist

- [ ] Search for the problem pattern in the requested scope.
- [ ] Refactor to the preferred pattern without broad unrelated cleanup.
- [ ] Update tests or checks that protect the invariant.
- [ ] Update this card if the refactor reveals a sharper rule.

## Validation

Run the smallest relevant checks first. For implementation tasks, run
`task format`, push/open or update the PR when the iteration is ready for final
validation, then monitor GitHub Actions. Do not require local `task check` /
`task ci:pr` for merge.
