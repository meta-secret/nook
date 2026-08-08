---
name: typescript-no-unknown
description: >-
  Loom TypeScript only: ban the authored unknown type. Model untrusted YAML/JSON
  as ExternalValue / ExternalObject. Enforced by ESLint no-restricted-types in
  agentic-ai/loom.
---

# TypeScript No Unknown (Loom)

Use this skill when editing `agentic-ai/loom` TypeScript.

Read `.cortex/dynamic-skills/typescript-no-unknown.md` and apply it:

1. Do not author the `unknown` type token.
2. Use `ExternalValue` / `ExternalObject` for untrusted data.
3. Keep `bun run lint` / `task loom:verify` green.
