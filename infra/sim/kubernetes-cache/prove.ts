import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ADMIN_SECRET,K3D_BINARY,K3D_VERSION,BUILDKIT_ADDRESS,REGISTRY_HOST,REMOTE_SECRET,RequiredOutputText,HostCommand} from "./contracts";
import {type BuildJobRequest,type BuildJobResultRequest,CacheBuildCompletion,JobsPodNode,BuildkitShardAccessProof,CacheNetworkPolicyProof,BuildkitPodRestart,RegistryRestart,CacheBuildSubmission} from "./jobs";
import {type DeployPlatformRequest,CachePlatformBoundary,CachePlatformDeployment,generatePassword} from "./platform";
import {SimulationCluster,type CleanupRequest,RuntimeCleanup,RuntimeRequireCommand,RuntimeWriteKubeconfig} from "./runtime";

class ProveFinish {
  constructor(private readonly request: FinishRequest) {}
  execute(): string {
    const request = this.request;

    const result: BuildJobResultRequest = {
      kubeconfigPath: request.job.kubeconfigPath,
      name: request.job.name,
      expectCached: request.expectCached,
    };
    return new CacheBuildCompletion(result).finish();
  }
}

class ProveProveStableCache {
  constructor(
    private readonly request: {
      readonly kubeconfigPath: string;
      readonly buildkitNodes: readonly string[];
    },
  ) {}
  execute(): void {
    const request = this.request;

    const [firstNode = "", secondNode = "", thirdNode = ""] =
      request.buildkitNodes;
    const forbidden: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-stable-write-denied",
      nodeName: thirdNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "forbidden-stable-write",
      dockerConfigSecret: REMOTE_SECRET,
      cacheImport: "",
      cacheExport: FORBIDDEN_CACHE_REF,
      expectCommandFailure: true,
    };
    new CacheBuildSubmission(forbidden).start();
    new RequiredOutputText({
      content: new ProveFinish({
        job: forbidden,
        expectCached: false,
      }).execute(),
      expected: "registry-write-denied",
      label: "Zot stable-scope ACL proof",
    }).assertPresent();

    const publish: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-main-publish",
      nodeName: firstNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "main-cache-input",
      dockerConfigSecret: ADMIN_SECRET,
      cacheImport: "",
      cacheExport: MAIN_CACHE_REF,
      expectCommandFailure: false,
    };
    new CacheBuildSubmission(publish).start();
    new ProveFinish({ job: publish, expectCached: false }).execute();

    const localReuse: BuildJobRequest = {
      ...publish,
      name: "cache-main-local-reuse",
      cacheExport: "",
    };
    new CacheBuildSubmission(localReuse).start();
    new ProveFinish({ job: localReuse, expectCached: true }).execute();

    new BuildkitPodRestart({
      kubeconfigPath: request.kubeconfigPath,
      podName: "nook-buildkit-0",
    }).run();
    const restartReuse: BuildJobRequest = {
      ...publish,
      name: "cache-main-restart-reuse",
      cacheExport: "",
    };
    new CacheBuildSubmission(restartReuse).start();
    new ProveFinish({ job: restartReuse, expectCached: true }).execute();

    new RegistryRestart(request.kubeconfigPath).run();
    const freshShard: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-main-fresh-shard",
      nodeName: secondNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "main-cache-input",
      dockerConfigSecret: REMOTE_SECRET,
      cacheImport: MAIN_CACHE_REF,
      cacheExport: "",
      expectCommandFailure: false,
    };
    new CacheBuildSubmission(freshShard).start();
    new ProveFinish({ job: freshShard, expectCached: true }).execute();
  }
}

class ProveProveIsolatedCache {
  constructor(
    private readonly request: {
      readonly kubeconfigPath: string;
      readonly buildkitNodes: readonly string[];
    },
  ) {}
  execute(): void {
    const request = this.request;

    const [firstNode = "", secondNode = "", thirdNode = ""] =
      request.buildkitNodes;
    const isolatedA: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-isolated-a-publish",
      nodeName: secondNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "isolated-cache-a",
      dockerConfigSecret: REMOTE_SECRET,
      cacheImport: MAIN_CACHE_REF,
      cacheExport: ISOLATED_A_CACHE_REF,
      expectCommandFailure: false,
    };
    const isolatedB: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-isolated-b-publish",
      nodeName: thirdNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "isolated-cache-b",
      dockerConfigSecret: REMOTE_SECRET,
      cacheImport: MAIN_CACHE_REF,
      cacheExport: ISOLATED_B_CACHE_REF,
      expectCommandFailure: false,
    };
    new CacheBuildSubmission(isolatedA).start();
    new CacheBuildSubmission(isolatedB).start();
    new ProveFinish({ job: isolatedA, expectCached: false }).execute();
    new ProveFinish({ job: isolatedB, expectCached: false }).execute();

    const restoreA: BuildJobRequest = {
      ...isolatedA,
      name: "cache-isolated-a-restore",
      nodeName: thirdNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      cacheImport: ISOLATED_A_CACHE_REF,
      cacheExport: "",
    };
    const restoreB: BuildJobRequest = {
      ...isolatedB,
      name: "cache-isolated-b-restore",
      nodeName: firstNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      cacheImport: ISOLATED_B_CACHE_REF,
      cacheExport: "",
    };
    new CacheBuildSubmission(restoreA).start();
    new CacheBuildSubmission(restoreB).start();
    new ProveFinish({ job: restoreA, expectCached: true }).execute();
    new ProveFinish({ job: restoreB, expectCached: true }).execute();
  }
}

const MAIN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-main:buildcache`;
const ISOLATED_A_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-a:buildcache`;
const ISOLATED_B_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-b:buildcache`;
const FORBIDDEN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-forbidden:buildcache`;

interface FinishRequest {
  readonly job: BuildJobRequest;
  readonly expectCached: boolean;
}

class CacheRuntimeProof {
  private activeTemporaryDirectory = "";
  private activeClusterCreated = false;
  private signalCleanupStarted = false;
  signalCleanup(): void {
    if (this.signalCleanupStarted) return;
    this.signalCleanupStarted = true;
    new RuntimeCleanup({
      temporaryDirectory: this.activeTemporaryDirectory,
      clusterCreated: this.activeClusterCreated,
    }).execute();
    process.exit(130);
  }
  verifyPrerequisites(): void {
    for (const command of ["bun", "docker", K3D_BINARY, "kubectl"]) {
      new RuntimeRequireCommand(command).execute();
    }
    const version = new HostCommand({
      label: "verify pinned k3d version",
      command: [K3D_BINARY, "version"],
    }).run().stdout;
    new RequiredOutputText({
      content: version,
      expected: `k3d version ${K3D_VERSION}`,
      label: "k3d version",
    }).assertPresent();
    if (new SimulationCluster().clusterExists()) {
      throw new Error(
        "refusing to replace existing k3d cluster named nook-cache-proof",
      );
    }
  }
  runProof(): void {
    this.verifyPrerequisites();
    this.activeTemporaryDirectory = mkdtempSync(
      join(tmpdir(), "nook-kubernetes-cache-proof-"),
    );
    const kubeconfigPath = join(
      this.activeTemporaryDirectory,
      "kubeconfig.yaml",
    );

    new SimulationCluster().createCluster();
    this.activeClusterCreated = true;
    new RuntimeWriteKubeconfig(kubeconfigPath).execute();
    new SimulationCluster().prepareLocalStorage();
    const deployRequest: DeployPlatformRequest = {
      kubeconfigPath,
      adminPassword: generatePassword(),
      remotePassword: generatePassword(),
    };
    new CachePlatformDeployment(deployRequest).apply();
    new CachePlatformBoundary(kubeconfigPath).assert();

    const buildkitNodes = [0, 1, 2].map((index) =>
      new JobsPodNode({
        kubeconfigPath,
        podName: `nook-buildkit-${index}`,
      }).execute(),
    );
    if (new Set(buildkitNodes).size !== 3) {
      throw new Error(
        `BuildKit anti-affinity: expected 3 nodes, got ${buildkitNodes}`,
      );
    }
    if (typeof buildkitNodes[0] !== "string") {
      throw new Error("BuildKit node inventory has no first node");
    }
    new BuildkitShardAccessProof({
      kubeconfigPath,
      name: "cache-shard-allowed",
      nodeName: buildkitNodes[0],
    }).run();
    new CacheNetworkPolicyProof({
      kubeconfigPath,
      name: "cache-network-denied",
      nodeName: buildkitNodes[0],
    }).run();
    new ProveProveStableCache({ kubeconfigPath, buildkitNodes }).execute();
    new ProveProveIsolatedCache({ kubeconfigPath, buildkitNodes }).execute();
    console.log("kubernetes cache runtime proof passed");
  }
  execute(): void {
    process.on("SIGINT", () => this.signalCleanup());
    process.on("SIGTERM", () => this.signalCleanup());

    const proofErrors: Error[] = [];
    try {
      this.runProof();
    } catch (error) {
      proofErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      const cleanupRequest: CleanupRequest = {
        temporaryDirectory: this.activeTemporaryDirectory,
        clusterCreated: this.activeClusterCreated,
      };
      try {
        new RuntimeCleanup(cleanupRequest).execute();
        this.activeClusterCreated = false;
        this.activeTemporaryDirectory = "";
      } catch (error) {
        const cleanupError =
          error instanceof Error ? error : new Error(String(error));
        proofErrors.push(cleanupError);
      }
    }

    if (proofErrors.length > 0) {
      throw new Error(proofErrors.map((error) => error.message).join("\n"));
    }
  }
}
new CacheRuntimeProof().execute();
