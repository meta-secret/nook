# Docker-backed cache proofs

`task infra:bake-cache:prove-pr` models the consolidated PR lifecycle with real
BuildKit solves, using `pr-pipeline.Dockerfile` and its Bake targets:

1. Verification succeeds before test compilation is requested.
2. Tests succeed before heavy work is requested.
3. Repeating those solves on the same builder reuses Docker layers without any
   registry cache import/export or intermediate image publication.
4. The Dylint product-dependency and manifest-only Cargo Chef WASM release-cook
   vertices remain cached both on a warm rebuild and after mutable source
   content changes. The Dylint stand-in uses the same immutable
   dependency-before-source layer architecture and named image output as
   production; it fails if verification falls back to a cache-only output.
5. The simulator uses small text inputs instead of downloading real
   dependencies, while preserving production's dependency-before-source ordering.
6. The fuzz dependency-install vertex remains cached when mutable source
   changes before the heavy phase is rebuilt.
7. An injected verification or test failure prevents the next phase invocation.

The proof starts a disposable Docker-container builder, retains local result
files, per-phase logs and BuildKit metadata, and removes only its own builder.
Run it on a local Docker host, not inside ARC. The dependency install uses a
small text fingerprint rather than downloading real crates, while preserving
the production ordering: immutable versions first, mutable source afterward.

`task infra:bake-cache:prove` includes this proof before the existing portable
Zot scenarios. Those scenarios still cover Main/remote registry-cache behavior;
they are not part of the PR validation path. The separate Kubernetes simulator
continues to cover node-local routing, storage persistence and cross-node cache
portability.

The proof fails if a warm or source-only rebuild executes the dependency marker
instead of reporting that exact BuildKit vertex as `CACHED`.
