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
    const remoteWorkflow = this.read(".github/workflows/remote.yml");
    expect(remoteWorkflow).toContain("web:e2e) task _ci:main:web:e2e-only ;;");
    expect(remoteWorkflow).not.toContain("web:e2e) task _web:test:e2e ;;");
    expect(remoteWorkflow).toContain("ci-pr-e2e-suite:");
    expect(remoteWorkflow).toContain("fail-fast: false");
    expect(remoteWorkflow).toContain(
      "suite: [stable, unstable, isolation, extension]",
    );
    for (const suiteTask of [
      "stable) task _web:test:e2e:stable ;;",
      "unstable) task _web:test:e2e:unstable ;;",
      "isolation) task _web:test:e2e:isolation ;;",
      "extension) task _extension:test:e2e ;;",
    ]) {
      expect(remoteWorkflow).toContain(suiteTask);
    }
    expect(remoteWorkflow).toContain(
      "remote-e2e-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.suite }}",
    );
    expect(remoteWorkflow).toContain("needs: ci-pr-e2e-suite");
    expect(remoteWorkflow).toContain(
      "SUITE_RESULT: ${{ needs.ci-pr-e2e-suite.result }}",
    );
    expect(remoteWorkflow).not.toContain("ci:pr:e2e) task _ci:main ;;");
    const webPackage = z
      .object({ scripts: z.object({ "test:e2e": z.string() }) })
      .parse(
        JSON.parse(this.read("nook-app/nook-web/nook-web-app/package.json")),
      );
    expect(webPackage.scripts["test:e2e"]).toContain(
      "bun run test:e2e:stable || failed=1",
    );
    expect(webPackage.scripts["test:e2e"]).toContain(
      "bun run test:e2e:unstable || failed=1",
    );
    expect(webPackage.scripts["test:e2e"]).toContain('exit "$failed"');
    const workflowSchema = z.object({
      jobs: z.record(
        z.string(),
        z.object({
          "timeout-minutes": z.union([z.number(), z.string()]).optional(),
          strategy: z
            .object({ "fail-fast": z.boolean().optional() })
            .optional(),
        }),
      ),
    });
    const pr = workflowSchema.parse(
      Bun.YAML.parse(this.read(".github/workflows/pr.yml")),
    );
    const main = workflowSchema.parse(
      Bun.YAML.parse(this.read(".github/workflows/main.yml")),
    );
    const remote = workflowSchema.parse(
      Bun.YAML.parse(this.read(".github/workflows/remote.yml")),
    );
    const manual = workflowSchema.parse(
      Bun.YAML.parse(this.read(".github/workflows/e2e-pr.yml")),
    );
    expect(pr.jobs["extension-e2e"]?.["timeout-minutes"]).toBe(180);
    expect(pr.jobs["full-e2e-shard"]?.["timeout-minutes"]).toBe(180);
    expect(pr.jobs["full-e2e-shard"]?.strategy?.["fail-fast"]).toBe(false);
    expect(main.jobs["web-e2e"]?.["timeout-minutes"]).toBe(180);
    expect(main.jobs["extension-e2e"]?.["timeout-minutes"]).toBe(180);
    expect(remote.jobs["web-e2e"]?.["timeout-minutes"]).toBe(180);
    expect(remote.jobs["ci-pr-e2e-suite"]?.["timeout-minutes"]).toBe(180);
    expect(remote.jobs["ci-pr-e2e-suite"]?.strategy?.["fail-fast"]).toBe(false);
    expect(manual.jobs.e2e?.["timeout-minutes"]).toBe(180);
    expect(this.read(".github/scripts/remote-task-batch.sh")).toContain(
      "web:e2e|web:e2e:debug|extension:e2e) echo 180",
    );
    const webConfig = this.read(
      "nook-app/nook-web/nook-web-app/playwright.config.ts",
    );
    const extensionConfig = this.read(
      "nook-app/nook-web/nook-web-extension/playwright.config.ts",
    );
    expect(webConfig).toContain("maxFailures: 0, globalTimeout: 180 * 60_000");
    expect(webConfig).toContain("retries: 0");
    expect(extensionConfig).toContain(
      "maxFailures: 0, globalTimeout: 180 * 60_000",
    );
    expect(extensionConfig).toContain("retries: 0");

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
    expect(this.read("nook-app/ci/Taskfile.yml")).toContain(
      "defer: task _web:e2e:restore-prod-dist",
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
