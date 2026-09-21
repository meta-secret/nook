# Nook Rust Ownership Lint Rollout

Meta-Cortex Rust development owns function ownership and workflow typestate.
This document owns Nook compiler enforcement and staged activation.

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

### Boundary evidence

Compiler fixtures must distinguish required boundaries from lookalike helpers.
Suppression fixtures must reject missing reasons and blanket exceptions.
The lint checks structure. Review owns the meaning of the selected type and
the security of each transition.
