# Cortex Writer — Low Cognitive Complexity

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines concise navigation summaries as part of every Cortex document.
  - Apply whenever headings, relationships, or document maps change.
- [Cortex structured articles](cortex-article-structure.md)
  - Defines when prose, rules, procedures, and reference structures apply.
  - Apply whenever sentence-level cleanup changes an article body.
- [Cortex consistency](cortex-consistency.md)
  - Requires readable edits to remain current and non-contradictory.
  - Apply whenever durable Cortex guidance changes.

## Document map

- [Priority](#priority)
  - Establishes low-complexity prose as a P1 Cortex invariant.
  - Read before authoring Cortex content.
- [Purpose](#purpose)
  - Explains the human and agent readability goal.
  - Read when deciding how much detail one sentence should carry.
- [Problem pattern](#problem-pattern)
  - Lists warning signs for dense prose.
  - Read while reviewing a Cortex diff.
- [Preferred pattern](#preferred-pattern)
  - Defines how to split facts, rules, and conditions.
  - Apply while rewriting dense content.
- [Mechanical lint](#mechanical-lint)
  - Shows the Loom density-lint request and command.
  - Read when running heuristic prose checks.
- [Scope](#scope)
  - Defines covered Cortex prose and narrow exclusions.
  - Read when deciding whether the writing rule applies.
- [Examples](#examples)
  - Contrasts a dense cache-policy paragraph with readable facts.
  - Read when a concrete rewrite pattern is useful.
- [Application checklist](#application-checklist)
  - Provides a short review checklist for every edit.
  - Use before completing Cortex writing.
- [Validation](#validation)
  - Defines self-review, consistency, and focused checks.
  - Run after editing Cortex prose.

## Priority

This is a P1 documentation rule for every `.cortex` Markdown file.

Dense prose that packs many facts into one sentence is a failed writing
invariant.

## Purpose

Keep `.cortex` readable for agents and humans under scarce context.

One sentence should carry one idea.

Complex facts belong in short sentences, bullets, or lists.

## Problem Pattern

A writer packs many constraints, identities, failure modes, and commands into
one long sentence or table cell.

Readers must hold too many clauses at once.

Warning signs:

- multiple independent facts joined by semicolons or "and";
- one sentence that names several actors with different credentials;
- one sentence that states a requirement, a failure mode, and an escape hatch;
- table cells that read like paragraphs;
- nested conditions inside a single clause.

## Preferred Pattern

Split the idea before writing the final prose.

1. List each fact, rule, actor, or command as its own unit.
2. Write one short sentence per unit when the fact stands alone.
3. Use a bullet list when several units share one topic.
4. Use a nested list only when a parent item owns clear children.
5. Keep table cells short. Move long detail under the table or into bullets.

Use [Cortex structured articles](cortex-article-structure.md) to choose the body
shape. This rule governs sentence complexity. The structured-article rule
governs semantic hierarchy.

Checklist for every new or edited `.cortex` sentence:

- [ ] Can a reader grasp the sentence in one pass?
- [ ] Does the sentence state more than one independent rule?
- [ ] Would a bullet list make the actors or steps clearer?
- [ ] Can a failure mode stand as its own sentence?

## Mechanical lint

Use Loom for a heuristic density pass over `.cortex`:

```yaml
cortexAudit:
  includeDensityLint: true
```

```bash
task loom:run CONFIG=path/to/cortex-audit-density.yaml
```

Loom flags long sentences and heavy semicolon / "and" joins.

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
[ARCHITECTURE.md](../ARCHITECTURE.md) under Docker cache model.

## Application Checklist

- [ ] Scan new or edited `.cortex` prose for multi-clause sentences.
- [ ] Split each independent fact into a short sentence or bullet.
- [ ] Prefer lists for actors, credentials, commands, and failure modes.
- [ ] Keep table cells short; move dense detail out of the cell.
- [ ] Apply the same rule to this skill card when updating it.

## Validation

Review the diff for sentence length and branching clauses.

A reviewer should be able to extract each rule without re-parsing a compound
sentence.

Docs-only captures need link checks and a short self-review against the
checklist above.

Also run the consistency GC in
[cortex-consistency.md](cortex-consistency.md) for the touched topic.

For implementation tasks that include `.cortex` edits, run `task loom:pre-push`,
commit and push, then use the normal hosted validation path.
