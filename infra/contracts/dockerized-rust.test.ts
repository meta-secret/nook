import { test, expect } from "bun:test";
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
import { TrustedBuildkitSetupContract } from "./trusted-buildkit-setup.fixture";
import { z } from "zod";
import { DockerizedRustE2eContract } from "./dockerized-rust-e2e.fixture";
import { DockerizedRustToolingContract } from "./dockerized-rust-tooling.fixture";

const tasksSchema = z.object({
  tasks: z.object({
    "preflight:policy:run": z.object({ cmds: z.array(z.string()) }),
  }),
});

enum EcosystemTask {
  Smoke = "docker:ecosystem:smoke",
  Check = "docker:ecosystem:check",
}

interface GitFixtureCommand {
  cwd: string;
  args: string[];
}

class DockerizedRustContract {
  private readonly root = resolve(import.meta.dir, "../..");

  previewGates(): void {
    const workflow = z
      .object({
        jobs: z.object({
          validation: z.object({
            steps: z.array(
              z.object({
                name: z.string().optional(),
                run: z.string().optional(),
              }),
            ),
          }),
        }),
      })
      .parse(Bun.YAML.parse(this.read(".github/workflows/pr.yml")));
    const guardCommand = z
      .string()
      .parse(
        workflow.jobs.validation.steps.find(
          (step) => step.name === "Require every selected validation branch",
        )?.run,
      );
    for (const selected of [
      {
        PREPARE_REQUIRED: "false",
        BROWSER_REQUIRED: "false",
        PREPARE_RESULT: "skipped",
        BROWSER_RESULT: "skipped",
      },
      {
        PREPARE_REQUIRED: "true",
        BROWSER_REQUIRED: "false",
        PREPARE_RESULT: "success",
        BROWSER_RESULT: "skipped",
      },
      {
        PREPARE_REQUIRED: "true",
        BROWSER_REQUIRED: "true",
        PREPARE_RESULT: "success",
        BROWSER_RESULT: "success",
      },
    ]) {
      const successful = {
        SCOPE_RESULT: "success",
        VERIFY_RESULT: "success",
        ...selected,
      };
      const accepted = spawnSync("bash", ["-c", guardCommand], {
        env: { ...process.env, ...successful },
      });
      expect(accepted.status).toBe(0);
      for (const result of [
        "SCOPE_RESULT",
        "VERIFY_RESULT",
        "PREPARE_RESULT",
        "BROWSER_RESULT",
      ] as const) {
        for (const status of ["success", "failure", "cancelled", "skipped"]) {
          const outcome = spawnSync("bash", ["-c", guardCommand], {
            env: { ...process.env, ...successful, [result]: status },
          });
          expect(outcome.status === 0).toBe(status === successful[result]);
        }
      }
    }
  }

  ecosystemResults(): void {
    const tasks = z
      .object({
        tasks: z.object({
          [EcosystemTask.Smoke]: z.object({ cmds: z.tuple([z.string()]) }),
          [EcosystemTask.Check]: z.object({ cmds: z.tuple([z.string()]) }),
        }),
      })
      .parse(
        Bun.YAML.parse(this.read("nook-app/nook-platform/docker/Taskfile.yml")),
      );
    const temporary = mkdtempSync(join(tmpdir(), "nook-ecosystem-results-"));
    try {
      writeFileSync(
        join(temporary, "task"),
        '#!/bin/sh\ncase ",$FAILURES," in *",$1,"*) exit 1 ;; *) exit 0 ;; esac\n',
        { mode: 0o755 },
      );
      for (const group of [
        {
          task: EcosystemTask.Smoke,
          children: ["deterministic", "fuzz", "kani"],
          labels: ["Deterministic tests", "Fuzz smoke", "Kani proofs"],
        },
        {
          task: EcosystemTask.Check,
          children: ["dependency-policy", "smoke", "dylint"],
          labels: [
            "Rust ecosystem: policy",
            "Rust ecosystem: smoke",
            "Rust ecosystem: dylint",
          ],
        },
      ]) {
        const script = tasks.tasks[group.task].cmds[0];
        for (let failures = 0; failures < 8; failures += 1) {
          const selected = group.children
            .filter((_, index) => (failures & (1 << index)) !== 0)
            .map((child) => "docker:ecosystem:" + child);
          const output = join(temporary, "outputs");
          writeFileSync(output, "");
          const run = spawnSync("bash", ["-e", "-c", script], {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: temporary + ":" + process.env.PATH,
              FAILURES: selected.join(","),
              RUNNER_TEMP: temporary,
              GITHUB_OUTPUT: output,
              GITHUB_STEP_SUMMARY: join(temporary, "summary"),
            },
          });
          expect(run.status === 0, run.stdout).toBe(failures === 0);
          for (const label of group.labels) expect(run.stdout).toContain(label);
          switch (group.task) {
            case EcosystemTask.Check: {
              const results = readFileSync(output, "utf8").trim().split("\n");
              expect(results).toHaveLength(3);
              expect(
                results.filter((result) => result.endsWith("=failure")),
              ).toHaveLength(selected.length);
              break;
            }
            case EcosystemTask.Smoke:
              break;
          }
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  portableGitMetadata(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-policy-git-"));
    try {
      this.command({ cwd: temporary, args: ["init", "-q"] });
      this.command({
        cwd: temporary,
        args: ["config", "user.email", "test@example.invalid"],
      });
      this.command({
        cwd: temporary,
        args: ["config", "user.name", "Policy Test"],
      });
      writeFileSync(join(temporary, "source.txt"), "baseline\n");
      this.command({ cwd: temporary, args: ["add", "."] });
      this.command({ cwd: temporary, args: ["commit", "-qm", "baseline"] });
      const base = this.command({
        cwd: temporary,
        args: ["rev-parse", "HEAD"],
      }).trim();
      this.command({
        cwd: temporary,
        args: ["update-ref", "refs/remotes/origin/main", base],
      });
      writeFileSync(join(temporary, "source.txt"), "head\n");
      this.command({ cwd: temporary, args: ["commit", "-qam", "head"] });
      this.command({
        cwd: temporary,
        args: [
          "config",
          "http.https://example.invalid/.extraheader",
          "fixture-credential",
        ],
      });
      writeFileSync(join(temporary, ".git/hooks/pre-commit"), "fixture-hook");
      const event = join(temporary, "event.json");
      writeFileSync(
        event,
        JSON.stringify({ pull_request: { base: { sha: base } } }),
      );
      const task = tasksSchema.parse(
        Bun.YAML.parse(this.read("preflight/Taskfile.yml")),
      );
      const command = task.tasks["preflight:policy:run"].cmds[0];
      if (!command) throw new Error("Policy command missing");
      const prefix = command
        .slice(0, command.indexOf("PREFLIGHT_SOURCE_CONTEXT="))
        .replaceAll("{{.REPO_ROOT}}", temporary)
        .replaceAll("{{.POLICY_STAGE}}", "repository-policy");
      const result = spawnSync(
        "bash",
        [
          "-c",
          prefix +
            `
        test "$(git --git-dir="$metadata/git" show HEAD:source.txt)" = head
        test "$(git --git-dir="$metadata/git" show origin/main:source.txt)" = baseline
        test "$(git --git-dir="$metadata/git" ls-files)" = source.txt
        test ! -e "$metadata/git/objects/info/alternates"
        test ! -e "$metadata/git/hooks/pre-commit"
        ! git --git-dir="$metadata/git" config --get-regexp 'http.*extraheader'
        ! git --git-dir="$metadata/git" config --get remote.origin.url
        test "$(jq -r .pull_request.base.sha "$metadata/event.json")" = '${base}'
      `,
        ],
        { encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: event } },
      );
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterExport(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-formatter-export-"));
    try {
      const implementation = join(temporary, "implementation");
      const bin = join(temporary, "bin");
      mkdirSync(join(implementation, "preflight"), { recursive: true });
      mkdirSync(join(implementation, ".git"));
      mkdirSync(bin);
      writeFileSync(join(implementation, ".git/config"), "fixture-credential");
      writeFileSync(join(implementation, "preflight/selected.rs"), "before\n");
      writeFileSync(join(implementation, "untouched.txt"), "untouched\n");
      writeFileSync(join(temporary, "outside.txt"), "outside\n");
      symlinkSync(temporary, join(implementation, "escape"));
      const dockerLog = join(temporary, "docker.log");
      writeFileSync(
        join(bin, "docker"),
        `#!/bin/bash
  set -euo pipefail
  printf 'called\\n' >> "$DOCKER_LOG"
  for arg in "$@"; do
    case "$arg" in
      format-export.contexts.implementation-source=*) source_dir="\u0024{arg#*=}" ;;
      format-export.output=type=local,dest=*) output_dir="\u0024{arg#*dest=}" ;;
    esac
  done
  test -f "$source_dir/preflight/selected.rs"
  test ! -e "$source_dir/.git"
  test ! -e "$source_dir/untouched.txt"
  if [ "$FORMAT_EXPORT_MODE" = complete ]; then
    mkdir -p "$output_dir/preflight"
    printf 'formatted\\n' > "$output_dir/preflight/selected.rs"
    printf 'must not be applied\\n' > "$output_dir/untouched.txt"
  fi
  `,
        { mode: 0o755 },
      );
      const files = join(temporary, "files");
      for (const scenario of [
        "complete",
        "missing",
        "escape",
        "traversal",
        "git",
      ]) {
        const path =
          scenario === "escape"
            ? "escape/outside.txt"
            : scenario === "traversal"
              ? "../outside.txt"
              : scenario === "git"
                ? ".git/config"
                : "preflight/selected.rs";
        writeFileSync(files, `${path}\0`);
        writeFileSync(dockerLog, "");
        const result = spawnSync(
          "task",
          [
            "--taskfile",
            join(this.root, "Taskfile.yml"),
            "ci:format:implementation",
          ],
          {
            cwd: this.root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FORMAT_CHANGED_FILES: files,
              REPO_ROOT: this.root,
              IMPLEMENTATION_REPO_ROOT: implementation,
              DOCKER_LOG: dockerLog,
              FORMAT_EXPORT_MODE: scenario,
            },
          },
        );
        if (scenario === "complete") {
          expect(result.status, result.stderr).toBe(0);
          expect(
            readFileSync(join(implementation, "preflight/selected.rs"), "utf8"),
          ).toBe("formatted\n");
        } else {
          expect(result.status).not.toBe(0);
          if (scenario !== "missing")
            expect(readFileSync(dockerLog, "utf8")).toBe("");
        }
        expect(
          readFileSync(join(implementation, "untouched.txt"), "utf8"),
        ).toBe("untouched\n");
        expect(readFileSync(join(temporary, "outside.txt"), "utf8")).toBe(
          "outside\n",
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterContext(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-format-context-"));
    try {
      const formatterRoot = join(temporary, "formatter");
      mkdirSync(formatterRoot);
      for (const file of [
        "package.json",
        "bun.lock",
        "format.sh",
        "prettier-default.json",
        "prettier-shared-typescript.json",
        "prettier-web.json",
        "prettier-skill.json",
      ]) {
        writeFileSync(
          join(formatterRoot, file),
          this.read(join(".github/formatting", file)),
        );
      }
      const install = spawnSync(
        "bun",
        ["install", "--frozen-lockfile", "--ignore-scripts"],
        { cwd: formatterRoot, encoding: "utf8" },
      );
      expect(install.status, install.stderr).toBe(0);
      const shared =
        "nook-app/nook-web/nook-web-shared/src/vault-app/fixture.ts";
      const skill =
        ".cortex/teams/ai/dynamic-skills/new-fixture/scripts/src/fixture.ts";
      const prelude = this.read(".github/formatting/ci.Dockerfile").match(
        /^RUN mkdir -p .+$/m,
      );
      if (!prelude)
        throw new Error("CI formatter working directory setup missing");
      for (const path of [shared, skill]) {
        const directory = path.slice(0, path.lastIndexOf("/"));
        mkdirSync(join(temporary, directory), { recursive: true });
        writeFileSync(
          join(temporary, path),
          'export const value={name:"example"}\n',
        );
        const files = join(temporary, "files");
        writeFileSync(files, `${path}\0`);
        const prepare = prelude[0].slice(4).replaceAll("/workspace", temporary);
        const result = spawnSync(
          "bash",
          ["-c", `${prepare}\nbash "$FORMAT_SCRIPT"`],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              NOOK_REPO_ROOT: temporary,
              NOOK_FORMATTER_ROOT: formatterRoot,
              FORMAT_CHANGED_FILES: files,
              FORMAT_SCRIPT: join(formatterRoot, "format.sh"),
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const quote = path === shared ? '"' : "'";
        expect(readFileSync(join(temporary, path), "utf8")).toBe(
          `export const value = { name: ${quote}example${quote} };\n`,
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
  private command(request: GitFixtureCommand): string {
    const { cwd, args } = request;
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
}

const contract = new DockerizedRustContract();
const e2eContract = new DockerizedRustE2eContract();
const toolingContract = new DockerizedRustToolingContract();
test(
  "PR readiness requires success for every selected validation branch",
  contract.previewGates.bind(contract),
);
test(
  "grouped ecosystem reports every result and fails for any failed check",
  contract.ecosystemResults.bind(contract),
);
test(
  "policy Git metadata retains exact head and real baseline without credentials",
  contract.portableGitMetadata.bind(contract),
);

test(
  "trusted formatter exports only bounded files and rejects hostile paths",
  contract.formatterExport.bind(contract),
  15_000,
);

test(
  "actual formatter supports shared-only files and new skill packages",
  contract.formatterContext.bind(contract),
  60_000,
);
test(
  "e2e orchestration reports every selected suite before failing",
  e2eContract.e2eCompletion.bind(e2eContract),
);
test(
  "tooling installs every package before checking successful installs",
  toolingContract.toolingStaticInstallsBeforeChecks.bind(toolingContract),
);

const setupContract = new TrustedBuildkitSetupContract();

test("trusted setup isolates login secrets and retains native backend failures", () => {
  setupContract.credentialsAndBackend();
});
test("setup observations preserve fatal environment and optional telemetry boundaries", () => {
  setupContract.observationsKeepFailureBoundaries();
});
