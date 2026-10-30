# Nook Unused-Code Tooling

Meta-Cortex TypeScript development owns unused-code policy and caller analysis.
This supplement maps that policy to Nook's installed tools.

## Required actions

- The main web app runs Knip 6 from `nook-app/nook-web`, because Knip 6
  analyzes only files under its root. Its graph covers shared vault code,
  Simple, Sentinel, and the extension.
- Research has an isolated Knip 6 graph.
- Class members need caller review in both graphs, because Knip 6 does not
  expose the classMembers issue type.
- Nook preflight rejects JSON serialize/parse round trips in authored web code.
- Run each affected project's unused script in the authorized hosted stage.

**Prohibited:** treat green Knip output as proof that public methods have
callers.

**Preferred:** include caller analysis for class members with the
unused-script evidence.
