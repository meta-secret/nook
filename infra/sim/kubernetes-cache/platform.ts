import { CommandOutputPolicy } from "./contracts";
import { err, ok, type Result } from "neverthrow";
import { CacheFailureKind, type CacheFailure } from "./contracts";
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
  KubernetesManifestApplication,
  RequiredOutputText,
  ForbiddenOutputText,
  HostCommand,
  KubectlCommand,
} from "./contracts";

class RegistryIdentityPassword {
  constructor(private readonly request: RegistryIdentity) {}
  hash(): Result<string, CacheFailure> {
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
    if (outcome.isErr()) return err(outcome.error);
    const line = outcome.value.stdout.trim();
    const bcrypt = new RequiredOutputText({
      content: line,
      expected: `${identity.username}:$2`,
      label: `bcrypt record for ${identity.username}`,
    }).assertPresent();
    if (bcrypt.isErr()) return err(bcrypt.error);
    return ok(line);
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
  render(): Result<string, CacheFailure> {
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
    const adminHash = new RegistryIdentityPassword(admin).hash();
    if (adminHash.isErr()) return err(adminHash.error);
    const remoteHash = new RegistryIdentityPassword(remote).hash();
    if (remoteHash.isErr()) return err(remoteHash.error);
    const htpasswd = [adminHash.value, remoteHash.value].join("\n");
    return ok(`apiVersion: v1
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
`);
  }
}

export class CachePlatformDeployment {
  constructor(private readonly request: DeployPlatformRequest) {}
  apply(): Result<void, CacheFailure> {
    const request = this.request;

    const namespaces = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: "create production namespaces",
      command: ["apply", "-f", "infra/k0s/manifests/namespaces.yaml"],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (namespaces.isErr()) return err(namespaces.error);
    const secrets = new RegistrySecretManifest(request).render();
    if (secrets.isErr()) return err(secrets.error);
    const secretApplication = new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "create ephemeral registry credentials",
      yaml: secrets.value,
    }).apply();
    if (secretApplication.isErr()) return err(secretApplication.error);
    const overlay = new ProductionCacheOverlay().render();
    if (overlay.isErr()) return err(overlay.error);
    const applied = new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "apply production-derived Zot and BuildKit workloads",
      yaml: overlay.value,
    }).apply();
    if (applied.isErr()) return err(applied.error);
    for (const command of [
      ["-n", "hive-data", "rollout", "status", "deployment/nook-zot"],
      ["-n", "arc-runners", "rollout", "status", "statefulset/nook-buildkit"],
    ]) {
      const [workload = "workload"] = command.slice(-1);
      const rollout = new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `wait for ${workload}`,
        command: [...command, "--timeout=300s"],
        output: CommandOutputPolicy.Streamed,
      }).run();
      if (rollout.isErr()) return err(rollout.error);
    }
    return ok();
  }
}

export class CachePlatformBoundary {
  constructor(private readonly request: string) {}
  assert(): Result<void, CacheFailure> {
    const kubeconfigPath = this.request;

    const buildkitResult = new KubectlCommand({
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
    }).run();
    if (buildkitResult.isErr()) return err(buildkitResult.error);
    const buildkit = buildkitResult.value.stdout;
    const zotResult = new KubectlCommand({
      kubeconfigPath,
      label: "inspect simulated Zot Deployment",
      command: ["-n", "hive-data", "get", "deployment/nook-zot", "-o", "yaml"],
    }).run();
    if (zotResult.isErr()) return err(zotResult.error);
    const zot = zotResult.value.stdout;
    const zotConfigResult = new KubectlCommand({
      kubeconfigPath,
      label: "inspect simulated Zot configuration",
      command: ["-n", "hive-data", "get", "configmap/nook-zot", "-o", "yaml"],
    }).run();
    if (zotConfigResult.isErr()) return err(zotConfigResult.error);
    const zotConfig = zotConfigResult.value.stdout;
    for (const expected of [
      "automountServiceAccountToken: false",
      "runAsNonRoot: true",
      "--oci-worker-no-process-sandbox",
      BUILDKIT_IMAGE,
    ]) {
      const requiredBuildkitControl = new RequiredOutputText({
        content: buildkit,
        expected,
        label: "simulated BuildKit boundary",
      }).assertPresent();
      if (requiredBuildkitControl.isErr())
        return err(requiredBuildkitControl.error);
    }
    for (const expected of [
      "privileged: true",
      "/var/run/docker.sock",
      "/run/containerd/containerd.sock",
      "hostPath:",
    ]) {
      const forbiddenBuildkitControl = new ForbiddenOutputText({
        content: buildkit,
        expected,
        label: "simulated BuildKit boundary",
      }).assertAbsent();
      if (forbiddenBuildkitControl.isErr())
        return err(forbiddenBuildkitControl.error);
    }
    for (const expected of [
      "automountServiceAccountToken: false",
      "runAsNonRoot: true",
      "allowPrivilegeEscalation: false",
      "readOnlyRootFilesystem: true",
    ]) {
      const requiredRegistryControl = new RequiredOutputText({
        content: zot,
        expected,
        label: "simulated Zot boundary",
      }).assertPresent();
      if (requiredRegistryControl.isErr())
        return err(requiredRegistryControl.error);
    }
    const registryFormat = new RequiredOutputText({
      content: zotConfig,
      expected: "docker2s2",
      label: "simulated Zot configuration",
    }).assertPresent();
    if (registryFormat.isErr()) return err(registryFormat.error);
    return ok();
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

export class RegistryProofCredentials {
  generatePassword(): Result<string, CacheFailure> {
    try {
      return ok(randomUUID().replaceAll("-", ""));
    } catch {
      return err({
        kind: CacheFailureKind.Command,
        message: "Unable to create ephemeral registry credential",
      });
    }
  }
}

class ProductionCacheOverlay {
  render(): Result<string, CacheFailure> {
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
    if (outcome.isErr()) return err(outcome.error);
    const rendered = outcome.value.stdout
      .replaceAll("__NOOK_REGISTRY_USERNAME__", ADMIN_USERNAME)
      .replaceAll("__NOOK_REGISTRY_REMOTE_USERNAME__", REMOTE_USERNAME);
    for (const expected of [
      "__NOOK_REGISTRY_USERNAME__",
      "__NOOK_REGISTRY_REMOTE_USERNAME__",
    ]) {
      const unresolvedPlaceholder = new ForbiddenOutputText({
        content: rendered,
        expected,
        label: "rendered Kubernetes overlay",
      }).assertAbsent();
      if (unresolvedPlaceholder.isErr())
        return err(unresolvedPlaceholder.error);
    }
    return ok(rendered);
  }
}
