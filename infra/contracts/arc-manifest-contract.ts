import { err, type Result } from "neverthrow";
import {
  OperationalYamlDocument,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { ArcSeparationContract } from "./arc-separation-contract";
import { ArcWorkerRestoreContract } from "./arc-worker-restore-contract";
import { ArcBuildkitUpdateContract } from "./arc-buildkit-update-contract";
import { DockerfileFrontendContract } from "./dockerfile-frontend-contract";

import { resolve } from "node:path";
import {
  arcValuesSchema,
  arcCoordinatorSchema,
  arcHookSchema,
  arcPodSchema,
} from "./arc-manifest-model";
import {
  ArcActivationScenario,
  ArcContainerResourceContract,
} from "./arc-placement-contracts";
import { ArcContractSourceInventory } from "./arc-contract-sources";
import { ArcWorkflowPlacementContract } from "./arc-workflow-placement-contract";
class ArcManifestContract {
  constructor(private readonly root: string) {}
  async assert(): Promise<Result<void, OperationalContractFailure>> {
    const root = this.root;
    const loaded = await new ArcContractSourceInventory(root).load();
    if (loaded.isErr()) return err(loaded.error);
    const {
      runnersSource,
      runners,
      containerRunnersSource,
      containerRunners,
      containerHookSource,
      containerHook,
      containerJobNodesSource,
      containerJobNodes,
      buildkit,
      buildkitContainer,
      network,
      tasks,
      dockerSetup,
      runtimeSmoke,
      repositoryPolicyWorkflow,
      webTasks,
    } = loaded.value;
    const valuesResult = new OperationalYamlDocument(runnersSource).decode(
      arcValuesSchema,
    );
    if (valuesResult.isErr()) return err(valuesResult.error);
    const values = valuesResult.value;
    if (
      values.runnerScaleSetName !== "nook-k0s" ||
      values.minRunners !== 0 ||
      values.maxRunners !== 35
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "general ARC must scale from zero through 35 runners",
      });
    }
    const pod = values.template.spec;
    if ("runtimeClassName" in pod) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "general ARC must use the default Kubernetes runtime",
      });
    }
    if (pod.automountServiceAccountToken !== false) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC runners must not receive Kubernetes credentials",
      });
    }
    if (pod.volumes.some((volume) => "hostPath" in volume)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC runners must not mount host paths",
      });
    }
    if (
      pod.initContainers.length !== 1 ||
      pod.initContainers[0]?.name !== "install-docker-client"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC must carry only the daemon-free Docker client init",
      });
    }
    for (const container of [...pod.initContainers, ...pod.containers]) {
      const resourceAdmission1 = new ArcContainerResourceContract(
        container,
        `general ARC ${container.name}`,
      ).assertCpuUnconstrained();
      if (resourceAdmission1.isErr()) return err(resourceAdmission1.error);
    }
    const dockerClientInit = pod.initContainers[0];
    if (
      dockerClientInit?.resources?.requests?.memory !== "32Mi" ||
      dockerClientInit.resources.limits?.memory !== "256Mi"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "general ARC Docker client init must retain its memory envelope",
      });
    }
    const runner = pod.containers.find(
      (container) => container.name === "runner",
    );
    if (!runner) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "general ARC must retain its runner container",
      });
    }
    const { env: runnerVariables = [] } = runner;
    const runnerEnvironment = new Map(
      runnerVariables.flatMap((item) =>
        "value" in item ? [[item.name, item.value]] : [],
      ),
    );
    if (
      runnerEnvironment.get("NOOK_BUILDKIT_ADDR") !==
      "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC runner must use its node-local BuildKit service",
      });
    }
    const kubernetesNodeEnvironment = runner.env?.find(
      (item) => item.name === "KUBERNETES_NODE_NAME",
    );
    if (
      !kubernetesNodeEnvironment ||
      !("valueFrom" in kubernetesNodeEnvironment) ||
      kubernetesNodeEnvironment.valueFrom.fieldRef.fieldPath !== "spec.nodeName"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "ARC runner must expose its Kubernetes worker through the Downward API",
      });
    }
    const resourceAdmission2 = new ArcContainerResourceContract(
      runner,
      "general ARC runner",
    ).assertNoEnvelope();
    if (resourceAdmission2.isErr()) return err(resourceAdmission2.error);

    const containerValuesResult = new OperationalYamlDocument(
      containerRunnersSource,
    ).decode(arcCoordinatorSchema);
    if (containerValuesResult.isErr()) return err(containerValuesResult.error);
    const containerValues = containerValuesResult.value;
    const containerRunner = containerValues.template.spec.containers.find(
      (container) => container.name === "runner",
    );
    if (!containerRunner) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "container ARC must retain its runner coordinator",
      });
    }
    const resourceAdmission3 = new ArcContainerResourceContract(
      containerRunner,
      "container ARC runner coordinator",
    ).assertCpuUnconstrained();
    if (resourceAdmission3.isErr()) return err(resourceAdmission3.error);
    const resourceAdmission4 = new ArcContainerResourceContract(
      containerRunner,
      "container ARC runner coordinator",
    ).assertNoEnvelope();
    if (resourceAdmission4.isErr()) return err(resourceAdmission4.error);

    const containerHookManifestResult = new OperationalYamlDocument(
      containerHookSource,
    ).decode(arcHookSchema);
    if (containerHookManifestResult.isErr())
      return err(containerHookManifestResult.error);
    const containerHookManifest = containerHookManifestResult.value;
    const containerPodTemplateResult = new OperationalYamlDocument(
      containerHookManifest.data["content.yaml"],
    ).decode(arcPodSchema);
    if (containerPodTemplateResult.isErr())
      return err(containerPodTemplateResult.error);
    const containerPodTemplate = containerPodTemplateResult.value;
    for (const container of [
      ...containerPodTemplate.spec.initContainers,
      ...containerPodTemplate.spec.containers,
    ]) {
      const resourceAdmission5 = new ArcContainerResourceContract(
        container,
        `ARC job Pod ${container.name}`,
      ).assertCpuUnconstrained();
      if (resourceAdmission5.isErr()) return err(resourceAdmission5.error);
    }
    const jobContainer = containerPodTemplate.spec.containers.find(
      (container) => container.name === "$job",
    );
    if (!jobContainer) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC container hook must retain its job container",
      });
    }
    const resourceAdmission6 = new ArcContainerResourceContract(
      jobContainer,
      "ARC job container",
    ).assertNoEnvelope();
    if (resourceAdmission6.isErr()) return err(resourceAdmission6.error);

    const admittedContract1 = runners.requireAll([
      "podAntiAffinity:",
      "nook.nokey.sh/arc-spread-group: general",
      "topologyKey: nook.nokey.sh/arc-standard-host",
      "topologyKey: nook.nokey.sh/arc-overflow-host",
      "values: [general, hive, container]",
      "weight: 25",
      "weight: 90",
      "weight: 100",
      "weight: 50",
      "weight: 1",
      "values: [primary]",
      "values: [secondary]",
      "values: [overflow]",
      "ghcr.io/meta-secret/nook-arc-runner@sha256:0c6d36f124cd33d313cfb7f8b4d602174f9680cb02e686f8743f5ff3b637dc50",
      "registry.dev.nokey.sh/library/docker:29.2.1-cli@sha256:",
    ]);
    if (admittedContract1.isErr()) return err(admittedContract1.error);
    const admittedContract2 = runners.forbidAll([
      "requiredDuringSchedulingIgnoredDuringExecution:",
      "minDomains:",
      "matchLabelKeys:",
    ]);
    if (admittedContract2.isErr()) return err(admittedContract2.error);
    const admittedContract3 = runners.requireAll([
      `    topologySpreadConstraints:
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: DoNotSchedule
        nodeAffinityPolicy: Honor
        nodeTaintsPolicy: Honor
        labelSelector:
          matchExpressions:
            - key: nook.nokey.sh/arc-spread-group
              operator: In
              values: [general, hive, container]`,
    ]);
    if (admittedContract3.isErr()) return err(admittedContract3.error);
    const admittedContract4 = runners.forbidAll([
      "runtimeClassName:",
      "privileged: true",
      "podman",
      "docker:dind",
      "dockerd",
      "docker.sock",
      "containerd.sock",
      "DOCKER_HOST",
      "hostPath:",
    ]);
    if (admittedContract4.isErr()) return err(admittedContract4.error);
    const admittedContract5 = containerRunners.requireAll([
      "runnerScaleSetName: nook-k0s-container",
      "maxRunners: 16",
      "type: kubernetes-novolume",
      "automountServiceAccountToken: true",
      "ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER",
      "ACTIONS_RUNNER_KUBERNETES_NAMESPACE",
      "value: arc-runners",
      "ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE",
      "/etc/nook-arc-hook/content.yaml",
      "ghcr.io/meta-secret/nook-arc-runner@sha256:0c6d36f124cd33d313cfb7f8b4d602174f9680cb02e686f8743f5ff3b637dc50",
    ]);
    if (admittedContract5.isErr()) return err(admittedContract5.error);
    const admittedContract6 = containerRunners.forbidAll([
      "nook.nokey.sh/arc-spread-group:",
      "requiredDuringSchedulingIgnoredDuringExecution:",
      "topologySpreadConstraints:",
      "privileged: true",
      "docker:dind",
      "dockerd",
      "docker.sock",
      "podman",
      "hostPath:",
    ]);
    if (admittedContract6.isErr()) return err(admittedContract6.error);
    const admittedContract7 = containerHook.requireAll([
      "apiVersion: v1",
      "kind: PodTemplate",
      "nook.nokey.sh/arc-spread-group: container",
      "name: nook-arc-container-hook",
      "automountServiceAccountToken: false",
      'name: "$job"',
      'nook.nokey.sh/arc-build: "true"',
      'nook.nokey.sh/arc-container-job: "true"',
      "values: [primary]",
      "values: [secondary]",
      "values: [overflow]",
      "podAntiAffinity:",
      `      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          nodeAffinityPolicy: Honor
          nodeTaintsPolicy: Honor
          labelSelector:
            matchExpressions:
              - key: nook.nokey.sh/arc-spread-group
                operator: In
                values: [container]`,
      "topologyKey: nook.nokey.sh/arc-standard-host",
      "topologyKey: nook.nokey.sh/arc-overflow-host",
      "values: [general, hive, container]",
      "weight: 25",
      "weight: 90",
      "weight: 100",
      "weight: 50",
      "weight: 1",
      'drop: ["ALL"]',
      "fsGroup: 1000",
      "fsGroupChangePolicy: OnRootMismatch",
      "name: fs-init",
      "ghcr.io/actions/actions-runner:2.338.2@sha256:",
      "mountPath: /mnt/externals",
      "mountPath: /mnt/work",
      "mountPath: /mnt/github",
      "mountPath: /home/runner/_work",
      "chmod -R g+rwX /mnt/work/nook",
    ]);
    if (admittedContract7.isErr()) return err(admittedContract7.error);
    const admittedContract8 = containerHook.forbidAll([
      "requiredDuringSchedulingIgnoredDuringExecution:",
      "minDomains:",
      "matchLabelKeys:",
      "nodeName:",
      "privileged: true",
      "docker.sock",
      "containerd.sock",
      "hostPath:",
    ]);
    if (admittedContract8.isErr()) return err(admittedContract8.error);
    const admittedContract9 = containerJobNodes.requireAll([
      "nook-rise-s-1",
      "nook-rise-s-2",
      "ovh-us",
    ]);
    if (admittedContract9.isErr()) return err(admittedContract9.error);
    const admittedContract10 = containerJobNodes.forbid("bynull-servo");
    if (admittedContract10.isErr()) return err(admittedContract10.error);
    if (containerJobNodesSource !== "nook-rise-s-1\nnook-rise-s-2\novh-us\n") {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "ARC container-job node inventory must contain exactly the declared eligible nodes",
      });
    }

    for (const queuedRunners of [22, 24]) {
      const activation = new ArcActivationScenario(queuedRunners, 2, 0);
      if (!activation.preservesPrimaryFirstEligibility()) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `ARC ${queuedRunners}-runner activation must expose both primaries before weaker tiers`,
        });
      }
    }

    const admittedContract11 = buildkit.requireAll([
      "name: nook-buildkit-local-retain",
      "volumeBindingMode: WaitForFirstConsumer",
      "internalTrafficPolicy: Local",
      "kind: StatefulSet",
      "replicas: 4",
      "updateStrategy:\n    type: OnDelete\n    rollingUpdate: null",
      "requiredDuringSchedulingIgnoredDuringExecution:",
      'nook.nokey.sh/arc-build: "true"',
      "registry.dev.nokey.sh/nook/buildkit@sha256:bdf9c1489e0818a264324bd0cdc9a414ebbf12c99b723fd0dd2d70c9edb5ead4",
      "--oci-worker-no-process-sandbox",
      "storage: 128Gi",
      "type: Unconfined",
      "[worker.oci]",
      "gc = true",
      'reservedSpace = "64GB"',
      'maxUsedSpace = "112GB"',
      'minFreeSpace = "16GB"',
      'minFreeSpace = "33%"',
      'filters = ["type==regular"]',
      'keepDuration = "24h"',
      "all = true",
      'mirrors = ["registry.dev.nokey.sh"]',
    ]);
    if (admittedContract11.isErr()) return err(admittedContract11.error);
    const admittedContract12 = buildkit.forbidAll([
      "nook.nokey.sh/arc-spread-group:",
      "--oci-worker-gc",
      "--oci-worker-gc-keepstorage",
      "[history]",
      "maxEntries",
    ]);
    if (admittedContract12.isErr()) return err(admittedContract12.error);
    const admittedContract13 = buildkit.count({
      fragment: "storage: 128Gi",
      expected: 5,
    });
    if (admittedContract13.isErr()) return err(admittedContract13.error);
    const admittedContract14 = buildkit.count({
      fragment: "kind: PersistentVolume\n",
      expected: 4,
    });
    if (admittedContract14.isErr()) return err(admittedContract14.error);
    const admittedContract15 = buildkit.count({
      fragment: "local:\n    path: /var/lib/nook-arc-buildkit/state",
      expected: 4,
    });
    if (admittedContract15.isErr()) return err(admittedContract15.error);
    const admittedContract16 = buildkitContainer.forbid("resources:");
    if (admittedContract16.isErr()) return err(admittedContract16.error);
    const admittedContract17 = buildkitContainer.forbid("limits:");
    if (admittedContract17.isErr()) return err(admittedContract17.error);
    const admittedContract18 = buildkit.forbidAll([
      "runtimeClassName:",
      "privileged: true",
      "docker.sock",
      "containerd.sock",
    ]);
    if (admittedContract18.isErr()) return err(admittedContract18.error);

    const admittedContract19 = network.requireAll([
      "name: arc-runner-default-deny-ingress",
      "name: arc-runner-to-buildkit",
      'values: ["arc-runner", "arc-job-container", "arc-buildkit-benchmark"]',
      "port: 1234",
    ]);
    if (admittedContract19.isErr()) return err(admittedContract19.error);
    const admittedContract20 = dockerSetup.requireAll([
      "driver remote",
      "Connect ARC Buildx to the selected BuildKit backend",
      "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
    ]);
    if (admittedContract20.isErr()) return err(admittedContract20.error);
    const admittedContract21 = dockerSetup.forbidAll([
      "Verify ARC container runtime",
      "tcp://127.0.0.1:2375",
      "docker info >/dev/null",
      "docker-in-docker",
    ]);
    if (admittedContract21.isErr()) return err(admittedContract21.error);
    const admittedContract22 = dockerSetup.requireAll([
      "name: Login to Nook OCI registry",
      "name: Preload hosted BuildKit from Zot",
      'docker pull "${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1"',
      "driver-opts: image=${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1",
    ]);
    if (admittedContract22.isErr()) return err(admittedContract22.error);
    const admittedContract23 = runtimeSmoke.requireAll([
      "NOOK_ARC_RUNNER",
      "type=local,dest=$shared_dir",
      "ARC node-local rootless BuildKit smoke passed",
    ]);
    if (admittedContract23.isErr()) return err(admittedContract23.error);
    const admittedContract24 = runtimeSmoke.forbidAll([
      "--load",
      "docker run",
      "docker info",
      "podman",
    ]);
    if (admittedContract24.isErr()) return err(admittedContract24.error);

    const admittedContract25 = tasks.requireAll([
      "arc:build-hosts:quarantine:",
      "arc:container-hosts:reconcile:",
      "arc:buildkit:storage:prepare:",
      "install -d -o 1000 -g 1000 -m 0700",
      "infra/k0s/manifests/arc/buildkit.yaml",
      "wait statefulset/nook-buildkit",
      "--for=jsonpath='{.status.readyReplicas}'=4",
      "BuildKit OnDelete update is pending reviewed manual replacements",
      "one persistent rootless BuildKit shard per build node",
      "for scale_set in nook-k0s nook-k0s-container",
      "helm uninstall nook-k0s-cache",
      "arc-build-nodes",
      "arc-container-job-nodes",
      "nook.nokey.sh/arc-container-job=true",
      "ARC container-job labels do not match the declared eligibility inventory",
      "expected_build_nodes",
      "usable_bytes=$((available_bytes + state_bytes + legacy_bytes))",
      'state_bytes="${state_bytes:-0}"',
      'test "$filesystem_bytes" -ge 137438953472',
      'if test "$usable_bytes" -lt 137438953472',
      'test "$((available_bytes + state_bytes))" -ge 137438953472',
      "- task: arc:auth:sync",
      "nook.nokey.sh/buildkit-config-sha256",
      "current_buildkit_storage",
      "--cascade=orphan --wait=true",
      "disable --now nook-arc-buildkit-cloner.service",
      '"$legacy_image_next"',
      "/etc/sysctl.d/91-nook-buildkit-keyring.conf",
      "keyring_maxkeys=20000",
      "keyring_maxbytes=2000000",
      "inotify_max_user_instances=8000",
      "inotify_max_user_watches=10485760",
      '"fs.inotify.max_user_instances=$inotify_max_user_instances"',
      '"fs.inotify.max_user_watches=$inotify_max_user_watches"',
      'sysctl -p "$keyring_config"',
      "cat /proc/sys/kernel/keys/maxkeys",
      "cat /proc/sys/kernel/keys/maxbytes",
      "cat /proc/sys/fs/inotify/max_user_instances",
      "cat /proc/sys/fs/inotify/max_user_watches",
      "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      "ARC build node $node is quarantined for convergence",
      "quarantine_failed=0",
      'test "$quarantine_failed" = 0',
      "for tier in primary secondary overflow",
      "primary) expected_tier_count=2",
      "secondary|overflow) expected_tier_count=1",
      'kubectl taint node "${tier_nodes[@]}"',
      "ARC build tier $tier is active",
      "- task: arc:build-hosts:quarantine\n      - task: arc:container-hosts:reconcile\n      - task: arc:buildkit:storage:prepare",
      "container-runner-scale-set-values.yaml",
      "container-hook.yaml",
      "for scale_set in nook-k0s nook-k0s-container",
    ]);
    if (admittedContract25.isErr()) return err(admittedContract25.error);
    const admittedContract36 = repositoryPolicyWorkflow.requireAll([
      "github.event.pull_request.head.repo.full_name == github.repository",
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "uses: ./.github/actions/nook-docker-setup",
      "run: task ci:repository-policy:trusted",
      "run: task ci:repository-policy:untrusted",
    ]);
    if (admittedContract36.isErr()) return err(admittedContract36.error);
    const workerOverrides = webTasks.forbid("PLAYWRIGHT_WORKERS");
    if (workerOverrides.isErr()) return err(workerOverrides.error);
    const separation = await new ArcSeparationContract(root).assert();
    if (separation.isErr()) return err(separation.error);
    const buildkitUpdate = await new ArcBuildkitUpdateContract(root).assert();
    if (buildkitUpdate.isErr()) return err(buildkitUpdate.error);
    const worker = await new ArcWorkerRestoreContract(root).assert();
    if (worker.isErr()) return err(worker.error);
    const frontend = await new DockerfileFrontendContract(root).assert();
    if (frontend.isErr()) return err(frontend.error);
    return new ArcWorkflowPlacementContract(root).assert();
  }
}
const outcome = await new ArcManifestContract(
  resolve(import.meta.dir, "../.."),
).assert();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
