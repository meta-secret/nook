import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILDKIT_ADDRESS,
  BUILDKIT_IMAGE,
  REGISTRY_HOST,
  SIMULATION_DIRECTORY,
  applyYaml,
  assertContains,
  runCommand,
  runKubectl,
} from "./contracts";

const PROOF_DOCKERFILE = readFileSync(
  join(SIMULATION_DIRECTORY, "proof.Dockerfile"),
  "utf8",
).trimEnd();

export interface BuildJobRequest {
  readonly kubeconfigPath: string;
  readonly name: string;
  readonly nodeName: string;
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

export function podNode(request: PodNodeRequest): string {
  const nodeName = runKubectl({
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
  }).stdout.trim();
  if (nodeName.length === 0) throw new Error(`${request.podName} has no node`);
  return nodeName;
}

function buildCommandArguments(request: BuildJobRequest): readonly string[] {
  const args = [
    "--addr",
    BUILDKIT_ADDRESS,
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildJobYaml(request: BuildJobRequest): string {
  const argumentsList = buildCommandArguments(request);
  const directArgs = argumentsList
    .map((argument) => `            - ${JSON.stringify(argument)}`)
    .join("\n");
  const shellCommand = ["buildctl", ...argumentsList].map(shellQuote).join(" ");
  const command = request.expectCommandFailure
    ? `          command: ["sh", "-euc"]
          args:
            - |-
              if ${shellCommand} >/tmp/buildctl.log 2>&1; then
                echo "unexpected registry write success" >&2
                exit 1
              fi
              cat /tmp/buildctl.log
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

export function startBuildJob(request: BuildJobRequest): void {
  applyYaml({
    kubeconfigPath: request.kubeconfigPath,
    label: `start build job ${request.name}`,
    yaml: buildJobYaml(request),
  });
}

export function finishBuildJob(request: BuildJobResultRequest): string {
  const waitOutcome = runKubectl({
    kubeconfigPath: request.kubeconfigPath,
    label: `wait for build job ${request.name}`,
    command: [
      "-n",
      "arc-runners",
      "wait",
      `job/${request.name}`,
      "--for=condition=complete",
      "--timeout=300s",
    ],
    allowFailure: true,
  });
  const logs = runKubectl({
    kubeconfigPath: request.kubeconfigPath,
    label: `read build job ${request.name} logs`,
    command: ["-n", "arc-runners", "logs", `job/${request.name}`],
    allowFailure: true,
  }).stdout;
  process.stdout.write(`\n== ${request.name} ==\n${logs}`);
  if (waitOutcome.exitCode !== 0) {
    const description = runKubectl({
      kubeconfigPath: request.kubeconfigPath,
      label: `describe failed build job ${request.name}`,
      command: ["-n", "arc-runners", "describe", `job/${request.name}`],
      allowFailure: true,
    }).stdout;
    throw new Error(
      `build job ${request.name} did not complete\n${logs}\n${description}`,
    );
  }
  if (request.expectCached) {
    assertCacheStepDidNotExecute({ logs, jobName: request.name });
  }
  return logs;
}

function assertCacheStepDidNotExecute(request: {
  readonly logs: string;
  readonly jobName: string;
}): void {
  assertContains({
    content: request.logs,
    expected: "cache-proof-execution-marker",
    label: `build job ${request.jobName}`,
  });
  const executionLine = /^#\d+\s+\d+(?:\.\d+)?\s+cache-proof-execution-marker$/m;
  if (executionLine.test(request.logs)) {
    throw new Error(`build job ${request.jobName}: cached RUN step executed`);
  }
}

function networkPolicyJobYaml(request: NetworkPolicyJobRequest): string {
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

export function proveNetworkPolicy(request: NetworkPolicyJobRequest): void {
  applyYaml({
    kubeconfigPath: request.kubeconfigPath,
    label: "start unauthorized BuildKit client",
    yaml: networkPolicyJobYaml(request),
  });
  const logs = finishBuildJob({
    kubeconfigPath: request.kubeconfigPath,
    name: request.name,
    expectCached: false,
  });
  assertContains({
    content: logs,
    expected: "network-policy-denied",
    label: "BuildKit NetworkPolicy proof",
  });
}

export function restartBuildkitPod(request: PodNodeRequest): void {
  const previous = podIdentity({
    kubeconfigPath: request.kubeconfigPath,
    namespace: "arc-runners",
    podName: request.podName,
  });
  runKubectl({
    kubeconfigPath: request.kubeconfigPath,
    label: `restart ${request.podName}`,
    command: ["-n", "arc-runners", "delete", `pod/${request.podName}`],
    streamOutput: true,
  });
  runKubectl({
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
  });
  const replacement = podIdentity({
    kubeconfigPath: request.kubeconfigPath,
    namespace: "arc-runners",
    podName: request.podName,
  });
  if (replacement.uid === previous.uid) {
    throw new Error(`${request.podName} retained its UID after deletion`);
  }
  runKubectl({
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
  });
  const ready = podIdentity({
    kubeconfigPath: request.kubeconfigPath,
    namespace: "arc-runners",
    podName: request.podName,
  });
  if (ready.uid !== replacement.uid) {
    throw new Error(`${request.podName} changed UID while waiting for readiness`);
  }
}

export function restartZot(kubeconfigPath: string): void {
  const previous = labeledPodIdentity({
    kubeconfigPath,
    namespace: "hive-data",
    labelSelector: "app.kubernetes.io/name=nook-zot",
    previousUid: "",
  });
  runKubectl({
    kubeconfigPath,
    label: "restart Zot pod",
    command: ["-n", "hive-data", "delete", `pod/${previous.name}`],
    streamOutput: true,
  });
  const replacement = labeledPodIdentity({
    kubeconfigPath,
    namespace: "hive-data",
    labelSelector: "app.kubernetes.io/name=nook-zot",
    previousUid: previous.uid,
  });
  runKubectl({
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
  });
  const ready = podIdentity({
    kubeconfigPath,
    namespace: "hive-data",
    podName: replacement.name,
  });
  if (ready.uid !== replacement.uid) {
    throw new Error("Zot changed UID while waiting for readiness");
  }
}

function podIdentity(request: PodIdentityRequest): PodIdentity {
  const output = runKubectl({
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
  }).stdout.trim();
  const [name = "", uid = ""] = output.split(" ");
  if (name.length === 0 || uid.length === 0) {
    throw new Error(`pod identity is incomplete: ${output}`);
  }
  return { name, uid };
}

function labeledPodIdentity(request: ReplacementPodRequest): PodIdentity {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const outcome = runKubectl({
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
    });
    for (const line of outcome.stdout.trim().split("\n")) {
      const [name = "", uid = ""] = line.trim().split(" ");
      if (name.length > 0 && uid.length > 0 && uid !== request.previousUid) {
        return { name, uid };
      }
    }
    runCommand({ label: "wait for replacement Pod", command: ["sleep", "1"] });
  }
  throw new Error(`replacement Pod did not appear for ${request.labelSelector}`);
}
