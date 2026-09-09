import { BuildCommandExpectation, CacheReuseExpectation } from "./jobs";
import { err, ok, type Result } from "neverthrow";
import { CacheFailureKind, type CacheFailure } from "./contracts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADMIN_SECRET,
  K3D_BINARY,
  K3D_VERSION,
  BUILDKIT_ADDRESS,
  REGISTRY_HOST,
  REMOTE_SECRET,
  RequiredOutputText,
  HostCommand,
} from "./contracts";
import {
  type BuildJobRequest,
  type BuildJobResultRequest,
  CacheBuildCompletion,
  JobsPodNode,
  BuildkitShardAccessProof,
  CacheNetworkPolicyProof,
  BuildkitPodRestart,
  RegistryRestart,
  CacheBuildSubmission,
} from "./jobs";
import {
  type DeployPlatformRequest,
  CachePlatformBoundary,
  CachePlatformDeployment,
  RegistryProofCredentials,
} from "./platform";
import {
  SimulationCluster,
  ClusterPresence,
  ClusterOwnership,
  TemporaryWorkspaceKind,
  type TemporaryWorkspace,
  RuntimeCleanup,
  RuntimeRequireCommand,
  RuntimeWriteKubeconfig,
} from "./runtime";

class ProveFinish {
  constructor(private readonly request: FinishRequest) {}
  execute(): Result<string, CacheFailure> {
    const request = this.request;

    const result: BuildJobResultRequest = {
      kubeconfigPath: request.job.kubeconfigPath,
      name: request.job.name,
      cacheReuse: request.cacheReuse,
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
  execute(): Result<void, CacheFailure> {
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
      expectation: BuildCommandExpectation.Denied,
    };
    const deniedSubmitted = new CacheBuildSubmission(forbidden).start();
    if (deniedSubmitted.isErr()) return err(deniedSubmitted.error);
    const denied = new ProveFinish({
      job: forbidden,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).execute();
    if (denied.isErr()) return err(denied.error);
    const denialObserved = new RequiredOutputText({
      content: denied.value,
      expected: "registry-write-denied",
      label: "Zot stable-scope ACL proof",
    }).assertPresent();
    if (denialObserved.isErr()) return err(denialObserved.error);

    const publish: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-main-publish",
      nodeName: firstNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "main-cache-input",
      dockerConfigSecret: ADMIN_SECRET,
      cacheImport: "",
      cacheExport: MAIN_CACHE_REF,
      expectation: BuildCommandExpectation.Success,
    };
    const publishSubmitted = new CacheBuildSubmission(publish).start();
    if (publishSubmitted.isErr()) return err(publishSubmitted.error);
    const publishCompleted = new ProveFinish({
      job: publish,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).execute();
    if (publishCompleted.isErr()) return err(publishCompleted.error);

    const localReuse: BuildJobRequest = {
      ...publish,
      name: "cache-main-local-reuse",
      cacheExport: "",
    };
    const localSubmitted = new CacheBuildSubmission(localReuse).start();
    if (localSubmitted.isErr()) return err(localSubmitted.error);
    const localCompleted = new ProveFinish({
      job: localReuse,
      cacheReuse: CacheReuseExpectation.Required,
    }).execute();
    if (localCompleted.isErr()) return err(localCompleted.error);

    const buildkitRestarted = new BuildkitPodRestart({
      kubeconfigPath: request.kubeconfigPath,
      podName: "nook-buildkit-0",
    }).run();
    if (buildkitRestarted.isErr()) return err(buildkitRestarted.error);
    const restartReuse: BuildJobRequest = {
      ...publish,
      name: "cache-main-restart-reuse",
      cacheExport: "",
    };
    const restartSubmitted = new CacheBuildSubmission(restartReuse).start();
    if (restartSubmitted.isErr()) return err(restartSubmitted.error);
    const restartCompleted = new ProveFinish({
      job: restartReuse,
      cacheReuse: CacheReuseExpectation.Required,
    }).execute();
    if (restartCompleted.isErr()) return err(restartCompleted.error);

    const registryRestarted = new RegistryRestart(request.kubeconfigPath).run();
    if (registryRestarted.isErr()) return err(registryRestarted.error);
    const freshShard: BuildJobRequest = {
      kubeconfigPath: request.kubeconfigPath,
      name: "cache-main-fresh-shard",
      nodeName: secondNode,
      buildkitAddress: BUILDKIT_ADDRESS,
      input: "main-cache-input",
      dockerConfigSecret: REMOTE_SECRET,
      cacheImport: MAIN_CACHE_REF,
      cacheExport: "",
      expectation: BuildCommandExpectation.Success,
    };
    const freshSubmitted = new CacheBuildSubmission(freshShard).start();
    if (freshSubmitted.isErr()) return err(freshSubmitted.error);
    const freshCompleted = new ProveFinish({
      job: freshShard,
      cacheReuse: CacheReuseExpectation.Required,
    }).execute();
    if (freshCompleted.isErr()) return err(freshCompleted.error);
    return ok();
  }
}

class ProveProveIsolatedCache {
  constructor(
    private readonly request: {
      readonly kubeconfigPath: string;
      readonly buildkitNodes: readonly string[];
    },
  ) {}
  execute(): Result<void, CacheFailure> {
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
      expectation: BuildCommandExpectation.Success,
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
      expectation: BuildCommandExpectation.Success,
    };
    const aSubmitted = new CacheBuildSubmission(isolatedA).start();
    if (aSubmitted.isErr()) return err(aSubmitted.error);
    const bSubmitted = new CacheBuildSubmission(isolatedB).start();
    if (bSubmitted.isErr()) return err(bSubmitted.error);
    const aCompleted = new ProveFinish({
      job: isolatedA,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).execute();
    if (aCompleted.isErr()) return err(aCompleted.error);
    const bCompleted = new ProveFinish({
      job: isolatedB,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).execute();
    if (bCompleted.isErr()) return err(bCompleted.error);

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
    const aRestored = new CacheBuildSubmission(restoreA).start();
    if (aRestored.isErr()) return err(aRestored.error);
    const bRestored = new CacheBuildSubmission(restoreB).start();
    if (bRestored.isErr()) return err(bRestored.error);
    const aReused = new ProveFinish({
      job: restoreA,
      cacheReuse: CacheReuseExpectation.Required,
    }).execute();
    if (aReused.isErr()) return err(aReused.error);
    const bReused = new ProveFinish({
      job: restoreB,
      cacheReuse: CacheReuseExpectation.Required,
    }).execute();
    if (bReused.isErr()) return err(bReused.error);
    return ok();
  }
}

const MAIN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-main:buildcache`;
const ISOLATED_A_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-a:buildcache`;
const ISOLATED_B_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-b:buildcache`;
const FORBIDDEN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-forbidden:buildcache`;

interface FinishRequest {
  readonly job: BuildJobRequest;
  readonly cacheReuse: CacheReuseExpectation;
}

enum ProofSignalState {
  Listening = "listening",
  Cleaning = "cleaning",
}
class CacheRuntimeProof {
  private workspace: TemporaryWorkspace = {
    kind: TemporaryWorkspaceKind.Absent,
  };
  private cluster = ClusterOwnership.Unowned;
  private signalState = ProofSignalState.Listening;
  signalCleanup(): void {
    if (this.signalState === ProofSignalState.Cleaning) return;
    this.signalState = ProofSignalState.Cleaning;
    const cleanup = new RuntimeCleanup({
      workspace: this.workspace,
      cluster: this.cluster,
    }).execute();
    if (cleanup.isErr())
      console.error(cleanup.error.map((failure) => failure.message).join("\n"));
    process.exit(130);
  }
  verifyPrerequisites(): Result<void, CacheFailure> {
    for (const command of ["bun", "docker", K3D_BINARY, "kubectl"]) {
      const admitted = new RuntimeRequireCommand(command).execute();
      if (admitted.isErr()) return err(admitted.error);
    }
    const version = new HostCommand({
      label: "verify pinned k3d version",
      command: [K3D_BINARY, "version"],
    }).run();
    if (version.isErr()) return err(version.error);
    const pinned = new RequiredOutputText({
      content: version.value.stdout,
      expected: `k3d version ${K3D_VERSION}`,
      label: "k3d version",
    }).assertPresent();
    if (pinned.isErr()) return err(pinned.error);
    const presence = new SimulationCluster().clusterExists();
    if (presence.isErr()) return err(presence.error);
    if (presence.value === ClusterPresence.Present)
      return err({
        kind: CacheFailureKind.Expectation,
        message:
          "refusing to replace existing k3d cluster named nook-cache-proof",
      });
    return ok();
  }
  private createWorkspace(): Result<string, CacheFailure> {
    try {
      return ok(mkdtempSync(join(tmpdir(), "nook-kubernetes-cache-proof-")));
    } catch {
      return err({
        kind: CacheFailureKind.Filesystem,
        message: "Unable to create Kubernetes cache proof workspace",
      });
    }
  }
  runProof(): Result<void, CacheFailure> {
    const prerequisites = this.verifyPrerequisites();
    if (prerequisites.isErr()) return err(prerequisites.error);
    const workspace = this.createWorkspace();
    if (workspace.isErr()) return err(workspace.error);
    this.workspace = {
      kind: TemporaryWorkspaceKind.Created,
      path: workspace.value,
    };
    const kubeconfigPath = join(workspace.value, "kubeconfig.yaml");
    const created = new SimulationCluster().createCluster();
    if (created.isErr()) return err(created.error);
    this.cluster = ClusterOwnership.Created;
    const configured = new RuntimeWriteKubeconfig(kubeconfigPath).execute();
    if (configured.isErr()) return err(configured.error);
    const storage = new SimulationCluster().prepareLocalStorage();
    if (storage.isErr()) return err(storage.error);
    const credentials = new RegistryProofCredentials();
    const adminPassword = credentials.generatePassword();
    if (adminPassword.isErr()) return err(adminPassword.error);
    const remotePassword = credentials.generatePassword();
    if (remotePassword.isErr()) return err(remotePassword.error);
    const deployRequest: DeployPlatformRequest = {
      kubeconfigPath,
      adminPassword: adminPassword.value,
      remotePassword: remotePassword.value,
    };
    const deployed = new CachePlatformDeployment(deployRequest).apply();
    if (deployed.isErr()) return err(deployed.error);
    const boundary = new CachePlatformBoundary(kubeconfigPath).assert();
    if (boundary.isErr()) return err(boundary.error);
    const buildkitNodes: string[] = [];
    for (const index of [0, 1, 2]) {
      const node = new JobsPodNode({
        kubeconfigPath,
        podName: `nook-buildkit-${index}`,
      }).execute();
      if (node.isErr()) return err(node.error);
      buildkitNodes.push(node.value);
    }
    if (new Set(buildkitNodes).size !== 3)
      return err({
        kind: CacheFailureKind.Identity,
        message: `BuildKit anti-affinity: expected 3 nodes, got ${buildkitNodes}`,
      });
    const [firstNode] = buildkitNodes;
    if (typeof firstNode !== "string")
      return err({
        kind: CacheFailureKind.Identity,
        message: "BuildKit node inventory has no first node",
      });
    const access = new BuildkitShardAccessProof({
      kubeconfigPath,
      name: "cache-shard-allowed",
      nodeName: firstNode,
    }).run();
    if (access.isErr()) return err(access.error);
    const isolation = new CacheNetworkPolicyProof({
      kubeconfigPath,
      name: "cache-network-denied",
      nodeName: firstNode,
    }).run();
    if (isolation.isErr()) return err(isolation.error);
    const stable = new ProveProveStableCache({
      kubeconfigPath,
      buildkitNodes,
    }).execute();
    if (stable.isErr()) return err(stable.error);
    const isolated = new ProveProveIsolatedCache({
      kubeconfigPath,
      buildkitNodes,
    }).execute();
    if (isolated.isErr()) return err(isolated.error);
    console.log("kubernetes cache runtime proof passed");
    return ok();
  }
  execute(): Result<void, readonly CacheFailure[]> {
    const cleanupOnSignal = this.signalCleanup.bind(this);
    process.on("SIGINT", cleanupOnSignal);
    process.on("SIGTERM", cleanupOnSignal);
    const proof = this.runProof();
    const cleanup = new RuntimeCleanup({
      workspace: this.workspace,
      cluster: this.cluster,
    }).execute();
    if (cleanup.isOk()) {
      this.workspace = { kind: TemporaryWorkspaceKind.Absent };
      this.cluster = ClusterOwnership.Unowned;
    }
    process.off("SIGINT", cleanupOnSignal);
    process.off("SIGTERM", cleanupOnSignal);
    const failures: CacheFailure[] = [];
    if (proof.isErr()) failures.push(proof.error);
    if (cleanup.isErr()) failures.push(...cleanup.error);
    return failures.length > 0 ? err(failures) : ok();
  }
}
const outcome = new CacheRuntimeProof().execute();
if (outcome.isErr()) {
  console.error(outcome.error.map((failure) => failure.message).join("\n"));
  process.exitCode = 1;
}
