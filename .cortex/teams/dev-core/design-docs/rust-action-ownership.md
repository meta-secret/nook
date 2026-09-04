# Rust Action Ownership and Typestate

## Decision

Rust action graphs must express legal sequencing through types.
This is the highest-priority Rust modeling policy for new or changed action flows.
Rollout proceeds through focused migrations rather than a repository-wide rewrite.

Domain newtypes explain what a value means. An owning type explains where an
operation belongs. Typestate additionally limits which operations are available
at each stage. These mechanisms complement one another.

## Required actions

### Function ownership

- Put every authored function on a meaningful struct, enum, or trait.
- Apply this rule to public, private, and nested functions.
- Choose the type that owns the operation's required knowledge or capability.
- Use associated functions for construction or cohesive stateless operations.
- Use methods when the operation depends on an instance.
- Use traits for real shared contracts or required external interfaces.
- Keep closures local when they express an immediately used operation.
- Keep test helpers owned by focused fixture types.

### State and transitions

- Use typestate for most meaningful action flows.
- Begin with distinct data-carrying structs for distinct actionable stages.
- Put only valid operations on each stage's implementation.
- Carry validated domain values forward through transition results.
- Consume `self` when a transition replaces the prior state's capabilities.
- Return an exhaustive outcome enum when a transition has multiple next states.
- Return typed errors for failed validation or failed effects.
- Keep independent state dimensions separate.
- Introduce a generic state wrapper only for a demonstrated shared need.
- Seal a generic phase contract when external implementations would forge states.

### Capability construction

- Keep advanced state fields private to the module that enforces transitions.
- Admit untrusted inputs through validation before returning a trusted state.
- Limit constructors to states callers are actually allowed to enter.
- Review `Default`, `Deserialize`, `From`, `Clone`, and `Copy` implementations.
  - Reject any implementation that forges or duplicates a restricted capability.
- Deserialize external data into boundary data before validating capabilities.
- Recheck authorization or freshness at effects when external state can change.
- Preserve cryptographic verification at its existing trust boundary.

### Evidence

- Test changed domain behavior in Rust.
- Add compile-fail tests for forbidden state construction and action ordering.
- Test each outcome branch and typed failure in the migrated flow.
- Test that invalid external input cannot construct an advanced state.
- Review secret ownership and destruction across consuming transitions.
- Follow the repository's hosted validation rules for Rust execution.

## Prohibited actions

### Ownership and modeling

- Do not hide unrelated functions in `Utils`, `Helpers`, or an empty catch-all type.
- Do not treat a module name alone as function ownership.
- Do not introduce a trait solely to move one free function.
- Do not require a generic `Session<P>` or `Phase` framework for ordinary flows.
- Do not add artificial states to a pure operation without a lifecycle.
- Do not reuse one field bag with optional stage-specific fields.

### Capability integrity

- Do not expose an unchecked constructor for a validated or authorized state.
- Do not derive deserialization directly into a restricted capability.
- Do not clone a one-use capability to preserve the pre-transition state.
- Do not treat typestate as proof of runtime authorization or cryptographic safety.
- Do not claim the ownership lint proves semantic cohesion or valid transitions.

## Simple default

Separate structs are sufficient when the next operation needs different data.
For example, a booking flow can move from `AwaitingTrip` to `AwaitingParty` and
then to `AwaitingConfirmation`. Each struct owns its `respond` method.

Confirmation returns a `Confirmed` enum containing either `Booked` or `Amend`.
Each variant carries the corresponding next state. Its constructors remain
inside the module that validates transitions.

A private field is necessary where callers must not fabricate a phase.
Ordinary answer DTOs remain ordinary data aggregates. The
[newtype construction rules](typed-newtypes.md#aggregate-construction) still
apply to those aggregates.

The existing
[enrollment typestates](auth-providers.md#shared-provider-onboarding)
illustrate sealed generic contracts. They are a precedent for that specific
provider distinction, not a universal template for action flows.

## Enforcement and rollout

### Required actions

- Use `unowned_function` to detect authored free function definitions.
- Use `invalid_unowned_function_suppression` to validate its exceptions.
- Keep both lints allow-by-default during migration.
- Activate migrated scopes explicitly while the Dylint library is loaded:

  ```rust
  #![cfg_attr(dylint_lib = "nook_domain_api", forbid(invalid_unowned_function_suppression))]
  #![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
  ```

- Keep the first implementation slice to policy and compiler lint fixtures.
- Enforce the policy through review for new or changed authored Rust meanwhile.
- Migrate one cohesive action flow per subsequent PR.
- Inventory its free functions and construction paths before changing them.
- Enable the lint only after the selected scope satisfies its diagnostics.
- Preserve public ABI and persisted wire contracts unless their change is scoped.

### Prohibited actions

- Do not classify existing free-function APIs as permanent exceptions.
- Do not equate compiler lint fixtures with domain behavior tests.
- Do not activate an unmigrated crate just to expose unrelated failures.
- Do not suppress the ownership lint across a crate, module, or type.
- Do not use blanket `allow` attributes for ownership exceptions.

## Boundary classification

Required language entrypoints and actual test-harness entry functions have an
external owner. Identify the compiler or harness requirement precisely.
A function name alone does not establish an exception.

Foreign declarations do not contain authored Rust behavior.
Externally generated framework items may remain outside the authored-item check.
Local macros must not bypass the ownership policy.
These boundaries do not exempt ordinary helper functions.

Framework callbacks that must remain free functions require a per-function
`expect(unowned_function, reason = "...")`. Use an `FFI boundary:` or
`framework boundary:` reason naming the exact required edge.
Use a checked expectation when automatic boundary identification is unavailable.
Move portable behavior into an owning type and delegate from that edge.

Compiler fixtures must distinguish required boundaries from lookalike helpers.
Suppression fixtures must reject missing reasons and blanket exceptions.
The lint checks structure. Review owns the meaning of the selected type and
the security of each transition.
