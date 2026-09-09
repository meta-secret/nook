import {readFileSync} from "node:fs";
import {join} from "node:path";
import {BUILDKIT_IMAGE,BUILDKIT_ADDRESS,REGISTRY_HOST,SIMULATION_DIRECTORY,KubernetesManifestApplication,RequiredOutputText,HostCommand,KubectlCommand} from "./contracts";

export class JobsPodNode {
  constructor(private readonly request: PodNodeRequest) {}
  execute(): string {
    const request = this.request;

    const nodeName = new KubectlCommand({
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
    })
      .run()
      .stdout.trim();
    if (nodeName.length === 0)
      throw new Error(`${request.podName} has no node`);
    return nodeName;
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
  manifest(): string {
    const request = this.request;

    const argumentsList = new JobsBuildCommandArguments(request).execute();
    const directArgs = argumentsList
      .map((argument) => `            - ${JSON.stringify(argument)}`)
      .join("\n");
    const shellCommand = ["buildctl", ...argumentsList]
      .map((value) => new JobsShellQuote(value).execute())
      .join(" ");
    const command = request.expectCommandFailure
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
    return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${request.name}-context
  namespace: arc-runners
data:
  Dockerfile: |-
${PROOF_DOCKERFILE.split("\n")
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
`;
  }
}

export class CacheBuildSubmission {
  constructor(private readonly request: BuildJobRequest) {}
  start(): void {
    const request = this.request;

    new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: `start build job ${request.name}`,
      yaml: new CacheBuildJob(request).manifest(),
    }).apply();
  }
}

export class CacheBuildCompletion {
  constructor(private readonly request: BuildJobResultRequest) {}
  finish(): string {
    const request = this.request;

    const completed = new KubernetesJobCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
    }).wait();
    const logs = new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `read build job ${request.name} logs`,
      command: ["-n", "arc-runners", "logs", `job/${request.name}`],
      allowFailure: true,
    }).run().stdout;
    process.stdout.write(`\n== ${request.name} ==\n${logs}`);
    if (!completed) {
      const description = new KubectlCommand({
        kubeconfigPath: request.kubeconfigPath,
        label: `describe failed build job ${request.name}`,
        command: ["-n", "arc-runners", "describe", `job/${request.name}`],
        allowFailure: true,
      }).run().stdout;
      throw new Error(
        `build job ${request.name} did not complete\n${logs}\n${description}`,
      );
    }
    if (request.expectCached) {
      new JobsAssertCacheStepDidNotExecute({
        logs,
        jobName: request.name,
      }).execute();
    }
    return logs;
  }
}

class KubernetesJobCompletion {
  constructor(private readonly request: JobTerminalRequest) {}
  wait(): boolean {
    const request = this.request;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const conditions = new KubectlCommand({
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
        allowFailure: true,
      }).run().stdout;
      if (conditions.includes("Complete")) return true;
      if (conditions.includes("Failed")) return false;
      new HostCommand({
        label: "wait for build job terminal state",
        command: ["sleep", "1"],
      }).run();
    }
    return false;
  }
}

class JobsAssertCacheStepDidNotExecute {
  constructor(
    private readonly request: {
      readonly logs: string;
      readonly jobName: string;
    },
  ) {}
  execute(): void {
    const request = this.request;

    new RequiredOutputText({
      content: request.logs,
      expected: "cache-proof-execution-marker",
      label: `build job ${request.jobName}`,
    }).assertPresent();
    const executionLine =
      /^#\d+\s+\d+(?:\.\d+)?\s+cache-proof-execution-marker$/m;
    if (executionLine.test(request.logs)) {
      throw new Error(`build job ${request.jobName}: cached RUN step executed`);
    }
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
  run(): void {
    const request = this.request;

    new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "start authorized BuildKit shard client",
      yaml: new JobsShardAccessJobYaml(request).execute(),
    }).apply();
    new CacheBuildCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
      expectCached: false,
    }).finish();
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
  run(): void {
    const request = this.request;

    new KubernetesManifestApplication({
      kubeconfigPath: request.kubeconfigPath,
      label: "start unauthorized BuildKit client",
      yaml: new JobsNetworkPolicyJobYaml(request).execute(),
    }).apply();
    const logs = new CacheBuildCompletion({
      kubeconfigPath: request.kubeconfigPath,
      name: request.name,
      expectCached: false,
    }).finish();
    new RequiredOutputText({
      content: logs,
      expected: "network-policy-denied",
      label: "BuildKit NetworkPolicy proof",
    }).assertPresent();
  }
}

export class BuildkitPodRestart {
  constructor(private readonly request: PodNodeRequest) {}
  run(): void {
    const request = this.request;

    const previous = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: `restart ${request.podName}`,
      command: ["-n", "arc-runners", "delete", `pod/${request.podName}`],
      streamOutput: true,
    }).run();
    new KubectlCommand({
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
      streamOutput: true,
    }).run();
    const replacement = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    if (replacement.uid === previous.uid) {
      throw new Error(`${request.podName} retained its UID after deletion`);
    }
    new KubectlCommand({
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
      streamOutput: true,
    }).run();
    const ready = new JobsPodIdentity({
      kubeconfigPath: request.kubeconfigPath,
      namespace: "arc-runners",
      podName: request.podName,
    }).execute();
    if (ready.uid !== replacement.uid) {
      throw new Error(
        `${request.podName} changed UID while waiting for readiness`,
      );
    }
  }
}

export class RegistryRestart {
  constructor(private readonly request: string) {}
  run(): void {
    const kubeconfigPath = this.request;

    const previous = new JobsLabeledPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      labelSelector: "app.kubernetes.io/name=nook-zot",
      previousUid: "",
    }).execute();
    new KubectlCommand({
      kubeconfigPath,
      label: "restart Zot pod",
      command: ["-n", "hive-data", "delete", `pod/${previous.name}`],
      streamOutput: true,
    }).run();
    const replacement = new JobsLabeledPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      labelSelector: "app.kubernetes.io/name=nook-zot",
      previousUid: previous.uid,
    }).execute();
    new KubectlCommand({
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
      streamOutput: true,
    }).run();
    const ready = new JobsPodIdentity({
      kubeconfigPath,
      namespace: "hive-data",
      podName: replacement.name,
    }).execute();
    if (ready.uid !== replacement.uid) {
      throw new Error("Zot changed UID while waiting for readiness");
    }
  }
}

class JobsPodIdentity {
  constructor(private readonly request: PodIdentityRequest) {}
  execute(): PodIdentity {
    const request = this.request;

    const output = new KubectlCommand({
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
    })
      .run()
      .stdout.trim();
    const [name = "", uid = ""] = output.split(" ");
    if (name.length === 0 || uid.length === 0) {
      throw new Error(`pod identity is incomplete: ${output}`);
    }
    return { name, uid };
  }
}

class JobsLabeledPodIdentity {
  constructor(private readonly request: ReplacementPodRequest) {}
  execute(): PodIdentity {
    const request = this.request;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const outcome = new KubectlCommand({
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
        allowFailure: true,
      }).run();
      for (const line of outcome.stdout.trim().split("\n")) {
        const [name = "", uid = ""] = line.trim().split(" ");
        if (name.length > 0 && uid.length > 0 && uid !== request.previousUid) {
          return { name, uid };
        }
      }
      new HostCommand({
        label: "wait for replacement Pod",
        command: ["sleep", "1"],
      }).run();
    }
    throw new Error(
      `replacement Pod did not appear for ${request.labelSelector}`,
    );
  }
}

const PROOF_DOCKERFILE = readFileSync(
  join(SIMULATION_DIRECTORY, "proof.Dockerfile"),
  "utf8",
).trimEnd();

export interface BuildJobRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly nodeName: string;
  readonly buildkitAddress: string;
  readonly input: string;
  readonly dockerConfigSecret: string;
  readonly cacheImport: string;
  readonly cacheExport: string;
  readonly expectCommandFailure: boolean;
}

export interface BuildJobResultRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly expectCached: boolean;
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
