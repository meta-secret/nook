---
name: cortex-document-map
description: Audit Nook Cortex navigation, ownership graphs, and canonical index structure.
---

# Nook Cortex Navigation

## Purpose

Route people and agents to Nook's owning Cortex context without copying
upstream authoring practices or another document's headings.

Meta-Cortex owns generic graph and article rules. Follow its
[knowledge-graph practice](../../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/knowledge-graphs.md)
and [article-structure practice](../../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/article-structure.md).
Nook graph placement and topology are defined below and in the
[root knowledge graph](../../../../knowledge-graph.md).

## Nook graph topology

Nook has one root router, a Gizmo Prime graph, six engineering and operational
owner graphs, and shared knowledge.

- The root graph selects Gizmo Prime, Delivery Pipeline, AI, development core,
  security, SRE, web development, or shared context.
- The Delivery Pipeline graph routes its direct `gizmo` and `pr-lifecycle`
  child contexts.
- The Delivery Pipeline `pr-lifecycle` child owns bounded feature PR mechanics.
- Gizmo Prime owns end-to-end feature delivery.
- The six engineering and operational owner graphs index documents owned by
  their teams: Delivery Pipeline, AI, development core, security, SRE, and web
  development.
- One Team Gizmo coordinates the six Nook contexts under Prime. Team-specific
  Gizmo paths adapt those contexts for the single coordinator.
- The shared graph indexes genuinely cross-team documents.
- Each Nook document belongs to one owning graph. The root graph does not index
  child documents directly, and one child graph does not index another
  context's documents.

**Prohibited:** launch separate AI and web coordinators because their contexts
have separate graphs.

**Preferred:** the existing Team Gizmo supplies the AI and web contexts to their
bounded worker assignments.

## Nook document placement

When adding or moving a Nook document:

1. Select its owning context from the [root graph](../../../../knowledge-graph.md)
   and confirm placement in that team's graph.
2. Put the document under its owning context and link it once from that graph.
3. Remove obsolete ownership links and update direct callers when a path changes.
4. Update the central [Nook skill registry](../index.md) when a skill card is
   added, moved, or retired.
5. Keep Delivery Pipeline's `gizmo` and `pr-lifecycle` children beneath its
   team graph.

Use the supplied context and the upstream
[assignment-context rules](../../../../../.meta-cortex/teams/AGENTS.md#assignment-context)
for general context loading. An assigned Cortex writer works from the supplied
AI context and relevant authorities without restarting root routing.

## Validation

The required pull request path runs `task loom:cortex-audit` in
`pr-verification`. The policy path `ci:pr:tests:policy-with-delivery-helpers`
invokes `preflight:repository-policy`; its Docker stage inherits
`loom-verify` and runs `task loom:verify` plus the document-map audit. Hosted
execution is the default; required hosted checks remain mandatory. A local run
of `task loom:cortex-audit` is a diagnostic governed by the root
[delivery and validation policy](../../../../AGENTS.md#delivery-and-validation)
and never replaces the hosted result. Do not invoke unrelated or broader local
preflight targets. A specific preflight target may be selected directly when it
is the smallest suitable diagnostic for the recorded task need under the root
policy. A selected repository task may also execute its declared necessary
Taskfile prerequisites through that task.

```bash
task loom:cortex-audit
task loom:verify
```

`task loom:cortex-audit` checks Nook graph topology, document ownership, index
uniqueness, and fragment-link rules. `task loom:verify` runs through the policy
Docker stage described above as a required hosted check. A local `loom:verify`
run is permitted only if that exact target is the smallest suitable diagnostic
for the recorded task need under the root policy, whether selected directly or
declared as a necessary prerequisite and invoked through the selected Task
target; local output never replaces the hosted result. Semantic review still
checks that the selected owner and links match the document's actual purpose.

The co-located read-only TypeScript application owns deterministic graph
topology diagnostics and legacy index migration rendering. The static
executable-skill host exposes its validated audit action through strict YAML;
discover it with `task skills:tools-list`. The action does not read or write
repository files, spawn processes, or coordinate agents.
