---
name: cortex-article-structure
description: Keep Cortex articles semantically structured and mechanically auditable.
---

# Cortex Structured Articles

Every Cortex article exposes the semantic shape of its content instead of
hiding rules and actions inside a wall of prose.

## Priority

This is a P1 documentation rule for every `.cortex` Markdown file.

The visible structure must match the meaning of the content.

## Purpose

Let a reader understand the shape of a manual before reading every detail.

Structure should expose:

- which facts are parallel;
- which action happens first;
- which steps belong to a parent action;
- which conditions create a branch;
- which result or validation completes the work.

Detailed explanation remains welcome. It belongs inside an article whose
purpose and boundaries are visible.

## Body grammar

Every substantive H2 or H3 article uses the body shape that matches its meaning.

Authored HTML is prohibited in every Cortex Markdown file.

- Do not use block HTML.
- Do not use inline HTML.
- Do not use HTML comments.
- Use Markdown syntax for document structure.
- Escape literal HTML text or place examples inside inline or block code.
- Block code may use fenced or indented Markdown syntax.

An article may combine shapes when the content genuinely combines them. Keep
the transition visible with a short lead-in or a meaningful subheading.

### Explanation article

Use prose for rationale, tradeoffs, history, and causal explanation.

Follow these rules:

- open with the article's conclusion, purpose, or owned question;
- keep one idea per sentence;
- split parallel facts into bullets;
- introduce an H3 only when the subtopic is independently navigable;
- end with implications or a decision when the explanation drives action.

Do not convert connected reasoning into disconnected bullets merely to increase
list usage.

### Rules article

Use an unordered list when several requirements share one topic.

- Put one invariant, choice, actor, or failure condition in each item.
- Nest a child list only when every child is owned by its parent item.
- Keep sibling items at the same semantic level.
- Use bold lead labels only when they improve scanning.
- Move multi-paragraph rationale below the relevant item or into an explanation
  subarticle.

### Procedure article

Use an ordered list for actions whose order matters.

1. State the action as an imperative step.
2. Nest required substeps under the action that owns them.
3. Represent a conditional branch as a nested bullet.
   - Name the condition first.
   - State the action taken under that condition.
4. Name the observable result of the step.
5. End with validation or a terminal outcome.

Do not number facts that may be read in any order. Those are rules or reference
data, not a procedure.

### Reference article

Use the smallest lookup structure that preserves meaning.

- Use bullets for a short catalog.
- Use an enclosed list keyed by a bold primary item for repeated fields or exact
  mappings. Rendered Markdown tables are prohibited.
- Use a definition paragraph followed by bullets when entries need explanation.
- Use code blocks only for literal syntax, commands, or examples.
- Keep explanations as named nested properties beneath their primary list item.

Reference structure supports lookup. It must not duplicate an authoritative
rule owned by another article or document.

## Hierarchy rules

Hierarchy represents containment, not decoration.

- H2 identifies a major article owned by the document.
- H3 identifies a substantial subarticle owned by its H2.
- A nested list identifies details, branches, or substeps owned by one item.
- A flat list identifies semantic peers.
- A paragraph explains why items relate or how to interpret them.

Avoid H4-H6 unless the information remains useful as a navigable article.

Knowledge graphs index documents, not headings. A heading-only change does not
change the owning graph. Update the graph when document ownership, path, or
discoverability changes.

## Standard action blocks

Action-oriented articles use these blocks when the concepts are present:

- **Outcome:** the state that completion must produce.
- **Inputs:** the evidence, identifiers, or materials required to begin.
- **Procedure:** the ordered actions and owned branches.
- **Failure handling:** condition-to-action rules for non-happy paths.
- **Validation:** observable proof that the outcome is real.

Use H3 headings for substantial blocks. Use bold lead labels for short blocks
that do not deserve document-map navigation.

Do not add an empty block merely because the label exists in this standard.

## Rejected patterns

- A long sequence of paragraphs with no visible grouping.
- Numbered facts whose order has no meaning.
- Flat bullets that hide parent-child ownership.
- Deep nesting used only to make a document look structured.
- One list item containing several independent rules.
- A heading for every sentence or label.
- A rendered Markdown table.
- Repeated boilerplate headings with no content.
- A rewrite that changes policy while claiming to change presentation only.

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

## Application checklist

- [ ] State the purpose or outcome of each article.
- [ ] Choose explanation, rules, procedure, or reference as the primary shape.
- [ ] Use ordered steps only when action order matters.
- [ ] Use nested items only for real ownership or branching.
- [ ] Keep explanations detailed where the reasoning matters.
- [ ] Keep sentences and list items cognitively simple.
- [ ] Update the owning graph only for document ownership, path, or
      discoverability changes.
- [ ] Verify that the rewrite preserves exact product and policy meaning.

## Validation

Run the focused checks. The provider contract and independent verifier live in
Loom with the production audit implementation:

```bash
task loom:cortex-audit
task loom:verify
task preflight:loom-contracts
```

Review the diff semantically after the mechanical checks pass.

- Confirm every `.cortex/**/*.md` document parses with no GFM `table` node.
- Confirm repeated fields and exact mappings remain explicit as named
  properties in enclosed lists.

The reviewer must be able to identify article purpose, action order, branches,
and completion evidence without reconstructing them from dense prose.
