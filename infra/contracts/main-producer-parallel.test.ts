import { test, expect } from "bun:test";
import {
  mkdtempSync,
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

for (const failure of ["none", "cache", "web"]) {
  test(`Main overlaps cache and web while preserving separate outcomes: ${failure}`, () => {
    const root = mkdtempSync(join(tmpdir(), "nook-main-join-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "task"),
        `#!/bin/bash
set -eu
case "$1" in
  ci:main:publish-wasm-cache) kind=cache; other=web; test "$GHA_CACHE_WRITE_ENABLED" = 1 ;;
  ci:main:web:artifacts) kind=web; other=cache; test -z "$GHA_CACHE_WRITE_ENABLED" ;;
  *) exit 9 ;;
esac
touch "$PROBE_DIR/$kind.started"
for attempt in $(seq 1 100); do
  if [ -f "$PROBE_DIR/$other.started" ]; then break; fi
  sleep 0.01
done
test -f "$PROBE_DIR/$other.started"
touch "$PROBE_DIR/$kind.finished"
if [ "$FAIL_STAGE" = "$kind" ]; then exit 7; fi
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
            FAIL_STAGE: failure,
            RUNNER_TEMP: root,
            GITHUB_OUTPUT: output,
            GHA_CACHE_WRITE_ENABLED: "",
          },
        },
      );
      expect(result.status === 0, result.stderr).toBe(failure !== "web");
      expect(readFileSync(join(root, "cache.finished"), "utf8")).toBe("");
      expect(readFileSync(join(root, "web.finished"), "utf8")).toBe("");
      expect(readFileSync(output, "utf8")).toBe(
        `cache_publication_outcome=${failure === "cache" ? "failure" : "success"}\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
