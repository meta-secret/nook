# Nook Unused-Code Tooling

Meta-Cortex TypeScript development owns unused-code policy and caller analysis.
This supplement maps that policy to Nook's installed tools.

## Required actions

- The main web app uses Knip 5 with class-member analysis. Its graph covers
  shared vault code, Simple, Sentinel, and the extension.
- Research has an isolated Knip 6 graph. Class members need caller review
  because that version does not expose the classMembers issue type.
- Nook preflight rejects JSON serialize/parse round trips in authored web code.
- Run each affected project's unused script in the authorized hosted stage.

**Prohibited:** treat green research Knip output as proof that public methods
have callers.

**Preferred:** include caller analysis for research class members with its
unused-script evidence.
