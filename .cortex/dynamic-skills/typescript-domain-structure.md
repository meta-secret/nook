# TypeScript Domain Structure

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.
- [Rust coding](rust-coding.md)
  - Defines the Rust-owned domain shapes that TypeScript must reuse.
  - Read when a TypeScript structure belongs behind the WASM boundary.
- [TypeScript single parameter](typescript-single-parameter.md)
  - Defines the parameter-object contract used by structured APIs.
  - Read when reshaping calls alongside domain types.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Forbidden Patterns](#forbidden-patterns)
  - Lists concrete forms that the rule prohibits.
  - Read while reviewing authored changes.
- [Required Pattern](#required-pattern)
  - Defines the pattern that compliant code must use.
  - Read before implementing the affected boundary.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Application Checklist](#application-checklist)
  - Lists the steps needed to apply and maintain the skill.
  - Use during implementation and review.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

## Purpose

Keep TypeScript domain models nested and enum-driven. Treat raw-string field
allow-lists and hand-rolled `Result` / `Maybe` utilities as forbidden.

## Forbidden Patterns

Do not ship any of these:

```ts
// Forbidden: raw-string field allow-list
const ALLOWED = new Set(['stageHostUpdates', 'fetchOriginMain']);

// Forbidden: generic Optional / Result clones
type Result<T> = Ok<T> | Err;
type Maybe<T> = Present<T> | Absent;

// Forbidden: flat same-prefix closed vocabularies
enum RequestKind {
  AgentStatsAssemble = 'agentStatsAssemble',
  AgentStatsValidate = 'agentStatsValidate',
  AgentStatsPublish = 'agentStatsPublish',
}
```

Same-prefix names almost always mean a separate object was flattened. Generic
`Result` / `Maybe` hide domain failure and absence behind reusable holes.

## Required Pattern

- Same prefix → nest. Prefer `agentStats` + `AgentStatsOperation`, not flat
  `AgentStatsAssemble` / `AgentStatsValidate` / `AgentStatsPublish`.
- YAML and TypeScript shapes match the nest:

  ```yaml
  agentStats:
    assemble:
      prNumber: 123
      scratchPath: "{agentTempDir}/pr-123-scratch.json"
      outputPath: "{agentTempDir}/123.yaml"
      includeTestInventory: true
  ```

- Closed field names are enums typed as `RequestFieldVocabulary<FieldName>`.
  Pass the enum into unknown-key checks
  (`denyUnknownKeys(record, PrePushField, path)`). Never author
  `Record<string, string>` or string-set field allow-lists.
- Closed failure codes are enums. Freeform detail text may accompany an enum
  code at an I/O boundary; the discriminant itself is never a bare string.
- Do not invent TypeScript `Result<T>` or `Maybe<T>` / Optional clones.
  Language-provided `Result` in Rust is fine.
- YAML decode may accumulate field issues in a **codec-local** type
  (`DecodeOutcome`, `DecodeStatus`, `FieldIssue`). That type must stay in the
  codec layer and must not become a repo-wide Result utility.
- Command / runtime failures throw domain errors (`LoomFailure` +
  `LoomFailureCode`) or use a command-specific outcome union. Never
  `Result<string>`.
- Optional request fields that mean a named state become domain unions
  (`RemoteTask.Specified` / `RemoteTask.Omitted`), never `Maybe<string>`.

## Scope

Applies to:

- Authored TypeScript under `agentic-ai/`, `nook-app/nook-web/`, scripts, and
  agent tooling
- Loom domain YAML request shapes

Does not apply to:

- Rust `Result` / `Option` (see [rust-coding.md](rust-coding.md))
- Generated WASM / dependency typings

## Examples

- Forbidden: `new Set(['stageHostUpdates', ...])`, `result.ts` with
  `Result` / `Maybe`
- Required: `enum PrePushField { ... }`, nested `agentStats.assemble`,
  `DecodeOutcome` only inside codecs, `LoomFailure` for runtime failures

## Application Checklist

- [ ] Search for `new Set(['...'])` field allow-lists and replace with field
      enums.
- [ ] Search for TypeScript `Result` / `Maybe` / `Present` / `Absent` utilities
      and delete them.
- [ ] Nest same-prefix enum members into a parent object plus operation enum.
- [ ] Keep decode accumulation codec-local; keep runtime failure codes as enums.
- [ ] Update YAML examples and cortex docs to the nested domain shape.

## Validation

- `rg "new Set\\(\\['" agentic-ai nook-app` should find no authored field
  allow-lists
- `rg "type Result<|type Maybe<" agentic-ai` should find none
- `task preflight:typescript-state`
- Loom: `bun run verify` in `agentic-ai/loom`
- `task loom:pre-push` before push

For Loom's one-parameter function rule, see
[typescript-single-parameter.md](typescript-single-parameter.md).
