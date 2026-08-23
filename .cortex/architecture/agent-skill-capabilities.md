# Agent, Skill, and Capability Architecture

Nook uses a small stable family of agent execution profiles over a large
catalog of focused skills. A skill may contain a deterministic TypeScript
capability, but skill selection never grants scheduling or write authority.

## Concept taxonomy

The architecture has five separate concepts.

- **Authority:** Durable product, architecture, workflow, or policy truth in
  Cortex.
- **Skill:** One focused reusable judgment, technique, or invariant available
  to an agent.
- **Agent profile:** Stable context, isolation, capability, and typed result
  contract. A domain expert is a profile, not a separate runtime.
- **Workflow:** Reviewed ordering, ownership, branching, barriers, and joins.
- **Deterministic tool:** A typed check or transformation whose result follows
  from declared inputs.

`SKILL.md` is an invocation adapter. It points to the owning authority and
states the direct-use boundary. The file is agent-executable guidance. It is
not proof that the skill contains executable code.

An executable skill is reviewed, statically registered repository capability
code. It is not an extension or plugin interface for arbitrary, downloaded,
model-authored, or hostile code. Review establishes provenance and intended
behavior. It does not grant ambient authority.

Task provides stable repository commands. Loom provides the generic controlled
execution boundary for reviewed repository capabilities. Neither becomes
semantic authority merely because it runs a check.

## Skill granularity

One skill owns one reusable reason to change.

Split a skill when its parts differ in any of these dimensions:

- trigger;
- owning authority;
- required context;
- negative space;
- validation evidence;
- consumer agent profiles; or
- maintenance lifecycle.

Do not split a skill only to shorten Markdown. Do not create a new agent because
a new skill exists. Most skills remain instruction-only.

Create or retain an agent profile only when context scope, isolation,
capabilities, or typed output differs materially from existing profiles.

## Mechanical capability package

A skill may own TypeScript code when all these conditions hold:

- the behavior is deterministic from declared inputs;
- the behavior is specific to the skill's semantic owner;
- inputs and outputs have stable closed contracts;
- repeat execution has enough value to justify maintenance;
- the behavior can be tested without model judgment; and
- mandatory invocation can remain registered independently of model-selected
  skills.

The optional package lives beside the owning skill under
`.agents/skills/<skill>/`.

It contains:

- `executable-skill.json` with closed declarative metadata and bounds;
- `src/` with codecs, domain behavior, execution, and semantic verification;
- `tests/` with focused behavior and contract evidence; and
- fixtures only when real files or protocol materials improve evidence.

The shared `.agents/skills/` Bun project runs TypeScript directly. `tsc
--noEmit` verifies types. Compilation is not a runtime prerequisite.

The manifest cannot name an import, command, environment variable, credential,
network endpoint, or scheduler transition. A reviewed static TypeScript
registry binds a skill ID to code.

## Static registry and agent selection

The static registry is the reviewed skill hashmap.

Each entry binds:

- one stable skill ID;
- one exact manifest;
- one statically bound runner path outside manifest control; and
- one closed request and result contract.

Agent profiles receive an audited allowed skill set. The task determines which
allowed skills are relevant. Loading a skill changes available knowledge or
local deterministic capability. It does not change filesystem authority,
network authority, lineage, depth, scheduling, or write access.

Mandatory repository checks are registered in Task, Loom, or CI. They run even
when no model selects the related skill.

## Loom trust boundary

Loom remains the generic control plane.

Loom owns:

- immutable source identity and bounded materialization;
- path and capability enforcement;
- process, credential, environment, and network isolation;
- static DAGs, lineage, depth, barriers, and successor authority;
- event journals, hashes, replay, receipts, and materialized views;
- byte, time, and activity budgets; and
- terminal persistence and all-terminal aggregation.

Each capability invocation runs in a fresh container under the manifest's
enforced `docker-read-only` policy:

- the staged transitive source and locked dependency closure is materialized
  from one immutable Git index tree;
- a content-addressed image is built from that closure with dependency scripts
  disabled;
- only the serialized request enters the running container;
- the container root filesystem is read-only, with no host bind mounts;
- the repository root and Docker socket are absent;
- network access, host credentials, host environment variables, and Linux
  capabilities are unavailable;
- protocol output and diagnostics are byte bounded; and
- execution and semantic self-verification complete in the same container.

The execution-kind field requests a policy. It is not evidence that the policy
was applied. Loom emits a verified receipt only after the pinned container
exits successfully and its bounded output passes the registered contract. The
receipt binds the Git index tree, recursive source-and-lock closure digest, and
inspected execution-image digest. Worktree changes to capability source or
dependency metadata must be staged before execution so one invocation cannot
mix versions.

On deadline expiry, Loom force-removes the named container, terminates the
client process, waits for teardown, and discards candidate output. Promise
cancellation without process teardown is not a hard timeout.

This boundary limits reviewed repository capability code and ordinary defects.
It does not claim safe execution of hostile same-host code. Supporting
downloaded or adversarial plugins would require a separate threat model.

A skill capability owns:

- repository-specific request and result codecs;
- local deterministic rules;
- semantic self-verification;
- focused fixtures and tests; and
- rendering that has no scheduler meaning.

A skill cannot delegate, schedule, append workflow journals, mint trusted
authority, mutate Git or GitHub, publish Workbench state, or infer transitions
from prose.

Self-verification proves local result consistency. Only Loom may accept that
result into trusted workflow provenance.

## Testing model

Executable skills use the strongest economical evidence.

1. Test pure rules with real domain values.
2. Test filesystem behavior with temporary directories and real files.
3. Test Git behavior with temporary repositories and real commits.
4. Test protocols with bounded local servers or in-process protocol adapters.
5. Test infrastructure with isolated containers when the real boundary matters.
6. Run one integration test through the static registry and generic Loom
   adapter.
7. Prove repository writes fail and leave no artifact.
8. Prove non-terminating execution is killed and its container disappears.
9. Prove network and host credential restrictions match the declared policy.

Avoid monkeypatching the function whose success is the trust predicate. Prefer
real implementations, typed stubs below the trust boundary, and independently
verifiable outputs.

Every executable skill applies the repository TypeScript rules:

- one named parameter contract per function;
- named object arguments;
- concrete domain types;
- strict compiler settings;
- no Python;
- focused source modules below the repository size limit; and
- exact manifest, codec, bounds, and negative-space tests.

## Migration rule

Determinism makes behavior eligible for mechanical encoding. It does not move
semantic authority out of Cortex.

For each candidate:

1. Identify the owning semantic skill and authority.
2. Separate generic trust mechanics from repository-specific behavior.
3. Freeze the capability request, result, bounds, and negative space.
4. Move the local mechanic and focused tests beside the skill.
5. Register its implementation statically.
6. Keep mandatory Task, Loom, or CI invocation intact.
7. Prove exact compatibility before deleting the former implementation.
8. Remove duplicated implementation prose while retaining rationale, scope,
   exceptions, and acceptance meaning in Cortex.

Retain behavior in Loom when it owns scheduling, isolation, provenance, replay,
or another generic trust concern. Record that reason explicitly rather than
moving code for directory symmetry.
