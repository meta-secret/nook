# TypeScript Domain Structure

## Purpose

Keep TypeScript domain models nested and enum-driven. Reject flat prefixed
vocabularies, string field allow-lists, and hand-rolled generic `Result` /
`Maybe` wrappers.

## Problem Pattern

Closed values are flattened into one enum by shared prefix:

```ts
enum RequestKind {
  AgentStatsAssemble = 'agentStatsAssemble',
  AgentStatsValidate = 'agentStatsValidate',
  AgentStatsPublish = 'agentStatsPublish',
}
```

Field allow-lists use raw strings:

```ts
const ALLOWED = new Set(['stageHostUpdates', 'fetchOriginMain']);
```

Absence and failure are modeled with generic clones of Optional/Result:

```ts
type Result<T> = Ok<T> | Err;
type Maybe<T> = Present<T> | Absent;
```

Same-prefix names almost always mean a separate object was flattened. Generic
`Result` / `Maybe` hide domain failure and absence behind reusable holes.

## Preferred Pattern

- Same prefix → nest. Prefer `agentStats` + `AgentStatsOperation`, not flat
  `AgentStatsAssemble` / `AgentStatsValidate` / `AgentStatsPublish`.
- YAML and TypeScript shapes match the nest:

  ```yaml
  agentStats:
    assemble:
      prNumber: 123
      scratchPath: /tmp/pr-123.json
      outputPath: /tmp/123.yaml
      includeTestInventory: true
  ```

- Closed field names are enums. Pass `Object.values(PrePushField)` (or an enum
  helper) into unknown-key checks. Do not author string sets of field names.
- Closed failure codes are enums. Freeform detail text may accompany an enum
  code at an I/O boundary; the discriminant itself is never a bare string.
- Do not invent TypeScript `Result<T>` or `Maybe<T>` / Optional clones.
  Language-provided `Result` in Rust is fine.
- Decode paths may use a **codec-local** outcome type named for decoding
  (`DecodeOutcome`, `DecodeStatus`) that accumulates field issues. That is not
  a repository-wide Result utility.
- Command / runtime failures use domain throws (`LoomFailure` + enum code) or a
  command-specific outcome union. Do not return `Result<string>`.
- Optional request fields that mean a named state become domain unions
  (`RemoteTask.Specified` / `RemoteTask.Omitted`), not `Maybe<string>`.

## Scope

Applies to:

- Authored TypeScript under `agentic-ai/`, `nook-app/nook-web/`, scripts, and
  agent tooling
- Loom domain YAML request shapes

Does not apply to:

- Rust `Result` / `Option` (see [rust-coding.md](rust-coding.md))
- Generated WASM / dependency typings

## Examples

- Before: flat `AgentStatsAssemble` request root and `Result<string>` helpers in
  `agentic-ai/loom/src/result.ts`
- After: nested `agentStats.assemble` YAML, `AgentStatsOperation` enum, field
  enums, `DecodeOutcome` for codecs, `LoomFailure` for runtime failures

## Application Checklist

- [ ] Search for same-prefix enum members and flatten them into a parent object
      plus operation enum.
- [ ] Replace `new Set(['fieldName', ...])` with field enums.
- [ ] Delete or refuse generic TypeScript `Result` / `Maybe` utilities.
- [ ] Keep decode accumulation in a decode-specific type; keep runtime failure
      codes as enums.
- [ ] Update YAML examples and cortex docs to the nested domain shape.

## Validation

- `task preflight:typescript-state`
- Loom: `bun run verify` in `agentic-ai/loom`
- `task loom:pre-push` before push
