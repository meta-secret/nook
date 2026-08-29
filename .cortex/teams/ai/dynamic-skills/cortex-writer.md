# Cortex Writer — Low Cognitive Complexity

## Priority

This is a P1 documentation rule for every `.cortex` Markdown file.

- Dense prose that packs many facts into one sentence is a failed writing
  invariant.
- Static directory trees in documentation are a failed documentation invariant.
- ASCII art, ASCII box drawings, and text flowcharts are prohibited.
- Tables are reserved for compact repeated fields or exact mappings.
  Enclosed lists remain the default.

## Purpose

Keep `.cortex` readable, maintainable, and accurate for agents and humans.

Cortex is optimized for AI legibility and structure:

- One sentence should carry one idea.
- Complex facts belong in short sentences, bullets, or lists.
- Use tables only when compact repeated fields or exact mappings make lookup
  clearer than an enclosed list.
- Project structure is dynamic; documents must not contain static directory trees.
- ASCII graphics are hard for AI agents to parse; diagrams must use Mermaid (` ```mermaid `) or structured lists.

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
- markdown tables used for multi-attribute inventories;
- nested conditions inside a single clause;
- ASCII directory trees (`├──`, `└──`) or nested file listings in Markdown;
- ASCII box drawings (`+---+`, `| |`) or manual ASCII flowcharts.

## Preferred Pattern

Split the idea before writing the final prose.

1. List each fact, rule, actor, or command as its own unit.
2. Write one short sentence per unit when the fact stands alone.
3. Use a bullet list when several units share one topic.
4. Use a nested list only when a parent item owns clear children.
5. **Prefer enclosed structured lists.**
   - Use a table only for compact repeated fields or exact mappings.
   - Keep every table cell short and free of procedural prose.
   - Replace explanatory or multi-clause tables with enclosed structured lists.
   - Enclose related properties under a bold primary item with nested child bullets.
   - Enclosed lists are clean, wrap naturally, and are easily parsed and maintained by AI agents.
6. **Never include project or directory trees in Cortex files.**
   - Project structure is dynamic.
   - Agents must investigate repository structure directly using tools (`list_dir`, `find_by_name`, `grep_search`).
   - Having directory trees in docs is bad practice.
   - Maximum allowed is a flat list when a directory represents an entire top-level subsystem (such as `infra`, `nook-app`, `agentic-ai`, `preflight`).
7. **Never use ASCII graphics, ASCII boxes, or manual text diagrams.**
   - Use Mermaid (` ```mermaid `) for flowcharts, sequence diagrams, and architecture maps.
   - Use structured ordered or unordered lists for execution procedures.

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
- A pure rename keeps its source ancestry and does not recheck legacy prose.
- Content edited during a rename remains in scope.
- It also checks untracked Cortex Markdown.
- It reconstructs prose across ordinary hard-wrapped lines.
- It checks each list-item paragraph independently.
- It excludes fenced code and structural Markdown blocks.
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
- table cells and callouts inside those files

Does not apply to:

- quoted command output or log excerpts
- code fences
- machine-generated inventories where structure is fixed by a tool
- intentional one-line index table summaries that only point elsewhere

## Examples

Before (one dense table cell):

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
- [ ] Replace tables with enclosed structured lists with nested bullet attributes.
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
  [Cortex consistency](cortex-consistency.md) for the touched topic.
- For implementation tasks that include `.cortex` edits:
  1. run `task loom:pre-push`;
  2. commit and push; and
  3. use the normal hosted validation path.
