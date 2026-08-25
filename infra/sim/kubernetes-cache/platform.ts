import { randomUUID } from "node:crypto";
import {
  ADMIN_SECRET,
  ADMIN_USERNAME,
  BUILDKIT_IMAGE,
  REGISTRY_HOST,
  REMOTE_SECRET,
  REMOTE_USERNAME,
  REPOSITORY_ROOT,
  SIMULATION_DIRECTORY,
  applyYaml,
  assertContains,
  assertExcludes,
  runCommand,
  runKubectl,
} from "./contracts";

const HTPASSWD_IMAGE =
  "docker.io/library/httpd:2.4-alpine@sha256:1b766f17b84026429b7cb243317b142921b24432336e798bc881c43f45ed9567";

interface RegistryIdentity {
  readonly username: string;
  readonly password: string;
  readonly secretName: string;
}

export interface DeployPlatformRequest {
  readonly kubeconfigPath: string;
  readonly adminPassword: string;
  readonly remotePassword: string;
}

export function generatePassword(): string {
  return randomUUID().replaceAll("-", "");
}

function generateHtpasswdLine(identity: RegistryIdentity): string {
  const outcome = runCommand({
    label: `generate bcrypt record for ${identity.username}`,
    command: [
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "htpasswd",
      HTPASSWD_IMAGE,
      "-nbB",
      identity.username,
      identity.password,
    ],
  });
  const line = outcome.stdout.trim();
  assertContains({
    content: line,
    expected: `${identity.username}:$2`,
    label: `bcrypt record for ${identity.username}`,
  });
  return line;
}

function dockerConfigJson(identity: RegistryIdentity): string {
  const auth = Buffer.from(`${identity.username}:${identity.password}`).toString(
    "base64",
  );
  return JSON.stringify({
    auths: {
      [REGISTRY_HOST]: {
        username: identity.username,
        password: identity.password,
        auth,
      },
    },
  });
}

function registrySecretsYaml(request: DeployPlatformRequest): string {
  const admin: RegistryIdentity = {
    username: ADMIN_USERNAME,
    password: request.adminPassword,
    secretName: ADMIN_SECRET,
  };
  const remote: RegistryIdentity = {
    username: REMOTE_USERNAME,
    password: request.remotePassword,
    secretName: REMOTE_SECRET,
  };
  const htpasswd = [generateHtpasswdLine(admin), generateHtpasswdLine(remote)].join(
    "\n",
  );
  return `apiVersion: v1
kind: Secret
metadata:
  name: nook-zot-htpasswd
  namespace: hive-data
type: Opaque
stringData:
  htpasswd: |-
${htpasswd
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
---
apiVersion: v1
kind: Secret
metadata:
  name: ${admin.secretName}
  namespace: arc-runners
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: '${dockerConfigJson(admin)}'
---
apiVersion: v1
kind: Secret
metadata:
  name: ${remote.secretName}
  namespace: arc-runners
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: '${dockerConfigJson(remote)}'
`;
}

function renderProductionOverlay(): string {
  const outcome = runCommand({
    label: "render production-derived Kubernetes overlay",
    command: [
      "kubectl",
      "kustomize",
      SIMULATION_DIRECTORY,
      "--load-restrictor=LoadRestrictionsNone",
    ],
    cwd: REPOSITORY_ROOT,
  });
  const rendered = outcome.stdout
    .replaceAll("__NOOK_REGISTRY_USERNAME__", ADMIN_USERNAME)
    .replaceAll("__NOOK_REGISTRY_REMOTE_USERNAME__", REMOTE_USERNAME);
  for (const expected of [
    "__NOOK_REGISTRY_USERNAME__",
    "__NOOK_REGISTRY_REMOTE_USERNAME__",
  ]) {
    assertExcludes({
      content: rendered,
      expected,
      label: "rendered Kubernetes overlay",
    });
  }
  return rendered;
}

export function deployPlatform(request: DeployPlatformRequest): void {
  runKubectl({
    kubeconfigPath: request.kubeconfigPath,
    label: "create production namespaces",
    command: ["apply", "-f", "infra/k0s/manifests/namespaces.yaml"],
    streamOutput: true,
  });
  applyYaml({
    kubeconfigPath: request.kubeconfigPath,
    label: "create ephemeral registry credentials",
    yaml: registrySecretsYaml(request),
  });
  applyYaml({
    kubeconfigPath: request.kubeconfigPath,
    label: "apply production-derived Zot and BuildKit workloads",
    yaml: renderProductionOverlay(),
  });
  for (const command of [
    ["-n", "hive-data", "rollout", "status", "deployment/nook-zot"],
    ["-n", "arc-runners", "rollout", "status", "statefulset/nook-buildkit"],
  ]) {
    runKubectl({
      kubeconfigPath: request.kubeconfigPath,
      label: `wait for ${command.at(-1) ?? "workload"}`,
      command: [...command, "--timeout=300s"],
      streamOutput: true,
    });
  }
}

export function assertRuntimeBoundaries(kubeconfigPath: string): void {
  const buildkit = runKubectl({
    kubeconfigPath,
    label: "inspect simulated BuildKit StatefulSet",
    command: ["-n", "arc-runners", "get", "statefulset/nook-buildkit", "-o", "yaml"],
  }).stdout;
  const zot = runKubectl({
    kubeconfigPath,
    label: "inspect simulated Zot Deployment",
    command: ["-n", "hive-data", "get", "deployment/nook-zot", "-o", "yaml"],
  }).stdout;
  const zotConfig = runKubectl({
    kubeconfigPath,
    label: "inspect simulated Zot configuration",
    command: ["-n", "hive-data", "get", "configmap/nook-zot", "-o", "yaml"],
  }).stdout;
  for (const expected of [
    "automountServiceAccountToken: false",
    "runAsNonRoot: true",
    "--oci-worker-no-process-sandbox",
    BUILDKIT_IMAGE,
  ]) {
    assertContains({ content: buildkit, expected, label: "simulated BuildKit boundary" });
  }
  for (const expected of [
    "privileged: true",
    "/var/run/docker.sock",
    "/run/containerd/containerd.sock",
    "hostPath:",
  ]) {
    assertExcludes({ content: buildkit, expected, label: "simulated BuildKit boundary" });
  }
  for (const expected of [
    "automountServiceAccountToken: false",
    "runAsNonRoot: true",
    "allowPrivilegeEscalation: false",
    "readOnlyRootFilesystem: true",
  ]) {
    assertContains({ content: zot, expected, label: "simulated Zot boundary" });
  }
  assertContains({
    content: zotConfig,
    expected: "docker2s2",
    label: "simulated Zot configuration",
  });
}
