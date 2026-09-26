import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    const scenarios = [
      {
        name: "registry and both cache refs are available",
        registryStatus: 200,
        currentStatus: 200,
        parentStatus: 200,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: {
          kind: "success",
          githubEnvironment:
            "GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE=1\n" +
            "GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE=1\n",
        },
      },
      {
        name: "current cache ref is absent",
        registryStatus: 200,
        currentStatus: 404,
        parentStatus: 200,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: {
          kind: "success",
          githubEnvironment:
            "GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE=0\n" +
            "GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE=1\n",
        },
      },
      {
        name: "parent cache ref is absent",
        registryStatus: 200,
        currentStatus: 200,
        parentStatus: 404,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: {
          kind: "success",
          githubEnvironment:
            "GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE=1\n" +
            "GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE=0\n",
        },
      },
      {
        name: "both cache refs are absent",
        registryStatus: 200,
        currentStatus: 404,
        parentStatus: 404,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: {
          kind: "success",
          githubEnvironment:
            "GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE=0\n" +
            "GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE=0\n",
        },
      },
      ...[401, 403, 404, 503].map((status) => ({
        name: "registry API rejects HTTP " + status,
        registryStatus: status,
        currentStatus: 200,
        parentStatus: 200,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: { kind: "failure" },
      })),
      ...[401, 403, 503].map((status) => ({
        name: "current cache manifest rejects HTTP " + status,
        registryStatus: 200,
        currentStatus: status,
        parentStatus: 200,
        blobStatus: 200,
        fetchFailure: "0",
        expectation: { kind: "failure" },
      })),
      {
        name: "referenced cache blob rejects HTTP 404",
        registryStatus: 200,
        currentStatus: 200,
        parentStatus: 200,
        blobStatus: 404,
        fetchFailure: "0",
        expectation: { kind: "failure" },
      },
      {
        name: "registry transport fails",
        registryStatus: 200,
        currentStatus: 200,
        parentStatus: 200,
        blobStatus: 200,
        fetchFailure: "1",
        expectation: { kind: "failure" },
      },
    ] as const;
    const harness = `
      import assert from "node:assert/strict";
      import { pathToFileURL } from "node:url";
      import { readFileSync, writeFileSync } from "node:fs";

      const scenarios = JSON.parse(process.env.CACHE_SCENARIOS);
      writeFileSync(process.env.CACHE_VERIFIER_FILE, process.env.CACHE_VERIFIER_SCRIPT);
      const verifierUrl = pathToFileURL(process.env.CACHE_VERIFIER_FILE).href;
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
      for (const [index, scenario] of scenarios.entries()) {
        process.env.CACHE_REGISTRY_STATUS = String(scenario.registryStatus);
        process.env.CACHE_CURRENT_STATUS = String(scenario.currentStatus);
        process.env.CACHE_PARENT_STATUS = String(scenario.parentStatus);
        process.env.CACHE_BLOB_STATUS = String(scenario.blobStatus);
        process.env.CACHE_FETCH_FAILURE = scenario.fetchFailure;
        writeFileSync(process.env.GITHUB_ENV, "");
        let actualOutcome = "success";
        try {
          await import(verifierUrl + "?scenario=" + index);
        } catch (error) {
          actualOutcome = "failure";
        }
        switch (scenario.expectation.kind) {
          case "success":
            assert.equal(actualOutcome, "success", scenario.name);
            assert.equal(
              readFileSync(process.env.GITHUB_ENV, "utf8"),
              scenario.expectation.githubEnvironment,
              scenario.name,
            );
            continue;
          case "failure":
            assert.equal(actualOutcome, "failure", scenario.name);
            continue;
        }
        assert.fail("unsupported registry expectation: " + scenario.expectation.kind);
      }
    `;
    const temporary = mkdtempSync(join(tmpdir(), "nook-cache-registry-"));
    try {
      const githubEnvironmentFile = join(temporary, "github-env");
      const verifierFile = join(temporary, "registry-verifier.mjs");
      writeFileSync(githubEnvironmentFile, "");
      // Share one Node startup across the matrix and stay under Bun's 5s timeout.
      const result = spawnSync("node", ["--input-type=module", "-e", harness], {
        encoding: "utf8",
        timeout: 4_000,
        env: {
          ...process.env,
          CACHE_VERIFIER_SCRIPT: registryGateScript,
          CACHE_VERIFIER_FILE: verifierFile,
          CACHE_SCENARIOS: JSON.stringify(scenarios),
          CACHE_ROOT_MANIFEST: rootManifest,
          CACHE_NESTED_MANIFEST: nestedManifest,
          GHA_CACHE_SCOPE_SUFFIX: "-git-current",
          GHA_CACHE_PARENT_SCOPE_SUFFIX: "-git-parent",
          GITHUB_ENV: githubEnvironmentFile,
          REGISTRY_HOST: "registry.example.test",
          REGISTRY_USERNAME: "sim-user",
          REGISTRY_PASSWORD: "sim-password",
        },
      });
      expect(result.status === 0, result.stderr || result.stdout).toBe(true);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
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
