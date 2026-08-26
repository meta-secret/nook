You are the planning phase for a Nook implementation task.

## Source task

${AGENT_TASK}

## Required output

Before any implementation agent runs, create `.nook-workbench-plan.md` in the
repository root. Write only this Markdown body, with each heading exactly once
and in this order:

```text
# Task plan

## Interpreted request

## Requirements

## Constraints and exclusions

## Change budget and PR sequence

- Estimated authored changed lines:
- Owning modules, packages, or layers:
- Public or cross-module interfaces:
- Delivery shape:
- Current PR estimated authored changed lines:
- Current PR slice and acceptance evidence:
- PR slices and acceptance evidence:

## Initial plan

## Completion evidence

## Safety review
```

Synthesize the complete development intent in your own words. Capture every
material functional, workflow, security, validation, and delivery requirement,
plus explicit assumptions or exclusions. Keep the execution plan small and
ordered.

Estimate additions and deletions for authored source, tests, documentation,
configuration, scripts, and workflow code. Exclude generated files, lockfiles,
snapshots, vendored sources, binary artifacts, and pure renames from the
estimate. Set `Delivery shape` to exactly `One PR` or `Multiple PRs`.
For a multi-PR feature, list each ordered, module-focused slice with its
acceptance evidence. Identify the first or currently authorized slice
separately. Its estimate must not exceed 3,015 authored changed lines. Use
`None` when no public or cross-module interface changes.

Target at most 3,000 authored changed lines per pull request. A 15-line
tolerance exists only for estimation noise; it is not extra feature capacity.
At 2,700 lines, inventory the logical domain changes and require `Multiple PRs`
with ordered semantic slices. Each dependent slice uses the previous slice as
its temporary stacked base. Independent slices use current `main`.

If planning replaces an in-progress oversized PR, require a successor branch
and linked draft PR from the last full-work commit before any scope reduction.
Require a Workbench inventory that maps every removed file and behavior to a
successor PR.

Write the current slice as `<scope>; Acceptance evidence: <observable proof>`.
Write every numbered PR slice in the same form. Never use `None`, `N/A`, or
another placeholder for a slice or its acceptance evidence.

A multi-PR result does not authorize implementation.

The feature summary and focused Workbench issues must be materialized first.
The scheduled workflow will stop after publishing this plan until that
hierarchy exists and a focused issue is dispatched.

This repository is public. Do not quote, copy, or lightly reformat the source
task. Do not include a raw prompt, transcript, conversational filler, secrets,
credentials, vault or private user data, environment values, raw logs, local
paths, internal hostnames or addresses, or unnecessary infrastructure details.
The safety review must explicitly confirm these exclusions without naming any
credential or environment variable.

You may inspect repository files and run read-only Git commands to ground the
estimate and ownership decision. Do not edit product files. Your only
filesystem change must be `.nook-workbench-plan.md`.
