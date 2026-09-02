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
  assertContains,
  runCommand,
} from "./contracts";
import {
  type BuildJobRequest,
  type BuildJobResultRequest,
  finishBuildJob,
  podNode,
  proveBuildkitShardAccess,
  proveNetworkPolicy,
  restartBuildkitPod,
  restartZot,
  startBuildJob,
} from "./jobs";
import {
  type DeployPlatformRequest,
  assertRuntimeBoundaries,
  deployPlatform,
  generatePassword,
} from "./platform";
import {
  type CleanupRequest,
  cleanup,
  clusterExists,
  createCluster,
  prepareLocalStorage,
  requireCommand,
  writeKubeconfig,
} from "./runtime";

const MAIN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-main:buildcache`;
const ISOLATED_A_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-a:buildcache`;
const ISOLATED_B_CACHE_REF = `${REGISTRY_HOST}/nook/remote-buildcache/kubernetes-sim-b:buildcache`;
const FORBIDDEN_CACHE_REF = `${REGISTRY_HOST}/nook/buildcache/kubernetes-sim-forbidden:buildcache`;

let activeTemporaryDirectory = "";
let activeClusterCreated = false;
let signalCleanupStarted = false;

interface FinishRequest {
  readonly job: BuildJobRequest;
  readonly expectCached: boolean;
}

function finish(request: FinishRequest): string {
  const result: BuildJobResultRequest = {
    kubeconfigPath: request.job.kubeconfigPath,
    name: request.job.name,
    expectCached: request.expectCached,
  };
  return finishBuildJob(result);
}

function signalCleanup(): void {
  if (signalCleanupStarted) return;
  signalCleanupStarted = true;
  cleanup({
    temporaryDirectory: activeTemporaryDirectory,
    clusterCreated: activeClusterCreated,
  });
  process.exit(130);
}

function verifyPrerequisites(): void {
  for (const command of ["bun", "docker", K3D_BINARY, "kubectl"]) {
    requireCommand(command);
  }
  const version = runCommand({
    label: "verify pinned k3d version",
    command: [K3D_BINARY, "version"],
  }).stdout;
  assertContains({
    content: version,
    expected: `k3d version ${K3D_VERSION}`,
    label: "k3d version",
  });
  if (clusterExists()) {
    throw new Error("refusing to replace existing k3d cluster named nook-cache-proof");
  }
}

function proveStableCache(request: {
  readonly kubeconfigPath: string;
  readonly buildkitNodes: readonly string[];
}): void {
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
  startBuildJob(forbidden);
  assertContains({
    content: finish({ job: forbidden, expectCached: false }),
    expected: "registry-write-denied",
    label: "Zot stable-scope ACL proof",
  });

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
  startBuildJob(publish);
  finish({ job: publish, expectCached: false });

  const localReuse: BuildJobRequest = {
    ...publish,
    name: "cache-main-local-reuse",
    cacheExport: "",
  };
  startBuildJob(localReuse);
  finish({ job: localReuse, expectCached: true });

  restartBuildkitPod({
    kubeconfigPath: request.kubeconfigPath,
    podName: "nook-buildkit-0",
  });
  const restartReuse: BuildJobRequest = {
    ...publish,
    name: "cache-main-restart-reuse",
    cacheExport: "",
  };
  startBuildJob(restartReuse);
  finish({ job: restartReuse, expectCached: true });

  restartZot(request.kubeconfigPath);
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
  startBuildJob(freshShard);
  finish({ job: freshShard, expectCached: true });
}

function proveIsolatedCache(request: {
  readonly kubeconfigPath: string;
  readonly buildkitNodes: readonly string[];
}): void {
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
  startBuildJob(isolatedA);
  startBuildJob(isolatedB);
  finish({ job: isolatedA, expectCached: false });
  finish({ job: isolatedB, expectCached: false });

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
  startBuildJob(restoreA);
  startBuildJob(restoreB);
  finish({ job: restoreA, expectCached: true });
  finish({ job: restoreB, expectCached: true });
}

function runProof(): void {
  verifyPrerequisites();
  activeTemporaryDirectory = mkdtempSync(
    join(tmpdir(), "nook-kubernetes-cache-proof-"),
  );
  const kubeconfigPath = join(activeTemporaryDirectory, "kubeconfig.yaml");

  createCluster();
  activeClusterCreated = true;
  writeKubeconfig(kubeconfigPath);
  prepareLocalStorage();
  const deployRequest: DeployPlatformRequest = {
    kubeconfigPath,
    adminPassword: generatePassword(),
    remotePassword: generatePassword(),
  };
  deployPlatform(deployRequest);
  assertRuntimeBoundaries(kubeconfigPath);

  const buildkitNodes = [0, 1, 2].map((index) =>
    podNode({ kubeconfigPath, podName: `nook-buildkit-${index}` }),
  );
  if (new Set(buildkitNodes).size !== 3) {
    throw new Error(`BuildKit anti-affinity: expected 3 nodes, got ${buildkitNodes}`);
  }
  const [firstNode = ""] = buildkitNodes;
  proveBuildkitShardAccess({
    kubeconfigPath,
    name: "cache-shard-allowed",
    nodeName: firstNode,
  });
  proveNetworkPolicy({
    kubeconfigPath,
    name: "cache-network-denied",
    nodeName: firstNode,
  });
  proveStableCache({ kubeconfigPath, buildkitNodes });
  proveIsolatedCache({ kubeconfigPath, buildkitNodes });
  console.log("kubernetes cache runtime proof passed");
}

process.on("SIGINT", signalCleanup);
process.on("SIGTERM", signalCleanup);

const proofErrors: Error[] = [];
try {
  runProof();
} catch (error) {
  proofErrors.push(error instanceof Error ? error : new Error(String(error)));
} finally {
  const cleanupRequest: CleanupRequest = {
    temporaryDirectory: activeTemporaryDirectory,
    clusterCreated: activeClusterCreated,
  };
  try {
    cleanup(cleanupRequest);
    activeClusterCreated = false;
    activeTemporaryDirectory = "";
  } catch (error) {
    const cleanupError = error instanceof Error ? error : new Error(String(error));
    proofErrors.push(cleanupError);
  }
}

if (proofErrors.length > 0) {
  throw new Error(proofErrors.map((error) => error.message).join("\n"));
}
