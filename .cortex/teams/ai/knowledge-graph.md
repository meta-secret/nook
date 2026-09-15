# AI Team Knowledge Graph

Load only the category that owns the assigned AI functionality.

## Team contract

- [AI team agent contract](AGENTS.md)

## Architecture and expert registries

Use these documents for AI runtime design and read-only expert routing.

- [Module expert registry](architecture/module-experts.md)
- [Structural refactoring expert registry](architecture/refactoring-experts.md)
- [Core agent-first beliefs](design-docs/core-beliefs.md)
- [Design document catalog](design-docs/index.md)

## Cortex authoring and maintenance

Use these skills when creating, moving, reviewing, or repairing Cortex.

- [Cortex writer](dynamic-skills/cortex-writer.md)
- [Cortex article structure](dynamic-skills/cortex-article-structure/SKILL.md)
- [Cortex document navigation](dynamic-skills/cortex-document-map/SKILL.md)
- [Cortex consistency](dynamic-skills/cortex-consistency/SKILL.md)
- [Delegation visualization](dynamic-skills/delegation-visualization/SKILL.md)
- [Cortex refactoring expert](dynamic-skills/cortex-refactoring-expert.md)
- [Dynamic skill authoring](dynamic-skills/dynamic-skill-authoring.md)
- [Executable skill host](dynamic-skills/executable-skill-host/SKILL.md)
- [Skill template](dynamic-skills/_template.md)
- [Project skill registry](dynamic-skills/index.md)

## AI expertise

Use these skills for bounded analysis and typed AI-owned boundaries.

- [Code refactoring expert](dynamic-skills/code-refactoring-expert.md)
- [Internal API expert](dynamic-skills/internal-api-expert.md)
- [Module expert](dynamic-skills/module-expert.md)
- [System coherence synthesizer](dynamic-skills/system-coherence-synthesizer.md)

## Knowledge lifecycle

Use these authorities for product knowledge and evidence-backed promotion.

- [Product specification lifecycle](dynamic-skills/product-spec-lifecycle.md)
- [Agent self-improvement](dynamic-skills/self-improvement.md)

## AI workflows

Use these workflows for AI-owned skills and cross-package changes.

- [Dynamic skills workflow](workflows/dynamic-skills.md)
- [Structural refactoring](workflows/structural-refactoring.md)
- [Cross-package changes](workflows/monorepo.md)

## Loom reference

- [Loom tools](references/loom-tools.md)

## Team topology

- [Docker cache specialist activation](architecture/docker-cache-specialist-activation.md)
  defines deterministic SRE routing from cache-health telemetry.

- [AI Team Gizmo](gizmo/knowledge-graph.md) coordinates bounded AI-team mechanics.
- [Loom specialist](loom-specialist/knowledge-graph.md) handles packeted AI-owned Loom work.
- [Cortex specialist](cortex-specialist/knowledge-graph.md) handles packeted AI-owned Cortex work.

AI dispatch uses actual admission results from the active harness. Every
dependency-ready disjoint specialist is attempted immediately and concurrently. Temporary
admission refusals queue for retry when capacity releases. Host or session
allocation is current availability, not an architecture or product limit. A
dispatch wave is not pre-checked or budgeted against a numeric limit. Fixed
numeric agent or subagent concurrency caps are never encoded, inferred, or
repeated.
