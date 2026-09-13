import { test, expect } from "bun:test";
import {
  readFileSync,
  readdirSync,
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

const actionSchema = z.object({
  runs: z.object({
    steps: z.array(z.object({ name: z.string(), run: z.string().default("") })),
  }),
});
const tasksSchema = z.object({
  tasks: z.object({
    "preflight:policy:run": z.object({ cmds: z.array(z.string()) }),
  }),
});

interface GitFixtureCommand {
  cwd: string;
  args: string[];
}

class DockerizedRustContract {
  private readonly root = resolve(import.meta.dir, "../..");

  previewGates(): void {
    const workflow = z
      .object({
        jobs: z.record(
          z.string(),
          z.object({
            needs: z.union([z.string(), z.array(z.string())]).optional(),
            if: z.string().optional(),
            steps: z
              .array(
                z.object({
                  run: z.string().optional(),
                  if: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      })
      .parse(Bun.YAML.parse(this.read(".github/workflows/pr.yml")));
    const preview = workflow.jobs.preview;
    const script = z.string().parse(preview?.steps?.[0]?.run);
    expect(preview?.needs).toContain("wasm-node-test");
    expect(preview?.needs).toContain("extension-e2e");
    expect(Object.keys(workflow.jobs)).not.toContain(
      "auth-sensitive-extension-e2e",
    );
    expect(Object.keys(workflow.jobs)).not.toContain("full-extension-e2e");
    const extension = workflow.jobs["extension-e2e"];
    expect(extension?.if).toContain(
      "inputs.full_e2e_requested || needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
    );
    expect(extension?.steps).toEqual([
      { if: "inputs.full_e2e_requested", run: "task _extension:test:e2e" },
      {
        if: "${{ !inputs.full_e2e_requested }}",
        run: "task _extension:test:e2e:file",
      },
    ]);
    for (const job of ["extension-e2e", "full-e2e-shard"]) {
      expect(workflow.jobs[job]?.needs).not.toContain("wasm-node-test");
      expect(workflow.jobs[job]?.needs).toContain("verify");
    }
    for (const full of ["true", "false"]) {
      for (const auth of ["true", "false"]) {
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          for (const node of ["success", "failure", "cancelled", "skipped"]) {
            const run = spawnSync("bash", ["-c", script], {
              encoding: "utf8",
              env: {
                ...process.env,
                NATIVE_RESULT: "success",
                WASM_RESULT: "success",
                WEB_RESULT: "success",
                WASM_NODE_RESULT: node,
                UI_DEMOS_ENABLED: "false",
                UI_DEMO_REQUIRED: "false",
                UI_DEMO_RESULT: "skipped",
                AUTH_SENSITIVE_E2E_REQUIRED: auth,
                FULL_E2E_REQUESTED: full,
                EXTENSION_E2E_RESULT: result,
              },
            });
            expect(run.status === 0, run.stdout).toBe(
              (result === "success" ||
                (full === "false" && auth === "false")) &&
                node === "success",
            );
          }
        }
      }
    }
  }

  ecosystemResults(): void {
    const tasks = z
      .object({
        tasks: z.object({
          "docker:ecosystem:smoke": z.object({ cmds: z.array(z.string()) }),
        }),
      })
      .parse(
        Bun.YAML.parse(this.read("nook-app/nook-platform/docker/Taskfile.yml")),
      );
    const script = z
      .string()
      .parse(tasks.tasks["docker:ecosystem:smoke"].cmds[0]);
    const temporary = mkdtempSync(join(tmpdir(), "nook-ecosystem-results-"));
    try {
      writeFileSync(
        join(temporary, "task"),
        '#!/bin/sh\ncase ",$FAILURES," in *",$1,"*) exit 1 ;; *) exit 0 ;; esac\n',
        { mode: 0o755 },
      );
      for (let failures = 0; failures < 8; failures += 1) {
        const selected = [];
        if (failures & 1) selected.push("docker:ecosystem:deterministic");
        if (failures & 2) selected.push("docker:ecosystem:fuzz");
        if (failures & 4) selected.push("docker:ecosystem:kani");
        const run = spawnSync("bash", ["-e", "-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${temporary}:${process.env.PATH}`,
            FAILURES: selected.join(","),
          },
        });
        expect(run.status === 0, run.stdout).toBe(failures === 0);
        expect(run.stdout).toContain("Deterministic tests");
        expect(run.stdout).toContain("Fuzz smoke");
        expect(run.stdout).toContain("Kani proofs");
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  coverageAndExporter(): void {
    const pr = this.read(".github/workflows/pr.yml");
    const checks = this.read(".github/workflows/rust-ecosystem-checks.yml");
    const product = this.read(
      "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    expect(pr).toContain("native_coverage_provided: true");
    expect(checks).toContain("type: boolean\n        default: false");
    expect(product).toContain("ARG NATIVE_COVERAGE_PROVIDED=false");
    expect(product).toContain(
      "true) INSTA_UPDATE=no cargo test --locked -p nook-replication --doc",
    );
    expect(product).toContain(
      "false) INSTA_UPDATE=no cargo test --locked -p nook-replication ;;",
    );
    expect(product).toContain(
      "INSTA_UPDATE=no cargo llvm-cov nextest --no-clean --profile ci -p nook-replication",
    );
    expect(product).toContain(
      "RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release",
    );
    const hive = this.read("agentic-ai/minds/hive/Dockerfile");
    const dependencies = hive
      .split("FROM fetched-dependencies AS observer-contract-dependencies")[1]
      ?.split(
        "FROM observer-contract-dependencies AS observer-contract-exporter",
      )[0];
    expect(dependencies).toContain(
      "COPY --from=chef-planner /build/recipe.json recipe.json",
    );
    expect(dependencies).toContain("cargo chef cook --locked");
    expect(dependencies).toContain(
      "--features observer-contract-export --bin hive-export-observer-contract",
    );
    expect(dependencies).not.toContain("COPY hive/src");
    expect(hive).toContain(
      "FROM observer-contract-dependencies AS observer-contract-exporter\nCOPY hive/src hive/src",
    );
    expect(hive).toContain(
      "--bin hive-export-observer-contract -- --output /observer-contract",
    );
  }

  workflowTooling(): void {
    for (const file of readdirSync(join(this.root, ".github/workflows"))) {
      if (!file.endsWith(".yml")) continue;
      const source = readFileSync(
        join(this.root, ".github/workflows", file),
        "utf8",
      );
      expect(source).not.toMatch(
        /uses: (?:dtolnay\/rust-toolchain|Swatinem\/rust-cache)/,
      );
      expect(source).not.toMatch(/^\s*(?:run:\s*)?(?:cargo|rustup|rustfmt)\s/m);
    }
    const ecosystem = this.read(".github/workflows/rust-ecosystem-checks.yml");
    expect(ecosystem).toContain("SCCACHE_OPTIONAL:");
    expect(ecosystem).toContain("'dependabot[bot]') && '1' || ''");
    expect(ecosystem.match(/uses: docker\/setup-buildx-action/g)).toHaveLength(
      3,
    );
    expect(ecosystem.match(/cache-selection: ecosystem-/g)).toHaveLength(3);
    let routedJobs = 0;
    for (const line of ecosystem.split("\n")) {
      if (!line.trimStart().startsWith("runs-on:")) continue;
      routedJobs += 1;
      expect(line).toContain(
        "github.event.pull_request.head.repo.full_name == github.repository",
      );
      expect(line).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
      expect(line).toContain(
        "(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'",
      );
    }
    expect(routedJobs).toBe(3);

    expect(this.read(".github/formatting/Dockerfile")).toContain(
      "prettier-skill.json",
    );
    expect(this.read("agentic-ai/minds/hive/Dockerfile")).toContain(
      "prettier-skill.json",
    );
    const audit = this.read(".github/docker/rust-maintenance.hcl");
    expect(audit).toContain('no-cache-filter = ["audit"]');
    expect(audit).not.toContain("no-cache = true");
    expect(this.read(".github/scripts/remote-task-batch.sh")).toContain(
      'loom:verify) run_with_timeout "$timeout_minutes" task preflight:loom-verify',
    );
    const dockerignore = this.read(".dockerignore").split("\n");
    const generatedWasm =
      "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm";
    expect(dockerignore).toContain(`${generatedWasm}*`);
    expect(
      dockerignore.indexOf(`!${generatedWasm}/.gitignore`),
    ).toBeGreaterThan(dockerignore.indexOf(`${generatedWasm}*`));
    expect(dockerignore).toContain("**/node_modules");
  }

  arcCacheSelection(): void {
    const action = actionSchema.parse(
      Bun.YAML.parse(this.read(".github/actions/nook-docker-setup/action.yml")),
    );
    const selection = action.runs.steps.find(this.isCacheSelection);
    if (!selection) throw new Error("Cache selection script missing");
    const temporary = mkdtempSync(join(tmpdir(), "nook-cache-contract-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "docker"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_LOG"\n',
        { mode: 0o755 },
      );
      for (const profile of [
        "preflight",
        "web-e2e",
        "connection-only",
        "native",
        "hive",
        "ecosystem-dylint",
        "ecosystem-fuzz",
        "ecosystem-policy-tools",
        "ecosystem-deterministic",
        "ecosystem-kani",
        "ecosystem-smoke",
      ]) {
        const script = selection.run
          .replaceAll("${{ inputs.cache-selection }}", profile)
          .replaceAll("${{ github.event_name }}", "pull_request")
          .replaceAll("${{ github.ref }}", "refs/pull/1/merge")
          .replaceAll("${{ github.event.pull_request.number }}", "1")
          .replaceAll(
            "${{ github.event.pull_request.head.sha }}",
            "a".repeat(40),
          )
          .replaceAll("${{ inputs.isolated-cache-write }}", "true")
          .replaceAll("${{ inputs.main-cache-only }}", "true")
          .replaceAll("${{ inputs.cache-write }}", "false")
          .replaceAll("${{ inputs.registry-host }}", "registry.dev.nokey.sh")
          .replaceAll(
            "${{ github.action_path }}",
            join(this.root, ".github/actions/nook-docker-setup"),
          );
        const environment = join(temporary, "environment");
        const probes = join(temporary, "probes");
        writeFileSync(environment, "");
        writeFileSync(probes, "");
        const result = spawnSync("bash", ["-c", script], {
          cwd: this.root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            PROBE_LOG: probes,
            GITHUB_ENV: environment,
            GITHUB_WORKSPACE: this.root,
            NOOK_ARC_RUNNER: "1",
            NOOK_SELECTED_BUILDER: "test-builder",
          },
        });
        expect(result.status, result.stderr).toBe(0);
        const values = readFileSync(environment, "utf8");
        expect(values).toContain("GHA_CACHE_SCOPE_SUFFIX=\n");
        expect(values).toContain("GHA_CACHE_WRITE_ENABLED=\n");
        expect(values).not.toContain("HIVE_CACHE_TO=");
        const calls = readFileSync(probes, "utf8");
        expect(calls).not.toContain("-git-");
        if (profile === "connection-only" || profile === "hive")
          expect(calls).toBe("");
        if (profile === "ecosystem-smoke") {
          expect(calls.trim().split("\n")).toHaveLength(3);
          expect(calls).toContain("nook-rust-ecosystem-deterministic-");
          expect(calls).toContain("nook-rust-ecosystem-fuzz-");
          expect(calls).toContain("nook-rust-ecosystem-kani-");
        } else if (profile.startsWith("ecosystem-")) {
          expect(calls.trim().split("\n")).toHaveLength(1);
          expect(calls).toContain(`nook-rust-${profile}-`);
        }
        if (profile === "preflight") {
          expect(calls.trim().split("\n")).toHaveLength(1);
          expect(calls).toContain("nook-preflight-v1");
        }
        if (profile === "web-e2e") {
          expect(calls.trim().split("\n")).toHaveLength(1);
          expect(calls).toContain("nook-web-e2e-v1");
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
              NOOK_FORMATTER_ROOT: join(this.root, ".github/formatting"),
              FORMAT_CHANGED_FILES: files,
              FORMAT_SCRIPT: join(this.root, ".github/formatting/format.sh"),
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
          "timeout-minutes": z.number().optional(),
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
    if (
      !groupedTask?.cmds ||
      !webOnlyTask?.cmds ||
      !fullTask?.cmds
    ) {
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

  compilerFirstWebVerification(): void {
    const taskSchema = z.object({
      tasks: z.record(
        z.string(),
        z.object({
          deps: z.array(z.string()).default([]),
          cmds: z
            .array(z.union([z.string(), z.object({ task: z.string() })]))
            .default([]),
        }),
      ),
    });
    const tasks = taskSchema.parse(
      Bun.YAML.parse(this.read("nook-app/Taskfile.yml")),
    ).tasks;
    const testTask = tasks["_test:parallel"];
    const compileTask = tasks["_compile:parallel"];
    const unitTask = tasks["_unit:parallel"];
    const lintTask = tasks["_lint:parallel"];
    if (!testTask || !compileTask || !unitTask || !lintTask) {
      throw new Error("Parallel task definitions are missing");
    }
    expect(
      testTask.cmds.map((command) =>
        typeof command === "string" ? command : command.task,
      ),
    ).toEqual(["_compile:parallel", "_unit:parallel"]);
    expect(compileTask.deps.sort()).toEqual([
      "_extension:typecheck",
      "_web:check:parallel",
    ]);
    expect(unitTask.deps.sort()).toEqual([
      "_extension:test:parallel",
      "_web:test:parallel",
    ]);
    expect(testTask.deps).toEqual([]);
    expect(
      lintTask.cmds.map((command) =>
        typeof command === "string" ? command : command.task,
      ),
    ).toContain("_extension:lint:parallel");

    const extension = this.read(
      "nook-app/nook-web/nook-web-extension/Taskfile.yml",
    );
    expect(extension).toContain("_extension:lint:parallel:");
    expect(extension).toContain("bun run typecheck");
    expect(extension).toContain("bun run test:unit");

    const temporary = mkdtempSync(join(tmpdir(), "nook-compiler-first-"));
    try {
      const taskfile = join(temporary, "Taskfile.yml");
      const probe = join(temporary, "probe.log");
      writeFileSync(
        taskfile,
        `version: '3'
tasks:
  compiler:web:
    cmds:
      - sh -c 'echo compiler:web >> "$PROBE_LOG"; test "${"${FAIL_COMPILERS:-}"}" != 1'
  compiler:extension:
    cmds:
      - sh -c 'echo compiler:extension >> "$PROBE_LOG"; test "${"${FAIL_COMPILERS:-}"}" != 1'
  compiler:all:
    deps: [compiler:web, compiler:extension]
  unit:web:
    cmds:
      - sh -c 'echo unit:web >> "$PROBE_LOG"'
  unit:extension:
    cmds:
      - sh -c 'echo unit:extension >> "$PROBE_LOG"'
  unit:all:
    deps: [unit:web, unit:extension]
  verify:
    cmds:
      - task: compiler:all
      - task: unit:all
`,
      );
      for (const failure of ["1", "0"]) {
        writeFileSync(probe, "");
        const result = spawnSync("task", ["--taskfile", taskfile, "verify"], {
          encoding: "utf8",
          env: {
            ...process.env,
            FAIL_COMPILERS: failure,
            PROBE_LOG: probe,
          },
        });
        const output = readFileSync(probe, "utf8");
        expect(output).toContain("compiler:web");
        expect(output).toContain("compiler:extension");
        if (failure === "1") {
          expect(result.status).not.toBe(0);
          expect(output).not.toContain("unit:web");
          expect(output).not.toContain("unit:extension");
        } else {
          expect(result.status, result.stderr).toBe(0);
          expect(output).toContain("unit:web");
          expect(output).toContain("unit:extension");
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

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
  private isCacheSelection(this: void, step: { name: string }): boolean {
    return step.name === "Select hosted BuildKit cache";
  }
  private command(request: GitFixtureCommand): string {
    const { cwd, args } = request;
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
}

const contract = new DockerizedRustContract();
test(
  "PR browser scheduling preserves covering extension and Node gates",
  contract.previewGates.bind(contract),
);
test(
  "grouped ecosystem reports every result and fails for any failed check",
  contract.ecosystemResults.bind(contract),
);
test(
  "PR dedup retains standalone coverage and source-correct Hive exports",
  contract.coverageAndExporter.bind(contract),
);
test(
  "workflow Rust tools are Docker owned and dependency audits stay live",
  contract.workflowTooling.bind(contract),
);
test(
  "ARC probes only consumed Main caches and never exports unused exact refs",
  contract.arcCacheSelection.bind(contract),
);
test(
  "policy Git metadata retains exact head and real baseline without credentials",
  contract.portableGitMetadata.bind(contract),
);

test(
  "trusted formatter exports only bounded files and rejects hostile paths",
  contract.formatterExport.bind(contract),
);

test(
  "actual formatter supports shared-only files and new skill packages",
  contract.formatterContext.bind(contract),
);
test(
  "e2e orchestration reports every selected suite before failing",
  contract.e2eCompletion.bind(contract),
);
test(
  "web verification aggregates compilers before starting unit suites",
  contract.compilerFirstWebVerification.bind(contract),
);
test(
  "tooling installs every package before checking successful installs",
  contract.toolingStaticInstallsBeforeChecks.bind(contract),
);
