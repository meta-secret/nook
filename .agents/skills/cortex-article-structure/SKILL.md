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

## Required response while writing

1. Identify whether each article primarily explains, defines rules, gives a
   procedure, or provides reference data.
2. Use ordered steps only when action order matters.
3. Use flat bullets for peers and nested bullets for owned branches or substeps.
4. Keep detailed rationale as prose inside a clearly owned article.
5. Update `.cortex/knowledge-graph.md` whenever the heading hierarchy changes.
6. Run the structured-article and consistency checks before completion.

## Mechanical capability

This skill owns the deterministic article-structure checker in `src/` and its
focused real-document tests in `tests/`.

Run it through the shared executable-skill quality project:

```bash
task skills:verify
```

This provider is dormant. It defines and self-verifies the serialized checker,
but it does not register or execute itself. It cannot schedule work, authorize
writes, or mutate the repository. A later Loom consumer owns registration,
isolation, deadlines, provenance, and workflow activation.
