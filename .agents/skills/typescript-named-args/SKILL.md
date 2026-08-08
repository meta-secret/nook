---
name: typescript-named-args
description: >-
  Loom TypeScript only: ban passing raw object literals into calls. Assign a
  named typed args value first. Enforced by ESLint no-restricted-syntax in
  agentic-ai/loom.
---

# TypeScript Named Call Arguments (Loom)

Use this skill when editing `agentic-ai/loom` TypeScript.

Read `.cortex/dynamic-skills/typescript-named-args.md` and apply it:

1. Do not call `fn({ ... })` with an inline object literal.
2. Create a named typed variable/constant, then pass that name.
3. Keep `bun run lint` / `task loom:verify` green.
