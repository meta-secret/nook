# Docker-backed cache proofs

`task infra:bake-cache:prove-pr` models the consolidated PR lifecycle with real
BuildKit solves, using `pr-pipeline.Dockerfile` and its Bake targets:

1. Verification succeeds before test compilation is requested.
2. Tests succeed before heavy work is requested.
3. Repeating those solves on the same builder reuses Docker layers without any
   registry cache import/export or intermediate image publication.
4. The pinned Dylint dependency-install vertex remains cached both on a warm
   rebuild and after mutable source content changes. The simulator mutates a
   small text input instead of using a revision argument, matching BuildKit's
   content-keyed production behavior without downloading real dependencies.
5. An injected verification or test failure prevents the next phase invocation.

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
