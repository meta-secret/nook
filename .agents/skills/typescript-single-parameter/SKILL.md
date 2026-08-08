---
name: typescript-single-parameter
description: >-
  Loom TypeScript only: every function or method may take at most one
  parameter. Wrap multi-value inputs in a named object type. Enforced by ESLint
  max-params in agentic-ai/loom.
---

# TypeScript Single Parameter (Loom)

Use this skill when editing `agentic-ai/loom` TypeScript.

Read `.cortex/dynamic-skills/typescript-single-parameter.md` and apply it:

1. Do not author functions/methods with two or more positional parameters.
2. Wrap multi-value inputs in a typed object argument.
3. Keep `bun run lint` / `task loom:verify` green (`max-params: 1`).
