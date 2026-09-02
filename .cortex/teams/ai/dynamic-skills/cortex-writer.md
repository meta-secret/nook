# Cortex Writer — Low Cognitive Complexity

## Priority

This is a P1 documentation rule for every `.cortex` Markdown file.

- Dense prose that packs many facts into one sentence is a failed writing
  invariant.
- Static directory trees in documentation are a failed documentation invariant.
- ASCII art, ASCII box drawings, and text flowcharts are prohibited.
- Rendered Markdown tables are prohibited. Represent repeated fields and exact
  mappings as enclosed lists keyed by a bold primary item.
- A Cortex writer that reads, reviews, authors, or refactors a large list must
  split it into logical groups organized around the items' domains.
- Arbitrary chunking by item count does not satisfy this rule.
- Most Cortex instruction sets contain both positive and negative constraints.
  - Begin their instructional structure with `Required actions`, followed by
    `Prohibited actions`.
  - Place domain-specific groups beneath the correct branch.
  - Omit a branch only when the content genuinely contains no instruction of
    that kind.

## Purpose

Keep `.cortex` readable, maintainable, and accurate for agents and humans.

Cortex is optimized for AI legibility and structure:

- One sentence should carry one idea.
- Complex facts belong in short sentences, bullets, or lists.
- Use enclosed lists for repeated fields and exact mappings. Rendered Markdown
  tables are prohibited.
- Project structure is dynamic; documents must not contain static directory trees.
- ASCII graphics are hard for AI agents to parse; diagrams must use Mermaid (` ```mermaid `) or structured lists.

## Ownership and composition

This card is the single canonical generic Cortex writing policy.

- The task's team identity owns the meaning and edits in its Cortex scope.
- Loom adds this card, Cortex article structure, and Cortex consistency when a
  write claim overlaps `.cortex/**`.
- The three cards form the canonical Cortex authoring bundle.
- A team-specific authoring skill may add domain rules.
- That skill must use a domain-specific name.
- It must not wrap, copy, rename, or partially restate this card.
- Loading this AI-owned policy does not add an AI team identity.
- A separate AI task is required only when AI-owned routing, tooling, or Cortex
  governance must change.

## Problem Pattern

A writer packs many constraints, identities, failure modes, and commands into
one long sentence, or uses multi-column tables that create horizontal clutter.

Static directory trees and ASCII box diagrams are embedded into documentation.

The pattern creates predictable costs:

- Readers must hold too many clauses at once.
- Tables wrap poorly and cram complex facts.
- Static trees quickly become stale.
- ASCII graphics confuse AI agents.

Warning signs include:

- multiple independent facts joined by semicolons or "and";
- one sentence that names several actors with different credentials;
- one sentence that states a requirement, a failure mode, and an escape hatch;
- rendered Markdown tables used for any inventory or mapping;
- a large list that remains flat or uses item-count chunks instead of domain
  groups;
- positive and negative constraints interleaved inside one domain-specific
  group;
- nested conditions inside a single clause;
- ASCII directory trees (`├──`, `└──`) or nested file listings in Markdown;
- ASCII box drawings (`+---+`, `| |`) or manual ASCII flowcharts.

## Preferred Pattern

Split the idea before writing the final prose.

Instruction sets with both kinds of constraint use the paired branches below.

### Required actions

- **Atomic content**
  1. List each fact, rule, actor, or command as its own unit.
  2. Write one short sentence per unit when the fact stands alone.
- **List structure**
  1. Use a bullet list when several units share one topic.
  2. Split every large list into logical groups based on the items' domains.
     - Use meaningful headings or parent items that name the domains.
  3. Use a nested list only when a parent item owns clear children.
- **Enclosed structured lists**
  - Prefer enclosed structured lists.
  - Do not use rendered Markdown tables.
  - Replace every table with an enclosed structured list.
  - Enclose related properties under a bold primary item with nested child
    bullets.
  - Enclosed lists are clean, wrap naturally, and remain easy for AI agents to
    parse and maintain.
- **Repository structure**
  - Investigate repository structure directly using tools such as `list_dir`,
    `find_by_name`, and `grep_search`.
  - Use at most a flat list when a directory represents an entire top-level
    subsystem such as `infra`, `nook-app`, `agentic-ai`, or `preflight`.
- **Diagrams and procedures**
  - Use Mermaid (` ```mermaid `) for flowcharts, sequence diagrams, and
    architecture maps.
  - Use structured ordered or unordered lists for execution procedures.

### Prohibited actions

- **List grouping**
  - Do not divide items into arbitrary count-based chunks.
- **Repository structure**
  - Do not include project or directory trees in Cortex files.
  - Static trees describe dynamic project structure and quickly become stale.
- **Diagrams**
  - Do not use ASCII graphics, ASCII boxes, or manual text diagrams.

Use [Cortex structured articles](cortex-article-structure/SKILL.md) to choose the
body shape. This rule governs sentence complexity and content conciseness. The
structured-article rule governs semantic hierarchy.

Checklist for every new or edited `.cortex` sentence:

- [ ] Can a reader grasp the sentence in one pass?
- [ ] Does the sentence state more than one independent rule?
- [ ] Would a bullet list make the actors or steps clearer?
- [ ] Can a failure mode stand as its own sentence?
- [ ] Are project directory trees omitted in favor of dynamic exploration?
- [ ] Are ASCII graphics and box drawings replaced with Mermaid diagrams or structured lists?

## Mechanical lint

The normal pre-push path checks changed Cortex Markdown automatically.

```bash
task loom:pre-push
```

This changed-file gate has bounded scope.

- It compares the working branch with its merge base against `origin/main`.
- It checks prose blocks touched by additions or deletion boundaries.
- A pure rename within persistent Cortex keeps its source ancestry.
- A rename from outside persistent Cortex checks the full destination.
- A Git type change into regular Cortex Markdown checks the full file.
- Content edited during a rename remains in scope.
- It also checks untracked Cortex Markdown.
- It reconstructs prose across ordinary hard-wrapped lines.
- It checks each list-item paragraph independently.
- It excludes labeled command or log output in blockquotes.
- It also excludes fenced code and structural Markdown blocks.
- It does not audit unchanged legacy prose.

Use Loom configuration for an explicit full-corpus density pass:

```yaml
cortexAudit:
  includeDensityLint: true
```

```bash
task loom:run CONFIG=path/to/cortex-audit-density.yaml
```

Loom flags long sentences and heavy semicolon or "and" joins.

It does not rewrite meaning. The agent still owns the edit.

## Scope

Applies to:

- `.cortex/**/*.md`
- new `.cortex` docs and edits to existing ones
- skill cards, workflows, design docs, product specs, references, and indexes
- callouts inside those files

Does not apply to:

- code fences

## Examples

Before (one dense mapping entry):

> `task sccache:ensure` requires readable keys and a healthy SeaweedFS
> head-bucket; missing credentials or an unhealthy backend fail the build
> instead of silently cold-compiling. Local materials live under `~/.nook/`.
> Trusted Main uses read/write identity; Remote uses read-only credentials;
> fork jobs receive neither and set `SCCACHE_OPTIONAL=1`.

After:

- `task sccache:ensure` needs readable cache keys.
- It also needs a healthy SeaweedFS head-bucket.
- Missing credentials or an unhealthy backend fail the build.
- The build must not silently cold-compile in those cases.
- Local materials live only under `~/.nook/`.
- Trusted Main and same-repository PR jobs use the read/write identity.
- Explicit Remote tasks use read-only credentials.
- Fork jobs receive neither identity.
- Those jobs set `SCCACHE_OPTIONAL=1` through `nook-cache-connect`.

Full rewritten example:
[ARCHITECTURE.md](../../../shared/architecture/system.md) under Docker cache model.

## Application Checklist

- [ ] Scan new or edited `.cortex` prose for multi-clause sentences.
- [ ] Split each independent fact into a short sentence or bullet.
- [ ] Prefer lists for actors, credentials, commands, and failure modes.
- [ ] Confirm the document contains no rendered Markdown table and represent
      every repeated-field or exact mapping as an enclosed structured list.
- [ ] Split every large list into logical groups based on the items' domains
      during reading, review, authoring, and refactoring.
- [ ] Put `Required actions` and `Prohibited actions` before domain groups when
      an instruction set contains both kinds of constraint.
- [ ] Remove project/directory trees and replace with dynamic inspection or flat subsystem lists.
- [ ] Replace ASCII graphics with Mermaid diagrams or structured lists.
- [ ] Apply the same rule to this skill card when updating it.

## Validation

- Review the diff for sentence length and branching clauses.
  - A reviewer should be able to extract each rule without re-parsing a
    compound sentence.
- For docs-only captures:
  - run link checks; and
  - self-review against the checklist above.
- Run the consistency GC in
  [Cortex consistency](cortex-consistency/SKILL.md) for the touched topic.
- For implementation tasks that include `.cortex` edits:
  1. run required formatters and commit every allowed AI source or Cortex
     mutation in the coherent handoff;
  2. have Gizmo continue from the direct Team Agent commit and run
     `task loom:pre-push`;
  3. return any new formatter mutation in AI-owned content for a fresh AI
     commit before Gizmo reruns hygiene and pushes; and
  4. Gizmo dispatches at least one relevant focused remote task when the pushed
     head is not validation-ready, or complete exact-head validation immediately
     when it is ready.
- Gizmo obtains fresh exact-head remote evidence after every replacement push.
