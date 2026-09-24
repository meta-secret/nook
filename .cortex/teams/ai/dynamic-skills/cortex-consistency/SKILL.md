---
name: cortex-consistency
description: Compile Nook typed Cortex policy contracts and workflow bindings.
---

# Nook Cortex Consistency Compiler

Meta-Cortex [consistency](../../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/consistency.md)
owns generic authority and consistency rules.
This card owns Nook's closed policy registry and executable compilation.

## Deterministic contract compilation

The ownership boundary is explicit:

- This skill's co-located TypeScript application owns the contract types,
  registry, ownership mapping, policy checks, and deterministic verification.
- Loom only discovers repository Markdown and adapts parsed references into the
  skill request.
- Loom also adapts commands from inline and fenced code as inert facts.
- Markdown does not become executable state.
- The rules and their executable policy remain beside this procedure.

Only in the feature pull request's required-check stage, run the compiler through the
Cortex consistency command below. Never invoke it locally or in feature work.

```bash
task loom:cortex-audit
```

The command reports failures in `contractFindings`.

The co-located application is also a discoverable executable skill. These
invocations are likewise restricted to the feature pull request's required-check stage:

```bash
task skills:tools-list
task skills:run REQUEST_YAML='<cortexConsistency.compile request>'
```

The executable request contains parsed document paths and references. The
registry and policy semantics remain internal to this skill.

Request contract v2 adds the required `commands` collection to each document.
The former `cortex-consistency-compile-v1` transport is not accepted; callers
must regenerate the request through the current Loom Markdown adapter.

- Context ownership and policy applicability determine required policy imports.
- Authority and policy document paths are their contract identities.
- The registry does not repeat owner names beside those paths.
- Recognized authority paths determine context and policy ownership.
- A registered contract path without a recognized owner fails the audit.
- A foreign policy import requires a direct reference from the context authority.
- Direct references use Markdown syntax-tree semantics.
- Persisted-representation policy requires a schema-versioning authority.
- It also requires a legacy-decode or migration-test obligation.
- One policy discriminator selects the persisted contract and its obligations.
- Missing imports, references, authorities, or evidence obligations fail the
  Cortex audit.
- Registered workflow runtime bindings are closed policy.
- A missing required entrypoint fails the audit.
- An unregistered Task or Loom command fails the owning workflow audit.
- A retired entrypoint fails even when legacy implementation remains present.
- Native Team Agent workflows cannot bind repository journals as dispatch.

The registry covers only relationships promoted into its closed TypeScript
model. It does not infer meaning from Markdown or replace semantic review.
