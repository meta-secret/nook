import { expect } from "bun:test";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

export class DockerizedRustToolingContract {
  private readonly root = resolve(import.meta.dir, "../..");

  toolingStaticInstallsBeforeChecks(): void {
    const command = z
      .object({
        tasks: z.object({
          "tooling:static": z.object({ cmds: z.array(z.string()) }),
        }),
      })
      .parse(Bun.YAML.parse(this.read(".task/static-checks.yml"))).tasks[
      "tooling:static"
    ].cmds[0];
    if (!command) throw new Error("Static tooling command missing");
    const temporary = mkdtempSync(join(tmpdir(), "nook-tooling-static-"));
    try {
      const packages = [
        ".",
        "agentic-ai/loom",
        "agentic-ai/ci-agent",
        ".cortex/teams/ai/dynamic-skills/example/scripts",
      ];
      for (const directory of packages) {
        mkdirSync(join(temporary, directory), { recursive: true });
        writeFileSync(join(temporary, directory, "package.json"), "{}\n");
      }
      const bin = join(temporary, "bin");
      const probe = join(temporary, "probe.log");
      mkdirSync(bin);
      const executable = join(bin, "bun");
      writeFileSync(
        executable,
        `#!/bin/sh
directory="$3"
action="$1"
if [ "$action" = run ]; then action="$4"; fi
printf '%s:%s:%s\\n' "$(basename "$0")" "$action" "$directory" >> "$PROBE_LOG"
if [ "$action" = install ] && [ "$directory" = "${"${FAIL_INSTALL:-}"}" ]; then exit 1; fi
`,
        { mode: 0o755 },
      );
      symlinkSync(executable, join(bin, "npm"));
      for (const scenario of [
        { environment: process.env, succeeds: true },
        {
          environment: { ...process.env, FAIL_INSTALL: "agentic-ai/loom" },
          succeeds: false,
        },
      ]) {
        writeFileSync(probe, "");
        const result = spawnSync("bash", ["-c", command], {
          cwd: temporary,
          encoding: "utf8",
          env: {
            ...scenario.environment,
            PATH: `${bin}:${process.env.PATH}`,
            PROBE_LOG: probe,
          },
        });
        const output = readFileSync(probe, "utf8");
        expect(result.status === 0, result.stderr).toBe(scenario.succeeds);
        expect(output.lastIndexOf(":install:")).toBeLessThan(
          output.indexOf(":lint:"),
        );
        expect(output).toContain(
          "bun:check:.cortex/teams/ai/dynamic-skills/example/scripts",
        );
        if (!scenario.succeeds)
          expect(output).not.toContain("bun:lint:agentic-ai/loom");
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
}
