# Docker-backed cache proofs

## Synthetic PR lineage proof

`task infra:bake-cache:prove-pr` models the consolidated PR lifecycle with real
BuildKit solves, using `pr-pipeline.Dockerfile` and its Bake targets:

1. Verification succeeds before test compilation is requested.
2. Tests, including Docker-side coverage generation and floor enforcement,
   succeed before the independent post-test fan-out (heavy work and
   browser-artifact export) is requested.
3. Repeating those solves on the same builder reuses Docker layers without any
   registry cache import/export or intermediate image publication.
4. The Dylint product-dependency and manifest-only WASM release-dependency
   stand-ins remain cached on a warm rebuild. The `cargo-deps` fixture models
   the manifest-only dependency root. The Dylint stand-in uses the same
   immutable dependency-before-source layer architecture and named image output as
   production; it fails if verification falls back to a cache-only output.
5. The simulator uses small text inputs instead of downloading real
   dependencies, while preserving production's dependency-before-source ordering.
6. The fuzz dependency-install vertex remains cached on the warm post-test solve.
7. An injected verification or test failure prevents the next phase invocation.
   The post-test fan-out is joined before browser suites begin, while those
   browser suites remain sequential on the runner. Coverage is never exported
   for a redundant PR report.

The proof starts a disposable Docker-container builder, retains local result
files, per-phase logs and BuildKit metadata, and removes only its own builder.
Run it on a local Docker host, not inside ARC. The dependency install uses a
small text input rather than downloading real crates, while preserving
the production ordering: immutable versions first, source-sensitive inputs afterward.

This fixture proves BuildKit lineage and phase barriers with synthetic inputs.
Real Rust compilation and disk/S3 compiler reuse require separate cold, warm,
cache-import, and cache-export builds with native cache-health statistics.

`task infra:bake-cache:prove` includes this proof before the existing portable
Zot scenarios. Those scenarios still cover Main/remote registry-cache behavior;
they are not part of the PR validation path. The separate Kubernetes simulator
continues to cover node-local routing, storage persistence and cross-node cache
portability.

### Warm-rebuild evidence

The proof fails if a warm rebuild executes the dependency marker instead of
reporting that exact BuildKit vertex as `CACHED`.

For a production warm-cache check, open a PR that does not change Rust, web,
Docker, Bake, or dependency inputs and compare its consolidated validation run
with the preceding run on the same ARC node. A warm run must show cached
BuildKit vertices without Cargo dependency downloads or Rust dependency
compilation. Runner placement is part of the evidence: results from different
nodes do not prove or disprove reuse of a node-local BuildKit cache.

## Real Rust compiler cache proof

Request `infra:bake-cache:prove-compiler` through the existing remote workflow:

```sh
task remote TASK_NAME=infra:bake-cache:prove-compiler
```

The task uses real Rust crates on the selected persistent BuildKit shard with
the existing S3 credentials. It needs no Docker runtime or runner changes.
Its fixture checks these observable outcomes:

- Strict S3 writes and subsequent S3 compiler hits.
- Local compiler hits after inheriting a parent snapshot without Cargo outputs.
- Real source behavior after replacing placeholder crate roots.
- Independent writable caches in sibling child stages.
- Cold and warm builds, followed by actual local-cache export and import.

Logs, BuildKit metadata, outputs, and cache-health statistics remain under
`RUNNER_TEMP/nook-compiler-cache-proof`. The remote workflow uploads that
directory when the proof produced it.

An import on the same shard demonstrates reuse on that shard. It does not
establish fresh-node portability. Record actual results and timings before
claiming a speed or storage improvement. The synthetic PR lineage proof above
does not supply this Rust/compiler-cache evidence.
