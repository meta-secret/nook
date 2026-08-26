---
name: cortex-article-structure
description: >-
  Require Cortex article bodies to expose semantic structure through meaningful
  headings, ordered procedures, parallel rule lists, nested branches, and owned
  explanation. Use whenever creating, editing, restructuring, or auditing
  .cortex Markdown.
---

# Cortex Structured Articles

Read and follow the canonical project rule at
[`.cortex/dynamic-skills/cortex-article-structure.md`](../../../.cortex/dynamic-skills/cortex-article-structure.md).

Every Cortex edit must make the body's real hierarchy visible.

Authored HTML is prohibited in every `.cortex/**/*.md` file.

- The prohibition includes block HTML, inline HTML, and HTML comments.
- Generic notation such as `Option<T>` must use inline code.
- Literal HTML examples belong in inline code or fenced code blocks.
- Escaped text and Markdown autolinks remain valid.
- Migration exemptions never bypass the prohibition.

## Required response while writing

1. Identify whether each article primarily explains, defines rules, gives a
   procedure, or provides reference data.
2. Use ordered steps only when action order matters.
3. Use flat bullets for peers and nested bullets for owned branches or substeps.
4. Keep detailed rationale as prose inside a clearly owned article.
5. Update `.cortex/knowledge-graph.md` whenever the heading hierarchy changes.
6. Run the structured-article and consistency checks before completion.
7. Run the global Cortex audit and fix every prohibited HTML finding.
