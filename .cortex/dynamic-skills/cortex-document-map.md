# Cortex Document Navigation

All Cortex document navigation and structural maps are centralized in `.cortex/knowledge-graph.md`.

## Purpose

Help humans and agents route through Cortex without reading every document in full.

Centralized navigation allows AI agents to load exact sections and anchors into context with zero prompt overhead.

## Centralized knowledge-graph structure

`.cortex/knowledge-graph.md` is the canonical knowledge graph and table of contents.

It contains:

- Golden principles and system entry points.
- Categorized directories of product specs, design docs, dynamic skills, workflows, references, and exec plans.
- Hierarchical section maps with clickable fragment links for every document.
- Directional summaries when a link label does not make routing intent clear.

## Individual document structure

Every `.cortex/**/*.md` document (except `knowledge-graph.md`) has this structure:

1. Exactly one H1 title at the top of the file.
2. An optional short introduction paragraph.
3. Content sections starting directly with H2 headings.

Individual documents must not contain duplicate inline `## Relationships` or `## Document map` sections.

## Preferred pattern

Individual document:

```markdown
# Authenticator Items

Add RFC 6238 TOTP authenticators as a first-class secure-item type.

## Overview

Overview prose follows directly.

## Product model

Domain rules follow.
```

Centralized entry in `.cortex/knowledge-graph.md`:

```markdown
### Product Specifications (`product-specs/`)

- [Authenticator Items](../product-specs/authenticator-items.md)
  - RFC 6238 TOTP authenticators as a first-class secure-item type.
  - [Overview](../product-specs/authenticator-items.md#overview)
    - Scope and intent of TOTP authenticators.
  - [Product model](../product-specs/authenticator-items.md#product-model)
    - Standalone vault items and issuer matching.
```

## Scope

Applies to:

- every authored `.cortex/**/*.md` file;
- new documents;
- edits that add, rename, or reorder headings;
- updates to `.cortex/knowledge-graph.md`.

## Application checklist

- [ ] Ensure the document starts with exactly one H1 title.
- [ ] Omit inline `## Relationships` and `## Document map` from individual documents.
- [ ] Add the document and its section anchors to `.cortex/knowledge-graph.md`.
- [ ] Add a concise directional summary when the link label alone is ambiguous.
- [ ] Apply the Cortex writer and consistency checks.

## Validation

Run the focused Cortex and Loom checks:

```bash
task loom:verify
task loom:cortex-audit
task preflight:loom-contracts
```

Loom audits `.cortex/knowledge-graph.md` to ensure every document and section anchor is valid and mapped.
