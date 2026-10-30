# Native Rust Test-Reuse Evidence

The dependency-aligned native graph has one observed successful execution of
all seven test leaves. That run passed 1,897 nextest tests and the unchanged
combined coverage floors. The broader cache-reuse matrix is still running.
Its results are not recorded as passing here.

The [engineering harness](engineering-harness.md#native-rust-source-and-test-reuse)
owns the source-input, test-result, and coverage-merge architecture.

## Reproduction entrypoints

From a clean, pushed feature checkout, use the existing remote Task entrypoints:

```sh
task remote TASK_NAME=rust:ci
task remote TASK_NAME=rust:native-test-evidence
```

The remote workflow binds the requested task to the checkout's pushed source
SHA. The proof selector runs `docker:ci:rust:native-test-reuse:prove`.
`NATIVE_TEST_PROOF_DIR` is assigned to the runner's temporary native-proof
directory. No separate infrastructure or shared-cache purge is required.

## Observed native execution

- **Run:** [41029465298](https://github.com/meta-secret/nook/actions/runs/41029465298), successful.
- **Source:** `1e2545100325bb57de7f59bad1282c90205a4cfa`.
- **Task:** `rust:ci`.
- **Job wall time:** 151 seconds, including setup and preflight.
- **Cache state:** The seven native test vertices all executed and reported `DONE`. None was `CACHED`.
- **Dependency state:** Existing toolchain, dependency, and compiler caches were preserved. This was not dependency-cold execution.
- **Guards:** Coverage-policy checks passed 5 tests. Vault-isolation checks passed 32 tests.
- **Diagnostics:** The extracted diagnostic inventory contains no actual LLVM warnings for this run.
- **Coverage handoff:** The solve exported a 4.64 MB combined report payload to the runner. This ordinary native run did not upload a coverage artifact.

The seven instrumented nextest leaves passed 1,897 tests with zero skipped.
Combined line coverage includes downstream test contributions. Every package
retained its existing 90% floor:

- **`nook-app-common`:** 16 tests passed, 95.72% line coverage.
- **`nook-authenticator-domain`:** 4 tests passed, 97.44% line coverage.
- **`nook-auth2`:** 219 tests passed, 90.84% line coverage.
- **`nook-replication`:** 21 tests passed, 97.93% line coverage.
- **`nook-event-log`:** 137 tests passed, 91.49% line coverage.
- **`nook-companion-core`:** 518 tests passed, 96.01% line coverage.
- **`nook-core`:** 982 tests passed, 94.31% line coverage.

## Cache matrix in progress

[Run 41029968770](https://github.com/meta-secret/nook/actions/runs/41029968770)
targets source `171af1b72919cb0f2730639cbf07db451d84d30b`.
Its configured sequence contains eight real BuildKit solves:

1. Cold test-result stages with the reusable toolchain and dependency foundation.
2. An unchanged warm replay.
3. An excluded documentation-only change.
4. A source change in `nook-replication`.
5. A `nook-core` floor-only change to 100%, with failure expected.
6. A real failing Cargo-discovered replication integration test.
7. Restored source exported to its ordinary exact branch cache ref.
8. Registry import through the existing persistent BuildKit worker.

These are case definitions, not successful outcomes. Final cache-state,
failure-boundary, export, and import observations remain pending.

## Evidence boundary and limits

- The proof uses the existing persistent ARC BuildKit store. A new Buildx client does not create a fresh content store.
- Same-store import does not establish clean-store or cross-node portability.
- Cold test-result execution can reuse dependency and compiler caches. It does not mean every compiler input or OS cache is cold.
- The earlier [37-second baseline run](https://github.com/meta-secret/nook/actions/runs/41024146348) was warm, with all six old test `RUN` vertices cached. The baseline and 151-second execution above exercised different cache states.
- Cold independent branches may repeat dependency compilation. No universal speedup is claimed.
- Raw LLVM profiles and executable bundles stay in BuildKit leaves and the coverage join. Proof output contains combined coverage, JUnit XML, and `artifact-files.tsv` inventories.
- The workflow uploads only the compact `evidence` directory. It excludes full Cargo target trees, raw executable bundles, and copied source contexts.

Local copies of the observed native run's logs and summaries are retained under
`/tmp/nook-native-test-reuse-execution-c7308e90/native-1e25451-*`.
The run link and exact source revision identify the hosted observation.
