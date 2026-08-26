---
name: typescript-single-parameter
description: >-
  Loom, executable-skill, and migrated Nook web TypeScript: every function or
  method may take at most one parameter. Wrap multi-value inputs in a named
  semantic object type. Enforced by ESLint max-params in the shared ESLint
  configurations.
---

# TypeScript Single Parameter

Use this skill when editing Loom, executable-skill, or migrated Nook web
TypeScript.

Read `.cortex/dynamic-skills/typescript-single-parameter.md` and apply it:

1. Do not author functions/methods with two or more positional parameters.
2. Wrap multi-value inputs in a named semantic object contract.
3. Do not use inline object parameter annotations or generic contract names.
4. Keep the applicable Loom, executable-skill, or web lint task green
   (`max-params: 1`).
