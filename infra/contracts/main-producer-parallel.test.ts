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
      rust: z.object({
        if: z.string(),
        steps: z.array(z.record(z.string(), z.unknown())),
      }),
      web: z.object({
        if: z.string(),
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
  Node = "node",
  Cache = "cache",
  PreflightCache = "preflight-cache",
  Web = "web",
  Image = "image",
  Construction = "construction",
}

enum CacheOutcome {
  Success = "success",
  Failure = "failure",
  Skipped = "skipped",
}

enum LogCapture {
  File = "file",
  Directory = "directory",
  BrowserDirectory = "browser-directory",
}

const scenarios = [
  {
    failure: FailureStage.None,
    exitStatus: 0,
    publishes: true,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.Node,
    exitStatus: 7,
    publishes: false,
    cacheOutcome: CacheOutcome.Skipped,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.Cache,
    exitStatus: 0,
    publishes: true,
    cacheOutcome: CacheOutcome.Failure,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.PreflightCache,
    exitStatus: 0,
    publishes: true,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.Web,
    exitStatus: 8,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.Image,
    exitStatus: 9,
    publishes: true,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.Construction,
    exitStatus: 12,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.File,
  },
  {
    failure: FailureStage.None,
    exitStatus: 1,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.BrowserDirectory,
  },
  {
    failure: FailureStage.None,
    exitStatus: 1,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.Directory,
  },
  {
    failure: FailureStage.Web,
    exitStatus: 8,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
    logCapture: LogCapture.Directory,
  },
];

for (const scenario of scenarios) {
  test(`Main overlaps Node and web checks and joins every result: ${scenario.failure}, log ${scenario.logCapture}`, () => {
    const root = mkdtempSync(join(tmpdir(), "nook-main-join-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      if (scenario.logCapture === LogCapture.Directory) {
        mkdirSync(join(root, "main-web-artifacts.log"));
      }
      if (scenario.logCapture === LogCapture.BrowserDirectory) {
        mkdirSync(join(root, "main-browser-construction.log"));
      }
      writeFileSync(
        join(bin, "task"),
        `#!/bin/bash
set -eu
case "$1" in
  ci:main:publish-preflight-cache)
    kind=preflight-cache; other=web
    test "$GHA_CACHE_WRITE_ENABLED" = 1 ;;
  ci:main:wasm-node-test) kind=node; other=web; test -z "$GHA_CACHE_WRITE_ENABLED" ;;
  ci:main:publish-wasm-cache)
    kind=cache; other=web
    test -f "$PROBE_DIR/node.finished"
    test "$FAIL_STAGE" != node
    test "$GHA_CACHE_WRITE_ENABLED" = 1 ;;
  ci:main:web:artifacts) kind=web; other=node; test -z "$GHA_CACHE_WRITE_ENABLED" ;;
  web:e2e:kubernetes-image:artifacts)
    if [ "\${E2E_OUTPUT:-}" = type=cacheonly ]; then
      kind=construction; other=node
      test -z "$GHA_CACHE_WRITE_ENABLED"
    else
    test -z "\${E2E_OUTPUT:-}"
    test -f "$PROBE_DIR/node.finished"
    test "$FAIL_STAGE" != node
    test -f "$PROBE_DIR/web.finished"
    test -f "$PROBE_DIR/construction.finished"
    test "$FAIL_STAGE" != construction
    test ! -f "$PROBE_DIR/cache.finished"
    touch "$PROBE_DIR/image.finished"
    if [ "$FAIL_STAGE" = image ]; then exit 9; fi
    exit 0
    fi ;;
  *) exit 9 ;;
esac
touch "$PROBE_DIR/$kind.started"
echo "$kind started log"
echo "$kind diagnostic" >&2
for attempt in $(seq 1 100); do
  if [ -f "$PROBE_DIR/$other.started" ]; then break; fi
  sleep 0.01
done
test -f "$PROBE_DIR/$other.started"
if [ "$kind" = web ] && [ "$FAIL_STAGE" != node ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/cache.started" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/cache.started"
fi
if [ "$kind" = cache ] && [ "$FAIL_STAGE" != web ] && [ "$FAIL_STAGE" != construction ] && [ "$LOG_CAPTURE" = file ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/image.finished" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/image.finished"
fi
if [ "$kind" = preflight-cache ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/node.finished" ] && [ -f "$PROBE_DIR/web.finished" ] && [ -f "$PROBE_DIR/construction.finished" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/node.finished"
  test -f "$PROBE_DIR/web.finished"
  test -f "$PROBE_DIR/construction.finished"
  sleep 0.05
fi
if [ "$kind" = node ]; then
  for attempt in $(seq 1 100); do
    if grep -q 'web started log' "$PROBE_DIR/live.out" && grep -q 'preflight-cache started log' "$PROBE_DIR/live.out"; then break; fi
    sleep 0.01
  done
  grep -q 'web started log' "$PROBE_DIR/live.out"
  grep -q 'preflight-cache started log' "$PROBE_DIR/live.out"
  for attempt in $(seq 1 100); do
    if grep -q 'construction started log' "$PROBE_DIR/live.out"; then break; fi
    sleep 0.01
  done
  grep -q 'construction started log' "$PROBE_DIR/live.out"
fi
touch "$PROBE_DIR/$kind.finished"
echo "$kind joined log"
if [ "$FAIL_STAGE" = "$kind" ]; then
  case "$kind" in node) exit 7 ;; web) exit 8 ;; cache) exit 10 ;; preflight-cache) exit 11 ;; construction) exit 12 ;; esac
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
            LOG_CAPTURE: scenario.logCapture,
            RUNNER_TEMP: root,
            GITHUB_OUTPUT: output,
            GHA_CACHE_WRITE_ENABLED: "",
          },
        },
      );
      expect(result.status, result.stderr).toBe(scenario.exitStatus);
      expect(existsSync(join(root, "cache.finished"))).toBe(
        scenario.failure !== FailureStage.Node,
      );
      expect(readFileSync(join(root, "node.finished"), "utf8")).toBe("");
      expect(readFileSync(join(root, "web.finished"), "utf8")).toBe("");
      expect(readFileSync(join(root, "construction.finished"), "utf8")).toBe(
        "",
      );
      expect(existsSync(join(root, "image.finished"))).toBe(scenario.publishes);
      expect(existsSync(join(root, "preflight-cache.finished"))).toBe(true);
      expect(result.stdout).toContain("preflight-cache joined log");
      for (const [kind, log] of [
        ["preflight-cache", "main-preflight-cache.log"],
        ["web", "main-web-artifacts.log"],
        ["construction", "main-browser-construction.log"],
        ["cache", "main-wasm-cache.log"],
      ] as const) {
        if (kind === "cache" && scenario.failure === FailureStage.Node) {
          expect(existsSync(join(root, log))).toBe(false);
          continue;
        }
        expect(
          result.stdout
            .split("\n")
            .filter((line) => line === `${kind} started log`),
        ).toHaveLength(1);
        expect(
          result.stdout
            .split("\n")
            .filter((line) => line === `${kind} diagnostic`),
        ).toHaveLength(1);
        if (
          !(
            log === "main-web-artifacts.log" &&
            scenario.logCapture === LogCapture.Directory
          ) &&
          !(
            log === "main-browser-construction.log" &&
            scenario.logCapture === LogCapture.BrowserDirectory
          )
        ) {
          expect(readFileSync(join(root, log), "utf8")).toContain(
            `${kind} diagnostic`,
          );
        }
      }
      expect(readFileSync(output, "utf8")).toBe(
        `preflight_cache_publication_outcome=${scenario.failure === FailureStage.PreflightCache ? CacheOutcome.Failure : CacheOutcome.Success}\ncache_publication_outcome=${scenario.cacheOutcome}\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("both Main producers fail fast on read-only preflight before building", () => {
  for (const [job, build] of [
    [workflow.jobs.rust, "task ci:main:rust"],
    [workflow.jobs.web, "task ci:pr:wasm"],
  ] as const) {
    expect(job.if).toBe("${{ !cancelled() && inputs.product_changed }}");
    const preflightIndex = job.steps.findIndex(
      (item) => item.run === "task preflight",
    );
    const buildIndex = job.steps.findIndex(
      (item) => typeof item.run === "string" && item.run.startsWith(build),
    );
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(preflightIndex);
    const preflight = z
      .object({
        env: z.object({
          CI: z.literal(true),
          GHA_CACHE_WRITE_ENABLED: z.literal(""),
        }),
      })
      .parse(job.steps[preflightIndex]);
    expect(preflight.env.CI).toBe(true);
    expect(job.steps[preflightIndex]).not.toHaveProperty("continue-on-error");
    expect(job.steps[preflightIndex]).not.toHaveProperty("if");
  }
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
