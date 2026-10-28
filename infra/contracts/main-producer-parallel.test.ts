import { test, expect } from "bun:test";
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
      "extension-e2e": z.object({
        steps: z.array(z.record(z.string(), z.unknown())),
      }),
      rust: z.object({
        if: z.string(),
        steps: z.array(z.record(z.string(), z.unknown())),
      }),
      web: z.object({
        if: z.string(),
        steps: z.array(z.record(z.string(), z.unknown())),
      }),
      "web-e2e": z.object({
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
echo $$ > "$PROBE_DIR/$kind.pid"
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
          timeout: 5000,
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
          const observed = spawnSync("ps", ["-o", "stat=", "-p", pid]);
          expect(observed.error).toBeFalsy();
          expect(observed.stderr.toString().trim()).toBe("");
          const state = observed.stdout.toString().trim();
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

test("Main native retains preflight ordering; web handoffs follow the complete private gate", () => {
  const native = workflow.jobs.rust.steps;
  const preflight = native.findIndex((item) => item.run === "task preflight");
  const build = native.findIndex(
    (item) =>
      typeof item.run === "string" && item.run.startsWith("task ci:main:rust"),
  );
  expect(preflight).toBeGreaterThanOrEqual(0);
  expect(build).toBeGreaterThan(preflight);
  expect(native[preflight]).not.toHaveProperty("continue-on-error");
  const producerIndex = workflow.jobs.web.steps.findIndex(
    (item) => item.id === "prepare_web",
  );
  for (const [index, item] of workflow.jobs.web.steps.entries()) {
    if (
      typeof item.uses === "string" &&
      item.uses.startsWith("actions/upload-artifact@")
    ) {
      expect(index).toBeGreaterThan(producerIndex);
      expect(item).not.toHaveProperty("if");
    }
  }
  const producer = z
    .object({ env: z.object({ GHA_CACHE_WRITE_ENABLED: z.literal("") }) })
    .parse(step);
  expect(producer.env.GHA_CACHE_WRITE_ENABLED).toBe("");
});

test("preflight cache failure remains terminal after verified artifact upload", () => {
  const steps = workflow.jobs.web.steps;
  const assertion = steps.findIndex(
    (item) => item.name === "Require successful preflight cache publication",
  );
  expect(assertion).toBeGreaterThan(
    steps.findIndex((item) => item.id === "upload_web"),
  );
  const gate = z
    .object({
      if: z.string(),
      run: z.string(),
      env: z.object({ CACHE_PUBLICATION_OUTCOME: z.string() }),
    })
    .parse(steps[assertion]);
  expect(gate.if).toBe("${{ !cancelled() }}");
  expect(gate.env.CACHE_PUBLICATION_OUTCOME).toBe(
    "${{ steps.prepare_web.outputs.preflight_cache_publication_outcome }}",
  );
  expect(steps[assertion]).not.toHaveProperty("continue-on-error");
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

test("research image publication keeps its imports but exports no compiler cache", () => {
  const research = z
    .object({
      jobs: z.object({
        image: z.object({ steps: z.array(z.record(z.string(), z.unknown())) }),
        dependencies: z.object({
          steps: z.array(z.record(z.string(), z.unknown())),
        }),
      }),
    })
    .parse(
      Bun.YAML.parse(
        readFileSync(
          resolve(import.meta.dir, "../../.github/workflows/web-research.yml"),
          "utf8",
        ),
      ),
    );
  const image = z
    .object({ env: z.record(z.string(), z.string()) })
    .parse(
      research.jobs.image.steps.find(
        (item) => item.run === "task web:e2e:kubernetes-image",
      ),
    );
  expect(image.env.GHA_CACHE_WRITE_ENABLED).toBe("");
  const dependencies = z
    .object({ env: z.record(z.string(), z.string()) })
    .parse(
      research.jobs.dependencies.steps.find(
        (item) => item.run === "task docker:ci:cache:publish:web-research",
      ),
    );
  expect(dependencies.env.GHA_CACHE_WRITE_ENABLED).toBe("1");
  const setup = z
    .object({ with: z.record(z.string(), z.string()) })
    .parse(
      research.jobs.image.steps.find(
        (item) => item.uses === "./.github/actions/nook-docker-setup",
      ),
    );
  expect(setup.with["isolated-cache-write"]).toBe(
    "${{ github.event_name == 'pull_request' && 'true' || 'false' }}",
  );
});

test("Main retains only existing extension failure context after a failed shard", () => {
  const retention = z
    .object({
      if: z.literal("failure()"),
      uses: z.literal("actions/upload-artifact@v7"),
      with: z.object({
        name: z.string(),
        path: z.string(),
        "retention-days": z.literal(1),
        "if-no-files-found": z.literal("ignore"),
      }),
    })
    .parse(
      workflow.jobs["extension-e2e"].steps.find(
        (item) => item.name === "Preserve existing extension failure context",
      ),
    );
  expect(retention.with.name).toBe(
    "main-extension-failure-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
  );
  expect(retention.with.path.trim().split("\n")).toEqual([
    "/meta-secret/nook/nook-app/nook-web/nook-web-extension/test-results/**/error-context.md",
    "/meta-secret/nook/nook-app/nook-web/nook-web-extension/test-results/**/test-failed-*.png",
  ]);
});

test("Main retains only existing web failure context after a failed web e2e", () => {
  const retention = z
    .object({
      if: z.literal("failure()"),
      uses: z.literal("actions/upload-artifact@v7"),
      with: z.object({
        name: z.string(),
        path: z.string(),
        "retention-days": z.literal(1),
        "if-no-files-found": z.literal("ignore"),
      }),
    })
    .parse(
      workflow.jobs["web-e2e"].steps.find(
        (item) => item.name === "Preserve existing web failure context",
      ),
    );
  expect(retention.with.name).toBe(
    "main-web-failure-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  expect(retention.with.path.trim().split("\n")).toEqual([
    "/meta-secret/nook/nook-app/nook-web/nook-web-app/test-results/**/error-context.md",
    "/meta-secret/nook/nook-app/nook-web/nook-web-app/test-results/**/test-failed-*.png",
  ]);
});
