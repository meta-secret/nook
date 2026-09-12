---
name: cortex-document-map
description: Audit Cortex document navigation, ownership graphs, and canonical index structure.
---

# Cortex Document Navigation

## Purpose

Route humans and agents to the smallest relevant Cortex context without
duplicating each document's heading hierarchy.

## Graph topology

Cortex has one root router and owning graphs for delivery controllers,
engineering teams, and shared knowledge.

- The root graph selects dev manager, Gizmo, PR Steward, AI, development core,
  security, SRE, web development, or shared context.
- The dev-manager graph owns dev publication, dev PR creation/update, slow
  evidence, readiness, and fast-forward promotion policy.
- The Gizmo graph owns feature delivery and local landing requests.
- PR Steward owns authorized mechanics, not delivery policy.
- Five team graphs index documents owned by their engineering teams.
- Dev manager is a manually operated controller, not a Loom child team.
- The shared graph indexes genuinely cross-team documents.
- Every document has exactly one owning graph.
- The root graph does not index child documents directly.
- One child graph does not index another context's documents.

## Knowledge-graph shape

Knowledge graphs are document catalogs, not generated tables of contents.

- Group documents under meaningful categories.
- Give each category a short routing sentence when its purpose is not obvious.
- Link each owned document exactly once.
- Do not add fragment links to document headings.
- Do not repeat a document's internal structure in a graph.
- Keep lists vertical and scannable. Do not create horizontal link chains.

The target document's headings provide section-level navigation after the
document is selected.

## Selective context loading

1. Read the root router.
2. Select one primary owning context.
3. Read that context's `AGENTS.md` and graph.
4. Select one relevant category.
5. Open only the documents needed for the assigned functionality.
6. Read only the relevant headings.
7. Stop when the task contract has enough authoritative context.

Agents must not preload all graphs, all team documents, or the shared corpus.
A foreign-team implementation requirement returns to Gizmo. A team subagent
does not load the Gizmo graph.

A selected team authority may link the smallest task-relevant set of
foreign-team skills as read-only engineering policy. The worker opens those
skills directly without opening the foreign team's graph. Skill consumption
does not require delegation. A foreign-team writer still requires an explicit
expertise contract.

## Individual document structure

Every Cortex document except a knowledge graph has:

1. exactly one H1 title at the beginning;
2. an optional short introduction; and
3. content organized under semantic H2 and H3 headings.

Individual documents do not contain inline `Relationships` or `Document map`
sections. Their natural heading hierarchy is the local map. Vale owns this
case-sensitive H2 lint rule; knowledge-graph documents are excluded because
they own centralized navigation.

## Application procedure

1. Determine whether the document belongs to dev manager, Gizmo, PR Steward,
   AI, development core, security, SRE, web development, or shared knowledge.
2. Place it under the owning context.
3. Add one document-level link to that context's graph.
4. Remove obsolete links from the previous graph.
5. Update direct callers and the canonical skill catalog.
6. Defer executable audits to the dev-manager slow PR stage.

## Validation

Only in the dev-manager remote slow PR stage, run:

```bash
task loom:cortex-audit
task loom:verify
task preflight:loom-contracts
```

Loom enforces:

- the Gizmo, dev-manager, and five engineering team graphs exist;
- the root links these owning graphs;
- every document is indexed by its owner;
- graphs do not cross ownership boundaries;
- each graph indexes a document once; and
- graphs contain no fragment-link duplication.

Vale rejects exact `## Relationships` and `## Document map` headings in
individual Cortex documents. `task vale:cortex` belongs only to the dev-manager
remote slow PR stage, not local or feature validation.

The co-located read-only TypeScript application owns deterministic graph
topology diagnostics and legacy index migration rendering. Vale owns prose and
heading lint rules that its Markdown scopes express directly. The project is
automatically installed and verified with every executable skill. Discover its
bounded audit action with
`task skills:tools-list`. The action does not read or write repository files,
spawn processes, or coordinate agents.
