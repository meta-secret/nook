import { CommandFailurePolicy, CommandOutputPolicy } from "./contracts";
import { err, ok, type Result } from "neverthrow";
import { CacheFailureKind, type CacheFailure } from "./contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILDKIT_IMAGE,
  BUILDKIT_ADDRESS,
  REGISTRY_HOST,
  SIMULATION_DIRECTORY,
  KubernetesManifestApplication,
  RequiredOutputText,
  HostCommand,
  KubectlCommand,
} from "./contracts";

export class JobsPodNode {
  constructor(private readonly request: PodNodeRequest) {}
  execute(): Result<string, CacheFailure> {
    const request = this.request;

    const nodeNameResult = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `read node for ${request.podName}`,
      command: [
        "-n",
        "arc-runners",
        "get",
        `pod/${request.podName}`,
        "-o",
        "jsonpath={.spec.nodeName}",
      ],
    }).run();
    if (nodeNameResult.isErr()) return err(nodeNameResult.error);
    const nodeName = nodeNameResult.value.stdout.trim();
    if (nodeName.length === 0)
      return err({
        kind: CacheFailureKind.Expectation,
        message: `${request.podName} has no node`,
      });
    return ok(nodeName);
  }
}

class JobsBuildCommandArguments {
  constructor(private readonly request: BuildJobRequest) {}
  execute(): readonly string[] {
    const request = this.request;

    const args = [
      "--addr",
      request.buildkitAddress,
      "build",
      "--progress=plain",
      "--frontend=dockerfile.v0",
      "--local",
      "context=/workspace",
      "--local",
      "dockerfile=/workspace",
      "--opt",
      `build-arg:BASE_IMAGE=${REGISTRY_HOST}/library/alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b`,
      "--opt",
      `build-arg:CACHE_PROOF_INPUT=${request.input}`,
    ];
    if (request.cacheImport.length > 0) {
      args.push("--import-cache", `type=registry,ref=${request.cacheImport}`);
    }
    if (request.cacheExport.length > 0) {
      args.push(
        "--export-cache",
        `type=registry,ref=${request.cacheExport},mode=max,image-manifest=true,oci-mediatypes=true`,
      );
    }
    return args;
  }
}

class JobsShellQuote {
  constructor(private readonly request: string) {}
  execute(): string {
    const value = this.request;

    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}

class CacheBuildJob {
  constructor(private readonly request: BuildJobRequest) {}
  manifest(): Result<string, CacheFailure> {
    const request = this.request;

    let dockerfile: string;
    try {
      dockerfile = readFileSync(
        join(SIMULATION_DIRECTORY, "proof.Dockerfile"),
        "utf8",
      ).trimEnd();
    } catch {
      return err({
        kind: CacheFailureKind.Filesystem,
        message: "Unable to read cache proof Dockerfile",
      });
    }
    const argumentsList = new JobsBuildCommandArguments(request).execute();
    const directArgs = argumentsList
      .map((argument) => `            - ${JSON.stringify(argument)}`)
      .join("\n");
    const shellCommand = ["buildctl", ...argumentsList]
      .map((value) => new JobsShellQuote(value).execute())
      .join(" ");
    const command =
      request.expectation === BuildCommandExpectation.Denied
        ? `          command: ["sh", "-euc"]
          args:
            - |-
              if ${shellCommand} >/tmp/buildctl.log 2>&1; then
                echo "unexpected registry write success" >&2
                exit 1
              fi
              cat /tmp/buildctl.log
              grep -Fq "exporting cache to registry" /tmp/buildctl.log
              grep -Eiq "denied|unauthorized|insufficient_scope|authorization failed" /tmp/buildctl.log
              echo "registry-write-denied"`
        : `          command: ["buildctl"]
          args:
${directArgs}`;
    return ok(`apiVersion: v1
kind: ConfigMap
metadata:
  name: ${request.name}-context
  namespace: arc-runners
data:
  Dockerfile: |-
${dockerfile
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${request.name}
  namespace: arc-runners
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 240
  template:
    metadata:
      labels:
        app.kubernetes.io/name: nook-cache-proof-client
        nook.nokey.sh/role: arc-buildkit-benchmark
    spec:
      nodeName: ${request.nodeName}
      restartPolicy: Never
      automountServiceAccountToken: false
      enableServiceLinks: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: buildctl
          image: ${BUILDKIT_IMAGE}
${command}
          env:
            - name: HOME
              value: /home/user
            - name: DOCKER_CONFIG
              value: /home/user/.docker
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: context
              mountPath: /workspace
              readOnly: true
            - name: docker-config
              mountPath: /home/user/.docker/config.json
              subPath: .dockerconfigjson
              readOnly: true
            - name: temporary
              mountPath: /tmp
      volumes:
        - name: context
          configMap:
            name: ${request.name}-context
        - name: docker-config
          secret:
            secretName: ${request.dockerConfigSecret}
        - name: temporary
          emptyDir:
            sizeLimit: 64Mi
`);
  }
}

export class CacheBuildSubmission {
  constructor(private readonly request: BuildJobRequest) {}
  start(): Result<void, CacheFailure> {
    const request = this.request;

    const manifest = new CacheBuildJob(request).manifest();
    if (manifest.isErr()) return err(manifest.error);
    return new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: `start build job ${request.name}`,
      yaml: manifest.value,
    }).apply();
  }
}

export class CacheBuildCompletion {
  constructor(private readonly request: BuildJobResultRequest) {}
  finish(): Result<string, CacheFailure> {
    const request = this.request;

    const completedResult = new KubernetesJobCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
    }).wait();
    if (completedResult.isErr()) return err(completedResult.error);
    const completed = completedResult.value;
    const logsResult = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `read build job ${request.name} logs`,
      command: ["-n", "arc-runners", "logs", `job/${request.name}`],
      failurePolicy: CommandFailurePolicy.ObserveExit,
    }).run();
    if (logsResult.isErr()) return err(logsResult.error);
    const logs = logsResult.value.stdout;
    process.stdout.write(`\n== ${request.name} ==\n${logs}`);
    if (completed !== JobCompletion.Completed) {
      const descriptionResult = new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `describe failed build job ${request.name}`,
        command: ["-n", "arc-runners", "describe", `job/${request.name}`],
        failurePolicy: CommandFailurePolicy.ObserveExit,
      }).run();
      if (descriptionResult.isErr()) return err(descriptionResult.error);
      const description = descriptionResult.value.stdout;
      return err({
        kind: CacheFailureKind.Expectation,
        message: `build job ${request.name} did not complete\n${logs}\n${description}`,
      });
    }
    if (request.cacheReuse === CacheReuseExpectation.Required) {
      const cacheReuse = new JobsAssertCacheStepDidNotExecute({
        logs,
        jobName: request.name,
      }).execute();
      if (cacheReuse.isErr()) return err(cacheReuse.error);
    }
    return ok(logs);
  }
}

class KubernetesJobCompletion {
  constructor(private readonly request: JobTerminalRequest) {}
  wait(): Result<JobCompletion, CacheFailure> {
    const request = this.request;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const conditionsResult = new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `read terminal state for build job ${request.name}`,
        command: [
          "-n",
          "arc-runners",
          "get",
          `job/${request.name}`,
          "-o",
          'jsonpath={range .status.conditions[?(@.status=="True")]}{.type}{"\\n"}{end}',
        ],
        failurePolicy: CommandFailurePolicy.ObserveExit,
      }).run();
      if (conditionsResult.isErr()) return err(conditionsResult.error);
      const conditions = conditionsResult.value.stdout;
      if (conditions.includes("Complete")) return ok(JobCompletion.Completed);
      if (conditions.includes("Failed")) return ok(JobCompletion.Failed);
      const terminalWait = new HostCommand({
        label: "wait for build job terminal state",
        command: ["sleep", "1"],
      }).run();
      if (terminalWait.isErr()) return err(terminalWait.error);
    }
    return ok(JobCompletion.TimedOut);
  }
}

class JobsAssertCacheStepDidNotExecute {
  constructor(
    private readonly request: {
      readonly logs: string;
      readonly jobName: string;
    },
  ) {}
  execute(): Result<void, CacheFailure> {
    const request = this.request;

    const markerPresent = new RequiredOutputText({
      content: request.logs,
      expected: "cache-proof-execution-marker",
      label: `build job ${request.jobName}`,
    }).assertPresent();
    if (markerPresent.isErr()) return err(markerPresent.error);
    const executionLine =
      /^#\d+\s+\d+(?:\.\d+)?\s+cache-proof-execution-marker$/m;
    if (executionLine.test(request.logs)) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `build job ${request.jobName}: cached RUN step executed`,
      });
    }
    return ok();
  }
}

class JobsShardAccessJobYaml {
  constructor(private readonly request: NetworkPolicyJobRequest) {}
  execute(): string {
    const request = this.request;

    return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${request.name}
  namespace: arc-runners
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 30
  template:
    metadata:
      labels:
        app.kubernetes.io/name: nook-cache-proof-client
        nook.nokey.sh/role: arc-buildkit-benchmark
    spec:
      nodeName: ${request.nodeName}
      restartPolicy: Never
      automountServiceAccountToken: false
      containers:
        - name: buildctl
          image: ${BUILDKIT_IMAGE}
          command: ["buildctl"]
          args: ["--addr", "${BUILDKIT_ADDRESS}", "debug", "workers"]
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
            seccompProfile:
              type: RuntimeDefault
`;
  }
}

export class BuildkitShardAccessProof {
  constructor(private readonly request: NetworkPolicyJobRequest) {}
  run(): Result<void, CacheFailure> {
    const request = this.request;

    const authorizedClient = new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "start authorized BuildKit shard client",
      yaml: new JobsShardAccessJobYaml(request).execute(),
    }).apply();
    if (authorizedClient.isErr()) return err(authorizedClient.error);
    const authorizedCompletion = new CacheBuildCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).finish();
    if (authorizedCompletion.isErr()) return err(authorizedCompletion.error);
    return ok();
  }
}

class JobsNetworkPolicyJobYaml {
  constructor(private readonly request: NetworkPolicyJobRequest) {}
  execute(): string {
    const request = this.request;

    return `apiVersion: batch/v1
kind: Job
metadata:
  name: ${request.name}
  namespace: arc-runners
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 30
  template:
    metadata:
      labels:
        app.kubernetes.io/name: nook-cache-proof-denied-client
    spec:
      nodeName: ${request.nodeName}
      restartPolicy: Never
      automountServiceAccountToken: false
      containers:
        - name: buildctl
          image: ${BUILDKIT_IMAGE}
          command: ["sh", "-euc"]
          args:
            - |-
              sleep 10
              if timeout 8 buildctl --addr ${BUILDKIT_ADDRESS} debug workers; then
                echo "unexpected BuildKit access" >&2
                exit 1
              fi
              echo "network-policy-denied"
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
            seccompProfile:
              type: RuntimeDefault
`;
  }
}

export class CacheNetworkPolicyProof {
  constructor(private readonly request: NetworkPolicyJobRequest) {}
  run(): Result<void, CacheFailure> {
    const request = this.request;

    const unauthorizedClient = new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "start unauthorized BuildKit client",
      yaml: new JobsNetworkPolicyJobYaml(request).execute(),
    }).apply();
    if (unauthorizedClient.isErr()) return err(unauthorizedClient.error);
    const logsResult = new CacheBuildCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
      cacheReuse: CacheReuseExpectation.Unspecified,
    }).finish();
    if (logsResult.isErr()) return err(logsResult.error);
    const logs = logsResult.value;
    const accessDenied = new RequiredOutputText({
      content: logs,
      expected: "network-policy-denied",
      label: "BuildKit NetworkPolicy proof",
    }).assertPresent();
    if (accessDenied.isErr()) return err(accessDenied.error);
    return ok();
  }
}

export class BuildkitPodRestart {
  constructor(private readonly request: PodNodeRequest) {}
  run(): Result<void, CacheFailure> {
    const request = this.request;

    const previousResult = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    if (previousResult.isErr()) return err(previousResult.error);
    const previous = previousResult.value;
    const deleted = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `restart ${request.podName}`,
      command: ["-n", "arc-runners", "delete", `pod/${request.podName}`],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (deleted.isErr()) return err(deleted.error);
    const created = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `wait for replacement ${request.podName}`,
      command: [
        "-n",
        "arc-runners",
        "wait",
        `pod/${request.podName}`,
        "--for=create",
        "--timeout=300s",
      ],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (created.isErr()) return err(created.error);
    const replacementResult = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    if (replacementResult.isErr()) return err(replacementResult.error);
    const replacement = replacementResult.value;
    if (replacement.uid === previous.uid) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `${request.podName} retained its UID after deletion`,
      });
    }
    const readyWait = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `wait for restarted ${request.podName}`,
      command: [
        "-n",
        "arc-runners",
        "wait",
        `pod/${request.podName}`,
        "--for=condition=Ready",
        "--timeout=300s",
      ],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (readyWait.isErr()) return err(readyWait.error);
    const readyResult = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    if (readyResult.isErr()) return err(readyResult.error);
    const ready = readyResult.value;
    if (ready.uid !== replacement.uid) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `${request.podName} changed UID while waiting for readiness`,
      });
    }
    return ok();
  }
}

export class RegistryRestart {
  constructor(private readonly request: string) {}
  run(): Result<void, CacheFailure> {
    const kubeconfigPath = this.request;

    const previousResult = new JobsLabeledPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      labelSelector: "app.kubernetes.io/name=nook-zot",
      previousUid: "",
    }).execute();
    if (previousResult.isErr()) return err(previousResult.error);
    const previous = previousResult.value;
    const deleted = new KubectlCommand({
      kubeconfigPath,
      label: "restart Zot pod",
      command: ["-n", "hive-data", "delete", `pod/${previous.name}`],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (deleted.isErr()) return err(deleted.error);
    const replacementResult = new JobsLabeledPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      labelSelector: "app.kubernetes.io/name=nook-zot",
      previousUid: previous.uid,
    }).execute();
    if (replacementResult.isErr()) return err(replacementResult.error);
    const replacement = replacementResult.value;
    const readyWait = new KubectlCommand({
      kubeconfigPath,
      label: "wait for restarted Zot",
      command: [
        "-n",
        "hive-data",
        "wait",
        `pod/${replacement.name}`,
        "--for=condition=Ready",
        "--timeout=300s",
      ],
      output: CommandOutputPolicy.Streamed,
    }).run();
    if (readyWait.isErr()) return err(readyWait.error);
    const readyResult = new JobsPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      podName: replacement.name,
    }).execute();
    if (readyResult.isErr()) return err(readyResult.error);
    const ready = readyResult.value;
    if (ready.uid !== replacement.uid) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: "Zot changed UID while waiting for readiness",
      });
    }
    return ok();
  }
}

class JobsPodIdentity {
  constructor(private readonly request: PodIdentityRequest) {}
  execute(): Result<PodIdentity, CacheFailure> {
    const request = this.request;

    const outputResult = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `read identity for ${request.podName}`,
      command: [
        "-n",
        request.namespace,
        "get",
        `pod/${request.podName}`,
        "-o",
        "jsonpath={.metadata.name} {.metadata.uid}",
      ],
    }).run();
    if (outputResult.isErr()) return err(outputResult.error);
    const output = outputResult.value.stdout.trim();
    const [name = "", uid = ""] = output.split(" ");
    if (name.length === 0 || uid.length === 0) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `pod identity is incomplete: ${output}`,
      });
    }
    return ok({ name, uid });
  }
}

class JobsLabeledPodIdentity {
  constructor(private readonly request: ReplacementPodRequest) {}
  execute(): Result<PodIdentity, CacheFailure> {
    const request = this.request;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const outcomeResult = new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `find replacement Pod for ${request.labelSelector}`,
        command: [
          "-n",
          request.namespace,
          "get",
          "pods",
          "-l",
          request.labelSelector,
          "-o",
          "jsonpath={range .items[*]}{.metadata.name} {.metadata.uid}{'\\n'}{end}",
        ],
        failurePolicy: CommandFailurePolicy.ObserveExit,
      }).run();
      if (outcomeResult.isErr()) return err(outcomeResult.error);
      const outcome = outcomeResult.value;
      for (const line of outcome.stdout.trim().split("\n")) {
        const [name = "", uid = ""] = line.trim().split(" ");
        if (name.length > 0 && uid.length > 0 && uid !== request.previousUid) {
          return ok({ name, uid });
        }
      }
      const replacementWait = new HostCommand({
        label: "wait for replacement Pod",
        command: ["sleep", "1"],
      }).run();
      if (replacementWait.isErr()) return err(replacementWait.error);
    }
    return err({
      kind: CacheFailureKind.Expectation,
      message: `replacement Pod did not appear for ${request.labelSelector}`,
    });
  }
}

export interface BuildJobRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly nodeName: string;
  readonly buildkitAddress: string;
  readonly input: string;
  readonly dockerConfigSecret: string;
  readonly cacheImport: string;
  readonly cacheExport: string;
  readonly expectation: BuildCommandExpectation;
}

export interface BuildJobResultRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly cacheReuse: CacheReuseExpectation;
}

interface JobTerminalRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
}

export interface PodNodeRequest {
  readonly kubeconfigPath: string;
  readonly podName: string;
}

interface NetworkPolicyJobRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly nodeName: string;
}

interface PodIdentity {
  readonly name: string;
  readonly uid: string;
}

interface PodIdentityRequest {
  readonly kubeconfigPath: string;
  readonly namespace: string;
  readonly podName: string;
}

interface ReplacementPodRequest {
  readonly kubeconfigPath: string;
  readonly namespace: string;
  readonly labelSelector: string;
  readonly previousUid: string;
}

enum JobCompletion {
  Completed = "completed",
  Failed = "failed",
  TimedOut = "timed-out",
}
export enum BuildCommandExpectation {
  Success = "success",
  Denied = "denied",
}
export enum CacheReuseExpectation {
  Unspecified = "unspecified",
  Required = "required",
}
