# TypeScript Domain Structure

## Purpose

- Apply the repository's primary function-ownership rule to every authored
  TypeScript function.
- Apply the repository-wide
  [domain API integrity rule](../../../shared/dynamic-skills/domain-api-integrity.md)
  to every authored TypeScript domain and application API.

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
- Create branded and opaque values through a named parser or validating
  factory. Keep the brand token and unchecked construction private.
- Return a domain-specific decode outcome or throw a named domain error class
  when external input cannot become the domain type.
- Give actionable failures a stable enum kind or code.
- Preserve the concrete source error when translating a lower-level failure.
- Catch a failure only when the current owner adds domain meaning, recovery, or
  boundary presentation.
- Put every authored public, private, and nested function on a meaningful
  class, value object, domain object, fixture, or required framework owner.
- Use an instance method when the operation depends on owned state.
- Use a static method for cohesive construction or stateless behavior.
- Keep component handlers on a Svelte component only when they belong to that
  component's state or interaction contract.
- Follow the repository-wide
  [function ownership rule](../../../shared/dynamic-skills/function-ownership.md).
- Model state changes as named transitions from one domain state to a named
  next state or outcome.
- Keep advanced-state construction private to the transition that validates
  it.
- Expose an operation only from the state owner where that operation is legal.
- Give every TypeScript-owned persisted or wire schema a named version type.
- Keep one explicit current writer version and an explicit supported-reader
  set. Reject unsupported versions with a domain-specific failure.
- Define an explicit migration before changing a persisted shape.
- Follow the security-owned
  [secret lifecycle](../../security/dynamic-skills/secret-lifecycle.md) for
  browser interactions that temporarily receive plaintext.

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
- Do not fabricate a branded or opaque domain value with `as` inside
  application behavior.
- Do not export a brand token, unchecked constructor, or writable field that
  bypasses validation.
- Do not put domain behavior in generic `Utils` or `Helpers` containers.
- Do not introduce an unowned top-level or nested free function.
- Do not treat a file, module, namespace, or directory as function ownership.
- Do not create an empty class, interface, namespace, or object only to move a
  free function.
- Do not throw raw strings or expose generic `Error` as an actionable domain
  contract.
- Do not swallow a failure or replace its domain kind with freeform text.
- Do not silently accept, reinterpret, or overwrite an unsupported schema
  version.
- Do not persist or log secret plaintext or retain it after the interaction
  lifecycle ends.
- Do not encode a transition by mutating parallel booleans, sentinels, or
  optional fields.
- Do not invent instance identity or lifecycle when a static operation on the
  meaningful owner is truthful.

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

- [ ] Put every authored function on a meaningful owner. Reject module-only,
      namespace-only, and catch-all utility ownership.
- [ ] Search the changed scope for raw primitives in domain fields, parameters,
      returns, state, DTOs, collections, tuples, and generic arguments.
- [ ] Give every scalar domain meaning a generated, branded, opaque, enum, or
      value-object type.
- [ ] Declare every domain union separately and use its name in containing
      fields.
- [ ] Reject primitive sentinels such as `false`, `undefined`, `null`, empty
      strings, and zero when they stand for a domain state.
- [ ] Verify each actionable failure has a stable domain kind or code and
      preserves its concrete source when translated.
- [ ] Verify each changed TypeScript-owned persisted schema has an explicit
      version, supported-reader set, unsupported-version failure, and migration
      decision.
- [ ] Inventory browser plaintext creation, copies, persistence, logs, and every
      terminal cleanup transition.
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
