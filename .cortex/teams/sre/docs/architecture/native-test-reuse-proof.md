# Native Rust Test-Reuse Evidence

The dependency-aligned graph reuses successful verification for the seven
portable native packages on the shared PR/Main route. An observed native run
passed 1,897 nextest tests and the unchanged combined coverage floors. Eight
BuildKit proof cases produced their intended outcomes, including the expected
floor and test failures. The proof workflow itself ended in a reporter-only
failure. The corrected reporter passed against the retained real artifact.

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

## Observed cache matrix

[Run 41032471900](https://github.com/meta-secret/nook/actions/runs/41032471900)
used source `8282aecfe47bd4e2067bda9e1497cf055765b087`.
The retained logs and output statuses record all eight actual BuildKit solves:

- **Cold test results:** All seven test leaves executed and reported `DONE`. The toolchain and dependency foundation remained reusable.
- **Unchanged warm replay:** All seven test leaves were `CACHED`.
- **Excluded documentation edit:** All seven test leaves were `CACHED`.
- **Replication source edit:** Common, authenticator, and auth2 test leaves were `CACHED`. Replication, event-log, companion, and core test leaves executed and reported `DONE`.
- **Core floor raised to 100%:** All seven test leaves were `CACHED`. The final gate failed because measured core line coverage was 94.31%, below the temporary 100% requirement.
- **New Cargo-discovered failing test:** The replication integration test failed at runtime. Dependent work was canceled.
- **Restored-source registry export:** All nine observed test vertices were `CACHED`. Common and authenticator each appeared twice. The registry exporter completed in 94.8 seconds and wrote the cache manifest.
- **Registry import:** The explicit native-source import completed in 3.9 seconds. The solve returned zero and all seven observed test vertices were `CACHED`.

The exported manifest digest was
`sha256:3670cdee097d11b3c62b7fde7b3fbafa5fe53e1b793c3e3bc67279c0f2379cb9`.
Its JSON length was 42,385 bytes. This is manifest metadata size, not the size
of all exported cache blobs. Missing private dependency refs with Main fallback
were separate from the successfully published native-source ref.

### Workflow and reporter status

The workflow's terminal conclusion remains **failure**. All eight BuildKit
solves had already completed with successful or expected failure outcomes.
The old reporter then rejected multiple observed vertices for a package stage
because it expected exactly one.

Reporter revision `bb899ade193bdfe72cd3872084f7685a1159c46d` retains every unique
observed vertex and checks every state. Its `verify` and `report` operations
passed when replayed against the retained real artifact. No additional BuildKit
run was performed for that reporter-only correction.

The recorded replay uses the downloaded artifact directory:

```sh
nook_native_evidence=/tmp/nook-native-test-reuse-execution-c7308e90/proof-8282aec-artifact
bun .github/scripts/native-test-reuse-evidence.ts "$nook_native_evidence" verify
bun .github/scripts/native-test-reuse-evidence.ts "$nook_native_evidence" report
```

## Measured resource footprint

The compact [proof artifact](https://github.com/meta-secret/nook/actions/runs/41032471900/artifacts/12965679073)
was 3,721,266 compressed bytes and 33,448,690 expanded bytes. The ordinary
native coverage export was 4.64 MB. Raw LLVM inputs stayed inside BuildKit.

The retained inventories measured these logical per-leaf raw-profile and
executable bundle lengths:

- **`nook-app-common`:** 480,827,688 bytes, 18 profiles, 80 objects.
- **`nook-authenticator-domain`:** 487,902,888 bytes, 6 profiles, 81 objects.
- **`nook-replication`:** 477,022,728 bytes, 23 profiles, 77 objects.
- **`nook-auth2`:** 687,055,040 bytes, 223 profiles, 92 objects.
- **`nook-event-log`:** 643,966,336 bytes, 139 profiles, 91 objects.
- **`nook-companion-core`:** 795,527,496 bytes, 520 profiles, 84 objects.
- **`nook-core`:** 2,906,532,504 bytes, 1,006 profiles, 94 objects.

Their logical sum is 6,478,834,680 bytes, about 6.03 GiB. Bundles can contain
overlapping shared objects. These file-length totals do not measure physical
BuildKit disk consumption after content deduplication.

## Evidence boundary and limits

- The proof uses the existing persistent ARC BuildKit store. A new Buildx client does not create a fresh content store.
- Same-store import does not establish clean-store or cross-node portability.
- Cold test-result execution can reuse dependency and compiler caches. It does not mean every compiler input or OS cache is cold.
- Cold independent branches may repeat dependency compilation. No universal speedup is claimed.
- This record covers the seven portable native nextest/coverage packages. Specialized ecosystem, fuzz, Kani, and browser paths are outside its proof scope.
- Raw LLVM profiles and executable bundles stay in BuildKit leaves and the coverage join. Proof output contains combined coverage, JUnit XML, and `artifact-files.tsv` inventories.
- The workflow uploads only the compact `evidence` directory. It excludes full Cargo target trees, raw executable bundles, and copied source contexts.

Native execution logs and summaries are retained locally under
`/tmp/nook-native-test-reuse-execution-c7308e90/native-1e25451-*`.
The proof's retained artifact is
`/tmp/nook-native-test-reuse-execution-c7308e90/proof-8282aec-artifact`.
Run links and exact source revisions identify the hosted observations.
