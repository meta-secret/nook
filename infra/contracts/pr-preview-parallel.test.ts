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

const action = z
  .object({
    runs: z.object({
      steps: z
        .tuple([z.object({ run: z.string() }).passthrough()])
        .rest(z.unknown()),
    }),
  })
  .parse(
    Bun.YAML.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          "../../.github/actions/nook-pr-preview/action.yml",
        ),
        "utf8",
      ),
    ),
  );
const command = action.runs.steps[0].run;

for (const scenario of [
  { failure: "none", research: true },
  { failure: "product", research: true },
  { failure: "research", research: true },
  { failure: "none", research: false },
]) {
  const { failure, research } = scenario;
  test(`preview uploads join both children before reporting: ${failure}, research=${research}`, () => {
    const root = mkdtempSync(join(tmpdir(), "nook-preview-join-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      // Each upload waits for the other to start: sequential execution fails.
      const upload = `#!/bin/bash
set -eu
kind="$(basename "$0")"
if [ "$kind" = bash ]; then kind=product; else kind=research; fi
touch "$PROBE_DIR/$kind.started"
other=product
if [ "$kind" = product ]; then other=research; fi
if [ "$PR_RESEARCH" = true ]; then
for attempt in $(seq 1 100); do
  if [ -f "$PROBE_DIR/$other.started" ]; then break; fi
  sleep 0.01
done
test -f "$PROBE_DIR/$other.started"
fi
touch "$PROBE_DIR/$kind.finished"
if [ "$FAIL_UPLOAD" = "$kind" ]; then exit 7; fi
printf '%s_url=https://example.com\\n' "$kind" >> "$GITHUB_OUTPUT"
`;
      for (const executable of ["bash", "task"]) {
        writeFileSync(join(bin, executable), upload, { mode: 0o755 });
      }
      const output = join(root, "outputs");
      writeFileSync(output, "");
      const result = spawnSync("/bin/bash", ["-e", "-c", command], {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PROBE_DIR: root,
          FAIL_UPLOAD: failure,
          PR_RESEARCH: String(research),
          GITHUB_OUTPUT: output,
        },
      });
      expect(result.status === 0, result.stderr).toBe(failure === "none");
      expect(readFileSync(join(root, "product.finished"), "utf8")).toBe("");
      if (research) {
        expect(readFileSync(join(root, "research.finished"), "utf8")).toBe("");
      }
      const reported = readFileSync(output, "utf8");
      if (failure === "none") {
        expect(reported).toContain("product_url=");
        if (research) expect(reported).toContain("research_url=");
        else expect(reported).not.toContain("research_url=");
      } else {
        expect(reported).toBe("");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
