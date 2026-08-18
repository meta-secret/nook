---
name: cortex-writer
description: >-
  Enforce Nook's critical .cortex writing rule: split long, dense sentences
  into short sentences, bullets, and lists to reduce cognitive complexity,
  replace tables with enclosed structured lists, prohibit static project
  directory trees, and ban ASCII graphics in favor of Mermaid diagrams or
  structured lists. Use whenever creating or editing .cortex Markdown, skill
  cards, workflows, design docs, product specs, references, or AGENTS.md guidance.
---

# Cortex Writer

Read and follow the canonical project rule at
[`.cortex/dynamic-skills/cortex-writer.md`](../../../.cortex/dynamic-skills/cortex-writer.md).

Every `.cortex` Markdown edit must keep cognitive complexity low, replace tables with enclosed structured lists, avoid static directory trees, and ban ASCII graphics.

## Required response while writing

1. Split each independent fact into its own short sentence.
2. Use bullets or lists for actors, credentials, commands, and failure modes.
3. Do not use tables in Markdown files; replace tables with enclosed structured lists.
4. Enclose related properties under a bold primary item with nested child bullets.
5. Prohibit static project directory trees; rely on dynamic exploration or flat subsystem lists.
6. Prohibit ASCII box drawings and text art; use Mermaid (` ```mermaid `) or structured lists instead.
7. Re-read the prose once for multi-clause sentences before finishing.
