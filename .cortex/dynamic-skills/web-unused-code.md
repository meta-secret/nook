# Web Unused-Code Enforcement

## Purpose

Keep every authored Nook web project free of unreachable files, exports, types,
enum members, class members, and dependencies.

## Problem Pattern

TypeScript and ESLint catch unused local declarations. The production Knip 5
graph also checks `classMembers`. Knip 6 removed that issue type, so the isolated
research graph cannot rely on Knip to find abandoned public methods and fields.

## Preferred Pattern

- The main `nook-web-app` Knip 5 graph includes `classMembers` alongside files,
  exports, types, and enum members.
- That graph covers shared vault code, Simple, Sentinel, and the extension.
- Research retains its isolated Knip 6 graph. It checks files, exports, types,
  and enum members.
- Research class members require a caller audit because Knip 6 no longer
  exposes the `classMembers` issue type.
- A green Knip result is not proof that an exported Svelte store has no dead
  members. Audit exported store methods and accessors against direct,
  optional-chained, test, and internal `this` call sites; delete compatibility
  members with no caller.
- Delete or correctly connect every valid finding. Do not add authored-code
  ignores, reduce issue coverage, or keep compatibility aliases without an
  actual caller.
- When removing a state-controller member, search Svelte, TypeScript, tests,
  and generated-boundary call sites before deletion.
- If a member is demonstrably called only through Svelte markup and Knip cannot
  trace the exported class, narrow the module API to a private implementation
  returned by an exported factory. Do not suppress the finding or delete live
  behavior.
- Preflight rejects JSON serialize/parse round trips in authored web source.
  Rune-aware code uses `$state.snapshot` directly at the boundary.

## Scope

Applies to all authored TypeScript and Svelte code under `nook-app/nook-web`.
Generated WASM declarations and third-party/vendor code remain outside the
authored project graph.

## Validation

Run `bun run unused` from both `nook-web-app` and `nook-web-research`; both must
finish with zero findings.
