import {randomUUID} from "node:crypto";
import {ADMIN_SECRET,ADMIN_USERNAME,BUILDKIT_IMAGE,REGISTRY_HOST,REMOTE_SECRET,REMOTE_USERNAME,REPOSITORY_ROOT,SIMULATION_DIRECTORY,KubernetesManifestApplication,RequiredOutputText,ForbiddenOutputText,HostCommand,KubectlCommand} from "./contracts";

class RegistryIdentityPassword {
  constructor(private readonly request: RegistryIdentity) {}
  hash(): string {
    const identity = this.request;

    const outcome = new HostCommand({
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
    }).run();
    const line = outcome.stdout.trim();
    new RequiredOutputText({
      content: line,
      expected: `${identity.username}:$2`,
      label: `bcrypt record for ${identity.username}`,
    }).assertPresent();
    return line;
  }
}

class RegistryIdentityConfig {
  constructor(private readonly request: RegistryIdentity) {}
  encode(): string {
    const identity = this.request;

    const auth = Buffer.from(
      `${identity.username}:${identity.password}`,
    ).toString("base64");
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
}

class RegistrySecretManifest {
  constructor(private readonly request: DeployPlatformRequest) {}
  render(): string {
    const request = this.request;

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
    const htpasswd = [
      new RegistryIdentityPassword(admin).hash(),
      new RegistryIdentityPassword(remote).hash(),
    ].join("\n");
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
  .dockerconfigjson: '${new RegistryIdentityConfig(admin).encode()}'
---
apiVersion: v1
kind: Secret
metadata:
  name: ${remote.secretName}
  namespace: arc-runners
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: '${new RegistryIdentityConfig(remote).encode()}'
`;
  }
}

export class CachePlatformDeployment {
  constructor(private readonly request: DeployPlatformRequest) {}
  apply(): void {
    const request = this.request;

    new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: "create production namespaces",
      command: ["apply", "-f", "infra/k0s/manifests/namespaces.yaml"],
      streamOutput: true,
    }).run();
    new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "create ephemeral registry credentials",
      yaml: new RegistrySecretManifest(request).render(),
    }).apply();
    new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "apply production-derived Zot and BuildKit workloads",
      yaml: renderProductionOverlay(),
    }).apply();
    for (const command of [
      ["-n", "hive-data", "rollout", "status", "deployment/nook-zot"],
      ["-n", "arc-runners", "rollout", "status", "statefulset/nook-buildkit"],
    ]) {
      const [workload = "workload"] = command.slice(-1);
      new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `wait for ${workload}`,
        command: [...command, "--timeout=300s"],
        streamOutput: true,
      }).run();
    }
  }
}

export class CachePlatformBoundary {
  constructor(private readonly request: string) {}
  assert(): void {
    const kubeconfigPath = this.request;

    const buildkit = new KubectlCommand({
      kubeconfigPath,
      label: "inspect simulated BuildKit StatefulSet",
      command: [
        "-n",
        "arc-runners",
        "get",
        "statefulset/nook-buildkit",
        "-o",
        "yaml",
      ],
    }).run().stdout;
    const zot = new KubectlCommand({
      kubeconfigPath,
      label: "inspect simulated Zot Deployment",
      command: ["-n", "hive-data", "get", "deployment/nook-zot", "-o", "yaml"],
    }).run().stdout;
    const zotConfig = new KubectlCommand({
      kubeconfigPath,
      label: "inspect simulated Zot configuration",
      command: ["-n", "hive-data", "get", "configmap/nook-zot", "-o", "yaml"],
    }).run().stdout;
    for (const expected of [
      "automountServiceAccountToken: false",
      "runAsNonRoot: true",
      "--oci-worker-no-process-sandbox",
      BUILDKIT_IMAGE,
    ]) {
      new RequiredOutputText({
        content: buildkit,
        expected,
        label: "simulated BuildKit boundary",
      }).assertPresent();
    }
    for (const expected of [
      "privileged: true",
      "/var/run/docker.sock",
      "/run/containerd/containerd.sock",
      "hostPath:",
    ]) {
      new ForbiddenOutputText({
        content: buildkit,
        expected,
        label: "simulated BuildKit boundary",
      }).assertAbsent();
    }
    for (const expected of [
      "automountServiceAccountToken: false",
      "runAsNonRoot: true",
      "allowPrivilegeEscalation: false",
      "readOnlyRootFilesystem: true",
    ]) {
      new RequiredOutputText({
        content: zot,
        expected,
        label: "simulated Zot boundary",
      }).assertPresent();
    }
    new RequiredOutputText({
      content: zotConfig,
      expected: "docker2s2",
      label: "simulated Zot configuration",
    }).assertPresent();
  }
}

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

function renderProductionOverlay(): string {
  const outcome = new HostCommand({
    label: "render production-derived Kubernetes overlay",
    command: [
      "kubectl",
      "kustomize",
      SIMULATION_DIRECTORY,
      "--load-restrictor=LoadRestrictionsNone",
    ],
    cwd: REPOSITORY_ROOT,
  }).run();
  const rendered = outcome.stdout
    .replaceAll("__NOOK_REGISTRY_USERNAME__", ADMIN_USERNAME)
    .replaceAll("__NOOK_REGISTRY_REMOTE_USERNAME__", REMOTE_USERNAME);
  for (const expected of [
    "__NOOK_REGISTRY_USERNAME__",
    "__NOOK_REGISTRY_REMOTE_USERNAME__",
  ]) {
    new ForbiddenOutputText({
      content: rendered,
      expected,
      label: "rendered Kubernetes overlay",
    }).assertAbsent();
  }
  return rendered;
}
