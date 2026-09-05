# TypeScript Domain Structure

## Purpose

Keep TypeScript domain models typed by meaning, nested, and enum-driven. A raw
representation does not carry the metadata that makes a domain value safe to
use. Treat raw domain primitives, inline unions, raw-string field allow-lists,
and hand-rolled `Result` / `Maybe` utilities as forbidden.

This is the TypeScript form of Rust's domain-newtype rule. A domain type must
make its meaning visible at the declaration, field, parameter, return, and
boundary where it is used.

## Domain Type Rule

### Required actions

- Define a named domain type for every authored domain, application, workflow,
  lifecycle, policy, mode, command, configuration, persistence, and
  owned-contract value.
- Use the generated Rust/WASM enum or newtype for portable product and
  security vocabulary. Do not declare a TypeScript mirror.
- Use a cohesive TypeScript enum for a browser, lifecycle, or presentation
  vocabulary owned by TypeScript.
- Use a branded or opaque type for a scalar with one domain meaning.

  ```ts
  declare const WorkflowIdBrand: unique symbol;
  type WorkflowId = string & {
    readonly [WorkflowIdBrand]: "WorkflowId";
  };
  ```

- Use a named interface or value object for a domain aggregate.
- Declare every legal alternative as a named discriminated union before using
  it in another domain type.
- Keep the named union separate from its containing field.

  ```ts
  enum WorkflowSelectionState {
    Matched = "matched",
    Unavailable = "unavailable",
  }

  type WorkflowSelection =
    | {
        readonly state: WorkflowSelectionState.Matched;
        readonly kind: AuthenticationWorkflowKind;
      }
    | { readonly state: WorkflowSelectionState.Unavailable };

  interface AuthenticationWorkflowView {
    readonly selection: WorkflowSelection;
  }
  ```

- Normalize a raw external representation into the named domain type at the
  narrowest boundary.
- Preserve the named type through domain calls, state, storage, and WASM
  adapters.

### Prohibited actions

- Do not expose raw primitive values when they carry domain meaning.
  - This includes `string`, `number`, `boolean`, and other primitives.
  - This applies to reachable fields, parameters, returns, DTOs, state,
    collections, tuples, and generic arguments.
- Do not use an inline union at a domain boundary. This includes fields,
  parameters, returns, arrays, promises, and generic arguments.
- Do not write `readonly workflowKind: AuthenticationWorkflowKind | false`.
  The absence or availability state must be a member of a named union such as
  `WorkflowSelection`.
- Do not use `false`, `true`, `null`, `undefined`, empty strings, zero, or
  sentinel numbers as unnamed domain states.
- Do not treat `type WorkflowId = string` as a safe newtype. A plain alias does
  not stop two string-backed domain values from being exchanged.
- Do not unwrap a domain type merely to pass its primitive representation
  through another application layer.

Raw primitives are allowed only in narrow cases.

- Keep them in private implementation storage.
- Keep them for plaintext user content whose representation is its meaning.
- Keep them for locale plumbing.
- Keep them at a required external, serialization, database, or host boundary.
- Convert them to named domain types immediately when application behavior
  begins.

## Forbidden Patterns

Do not ship any of these:

```ts
// Forbidden: raw-string field allow-list
const ALLOWED = new Set(["stageHostUpdates", "fetchOriginMain"]);

// Forbidden: generic Optional / Result clones
type Result<T> = Ok<T> | Err;
type Maybe<T> = Present<T> | Absent;

// Forbidden: flat same-prefix closed vocabularies
enum RequestKind {
  AgentStatsAssemble = "agentStatsAssemble",
  AgentStatsValidate = "agentStatsValidate",
  AgentStatsPublish = "agentStatsPublish",
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
- Domain unions are declared as named types and referenced by name. Do not
  embed a union in a field declaration.

## Scope

Applies to:

- Authored TypeScript under `agentic-ai/`, `nook-app/nook-web/`, scripts, and
  agent tooling
- Loom domain YAML request shapes

Does not apply to:

- Rust `Result` / `Option` (see [rust-coding.md](../../dev-core/dynamic-skills/rust-coding.md))
- Generated WASM / dependency typings

## Examples

- Forbidden: `new Set(['stageHostUpdates', ...])`, `result.ts` with
  `Result` / `Maybe`
- Required: `enum PrePushField { ... }`, nested `agentStats.assemble`,
  `DecodeOutcome` only inside codecs, `LoomFailure` for runtime failures

## Application Checklist

- [ ] Search the changed scope for raw primitives in domain fields, parameters,
      returns, state, DTOs, collections, tuples, and generic arguments.
- [ ] Give every scalar domain meaning a generated, branded, opaque, enum, or
      value-object type.
- [ ] Declare every domain union separately and use its name in containing
      fields.
- [ ] Reject primitive sentinels such as `false`, `undefined`, `null`, empty
      strings, and zero when they stand for a domain state.
- [ ] Normalize raw external values immediately at the boundary.
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
- The worker that owns the changed scope runs the applicable checks above plus
  the affected package's focused typecheck and behavior tests, retains required
  browser evidence, formats every allowed source or Cortex file, commits one
  coherent exact handoff, and returns the commit and evidence without pushing.
  Changes under `agentic-ai/` and Loom remain AI-worker work. A Web worker
  applies this skill only to web-owned implementation or through an explicit
  Web expertise task; the skill does not grant generic ownership of
  `agentic-ai/` or Loom.
- Gizmo continues from the formatted commit and runs `task loom:pre-push` on the
  combined head. If that gate formats team-owned content, Gizmo returns the
  exact diff to its owning worker for a fresh formatted commit instead of
  committing it.
- After the owner commit and a clean gate, Gizmo pushes.
- A head that is not validation-ready receives a relevant focused remote task.
- A validation-ready head receives complete exact-head validation.
- Gizmo owns readiness and merge.

For Loom's one-parameter function rule, see
[typescript-single-parameter.md](typescript-single-parameter.md).
