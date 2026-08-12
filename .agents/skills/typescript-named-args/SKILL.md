---
name: typescript-named-args
description: >-
  Loom and migrated Nook web TypeScript: require named semantic object parameter types and ban
  raw object literals in calls. Enforced by ESLint loom/no-raw-object-arguments in Loom and
  nook-typed-api/no-raw-object-arguments in Nook web.
---

# TypeScript Named Call Arguments

Use this skill when editing Loom or migrated Nook web TypeScript.

Read `.cortex/dynamic-skills/typescript-named-args.md` and apply it:

1. Do not declare `fn(args: { ... })` with an inline object type.
2. Declare and reuse a named semantic `type`, `interface`, or Rust-generated type.
3. Do not use generic contract names such as `Args` or `CallbackArgs`.
4. Do not declare object-valued parameter defaults. Apply defaults at the call
   site or inside the function body.
5. Do not call `fn({ ... })` with an inline object literal.
6. Create a named typed variable/constant, then pass that name.
7. Keep the applicable Loom or web lint task green.
