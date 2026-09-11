import { test, expect } from "bun:test";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

const actionSchema = z.object({
  runs: z.object({ steps: z.array(z.object({ name: z.string(), run: z.string().default("") })) }),
});
const tasksSchema = z.object({
  tasks: z.object({
    "preflight:policy:run": z.object({ cmds: z.array(z.string()) }),
  }),
});

class DockerizedRustContract {
  private readonly root = resolve(import.meta.dir, "../..");

  workflowTooling(): void {
    for (const file of readdirSync(join(this.root, ".github/workflows"))) {
      if (!file.endsWith(".yml")) continue;
      const source = readFileSync(join(this.root, ".github/workflows", file), "utf8");
      expect(source).not.toMatch(/uses: (?:dtolnay\/rust-toolchain|Swatinem\/rust-cache)/);
      expect(source).not.toMatch(/^\s*(?:run:\s*)?(?:cargo|rustup|rustfmt)\s/m);
    }
    const audit = this.read(".github/docker/rust-maintenance.hcl");
    expect(audit).toContain('no-cache-filter = ["audit"]');
    expect(audit).not.toContain('no-cache = true');
    expect(this.read(".github/scripts/remote-task-batch.sh")).toContain(
      'loom:verify) run_with_timeout "$timeout_minutes" task preflight:loom-verify',
    );
  }

  arcCacheSelection(): void {
    const action = actionSchema.parse(Bun.YAML.parse(this.read(".github/actions/nook-docker-setup/action.yml")));
    const selection = action.runs.steps.find(this.isCacheSelection);
    if (!selection) throw new Error("Cache selection script missing");
    const temporary = mkdtempSync(join(tmpdir(), "nook-cache-contract-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "docker"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_LOG"\n', { mode: 0o755 });
      for (const profile of ["preflight", "web-e2e", "connection-only", "native", "hive"]) {
        const script = selection.run
          .replaceAll("${{ inputs.cache-selection }}", profile)
          .replaceAll("${{ github.event_name }}", "pull_request")
          .replaceAll("${{ github.ref }}", "refs/pull/1/merge")
          .replaceAll("${{ github.event.pull_request.number }}", "1")
          .replaceAll("${{ github.event.pull_request.head.sha }}", "a".repeat(40))
          .replaceAll("${{ inputs.isolated-cache-write }}", "true")
          .replaceAll("${{ inputs.main-cache-only }}", "true")
          .replaceAll("${{ inputs.cache-write }}", "false")
          .replaceAll("${{ inputs.registry-host }}", "registry.dev.nokey.sh")
          .replaceAll("${{ github.action_path }}", join(this.root, ".github/actions/nook-docker-setup"));
        const environment = join(temporary, "environment");
        const probes = join(temporary, "probes");
        writeFileSync(environment, "");
        writeFileSync(probes, "");
        const result = spawnSync("bash", ["-c", script], {
          cwd: this.root,
          encoding: "utf8",
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROBE_LOG: probes,
            GITHUB_ENV: environment, GITHUB_WORKSPACE: this.root, NOOK_ARC_RUNNER: "1", NOOK_SELECTED_BUILDER: "test-builder" },
        });
        expect(result.status, result.stderr).toBe(0);
        const values = readFileSync(environment, "utf8");
        expect(values).toContain("GHA_CACHE_SCOPE_SUFFIX=\n");
        expect(values).toContain("GHA_CACHE_WRITE_ENABLED=\n");
        expect(values).not.toContain("HIVE_CACHE_TO=");
        const calls = readFileSync(probes, "utf8");
        expect(calls).not.toContain("-git-");
        if (profile === "connection-only" || profile === "hive") expect(calls).toBe("");
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
      this.command(temporary, ["init", "-q"]);
      this.command(temporary, ["config", "user.email", "test@example.invalid"]);
      this.command(temporary, ["config", "user.name", "Policy Test"]);
      writeFileSync(join(temporary, "source.txt"), "baseline\n");
      this.command(temporary, ["add", "."]);
      this.command(temporary, ["commit", "-qm", "baseline"]);
      const base = this.command(temporary, ["rev-parse", "HEAD"]).trim();
      this.command(temporary, ["update-ref", "refs/remotes/origin/main", base]);
      writeFileSync(join(temporary, "source.txt"), "head\n");
      this.command(temporary, ["commit", "-qam", "head"]);
      this.command(temporary, ["config", "http.https://example.invalid/.extraheader", "fixture-credential"]);
      writeFileSync(join(temporary, ".git/hooks/pre-commit"), "fixture-hook");
      const event = join(temporary, "event.json");
      writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
      const task = tasksSchema.parse(Bun.YAML.parse(this.read("preflight/Taskfile.yml")));
      const command = task.tasks["preflight:policy:run"].cmds[0];
      if (!command) throw new Error("Policy command missing");
      const prefix = command.slice(0, command.indexOf('PREFLIGHT_SOURCE_CONTEXT='))
        .replaceAll("{{.REPO_ROOT}}", temporary)
        .replaceAll("{{.POLICY_STAGE}}", "repository-policy");
      const result = spawnSync("bash", ["-c", prefix + `
        test "$(git --git-dir="$metadata/git" show HEAD:source.txt)" = head
        test "$(git --git-dir="$metadata/git" show origin/main:source.txt)" = baseline
        test "$(git --git-dir="$metadata/git" ls-files)" = source.txt
        test ! -e "$metadata/git/objects/info/alternates"
        test ! -e "$metadata/git/hooks/pre-commit"
        ! git --git-dir="$metadata/git" config --get-regexp 'http.*extraheader'
        ! git --git-dir="$metadata/git" config --get remote.origin.url
        test "$(jq -r .pull_request.base.sha "$metadata/event.json")" = '${base}'
      `], { encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: event } });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string { return readFileSync(join(this.root, path), "utf8"); }
  private isCacheSelection(step: { name: string }): boolean { return step.name === "Select hosted BuildKit cache"; }
  private command(cwd: string, args: string[]): string {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
}

const contract = new DockerizedRustContract();
test("workflow Rust tools are Docker owned and dependency audits stay live", contract.workflowTooling.bind(contract));
test("ARC probes only consumed Main caches and never exports unused exact refs", contract.arcCacheSelection.bind(contract));
test("policy Git metadata retains exact head and real baseline without credentials", contract.portableGitMetadata.bind(contract));
