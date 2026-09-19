# Docker-backed cache proofs

`task infra:bake-cache:prove-pr` models the consolidated PR lifecycle with real
BuildKit solves, using `pr-pipeline.Dockerfile` and its Bake targets:

1. Verification succeeds before test compilation is requested.
2. Tests succeed before heavy work is requested.
3. Repeating those solves on the same builder reuses Docker layers without any
   registry cache import/export or intermediate image publication.
4. An injected verification or test failure prevents the next phase invocation.

The proof starts a disposable Docker-container builder, retains local result
files, per-phase logs and BuildKit metadata, and removes only its own builder.
Run it on a local Docker host, not inside ARC. It does not model BuildKit's cache
validity itself and makes no production performance claim.

`task infra:bake-cache:prove` includes this proof before the existing portable
Zot scenarios. Those scenarios still cover Main/remote registry-cache behavior;
they are not part of the PR validation path. The separate Kubernetes simulator
continues to cover node-local routing, storage persistence and cross-node cache
portability.

For this change, proof execution is intentionally deferred to the follow-up
validation owner. Neither a successful runtime proof nor a speedup is claimed.
