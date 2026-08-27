# Module Expert Development

## Purpose

Route module analysis through one registered read-only expert and keep module
responsibilities separate from workflow roles.

## Problem Pattern

An agent loads broad repository context, mixes abstraction levels, and changes
providers and consumers before their external contract is clear.

Duplicated per-agent prompts then become stale copies of architecture rules.

## Preferred Pattern

Resolve the module in
[the expert registry](../architecture/module-experts.md).
Load only the task-selected authorities and skills allowed by that role.
Inspect only the relevant source at the exact baseline.

Analyze in this order:

1. Identify the consumer need.
2. Describe the module's current external API.
3. Name dependencies and consumers.
4. State behavior, security, and compatibility invariants.
5. Identify owning tests and focused validation.
6. Report the smallest provider change and parent actions.

Keep knowledge routing separate from write authorization. Invoke the registered
semantic role through the active harness as read-only. A separate
implementation worker may consume that evidence in a fresh isolated workspace
at the exact accepted baseline. The parent verifies its commit handoff before
integration.

## Scope

Apply when planning, reviewing, or implementing a change owned by a registered
production module.

Use `internal-api-expert` when a changed contract crosses a module boundary.

Do not use this skill to:

- grant a child write access;
- schedule successors;
- mutate GitHub or Workbench;
- route non-production research code as a production module.

## Examples

- For a new core capability, review the `core_expert` entry before touching the
  WASM consumer.
- For an authentication value type, begin with
  `authenticator_domain_expert` when that leaf owns the concept.
- For a presentation-only change, use `web_expert` and preserve Rust domain
  ownership.

## Application procedure

1. Read `.cortex/knowledge-graph.md` and the assigned team's knowledge graph.
2. Resolve one role contract in `architecture/module-experts.md`.
3. Select the smallest allowed authority and skill context for the task.
4. Verify the role contract and selection against the exact source commit.
5. Return findings directly through the harness.
6. Let a separately authorized implementation worker apply accepted findings.
7. Let the delivery parent verify acceptance and decide continuation.

## Validation

Run `task loom:module-experts:validate` after registry or role changes.
Run the role's focused validation selectors for product changes.
