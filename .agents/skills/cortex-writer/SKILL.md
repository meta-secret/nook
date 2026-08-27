---
name: cortex-writer
description: >-
  Enforce Nook's critical .cortex writing rule: split long, dense sentences
  into short sentences, bullets, and lists to reduce cognitive complexity,
  prefer enclosed structured lists while reserving tables for compact exact
  mappings, prohibit static project directory trees, and ban ASCII graphics in
  favor of Mermaid diagrams or structured lists. Use whenever creating or editing .cortex Markdown, skill
  cards, workflows, design docs, product specs, references, or AGENTS.md guidance.
---

# Cortex Writer

Read and follow the canonical project rule at
[`.cortex/teams/ai/dynamic-skills/cortex-writer.md`](../../../.cortex/teams/ai/dynamic-skills/cortex-writer.md).

Every `.cortex` Markdown edit must keep cognitive complexity low, prefer
enclosed structured lists, reserve tables for compact exact mappings, avoid
static directory trees, and ban ASCII graphics.

Present causes, consequences, and warning signs as parallel bullets when a
paragraph would combine independent facts.

## Required response while writing

1. Split each independent fact into its own short sentence.
2. Use bullets or lists for actors, credentials, commands, and failure modes.
3. Use tables only for compact repeated fields or exact mappings. Replace
   explanatory tables with enclosed structured lists.
4. Enclose related properties under a bold primary item with nested child bullets.
5. Prohibit static project directory trees; rely on dynamic exploration or flat subsystem lists.
6. Prohibit ASCII box drawings and text art; use Mermaid (` ```mermaid `) or structured lists instead.
7. Re-read the prose once for multi-clause sentences before finishing.
