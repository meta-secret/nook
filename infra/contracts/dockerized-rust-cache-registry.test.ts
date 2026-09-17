import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

class DockerizedRustCacheRegistryContract {
  private readonly root = resolve(import.meta.dir, "../..");

  preservesCompilerCacheSecretsAndRejectsRegistryFailures(): void {
    const bake = this.read("nook-app/docker-bake.hcl");
    const compile = this.read(".github/scripts/compile-remote.sh");
    expect(bake).toContain('variable "SCCACHE_RUNTIME_MODE_FILE"');
    expect(bake).toContain(
      "id=sccache_runtime_mode,src=${SCCACHE_RUNTIME_MODE_FILE}",
    );
    expect(bake).toContain(
      "sccache_secrets = concat(sccache_credentials, sccache_runtime_secrets)",
    );
    expect(compile).toContain(
      "--var=SCCACHE_RUNTIME_MODE_FILE=${runtime_mode_file}",
    );
    expect(compile).toContain(
      "--var=SCCACHE_S3_ACCESS_KEY_FILE=${access_key_file}",
    );
    expect(compile).toContain(
      "--var=SCCACHE_S3_SECRET_KEY_FILE=${secret_key_file}",
    );
    expect(compile).not.toContain(
      "--set=build-compile.secrets=id=sccache_runtime_mode",
    );

    const action = this.read(".github/actions/nook-docker-setup/action.yml");
    expect(action).toContain(
      'echo "NOOK_REMOTE_TASK_SELECTION=$NOOK_REMOTE_TASK_SELECTION" >> "$GITHUB_ENV"',
    );
    const gateMarker = "    - name: Verify Docker cache refs and blobs";
    const gateStart = action.indexOf(gateMarker);
    expect(gateStart).toBeGreaterThanOrEqual(0);
    const nextStep = action.indexOf(
      "\n    - name:",
      gateStart + gateMarker.length,
    );
    const gate = action.slice(
      gateStart,
      nextStep < 0 ? action.length : nextStep,
    );
    const runMarker = "        timeout 60s node --input-type=module <<'NODE'\n";
    const runStart = gate.indexOf(runMarker);
    expect(runStart).toBeGreaterThanOrEqual(0);
    const runEnd = gate.indexOf("\n        NODE", runStart + runMarker.length);
    expect(runEnd).toBeGreaterThan(runStart);
    expect(
      gate.indexOf('echo "GHA_CACHE_EXACT_PROBES_COMPLETE=1"'),
    ).toBeGreaterThan(runEnd);
    expect(
      gate.indexOf('echo "GHA_CACHE_EXACT_PROBE_FAILURE_CLASS=none"'),
    ).toBeGreaterThan(runEnd);
    const registryGateScript = gate
      .slice(runStart + runMarker.length, runEnd)
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        expect(line.startsWith("        ")).toBe(true);
        return line.slice(8);
      })
      .join("\n");
    for (const entry of [
      "verifyRegistryAvailability",
      'this.request(`https://${this.registryHost}/v2/`, "GET")',
      '`https://${this.registryHost}/v2/${repository}/manifests/${reference}`',
      "/blobs/",
      'this.request(url, "HEAD")',
      "method,",
      "AbortSignal.timeout",
    ]) {
      expect(registryGateScript).toContain(entry);
    }

    const rootManifest = JSON.stringify({
      schemaVersion: 2,
      manifests: [{ digest: `sha256:${"a".repeat(64)}` }],
    });
    const nestedManifest = JSON.stringify({
      schemaVersion: 2,
      config: { digest: `sha256:${"b".repeat(64)}` },
      layers: [{ digest: `sha256:${"c".repeat(64)}` }],
    });
    const harness = `
      globalThis.fetch = async (input, init = {}) => {
        if (process.env.CACHE_FETCH_FAILURE === "1") {
          throw new Error("mock registry network failure");
        }
        const url = new URL(typeof input === "string" ? input : input.url);
        const headers = new Headers(init.headers);
        const expectedAuthorization = "Basic " + Buffer.from("sim-user:sim-password").toString("base64");
        if (headers.get("authorization") !== expectedAuthorization) {
          return new Response("", { status: 401 });
        }
        if (url.pathname === "/v2/") {
          return new Response("", { status: Number(process.env.CACHE_REGISTRY_STATUS) });
        }
        if (url.pathname.endsWith("/manifests/buildcache")) {
          const isCurrent = url.pathname.includes("nook-build-compile-git-current");
          const status = Number(process.env[isCurrent ? "CACHE_CURRENT_STATUS" : "CACHE_PARENT_STATUS"]);
          if (status !== 200) return new Response("", { status });
          return new Response(process.env.CACHE_ROOT_MANIFEST, { status });
        }
        if (url.pathname.includes("/manifests/sha256:")) {
          return new Response(process.env.CACHE_NESTED_MANIFEST, { status: 200 });
        }
        if (url.pathname.includes("/blobs/sha256:")) {
          if (init.method !== "HEAD") return new Response("", { status: 405 });
          return new Response("", { status: Number(process.env.CACHE_BLOB_STATUS) });
        }
        return new Response("", { status: 500 });
      };
      await import("data:text/javascript," + encodeURIComponent(process.env.CACHE_VERIFIER_SCRIPT));
    `;
    for (const [registry, current, parent, blob, networkFailure, expected] of [
      [200, 200, 200, 200, false, true],
      [200, 404, 200, 200, false, true],
      [200, 200, 404, 200, false, true],
      [200, 404, 404, 200, false, true],
      [401, 200, 200, 200, false, false],
      [403, 200, 200, 200, false, false],
      [404, 200, 200, 200, false, false],
      [503, 200, 200, 200, false, false],
      [200, 401, 200, 200, false, false],
      [200, 403, 200, 200, false, false],
      [200, 503, 200, 200, false, false],
      [200, 200, 200, 404, false, false],
      [200, 200, 200, 200, true, false],
    ] as const) {
      const result = spawnSync("node", ["--input-type=module", "-e", harness], {
        encoding: "utf8",
        env: {
          ...process.env,
          CACHE_VERIFIER_SCRIPT: registryGateScript,
          CACHE_REGISTRY_STATUS: String(registry),
          CACHE_ROOT_MANIFEST: rootManifest,
          CACHE_NESTED_MANIFEST: nestedManifest,
          CACHE_CURRENT_STATUS: String(current),
          CACHE_PARENT_STATUS: String(parent),
          CACHE_BLOB_STATUS: String(blob),
          CACHE_FETCH_FAILURE: networkFailure ? "1" : "0",
          GHA_CACHE_SCOPE_SUFFIX: "-git-current",
          GHA_CACHE_PARENT_SCOPE_SUFFIX: "-git-parent",
          REGISTRY_HOST: "registry.example.test",
          REGISTRY_USERNAME: "sim-user",
          REGISTRY_PASSWORD: "sim-password",
        },
      });
      expect(result.status === 0, result.stderr || result.stdout).toBe(expected);
    }
  }

  preservesTwoPhaseTimeoutBudgets(): void {
    const batch = this.read(".github/scripts/remote-task-batch.sh");
    const workflow = this.read(".github/workflows/remote.yml");
    for (const entry of [
      "timeout --kill-after=10s 240s task build:compile",
      "timeout --kill-after=10s 280s task build:compile",
      "build:compile) echo 5 ;;",
    ]) {
      expect(batch).toContain(entry);
    }
    expect(workflow).toContain(
      "timeout-minutes: ${{ (inputs.tasks || inputs.task) == 'build:compile' && 5 || 360 }}",
    );
  }

  private read(path: string): string {
    return readFileSync(resolve(this.root, path), "utf8");
  }
}

const contract = new DockerizedRustCacheRegistryContract();
test(
  "remote compile preserves cache secrets and rejects registry access failures",
  contract.preservesCompilerCacheSecretsAndRejectsRegistryFailures.bind(
    contract,
  ),
);
test(
  "two-phase compile keeps its publish and read-only timeout budgets",
  contract.preservesTwoPhaseTimeoutBudgets.bind(contract),
);
