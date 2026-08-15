# Cortex Document Navigation

Every Cortex document exposes its place in the knowledge graph and its internal
structure before detailed prose begins.

## Relationships

- [Cortex writer](cortex-writer.md)
  - Keeps navigation summaries short and readable.
  - Apply whenever a Cortex document is created or edited.
- [Cortex consistency](cortex-consistency.md)
  - Prevents navigation from preserving stale or contradictory guidance.
  - Apply when relationships or durable document content changes.
- [Dynamic skill authoring](dynamic-skill-authoring.md)
  - Defines how this rule is captured and exposed as a project skill.
  - Read when changing the rule or its executable wrapper.

## Document map

- [Purpose](#purpose)
  - Explains why navigation is a first-class part of every Cortex document.
  - Read before authoring or restructuring Cortex prose.
- [Required structure](#required-structure)
  - Defines the mandatory title, relationship graph, map, and content order.
  - Read whenever a Cortex Markdown file changes.
  - [Relationships section](#relationships-section)
    - Defines external Cortex-document relationship entries.
    - Read when connecting one document to another.
  - [Document map section](#document-map-section)
    - Defines hierarchical internal navigation entries.
    - Read when headings or article structure changes.
- [Preferred pattern](#preferred-pattern)
  - Shows the canonical Markdown shape.
  - Copy when creating or migrating a document.
- [Scope](#scope)
  - States which files and links the rule governs.
  - Read when deciding whether the rule applies.
- [Migration](#migration)
  - Defines temporary exemptions during the bounded multi-PR rollout.
  - Read while the repository migration remains incomplete.
- [Application checklist](#application-checklist)
  - Lists the authoring and maintenance checks.
  - Use before completing a Cortex edit.
- [Validation](#validation)
  - Names the focused mechanical checks.
  - Run after changing Cortex documents or enforcement.

## Purpose

Help humans and agents route through Cortex without reading every document in
full.

Navigation summaries describe where knowledge lives. They do not duplicate the
detailed rules below them.

## Required structure

Every `.cortex/**/*.md` file has this root order:

1. Exactly one H1 title.
2. An optional short introduction.
3. `## Relationships` as the first H2.
4. `## Document map` as the second H2.
5. The document's detailed articles.

Use standard inline Markdown links. Do not use wiki links or programming-style
identifiers.

### Relationships section

Use one linked list item for each related Cortex document.

Each entry has exactly two concise child bullets:

1. What the related document contributes.
2. When the reader should follow the link.

Optional H3 headings may group relationships by meaning. Useful labels include
`Always required`, `Related context`, `Supersedes`, and `Superseded by`.

Relationship targets must:

- use relative `.md` paths;
- stay inside `.cortex`;
- avoid self-links and duplicate target files;
- use a valid fragment when a section-specific link is needed.

Use `- None.` only when a document has no meaningful Cortex relationship.

Relationships form a graph. Cycles are valid and expected.

### Document map section

Map every structural heading after `Document map` exactly once.

Each entry has:

- a standard same-document fragment link;
- exactly two concise child bullets;
- list nesting that matches the heading hierarchy.

The child bullets explain:

1. What the article contains.
2. When the reader should read it.

Keep entries in source order. Remove stale entries and add new entries whenever
headings change.

Do not map:

- the H1 title;
- headings inside `Relationships`;
- headings inside `Document map`;
- heading-like text in code fences, HTML, or block quotes.

## Preferred pattern

```markdown
# Document title

Short purpose.

## Relationships

- [Cortex writing](cortex-writer.md)
  - Keeps instruction prose short and readable.
  - Applies whenever `.cortex` is edited.

## Document map

- [Always required](#always-required)
  - Defines the rules that apply to every task.
  - Read before starting work.
  - [Cortex writing](#cortex-writing)
    - Keeps instruction prose short and readable.
    - Applies whenever `.cortex` is edited.

## Always required

### Cortex writing

Detailed guidance follows.
```

## Scope

Applies to:

- every authored `.cortex/**/*.md` file;
- new documents;
- edits that add, remove, rename, reorder, or re-parent headings;
- edits that change relationships between Cortex documents.

It does not require graph entries for:

- source-code links;
- web links;
- evidence and Workbench links;
- links whose purpose is local context rather than a document relationship.

## Migration

The repository-wide adoption is split across bounded PRs.

`.cortex/document-map-migration.txt` lists existing documents not yet migrated.
The list must shrink with every migration PR. New Cortex documents cannot enter
the ledger.

Delete the ledger when the final document migrates. The final state has no
exemptions.

## Application checklist

- [ ] Keep `Relationships` and `Document map` as the first two H2 sections.
- [ ] Use standard Markdown links.
- [ ] Give every linked navigation entry exactly two concise child bullets.
- [ ] Map every content heading once, in source order and hierarchy.
- [ ] Update relationships when document ownership or context changes.
- [ ] Update the map whenever headings change.
- [ ] Keep summaries directional; do not copy the detailed policy into them.
- [ ] Apply the Cortex writer and consistency checks.

## Validation

Run the focused Cortex and Loom checks:

```bash
task loom:verify
task loom:cortex-audit
task preflight:loom-contracts
```

Loom parses Markdown structure and GitHub-compatible fragments. It rejects
missing, stale, duplicate, out-of-order, or incorrectly nested navigation.

Semantic relationship quality still requires author judgment.
