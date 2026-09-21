---
name: cortex-article-structure
description: Apply Nook executable article-structure audits to Cortex documents.
---

# Nook Cortex Article Audit

Meta-Cortex Context Engineering owns generic article structure.
This card owns Nook's executable audit semantics and its Loom integration.

## Mechanical enforcement

Loom parses the Markdown syntax tree and adapts repository documents into the
semantic request. The co-located application under `scripts/` validates that
request, audits it,
independently verifies the findings, and enforces request and result bounds.
This Cortex card remains the sole semantic authority.

It rejects mechanically provable failures:

- empty substantive H2 or H3 articles, including mapless articles;
- excessive consecutive prose blocks without structural relief;
- explicitly procedure-labeled articles that contain no ordered list; and
- any GFM `table` node.

The audit uses Markdown syntax semantics only.

- Empty code blocks, block quotes, lists, and list items do not make an
  article substantive.
- Any GFM `table` node is prohibited and produces a typed audit finding.
- Definitions and footnote definitions are transparent to emptiness and prose
  density.
- A thematic break provides structural relief between prose blocks but does not
  make an article substantive.
- Image-only paragraphs provide structural relief rather than prose density.
- A GFM task control makes an article visible but does not by itself state a
  procedure action.
- H4-H6 headings reset prose density inside their owning H3. Their content
  remains part of that H3 audit.
- Procedure actions may be nested through normal Markdown containers.
- Ordered examples inside block quotes, block code, or footnotes do not satisfy
  a procedure article.
- An H1 title alone does not create a substantive article.

The canonical document audit rejects every Markdown AST HTML node before
article-structure findings are accepted.

Mechanical checks cannot decide whether a list reflects the correct semantics.
The author still owns hierarchy, meaning, and consistency review.

The application remains an in-process Loom dependency with no command, network,
write, scheduling, or lifecycle authority. The static executable-skill host
also exposes its validated audit action through strict YAML.

