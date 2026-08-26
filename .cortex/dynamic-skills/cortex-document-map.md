# Cortex Document Navigation

All Cortex document navigation and structural maps are centralized in the root
and team knowledge graphs.

## Purpose

Help humans and agents route through Cortex without reading every document in full.

Centralized navigation allows AI agents to load exact sections and anchors into context with zero prompt overhead.

## Centralized knowledge-graph structure

The knowledge-graph topology is:

- `.cortex/knowledge-graph.md` routes teams and maps common authorities.
- `.cortex/dev-core/knowledge-graph.md` maps development-core authorities.
- `.cortex/sre/knowledge-graph.md` maps SRE authorities.
- `.cortex/web-dev/knowledge-graph.md` maps web-development authorities.

Each document has one owning graph.

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

Entry in the owning team graph:

```markdown
### Product Specifications (`product-specs/`)

- [Authenticator Items](../dev-core/product-specs/authenticator-items.md)
  - RFC 6238 TOTP authenticators as a first-class secure-item type.
  - [Overview](../dev-core/product-specs/authenticator-items.md#overview)
    - Scope and intent of TOTP authenticators.
  - [Product model](../dev-core/product-specs/authenticator-items.md#product-model)
    - Standalone vault items and issuer matching.
```

## Scope

Applies to:

- every authored `.cortex/**/*.md` file;
- new documents;
- edits that add, rename, or reorder headings;
- updates to any root or team knowledge graph.

## Application checklist

- [ ] Ensure the document starts with exactly one H1 title.
- [ ] Omit inline `## Relationships` and `## Document map` from individual documents.
- [ ] Add the document and its section anchors to its owning graph.
- [ ] Keep the root graph limited to team routing and common authorities.
- [ ] Add a concise directional summary when the link label alone is ambiguous.
- [ ] Apply the Cortex writer and consistency checks.

## Validation

Run the focused Cortex and Loom checks:

```bash
task loom:verify
task loom:cortex-audit
task preflight:loom-contracts
```

Loom audits all four knowledge graphs.

- Every team graph must exist.
- Every document must be mapped by its owning graph.
- The root graph must link each team graph.
- Root navigation must not bypass a team graph to index team-owned documents.
