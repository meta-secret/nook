# Domain API Integrity

## Priority

This is the repository-wide P1 contract for authored domain and application
APIs. Language-specific rules refine its syntax. They do not weaken its
semantics.

Domain types carry meaning and metadata. API shapes preserve that meaning from
external decoding through state, behavior, persistence, and results.

## Required actions

### Types and states

- Give every domain value a named type.
- Use a nominal newtype, opaque type, enum, or value object when a primitive
  representation has domain meaning.
- Use an enum or discriminated union for a closed set or named state.
- Put state-specific data on the state or variant that owns it.
- Keep independent state dimensions in independent types.
- Match evolving domain alternatives exhaustively.
- Keep internal application values concrete after boundary decoding.

### Construction and transitions

- Validate untrusted input before constructing a trusted domain value.
- Keep unchecked construction private to the validating owner.
- Keep advanced capability construction private to the legal transition.
- Expose an operation only on the state or capability where it is legal.
- Return a named next state or exhaustive outcome from a state transition.
- Recheck runtime authorization or freshness at the effect boundary when
  external state can change.

### API inputs and failures

- Give each authored function or method at most one non-receiver parameter.
- Use one named domain or operation request when an API needs multiple values.
- Construct independent request values with named fields.
- Return or throw a domain-specific failure with a stable kind or code.
- Preserve a typed source when one operation fails because another operation
  failed.
- Distinguish validation, authorization, unavailable-state, conflict, and
  external-effect failures when callers act on them differently.
- Propagate failure until the owner that can classify, recover, or present it.

### Boundaries and versions

- Decode raw external data into concrete domain values at the narrowest edge.
- Encode domain values only when crossing a required external boundary.
- Give every persisted or wire schema version a named domain type.
- Keep one explicit current writer version and an explicit supported-reader
  set.
- Reject unsupported versions with a typed failure.
- Define the migration and rollback contract before changing a persisted or
  wire shape.
- Preserve the owning schema and generated binding instead of creating a
  language-local mirror.
- Follow the security-owned
  [secret lifecycle](../../teams/security/dynamic-skills/secret-lifecycle.md)
  whenever a value contains secret material.

## Prohibited actions

- Do not expose a raw primitive when it carries domain meaning.
- Do not embed an unnamed union in a field, parameter, return, or collection.
- Do not represent a named state with a boolean, sentinel, optional field bag,
  fake default, or decorative missing variant.
- Do not use an erased value bag as a domain or application value.
  - This includes `unknown`, `any`, `object`, generic records, raw JSON trees,
    `dyn Any`, and equivalent catch-all values.
- Do not use an unchecked cast, non-null assertion, panic shortcut, or
  equivalent escape hatch to manufacture a valid state.
- Do not use multiple positional parameters, tuples, arrays, or collections to
  hide independent request values.
- Do not introduce a repository-defined generic result, optional-value, or
  catch-all error wrapper that erases domain failure meaning. A language
  built-in remains valid when its success and failure types are concrete.
- Do not catch or convert a failure unless the current owner adds domain
  meaning, recovery, or boundary translation.
- Do not silently accept an unknown schema version.
- Do not change a persisted or wire shape without its explicit version and
  migration decision.

## Narrow boundaries

Raw primitives and untyped transport values may exist only in private
representation storage or at required serialization, database, FFI, generated
ABI, browser, and host edges. Validate and convert them immediately.

Compiler-required signatures, traits, generated bindings, and externally fixed
callbacks may retain their owned shape. Keep adapters thin and delegate to an
API that follows this contract.

Plaintext user content may remain text when the content itself is the value.
Its secret lifetime still follows the security authority above.

## Language applications

- Rust follows [Rust coding](../../teams/dev-core/dynamic-skills/rust-coding.md),
  [typed newtypes](../../teams/dev-core/design-docs/typed-newtypes.md), and
  [action ownership](../../teams/dev-core/design-docs/rust-action-ownership.md).
- TypeScript follows
  [domain structure](../../teams/web-dev/dynamic-skills/typescript-domain-structure.md),
  [explicit state](../../teams/web-dev/dynamic-skills/typescript-explicit-state.md),
  [concrete values](../../teams/web-dev/dynamic-skills/typescript-no-unknown.md),
  and [single parameter](../../teams/web-dev/dynamic-skills/typescript-single-parameter.md).
- Rust owns portable product, security, persistence, and wire vocabulary.
- TypeScript owns browser, host, lifecycle, and presentation vocabulary.

## Validation

- Review every new or changed field, parameter, return, state, and boundary.
- Verify named request construction and one-parameter signatures.
- Test every state transition, exhaustive outcome, and typed failure branch.
- Test malformed and unsupported external input at the decoding boundary.
- Test every supported schema version and unsupported-version rejection.
- Use language-specific static enforcement where it exists.
- Keep semantic review mandatory because syntax checks cannot prove ownership,
  domain meaning, capability integrity, or migration safety.
