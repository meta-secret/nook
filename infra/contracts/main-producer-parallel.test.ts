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
  Node = "node",
  Cache = "cache",
  Web = "web",
  Image = "image",
}

enum CacheOutcome {
  Success = "success",
  Failure = "failure",
  Skipped = "skipped",
}

const scenarios = [
  {
    failure: FailureStage.None,
    exitStatus: 0,
    publishes: true,
    cacheOutcome: CacheOutcome.Success,
  },
  {
    failure: FailureStage.Node,
    exitStatus: 7,
    publishes: false,
    cacheOutcome: CacheOutcome.Skipped,
  },
  {
    failure: FailureStage.Cache,
    exitStatus: 0,
    publishes: true,
    cacheOutcome: CacheOutcome.Failure,
  },
  {
    failure: FailureStage.Web,
    exitStatus: 8,
    publishes: false,
    cacheOutcome: CacheOutcome.Success,
  },
  {
    failure: FailureStage.Image,
    exitStatus: 9,
    publishes: true,
    cacheOutcome: CacheOutcome.Success,
  },
];

for (const scenario of scenarios) {
  test(`Main overlaps Node and web checks and joins every result: ${scenario.failure}`, () => {
    const root = mkdtempSync(join(tmpdir(), "nook-main-join-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "task"),
        `#!/bin/bash
set -eu
case "$1" in
  ci:main:wasm-node-test) kind=node; other=web; test -z "$GHA_CACHE_WRITE_ENABLED" ;;
  ci:main:publish-wasm-cache)
    kind=cache; other=web
    test -f "$PROBE_DIR/node.finished"
    test "$FAIL_STAGE" != node
    test "$GHA_CACHE_WRITE_ENABLED" = 1 ;;
  ci:main:web:artifacts) kind=web; other=node; test -z "$GHA_CACHE_WRITE_ENABLED" ;;
  web:e2e:kubernetes-image:artifacts)
    test -f "$PROBE_DIR/node.finished"
    test "$FAIL_STAGE" != node
    test -f "$PROBE_DIR/web.finished"
    test ! -f "$PROBE_DIR/cache.finished"
    touch "$PROBE_DIR/image.finished"
    if [ "$FAIL_STAGE" = image ]; then exit 9; fi
    exit 0 ;;
  *) exit 9 ;;
esac
touch "$PROBE_DIR/$kind.started"
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
if [ "$kind" = cache ] && [ "$FAIL_STAGE" != web ]; then
  for attempt in $(seq 1 100); do
    if [ -f "$PROBE_DIR/image.finished" ]; then break; fi
    sleep 0.01
  done
  test -f "$PROBE_DIR/image.finished"
fi
touch "$PROBE_DIR/$kind.finished"
if [ "$FAIL_STAGE" = "$kind" ]; then
  case "$kind" in node) exit 7 ;; web) exit 8 ;; cache) exit 10 ;; esac
fi
`,
        { mode: 0o755 },
      );
      const output = join(root, "outputs");
      writeFileSync(output, "");
      const result = spawnSync(
        "/bin/bash",
        ["-e", "-c", command.replaceAll("${{ runner.temp }}", root)],
        {
          encoding: "utf8",
          timeout: 5000,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            PROBE_DIR: root,
            FAIL_STAGE: scenario.failure,
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
      expect(existsSync(join(root, "image.finished"))).toBe(scenario.publishes);
      expect(readFileSync(output, "utf8")).toBe(
        `cache_publication_outcome=${scenario.cacheOutcome}\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

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
