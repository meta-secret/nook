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
estimate. The delivery shape must say whether one PR can complete the feature.
For a multi-PR feature, list each ordered, module-focused slice with its
acceptance evidence. Use `None` when no public or cross-module interface
changes.

This repository is public. Do not quote, copy, or lightly reformat the source
task. Do not include a raw prompt, transcript, conversational filler, secrets,
credentials, vault or private user data, environment values, raw logs, local
paths, internal hostnames or addresses, or unnecessary infrastructure details.
The safety review must explicitly confirm these exclusions without naming any
credential or environment variable.

Do not inspect or edit product files. Do not run Git commands. Your only
filesystem change must be `.nook-workbench-plan.md`.
