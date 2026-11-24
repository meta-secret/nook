import { test, expect, setDefaultTimeout } from "bun:test";
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

const workflow = z
  .object({
    jobs: z.object({
      web: z.object({
        steps: z.array(z.record(z.string(), z.unknown())),
      }),
    }),
  })
  .parse(
    Bun.YAML.parse(
      readFileSync(
        resolve(import.meta.dir, "../../.github/workflows/main.yml"),
        "utf8",
      ),
    ),
  );
const step = workflow.jobs.web.steps.find((item) => item.id === "prepare_web");
const command = z.object({ run: z.string() }).parse(step).run;

enum FailureStage {
  None = "none",
  Preflight = "preflight",
  Wasm = "wasm",
  Node = "node",
  Web = "web",
  Construction = "construction",
  Cache = "cache",
  PreflightCache = "preflight-cache",
  Image = "image",
}

enum CacheOutcome {
  Success = "success",
  Failure = "failure",
  Skipped = "skipped",
}

const scenarios = [
  { failure: FailureStage.None, status: 0, logFailure: "", publishes: true },
  {
    failure: FailureStage.Preflight,
    status: 6,
    logFailure: "",
    publishes: false,
  },
  { failure: FailureStage.Wasm, status: 5, logFailure: "", publishes: false },
  { failure: FailureStage.Node, status: 7, logFailure: "", publishes: false },
  { failure: FailureStage.Web, status: 8, logFailure: "", publishes: false },
  {
    failure: FailureStage.Construction,
    status: 12,
    logFailure: "",
    publishes: false,
  },
  { failure: FailureStage.Cache, status: 0, logFailure: "", publishes: true },
  {
    failure: FailureStage.PreflightCache,
    status: 0,
    logFailure: "",
    publishes: true,
  },
  { failure: FailureStage.Image, status: 9, logFailure: "", publishes: true },
  ...[
    "preflight",
    "wasm-build",
    "node",
    "web-artifacts",
    "browser-construction",
  ].map((logFailure) => ({
    failure: FailureStage.None,
    status: 1,
    logFailure,
    publishes: false,
  })),
  {
    failure: FailureStage.Web,
    status: 8,
    logFailure: "web-artifacts",
    publishes: false,
  },
];

/** The producer runs eight probes, some sleeping 3 s, on a loaded runner; the
 * bound only stops a hung producer. */
const SCENARIO_TIMEOUT_MS = 20_000;
/** A stopped task's TERM trap only touches a file; this bound is far longer. */
const TASK_EXIT_GRACE_MS = 5_000;
setDefaultTimeout(SCENARIO_TIMEOUT_MS * 2);

for (const scenario of scenarios) {
  test(`Main gates every publisher on all private tasks and loggers: ${scenario.failure}, log ${scenario.logFailure}`, () => {
    const root = mkdtempSync(join(tmpdir(), "nook-main-join-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      if (scenario.logFailure !== "") {
        mkdirSync(join(root, `main-${scenario.logFailure}.log`));
      }
      writeFileSync(
        join(bin, "task"),
        `#!/bin/bash
set -eu
case "$1" in
  preflight) kind=preflight ;;
  ci:pr:wasm) kind=wasm ;;
  ci:main:wasm-node-test) kind=node ;;
  ci:main:web:artifacts) kind=web ;;
  ci:main:publish-preflight-cache) kind=preflight-cache ;;
  ci:main:publish-wasm-cache) kind=cache ;;
  web:e2e:kubernetes-image:artifacts)
    if [ "\${E2E_OUTPUT:-}" = type=cacheonly ]; then kind=construction; else kind=image; fi ;;
  *) exit 90 ;;
esac
echo $$ > "$PROBE_DIR/$kind.pid.partial"
mv "$PROBE_DIR/$kind.pid.partial" "$PROBE_DIR/$kind.pid"
trap 'touch "$PROBE_DIR/$kind.stopped"; exit 143' TERM
case "$kind" in
  preflight-cache|cache|image)
    for required in preflight wasm node web construction; do
      test -f "$PROBE_DIR/$required.finished"
      test "$FAIL_STAGE" != "$required"
    done
    test -z "$LOG_FAILURE"
    case "$kind" in image) test -z "\${E2E_OUTPUT:-}" ;; *) test "$GHA_CACHE_WRITE_ENABLED" = 1 ;; esac ;;
  *) test -z "$GHA_CACHE_WRITE_ENABLED" ;;
esac
case "$kind" in
  node|web|construction)
    test -f "$PROBE_DIR/wasm.finished"
    test "$(cat "$PROBE_DIR/nook-ci-artifacts/joined/nook-wasm/nook-run-attempt")" = 4 ;;
esac
touch "$PROBE_DIR/$kind.started"
echo "$kind started log"
echo "$kind diagnostic" >&2
case "$kind" in
  preflight) other=wasm ;;
  wasm) other=preflight ;;
  node) other=construction ;;
  web|construction) other=node ;;
  *) other=$kind ;;
esac
for attempt in $(seq 1 100); do
  if [ -f "$PROBE_DIR/$other.started" ]; then break; fi
  sleep 0.01
done
test -f "$PROBE_DIR/$other.started"
if [ "$kind" = wasm ]; then mkdir -p "$PROBE_DIR/nook-ci-artifacts/joined/nook-wasm"; fi
if [ "$kind" = preflight ] && [ "$FAIL_STAGE" = preflight ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/node.started" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/node.started"
fi
if [ "$kind" = node ] && [ "$FAIL_STAGE" = preflight ]; then
  sleep 3
fi
if [ "$kind" = web ] && [ "$FAIL_STAGE" = node ]; then
  sleep 3
fi
if [ "$kind" = node ] && [ "$FAIL_STAGE" = node ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/web.started" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/web.started"
fi
if [ "$kind" = node ] && [ "$FAIL_STAGE" = none ] && [ -z "$LOG_FAILURE" ]; then
  for attempt in $(seq 1 100); do
    if grep -q 'web started log' "$PROBE_DIR/live.out" && grep -q 'construction started log' "$PROBE_DIR/live.out"; then break; fi
    sleep 0.01
  done
  grep -q 'web started log' "$PROBE_DIR/live.out"
  grep -q 'construction started log' "$PROBE_DIR/live.out"
fi
touch "$PROBE_DIR/$kind.finished"
echo "$kind joined log"
if [ "$FAIL_STAGE" = "$kind" ]; then
  case "$kind" in preflight) exit 6 ;; wasm) exit 5 ;; node) exit 7 ;; web) exit 8 ;; construction) exit 12 ;; image) exit 9 ;; cache) exit 10 ;; preflight-cache) exit 11 ;; esac
fi
`,
        { mode: 0o755 },
      );
      const output = join(root, "outputs");
      writeFileSync(output, "");
      writeFileSync(
        join(root, "producer.sh"),
        command.replaceAll("${{ runner.temp }}", root),
      );
      const result = spawnSync(
        "/bin/bash",
        [
          "-e",
          "-c",
          `status=0
/bin/bash -e -o pipefail "$PROBE_DIR/producer.sh" > "$PROBE_DIR/live.out" 2>&1 || status=$?
cat "$PROBE_DIR/live.out"
exit "$status"`,
        ],
        {
          encoding: "utf8",
          timeout: SCENARIO_TIMEOUT_MS,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            PROBE_DIR: root,
            FAIL_STAGE: scenario.failure,
            LOG_FAILURE: scenario.logFailure,
            RUNNER_TEMP: root,
            GITHUB_OUTPUT: output,
            GITHUB_RUN_ATTEMPT: "4",
            GHA_CACHE_WRITE_ENABLED: "",
          },
        },
      );
      expect(result.status, result.stdout + result.stderr).toBe(
        scenario.status,
      );
      for (const kind of ["image", "cache", "preflight-cache"]) {
        expect(existsSync(join(root, `${kind}.started`))).toBe(
          scenario.publishes,
        );
      }
      for (const kind of [
        "preflight",
        "wasm",
        "node",
        "web",
        "construction",
        "cache",
        "preflight-cache",
      ]) {
        const pidFile = join(root, `${kind}.pid`);
        if (existsSync(pidFile)) {
          const pid = readFileSync(pidFile, "utf8").trim();
          // The producer waits for each task's subshell; a task the cleanup
          // stopped may still be running its TERM trap when the producer
          // returns, so it gets a short bound to finish exiting.
          const exitBy = Date.now() + TASK_EXIT_GRACE_MS;
          let observed = spawnSync("ps", ["-o", "stat=", "-p", pid]);
          let state = observed.stdout.toString().trim();
          while (
            state.length > 0 &&
            !state.startsWith("Z") &&
            Date.now() < exitBy
          ) {
            Bun.sleepSync(50);
            observed = spawnSync("ps", ["-o", "stat=", "-p", pid]);
            state = observed.stdout.toString().trim();
          }
          expect(observed.error).toBeFalsy();
          expect(observed.stderr.toString().trim()).toBe("");
          if (state.length === 0) {
            expect(observed.status).toBe(1);
          } else {
            expect(observed.status).toBe(0);
            expect(
              state.startsWith("Z"),
              `${kind} remains live: ${state}`,
            ).toBe(true);
          }
        }
      }
      if (scenario.failure === FailureStage.Preflight) {
        expect(existsSync(join(root, "node.finished"))).toBe(false);
      }
      if (scenario.failure === FailureStage.Node) {
        expect(existsSync(join(root, "web.finished"))).toBe(false);
      }
      if (scenario.publishes) {
        for (const kind of [
          "preflight",
          "wasm",
          "node",
          "web",
          "construction",
          "cache",
          "preflight-cache",
        ]) {
          expect(
            result.stdout
              .split("\n")
              .filter((line) => line === `${kind} diagnostic`),
          ).toHaveLength(1);
          expect(existsSync(join(root, `${kind}.finished`))).toBe(true);
        }
        expect(readFileSync(output, "utf8")).toBe(
          `preflight_cache_publication_outcome=${scenario.failure === FailureStage.PreflightCache ? CacheOutcome.Failure : CacheOutcome.Success}\ncache_publication_outcome=${scenario.failure === FailureStage.Cache ? CacheOutcome.Failure : CacheOutcome.Success}\n`,
        );
      } else {
        expect(readFileSync(output, "utf8")).toBe("");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("preflight cache publication gate propagates failure", () => {
  const steps = workflow.jobs.web.steps;
  const gate = z
    .object({ run: z.string() })
    .parse(
      steps.find(
        (item) =>
          item.name === "Require successful preflight cache publication",
      ),
    );
  for (const [outcome, status] of [
    [CacheOutcome.Success, 0],
    [CacheOutcome.Failure, 1],
    [CacheOutcome.Skipped, 1],
  ] as const) {
    const result = spawnSync("/bin/bash", ["-e", "-c", gate.run], {
      encoding: "utf8",
      env: { ...process.env, CACHE_PUBLICATION_OUTCOME: outcome },
    });
    expect(result.status).toBe(status);
  }
});
