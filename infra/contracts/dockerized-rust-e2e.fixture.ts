import { expect } from "bun:test";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

export class DockerizedRustE2eContract {
  private readonly root = resolve(import.meta.dir, "../..");

  e2eCompletion(): void {
    const taskSchema = z.object({
      tasks: z.record(
        z.string(),
        z.object({
          cmds: z
            .array(z.union([z.string(), z.record(z.string(), z.any())]))
            .optional(),
        }),
      ),
    });
    const webTasks = taskSchema.parse(
      Bun.YAML.parse(this.read("nook-app/nook-web/Taskfile.yml")),
    );
    const ciTasks = taskSchema.parse(
      Bun.YAML.parse(this.read("nook-app/ci/Taskfile.yml")),
    );
    const groupedTask = webTasks.tasks["_web:test:e2e:run-groups"];
    const webOnlyTask = ciTasks.tasks["_ci:main:web:e2e-only"];
    const fullTask = ciTasks.tasks["_ci:main"];
    if (!groupedTask?.cmds || !webOnlyTask?.cmds || !fullTask?.cmds) {
      throw new Error("E2E completion task definitions are missing");
    }
    const grouped = z.string().parse(groupedTask.cmds[0]);
    const webOnly = z.string().parse(webOnlyTask.cmds[0]);
    const full = z.string().parse(fullTask.cmds[0]);
    const temporary = mkdtempSync(join(tmpdir(), "nook-e2e-completion-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "task"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_LOG"\nif [ -n "$FAILURE" ]; then case "$*" in *"$FAILURE"*) exit 1;; esac; fi\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, "bun"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_LOG"\nif [ -n "$FAILURE" ]; then case "$*" in *"$FAILURE"*) exit 1;; esac; fi\n',
        { mode: 0o755 },
      );
      for (const scenario of [
        {
          script: grouped.replaceAll("{{.WEB_ROOT}}", temporary),
          failures: ["project=stable", "project=unstable"],
          expected: ["project=stable", "project=unstable"],
        },
        {
          script: webOnly,
          failures: ["_web:test:e2e:parallel", "_web:test:e2e:isolation"],
          expected: ["_web:test:e2e:parallel", "_web:test:e2e:isolation"],
        },
        {
          script: full,
          failures: ["_ci:main:core", "_extension:test:e2e"],
          expected: ["_ci:main:core", "_extension:test:e2e"],
        },
      ]) {
        const successfulProbe = join(temporary, "successful-probe.log");
        writeFileSync(successfulProbe, "");
        const successful = spawnSync("bash", ["-c", scenario.script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FAILURE: "",
            PROBE_LOG: successfulProbe,
          },
        });
        expect(successful.status, successful.stderr).toBe(0);
        const successfulOutput = readFileSync(successfulProbe, "utf8");
        for (const expected of scenario.expected) {
          expect(successfulOutput).toContain(expected);
        }
        for (const failure of scenario.failures) {
          const probe = join(temporary, "probe.log");
          writeFileSync(probe, "");
          const result = spawnSync("bash", ["-c", scenario.script], {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FAILURE: failure,
              PROBE_LOG: probe,
            },
          });
          expect(result.status).not.toBe(0);
          const output = readFileSync(probe, "utf8");
          for (const expected of scenario.expected) {
            expect(output).toContain(expected);
          }
        }
      }
      const setupProbe = join(temporary, "setup-probe.log");
      writeFileSync(setupProbe, "");
      const invalidSetup = spawnSync(
        "bash",
        [
          "-c",
          grouped.replaceAll(
            "{{.WEB_ROOT}}",
            join(temporary, "missing-working-directory"),
          ),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FAILURE: "",
            PROBE_LOG: setupProbe,
          },
        },
      );
      expect(invalidSetup.status).not.toBe(0);
      expect(readFileSync(setupProbe, "utf8")).toBe("");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
}
