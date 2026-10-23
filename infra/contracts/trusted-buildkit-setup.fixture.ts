import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const setup = z
  .object({
    runs: z.object({ steps: z.array(z.record(z.string(), z.unknown())) }),
  })
  .parse(
    Bun.YAML.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          "../../.github/actions/nook-docker-setup/action.yml",
        ),
        "utf8",
      ),
    ),
  );

/** Exercises the production setup shell boundaries without contacting services. */
export class TrustedBuildkitSetupContract {
  private command(name: string): string {
    const step = setup.runs.steps.find((candidate) => candidate.name === name);
    expect(step?.["continue-on-error"]).toBeUndefined();
    return z.object({ run: z.string() }).parse(step).run;
  }

  credentialsAndBackend(): void {
    const names = setup.runs.steps.map((step) => step.name);
    const ordered = [
      "Login to Nook OCI registry and connect ARC BuildKit",
      "Preload hosted BuildKit from Zot",
      "Setup hosted Buildx",
      "Connect SeaweedFS compiler cache",
      "Configure hosted BuildKit cache",
      "Verify Docker cache refs and blobs",
      "Set CI environment and start cache observations",
    ].map((name) => names.indexOf(name));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    for (const name of [
      "Preload hosted BuildKit from Zot",
      "Setup hosted Buildx",
    ]) {
      expect(setup.runs.steps.find((step) => step.name === name)?.if).toBe(
        "${{ !startsWith(runner.name, 'nook-k0s-') }}",
      );
    }
    const policy = this.command("Configure hosted BuildKit cache");
    expect(policy).toContain('test -n "$NOOK_SELECTED_BUILDER"');
    expect(policy).toContain('"${NOOK_SCCACHE_BACKEND:-}" != "remote"');
    expect(
      setup.runs.steps.find(
        (step) => step.name === "Configure hosted BuildKit cache",
      )?.env,
    ).toEqual({
      NOOK_REMOTE_TASK_SELECTION:
        "${{ github.event.inputs.tasks || github.event.inputs.task }}",
      NOOK_SELECTED_BUILDER:
        "${{ steps.arc-buildx.outputs.name || steps.hosted-buildx.outputs.name }}",
    });
    const script = this.command(
      "Login to Nook OCI registry and connect ARC BuildKit",
    )
      .replaceAll("${{ inputs.registry-host }}", "registry.example.invalid")
      .replaceAll("${{ inputs.registry-username }}", "fixture-user");
    const temporary = mkdtempSync(join(tmpdir(), "nook-trusted-setup-"));
    try {
      const childGuard = `#!/bin/bash
set -euo pipefail
test -z "\u0024{NOOK_REGISTRY_PASSWORD+x}"
test -z "\u0024{nook_setup_registry_password+x}"
`;
      writeFileSync(
        join(temporary, "sysctl"),
        `${childGuard}
test "$FIXTURE_FAILURE" != watcher || exit 8
echo 20000000
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(temporary, "docker"),
        `${childGuard}
printf '%s\\n' "$*" >> "$FIXTURE_LOG"
if [ "$1" = login ]; then
  test "$(cat)" = fixture-secret
  test "$FIXTURE_FAILURE" != login || exit 7
elif [ "$2" = inspect ]; then
  test "$FIXTURE_FAILURE" != inspect || exit 9
fi
`,
        { mode: 0o755 },
      );
      const scenarios = [
        {
          arc: "true",
          failure: "none",
          address: "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
          status: 0,
          connected: true,
        },
        {
          arc: "false",
          failure: "none",
          address: "",
          status: 0,
          connected: false,
        },
        {
          arc: "true",
          failure: "watcher",
          address: "",
          status: 8,
          connected: false,
        },
        {
          arc: "true",
          failure: "login",
          address: "",
          status: 7,
          connected: false,
        },
        {
          arc: "true",
          failure: "none",
          address: "tcp://wrong:1234",
          status: 2,
          connected: false,
        },
        {
          arc: "true",
          failure: "inspect",
          address: "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
          status: 9,
          connected: false,
        },
      ];
      for (const scenario of scenarios) {
        const environment = join(temporary, "environment");
        const output = join(temporary, "output");
        const log = join(temporary, "commands");
        for (const path of [environment, output, log]) writeFileSync(path, "");
        const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${temporary}:${process.env.PATH}`,
            NOOK_REGISTRY_PASSWORD: "fixture-secret",
            nook_setup_registry_password: "inherited-export-must-be-cleared",
            NOOK_SETUP_ARC: scenario.arc,
            NOOK_BUILDKIT_ADDR: scenario.address,
            GITHUB_RUN_ID: "42",
            GITHUB_JOB: "prepare",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_ENV: environment,
            GITHUB_OUTPUT: output,
            FIXTURE_FAILURE: scenario.failure,
            FIXTURE_LOG: log,
          },
        });
        expect(result.status).toBe(scenario.status);
        expect(result.stdout + result.stderr).not.toContain("fixture-secret");
        expect(readFileSync(environment, "utf8")).toBe(
          scenario.connected ? "NOOK_BUILDKIT_REMOTE=1\n" : "",
        );
        expect(readFileSync(output, "utf8")).toBe(
          scenario.connected ? "name=nook-arc-42-prepare-1\n" : "",
        );
        if (scenario.arc === "false")
          expect(readFileSync(log, "utf8")).not.toContain("buildx");
        if (scenario.failure === "login" || scenario.failure === "watcher")
          expect(readFileSync(log, "utf8")).not.toContain("buildx");
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  observationsKeepFailureBoundaries(): void {
    const script = this.command(
      "Set CI environment and start cache observations",
    );
    const temporary = mkdtempSync(join(tmpdir(), "nook-cache-observations-"));
    try {
      writeFileSync(
        join(temporary, "mktemp"),
        `#!/bin/bash
test "$FIXTURE_FAILURE" != monitor-setup || exit 11
exec /usr/bin/mktemp "$@"
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(temporary, "timeout"),
        `#!/bin/bash
set -euo pipefail
test "$NOOK_ENV" = ci
printf '%s\\n' "$1" >> "$FIXTURE_LOG"
if [ "$1" = 8s ]; then
  test "$FIXTURE_FAILURE" != monitor || exit 8
  echo 'Total: 20GB'
else
  test "$1" = 15s
  test "$FIXTURE_FAILURE" != telemetry || exit 9
fi
`,
        { mode: 0o755 },
      );
      for (const scenario of [
        { monitor: "true", failure: "none", status: 0 },
        { monitor: "false", failure: "none", status: 0 },
        { monitor: "true", failure: "monitor", status: 0 },
        { monitor: "true", failure: "monitor-setup", status: 0 },
        { monitor: "true", failure: "telemetry", status: 0 },
        { monitor: "true", failure: "environment", status: 1 },
      ]) {
        const environment = join(temporary, "environment");
        const log = join(temporary, "commands");
        writeFileSync(environment, "");
        writeFileSync(log, "");
        const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${temporary}:${process.env.PATH}`,
            GITHUB_ENV:
              scenario.failure === "environment"
                ? join(temporary, "missing", "environment")
                : environment,
            RUNNER_TEMP: temporary,
            GITHUB_ACTION_PATH: temporary,
            NOOK_MONITOR_BUILDKIT_STORAGE: scenario.monitor,
            FIXTURE_FAILURE: scenario.failure,
            FIXTURE_LOG: log,
          },
        });
        expect(result.status).toBe(scenario.status);
        const recorded = readFileSync(environment, "utf8");
        const calls = readFileSync(log, "utf8");
        if (scenario.failure === "environment") {
          expect(calls).toBe("");
        } else {
          expect(recorded).toContain("NOOK_ENV=ci\n");
          expect(calls).toBe(
            scenario.monitor === "true" && scenario.failure !== "monitor-setup"
              ? "8s\n15s\n"
              : "15s\n",
          );
          if (scenario.failure === "telemetry")
            expect(recorded).not.toContain("NOOK_CACHE_TELEMETRY_BASELINE=");
          else
            expect(recorded).toContain(
              `NOOK_CACHE_TELEMETRY_BASELINE=${temporary}/nook-cache-telemetry-baseline.json\n`,
            );
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
