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

Run:

1. `task preflight:source-architecture`
2. `task infra:k0s:manifests:check`
3. `task format`
4. Exact-head pull-request validation

The repository-language preflight uses one filesystem inventory in every
environment. The inventory applies committed ignore files without requiring Git
metadata. It never follows symlinks. Automation symlinks fail closed.

The scan rejects prohibited source extensions. It reads only
automation-capable text formats. Structured YAML and JSON manifests are decoded
before runtime, dependency, and script references are checked.
