# Function Ownership

## Priority

This is the repository-wide P1 code-structure rule for every implementation
language. Every authored function belongs to a meaningful owner.
Each owner must satisfy the single-responsibility principle.

An owner represents the knowledge, capability, state, lifecycle, or external
contract required by the operation. A file, module, namespace, or generic
utility container is not an owner by itself.

## Required actions

### Single responsibility

- Give each owner one coherent responsibility with one reason to change.
- Put domain decisions on the type that owns the required knowledge.
- Keep invariants, selection rules, priority comparisons, and state
  interpretation with that owner.
- Keep exhaustive matching that implements a domain rule inside its owner.
- Let callers orchestrate through methods named for the requested intent.
- Separate responsibilities that change for independent domain reasons.

For example, `AuthenticationWorkflowMatch::select_candidate` owns candidate
selection. Its caller must not interpret match variants or compare priorities
to reconstruct that decision.

### Decision locality

- Treat repeated predicates on one value as evidence of hidden domain behavior.
- Name the decision before changing its implementation.
- Put the decision on the object that owns the interpreted data.
- Return a semantic enum or discriminated outcome for domain classifications.
- Carry admitted data on the outcome when callers need the selected variant.
- Let callers act on the outcome without reconstructing its prerequisites.
- Apply the same placement rule recursively inside the extracted behavior.
- Keep each nested decision with the value whose knowledge determines it.
- Preserve short-circuit behavior when it protects admission or effects.
- Keep transport records structural at their external boundary.
- Admit those records into meaningful owners when authored behavior needs them.
- Reuse generated Rust contracts rather than copying their fields into TypeScript.

For example, article traversal must not combine absence, heading kind, and
heading depth checks to decide whether a block starts an article.
`CortexArticleBlock.articleHeading()` returns `Article` with its heading or
`Other`. Traversal selects the result. The block owns heading interpretation.

A compound condition is evidence, not a mechanical extraction rule. Conditions
that relate independent owners belong to the operation that owns that relation.
An empty wrapper around the original expression does not establish ownership.

### Operation placement

- Put every authored public, private, and nested function on a meaningful
  domain, application, infrastructure, fixture, or framework owner.
- Use an instance method when the operation depends on owned state or
  capability.
- Use an associated or static method for construction and cohesive stateless
  behavior.
- Use a real trait, interface, or equivalent abstraction only when it expresses
  a shared contract.
- Keep closures local only when they express an immediately used operation.
- Put test behavior on a focused fixture, harness, builder, or scenario owner.
- Keep required language entrypoints and externally fixed callbacks thin.
  Delegate portable behavior to a meaningful owner.
- Name the owner for the domain knowledge or capability it holds.

## Prohibited actions

- Do not reconstruct an owner's domain decision from its getters or variants
  in a caller.
- Do not replace that decision with a chain of mechanical getters.
- Do not return a boolean that erases a named domain decision.
- Do not move a compound predicate into a generic helper and call it locality.
- Do not combine independent responsibilities in a god object.
- Do not add a wrapper whose only purpose is to conceal misplaced behavior.
- Do not introduce an unowned free function.
- Do not treat a file, module, namespace, or directory name as function
  ownership.
- Do not hide functions in `Utils`, `Helpers`, `Common`, `Shared`, or another
  catch-all owner.
- Do not create an empty type, trait, interface, or object only to relocate free
  functions.
- Do not keep a nested helper function when its behavior belongs to an existing
  owner.
- Do not use a closure to bypass ownership for reusable behavior.
- Do not invent object identity, lifecycle phases, or a generic framework for a
  pure operation. Use a cohesive associated or static operation on its
  meaningful owner.

## Narrow boundaries

A compiler-required entrypoint, FFI export, generated ABI function, test-runner
entrypoint, or framework callback may retain its externally owned shape.

Document the exact external requirement when the boundary is not
self-evident. Keep the boundary function limited to decoding, delegation, and
encoding. A conventional name alone does not establish an exception.

Svelte component handlers and lifecycle callbacks belong to the component only
when they use that component's state or interaction contract. Shared behavior
moves to its meaningful domain or application owner.

Boundary code may discriminate transport variants for decoding or encoding.
Presentation code may discriminate public outcomes to choose their display.
These branches must not introduce selection, eligibility, authorization, or
other domain rules owned elsewhere.

## Language applications

- Rust follows
  [action ownership and typestate](../../teams/dev-core/design-docs/rust-action-ownership.md).
- TypeScript follows
  [domain structure](../../teams/web-dev/dynamic-skills/typescript-domain-structure.md).
- Repository automation follows the same rule in authored Rust and TypeScript.
- Taskfile declarations remain declarative tasks rather than authored
  functions.

## Validation

- Treat every new or changed unowned function as a P1 review finding.
- Treat misplaced domain decisions or mixed owner responsibilities in new or
  changed code as P1 findings.
- Inspect public, private, nested, test, callback, and adapter functions.
- Verify that the selected owner has semantic knowledge or capability required
  by the operation.
- Reject a mechanical move into a catch-all type or object.
- Use language-specific static enforcement where it exists.
- Keep review enforcement mandatory where static enforcement does not exist.
