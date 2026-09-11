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
      5,
    );
    expect(ecosystem.match(/cache-selection: ecosystem-/g)).toHaveLength(5);

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
    expect(dockerignore.indexOf(`!${generatedWasm}/.gitignore`)).toBeGreaterThan(
      dockerignore.indexOf(`${generatedWasm}*`),
    );
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
        if (profile.startsWith("ecosystem-")) {
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

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
  private isCacheSelection(step: { name: string }): boolean {
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
