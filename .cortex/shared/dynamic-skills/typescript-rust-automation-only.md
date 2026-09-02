# TypeScript and Rust Automation Only

## Priority

This is a P1 hard rule. A violation blocks delivery.

## Problem Pattern

Python adds a fourth repository language and runtime for tasks already covered by
the standard toolchain. It creates duplicate dependency management, formatting,
typing, image packages, and reviewer context. Small scripts tend to become
operational controllers without the repository's TypeScript or Rust checks.

## Hard Rule

Do not author, retain, or invoke Python anywhere in the repository. The ban
includes:

- source and interface files;
- inline heredoc programs and shebangs;
- CI and Taskfile commands;
- runtime and container packages;
- test mocks and manifest contracts;
- explicit package or tool dependencies.

There are no baselines, allowlists, changed-file exceptions, or grandfathered
uses.

## Preferred Pattern

Choose from the repository's owned toolchain:

- Use Bun and TypeScript for scripts, manifest contracts, HTTP controllers, and
  test harnesses.
- Use Rust for compiled domain, security, systems, and performance-sensitive
  behavior.
- Use Taskfiles for declarative orchestration of existing commands.
- Use focused standard command-line tools such as OpenSSL, jq, and Bash only
  within a Taskfile-owned operation when they avoid a new language runtime.

Keep TypeScript within the named-argument, single-parameter, and explicit-type
rules. Keep operational behavior covered by regression tests after migration.

## Validation

Team Agents author the required regression coverage, run only required
non-compiling formatters, and return a coherent commit to Gizmo. Gizmo runs
`task loom:pre-push`, pushes the exact head, and dispatches
`task remote TASK_NAME=preflight`; hosted preflight owns the source-architecture
evidence.

Complete exact-head pull-request validation owns the manifest-contract
evidence. No focused hosted selector is allowlisted for the manifest check. If
the complete validation job cannot provide that evidence, report the missing
route as a blocker. Never substitute local source-architecture or manifest
validation.

The repository-language preflight uses one ignore-aware filesystem inventory in
every environment. When Git metadata is present, tracked index entries are
unioned into that inventory. Force-added files therefore cannot hide behind
ignore rules. Sealed source contexts scan every file admitted by the Docker
context instead of reapplying Git-only ignore rules. The inventory never
follows symlinks. Automation symlinks fail closed.

The scan rejects prohibited source, package, notebook, and executable-artifact
extensions. Content matching is limited to shell files, manifests, and
TypeScript or JavaScript under automation-owned directories. It uses explicit
regular expressions for direct runtime and package-tool invocations.
