# Companion Page-Policy Compile Measurements

The extraction gives `nook-page-policy` independent ownership with no other
Nook dependencies. Compile results were mixed. Cold single samples improved
slightly, while the selected source-invalidation rebuild medians increased.
These measurements do not demonstrate a general compilation or CI speedup.

## Revisions and environment

- **Before:** `877a39572755d87acb670e068130508ba1078537`.
- **After code:** `405730a7adf2cd02afe90aa01101b6e79517e1eb`.
- **Source root:** `/Users/bynull/.codex/worktrees/821f/nook/nook-app/nook-platform` for both revisions.
- **Host:** Apple ARM `Mac17,6`, 18 logical CPUs, 128 GiB memory.
- **Toolchain:** Rust and Cargo `1.98.1`, LLVM `22.1.8`.
- **Authorization:** The user explicitly authorized host Rust measurements for this task after the container runtime was unavailable.
- **Parallelism:** `CARGO_BUILD_JOBS=18` used every logical CPU. Other worker compiles were stopped during samples.
- **Compiler state:** Incremental compilation was off. Both compiler wrappers were disabled.
- **Inputs:** Registry sources were fetched outside timed samples. Every measured build used `--locked --offline`.
- **Outputs:** Each revision and target started with an isolated empty compiler-output directory. Its warm and source-edit samples reused that directory.
- **Profiles:** Native used the default dev profile with the repository's dependency `opt-level=3`. Both WASM libraries used release mode.

## Recorded commands

Both revisions used the same top-level package selections and compiler flags.
`nook_timing_side` selected `before` or `after` for the corresponding source
revision. The native selection stayed at seven roots, with the new leaf built
through its consumers after extraction.

```sh
cd /Users/bynull/.codex/worktrees/821f/nook/nook-app/nook-platform
nook_timing_root=/tmp/nook-companion-page-policy-c7308e90
nook_timing_side=before

/usr/bin/time -l env \
  RUSTC_WRAPPER= RUSTC_WORKSPACE_WRAPPER= \
  CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=18 \
  CARGO_TARGET_DIR="$nook_timing_root/$nook_timing_side/native" \
  cargo build --locked --offline --timings \
  --target aarch64-apple-darwin \
  -p nook-app-common -p nook-authenticator-domain \
  -p nook-companion-core -p nook-core -p nook-auth2 \
  -p nook-replication -p nook-event-log

/usr/bin/time -l env \
  RUSTC_WRAPPER= RUSTC_WORKSPACE_WRAPPER= \
  CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=18 \
  CARGO_TARGET_DIR="$nook_timing_root/$nook_timing_side/wasm" \
  cargo build --locked --offline --timings --release \
  --target wasm32-unknown-unknown --lib \
  -p nook-wasm -p nook-companion-wasm
```

## Sampling and source probe

1. Run each full build once with its empty output directory.
2. Repeat each unchanged command three times for warm no-op samples.
3. Capture three paired source-invalidation samples.
   - Restore the module's original content before each repetition.
   - Append `// compile timing source invalidation probe N`, with `N` from 1 to 3.
   - Before extraction, the module is `nook-companion-core/src/page_field_classification.rs`.
   - After extraction, it is `nook-page-policy/src/page_field_classification.rs`.
   - Run the native and release-WASM commands sequentially against their warmed outputs.
4. Restore the module's exact original bytes after sampling.

All 28 build commands succeeded: 14 before and 14 after. The source was restored
exactly and the canonical worktree was clean after each measurement set.
The neutral comment forces source invalidation while preserving runtime behavior.

## Results

Wall times are seconds. Changes are relative to the before value.

- **Compiler-output cold, one sample per side**
  - Native: `43.10` before, `41.32` after. Change: `-1.78` seconds (`-4.13%`).
  - Release both-WASM: `52.28` before, `50.47` after. Change: `-1.81` seconds (`-3.46%`).
- **Warm no-op, three samples per side**
  - Native median: `0.28` before, `0.24` after. Before samples: `0.28, 0.28, 0.26`. After samples: `0.28, 0.24, 0.24`.
  - Release both-WASM median: `0.26` before, `0.26` after. Before samples: `0.31, 0.26, 0.26`. After samples: `0.26, 0.26, 0.25`.
- **Neutral-comment source invalidation, three samples per side**
  - Native median: `9.08` before, `9.55` after. Change: `+0.47` seconds (`+5.18%`, slower). Before samples: `9.08, 9.08, 9.16`. After samples: `9.55, 9.67, 9.49`.
  - Release both-WASM median: `37.67` before, `38.70` after. Change: `+1.03` seconds (`+2.73%`, slower). Before samples: `37.29, 37.67, 38.45`. After samples: `38.63, 38.94, 38.70`.

## Interpretation and retained evidence

- Cold figures are single observations. Their modest difference has no repeated cold-run estimate of variation.
- The source probe measures forced recompilation of this specific moved module. It does not estimate arbitrary production edits.
- Sub-second no-op differences are at startup scale and do not establish a meaningful speedup.
- Compiler-output cold leaves the OS filesystem cache intact. Shared caches were preserved.
- These Apple ARM results do not predict remote Linux CI latency.
- Timings cover Cargo full compilation. They exclude downloads, installation, wasm-bindgen packaging, wasm-opt, tests, coverage, and browser execution.

Raw Cargo timing HTML, wall-time logs, commands, environment records, and JSON
summaries remain under `/tmp/nook-companion-page-policy-c7308e90`.
`comparison.json` contains both revisions' samples. `after-summary.json`
records the final source revision and successful restoration.
