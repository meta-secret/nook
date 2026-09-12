import { err, type Result } from "neverthrow";
import {
  OperationalYamlDocument,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { ArcHiveRenderContract } from "./arc-hive-render-contract";
import { ArcWorkerRestoreContract } from "./arc-worker-restore-contract";
import { DockerfileFrontendContract } from "./dockerfile-frontend-contract";
import { DockerCacheSelectionContract } from "./docker-cache-selection-contract";
import { TextContract } from "./text-contract";

import { resolve } from "node:path";
import {
  arcValuesSchema,
  arcCoordinatorSchema,
  arcHookSchema,
  arcPodSchema,
} from "./arc-manifest-model";
import {
  ArcPlacementScenario,
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
      ciWorkflow,
      mainWorkflow,
      prWorkflow,
      authSensitiveJob,
      hiveWorkflow,
      repositoryPolicyWorkflow,
      webResearchWorkflow,
      nodeSetup,
      webTasks,
      webDockerTasks,
      extensionTasks,
      wasmCacheProofSource,
      wasmCacheProof,
      remoteWorkflow,
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
      "maxSkew: 2",
      "whenUnsatisfiable: ScheduleAnyway",
      "weight: 100",
      "weight: 50",
      "weight: 1",
      "values: [primary]",
      "values: [secondary]",
      "values: [overflow]",
      "ghcr.io/actions/actions-runner:2.336.0@sha256:",
      "registry.dev.nokey.sh/library/docker:29.1.3-cli@sha256:",
    ]);
    if (admittedContract1.isErr()) return err(admittedContract1.error);
    const admittedContract2 = runners.forbid("maxSkew: 5");
    if (admittedContract2.isErr()) return err(admittedContract2.error);
    const admittedContract3 = runners.forbid(
      "whenUnsatisfiable: DoNotSchedule",
    );
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
      "maxRunners: 20",
      "type: kubernetes-novolume",
      "automountServiceAccountToken: true",
      "ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER",
      "ACTIONS_RUNNER_KUBERNETES_NAMESPACE",
      "value: arc-runners",
      "ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE",
      "/etc/nook-arc-hook/content.yaml",
      "ghcr.io/actions/actions-runner:2.336.0@sha256:",
    ]);
    if (admittedContract5.isErr()) return err(admittedContract5.error);
    const admittedContract6 = containerRunners.forbidAll([
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
      "name: nook-arc-container-hook",
      "automountServiceAccountToken: false",
      'name: "$job"',
      'nook.nokey.sh/arc-build: "true"',
      'nook.nokey.sh/arc-container-job: "true"',
      "values: [primary]",
      "values: [secondary]",
      "values: [overflow]",
      "maxSkew: 2",
      "whenUnsatisfiable: ScheduleAnyway",
      "weight: 100",
      "weight: 50",
      "weight: 1",
      'drop: ["ALL"]',
      "fsGroup: 1000",
      "fsGroupChangePolicy: OnRootMismatch",
      "name: fs-init",
      "ghcr.io/actions/actions-runner:2.336.0@sha256:",
      "mountPath: /mnt/externals",
      "mountPath: /mnt/work",
      "mountPath: /mnt/github",
      "chmod -R g+rwX /mnt/work/nook",
    ]);
    if (admittedContract7.isErr()) return err(admittedContract7.error);
    const admittedContract8 = containerHook.forbidAll([
      "maxSkew: 5",
      "whenUnsatisfiable: DoNotSchedule",
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

    // These scenarios compare the declared preferences; Kubernetes still combines
    // them with its other scheduler scores and live node state.
    const fiveJobPreference = new ArcPlacementScenario(2, 2, 1, 0);
    const fiveJobPrimaryPile = new ArcPlacementScenario(4, 0, 1, 0);
    if (
      fiveJobPreference.primarySkew() >= fiveJobPrimaryPile.primarySkew() ||
      fiveJobPreference.secondary >= fiveJobPreference.primaryOne ||
      fiveJobPreference.overflow >= fiveJobPreference.secondary
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "ARC five-job intent must balance primary nodes while limiting weaker tiers",
      });
    }

    const primaryDominantBurst = new ArcPlacementScenario(9, 9, 5, 1);
    const forcedEqualBurst = new ArcPlacementScenario(6, 6, 6, 6);
    if (
      primaryDominantBurst.tierPreferenceScore() <=
        forcedEqualBurst.tierPreferenceScore() ||
      primaryDominantBurst.secondary >= primaryDominantBurst.primaryOne ||
      primaryDominantBurst.overflow >= primaryDominantBurst.secondary
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "ARC 24-runner intent must prefer primary capacity over equal cross-tier load",
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
      "requiredDuringSchedulingIgnoredDuringExecution:",
      'nook.nokey.sh/arc-build: "true"',
      "v0.32.2-rootless@sha256:60d1f642e29dc938bd6c109ba5500849fccf41921927c5339788b8227f57feb9",
      "--oci-worker-no-process-sandbox",
      'cpu: "4"',
      "memory: 8Gi",
      "storage: 128Gi",
      "type: Unconfined",
      "[worker.oci]",
      "gc = true",
      'reservedSpace = "8GB"',
      'maxUsedSpace = "112GB"',
      'minFreeSpace = "16GB"',
      'mirrors = ["registry.dev.nokey.sh"]',
    ]);
    if (admittedContract11.isErr()) return err(admittedContract11.error);
    const admittedContract12 = buildkit.forbidAll([
      "--oci-worker-gc",
      "--oci-worker-gc-keepstorage",
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
    const admittedContract16 = buildkitContainer.requireAll([
      "resources:",
      "requests:",
      'cpu: "4"',
      "memory: 8Gi",
    ]);
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
      'values: ["arc-runner", "arc-hive-runner", "arc-buildkit-benchmark"]',
      "port: 1234",
    ]);
    if (admittedContract19.isErr()) return err(admittedContract19.error);
    const admittedContract20 = dockerSetup.requireAll([
      "driver remote",
      "node-local BuildKit shard",
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
      "rollout status statefulset/nook-buildkit",
      "one persistent rootless BuildKit shard per build node",
      "for scale_set in nook-k0s nook-k0s-hive",
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
      "for scale_set in nook-k0s nook-k0s-hive nook-k0s-container",
    ]);
    if (admittedContract25.isErr()) return err(admittedContract25.error);
    const admittedContract26 = mainWorkflow.forbid("NOOK_CACHE_RUNS_ON");
    if (admittedContract26.isErr()) return err(admittedContract26.error);
    const admittedContract27 = mainWorkflow.forbid(
      "    runs-on: ubuntu-latest",
    );
    if (admittedContract27.isErr()) return err(admittedContract27.error);
    const centralRouting = ciWorkflow.requireAll([
      "types: [opened, synchronize, reopened, labeled, edited, closed]",
      "branches: [main]",
      ".vale.ini | .vale/*",
      "uses: ./.github/workflows/pr.yml",
      "uses: ./.github/workflows/main.yml",
      "uses: ./.github/workflows/hive.yml",
      "uses: ./.github/workflows/repository-policy.yml",
      "uses: ./.github/workflows/web-research.yml",
      "github.event_name == 'push' && 'main'",
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      "needs.scope.outputs.validation-requested == 'true'",
      "persist-credentials: false",
    ]);
    if (centralRouting.isErr()) return err(centralRouting.error);
    const admittedContract28 = mainWorkflow.requireAll([
      "workflow_call:",
      "if: inputs.product_changed",
      "wasm-cache-publish:",
      "name: WASM cache publication",
      "needs: [wasm]",
      "cache_publication_outcome: ${{ steps.publish_wasm_cache.outcome }}",
      "continue-on-error: true",
      "CACHE_PUBLICATION_OUTCOME: ${{ needs.wasm.outputs.cache_publication_outcome }}",
      "WASM cache publication failed in the verified producer",
      "wasm-cache-proof:",
      "name: Portable WASM cache publication proof",
      "needs: [wasm-cache-publish]",
      "Install Bun for registry cache audit",
      'NOOK_WASM_CACHE_PROMOTION_ENABLED: "1"',
      "NOOK_REGISTRY_USERNAME: ${{ secrets.NOOK_REGISTRY_USERNAME }}",
      "bash .github/scripts/verify-wasm-gha-cache.sh",
      "web-e2e:",
      "extension-e2e:",
      "ui-demos:",
      "deploy:",
      "Upload verified development deployment handoff",
      "main-web-deploy-${{ github.run_id }}",
      "runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}",
      "runs-on: nook-k0s-container",
      "Publish exact-source browser job image",
      "name: Verify web build",
      "needs: [web, web-e2e, wasm-cache-proof]",
      "task _ci:main:web:e2e-only",
      "task _extension:test:e2e",
      "task _web:test:ui-demo",
    ]);
    if (admittedContract28.isErr()) return err(admittedContract28.error);
    const admittedContract29 = mainWorkflow.forbid(
      "Build sealed web image for development deploy",
    );
    if (admittedContract29.isErr()) return err(admittedContract29.error);
    const admittedContract30 = prWorkflow.requireAll([
      "workflow_call:",
      "inputs.validation_requested",
      "full-e2e-shard:",
      "name: Full browser e2e shard (${{ matrix.shard }}/2)",
      "fail-fast: false",
      "shard: [1, 2]",
      "NOOK_E2E_SHARD: ${{ matrix.shard }}/2",
      "full-e2e:",
      "name: Full browser e2e (main fix)",
      "needs: [full-e2e-shard, wasm]",
      "SHARD_RESULT: ${{ needs.full-e2e-shard.result }}",
      "Publish exact-source PR browser job image",
      "nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
      "runs-on: nook-k0s-container",
      "task _ci:main:web:e2e-only",
      "task _extension:test:e2e",
      "task _web:test:ui-demo",
      "auth-sensitive-e2e-required: ${{ steps.auth-sensitive-e2e-contract.outputs.required }}",
      "name: Detect authentication-sensitive browser changes",
      "steps.auth-sensitive-e2e-contract.outputs.required == 'true' &&\n          github.event.pull_request.head.repo.full_name == github.repository &&\n          github.event.pull_request.user.login != 'dependabot[bot]'",
      "nook-app/nook-web/nook-web-shared/src/extension/password-form*",
      "nook-app/nook-web/nook-web-extension/src/content/autofill.ts",
      "nook-app/nook-web/nook-web-extension/src/content/autofill/*",
      "nook-app/nook-web/nook-web-extension/e2e/mock-auth-provider-scenarios.ts",
      "nook-app/nook-web/nook-web-extension/e2e/mock-auth/src/pages/DetectionHiddenHeaderLogin.svelte",
      "nook-app/nook-web/nook-web-extension/e2e/mock-auth-pilot-coverage.spec.ts",
      "extension-e2e:",
      "name: Extension e2e",
      "needs: [validation-request, verify]",
      "E2E_SPEC: e2e/mock-auth-pilot-coverage.spec.ts",
      "EXTENSION_E2E_RESULT: ${{ needs.extension-e2e.result }}",
      "WASM_NODE_RESULT: ${{ needs.wasm-node-test.result }}",
      "WASM Node tests=$WASM_NODE_RESULT",
      "needs: [validation-request, rust, wasm, verify, wasm-node-test, ui-demo, extension-e2e]",
      "Extension e2e finished with $EXTENSION_E2E_RESULT",
      "task _extension:test:e2e:file",
    ]);
    if (admittedContract30.isErr()) return err(admittedContract30.error);
    const admittedContract31 = authSensitiveJob.requireAll([
      "inputs.full_e2e_requested || needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
      "if: inputs.full_e2e_requested",
      "if: ${{ !inputs.full_e2e_requested }}",
      "needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
      "github.event.pull_request.head.repo.full_name == github.repository",
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "runs-on: nook-k0s-container",
      "image: registry.dev.nokey.sh/nook/remote-buildcache/nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
      "run: task _extension:test:e2e:file",
      "E2E_SPEC: e2e/mock-auth-pilot-coverage.spec.ts",
    ]);
    if (admittedContract31.isErr()) return err(admittedContract31.error);
    const admittedContract32 = extensionTasks.requireAll([
      "_extension:test:e2e:file:",
      'test -n "${E2E_SPEC:-}"',
      'bash scripts/test-e2e.sh "$E2E_SPEC"',
    ]);
    if (admittedContract32.isErr()) return err(admittedContract32.error);
    const admittedContract33 = prWorkflow.forbid("    runs-on: ubuntu-latest");
    if (admittedContract33.isErr()) return err(admittedContract33.error);
    const admittedContract34 = nodeSetup.requireAll([
      "/home/runner/externals/node24/bin/node",
      'echo "$(dirname "$node_bin")" >> "$GITHUB_PATH"',
    ]);
    if (admittedContract34.isErr()) return err(admittedContract34.error);
    const admittedContract35 = prWorkflow.require(
      "uses: ./.github/actions/nook-node-setup",
    );
    if (admittedContract35.isErr()) return err(admittedContract35.error);
    const admittedContract36 = repositoryPolicyWorkflow.requireAll([
      "github.event.pull_request.head.repo.full_name == github.repository",
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "uses: ./.github/actions/nook-docker-setup",
      "run: task ci:repository-policy:trusted",
      "run: task ci:repository-policy:untrusted",
    ]);
    if (admittedContract36.isErr()) return err(admittedContract36.error);
    const admittedContract39 = repositoryPolicyWorkflow.forbid("run: |");
    if (admittedContract39.isErr()) return err(admittedContract39.error);
    const admittedContract40 = repositoryPolicyWorkflow.requireBefore({
      first: "uses: ./.github/actions/nook-docker-setup",
      second: "run: task ci:repository-policy:trusted",
    });
    if (admittedContract40.isErr()) return err(admittedContract40.error);
    const admittedContract41 = hiveWorkflow.requireAll([
      "Build Hive Control Center browser image",
      "nook-hive-console:run-${{ github.run_id }}-${{ github.run_attempt }}",
      "needs: console-image",
      "runs-on: nook-k0s-container",
      "console-untrusted:",
      "Validate untrusted Hive Control Center source",
      "task hive:console:verify",
      "without private credentials",
    ]);
    if (admittedContract41.isErr()) return err(admittedContract41.error);
    const admittedContract42 = hiveWorkflow.forbid(
      "task hive:console:e2e:prepare",
    );
    if (admittedContract42.isErr()) return err(admittedContract42.error);
    const admittedContract43 = webResearchWorkflow.requireAll([
      "Build research browser image",
      "nook-web-research:run-${{ github.run_id }}-${{ github.run_attempt }}",
      "needs: image",
      "runs-on: nook-k0s-container",
    ]);
    if (admittedContract43.isErr()) return err(admittedContract43.error);
    const admittedContract44 = webTasks.requireAll([
      "_web:test:e2e:run-groups:",
      'set -- "--shard=$NOOK_E2E_SHARD"',
      "PLAYWRIGHT_WORKERS=3 bun x playwright test --project=stable",
      "PLAYWRIGHT_WORKERS=2 bun x playwright test --project=unstable",
      "bun x playwright test --config playwright.isolation.config.ts",
    ]);
    if (admittedContract44.isErr()) return err(admittedContract44.error);
    const admittedContract45 = webDockerTasks.requireAll([
      "NOOK_E2E_SHARD: '{{.NOOK_E2E_SHARD}}'",
      "-e NOOK_E2E_SHARD",
    ]);
    if (admittedContract45.isErr()) return err(admittedContract45.error);
    const admittedContract46 = wasmCacheProof.requireAll([
      "Publish from the already-selected node-local rootless BuildKit shard",
      "repair solve never imports the ref it is replacing",
      "nook-rust-wasm-deps-input-v3:fingerprint-${deps_fingerprint}",
      "nook-rust-wasm-source-v3:buildcache,ignore-error=true",
      "compression=zstd,force-compression=true",
      "builder-wasm-deps-cache-proof.cache-to=type=registry,ref=${cache_ref}",
      "verify-registry-cache-blobs.ts",
    ]);
    if (admittedContract46.isErr()) return err(admittedContract46.error);
    const admittedContract47 = wasmCacheProof.forbidAll([
      "--driver docker-container",
      "docker buildx create",
      "docker buildx rm",
    ]);
    if (admittedContract47.isErr()) return err(admittedContract47.error);
    const promotionSolve = wasmCacheProofSource.slice(
      wasmCacheProofSource.indexOf(
        'if [ "${NOOK_WASM_CACHE_PROMOTION_ENABLED:-}" = "1" ]',
      ),
      wasmCacheProofSource.indexOf(
        'bun "$repo_root/.github/scripts/verify-registry-cache-blobs.ts"',
      ),
    );
    if (promotionSolve.includes("cache-from=type=registry,ref=${cache_ref}")) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "portable WASM cache promotion must not import its destination",
      });
    }
    const admittedContract48 = remoteWorkflow.forbidAll([
      "NOOK_CACHE_RUNS_ON",
      "nook-k0s-cache",
      "ci:pr:e2e) task _ci:main",
    ]);
    if (admittedContract48.isErr()) return err(admittedContract48.error);
    const admittedContract49 = remoteWorkflow.requireAll([
      "name: Report Kubernetes worker node",
      ': "${KUBERNETES_NODE_NAME:?KUBERNETES_NODE_NAME is required}"',
      "printf '::notice title=Kubernetes worker::%s\\n' \"$KUBERNETES_NODE_NAME\"",
      "Remote / browser image",
      "runs-on: nook-k0s-container",
      "Run repository invariant preflight",
      "run: task preflight",
      "task web:e2e:kubernetes-image",
      "Run selected task without a nested container runtime",
      "web:build) task _web:build",
      "web:e2e) task _ci:main:web:e2e-only",
      "extension:e2e) task _extension:test:e2e",
      "check) task _check",
      "ci:pr) task _ci:pr",
      "ci-pr-e2e-suite:",
      "needs: web-e2e-image",
      "name: Remote / ci:pr:e2e / ${{ matrix.suite }}",
      "fail-fast: false",
      "suite: [stable, unstable, isolation, extension]",
      "stable) task _web:test:e2e:stable",
      "unstable) task _web:test:e2e:unstable",
      "isolation) task _web:test:e2e:isolation",
      "extension) task _extension:test:e2e",
      "remote-e2e-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.suite }}",
      "ci-pr-e2e:",
      "needs: ci-pr-e2e-suite",
      "SUITE_RESULT: ${{ needs.ci-pr-e2e-suite.result }}",
      'run: test "$SUITE_RESULT" = "success"',
      "inputs.tasks != '' && inputs.task != ''",
      "(inputs.tasks == '' || inputs.task == '')",
    ]);
    if (admittedContract49.isErr()) return err(admittedContract49.error);
    const admittedContract50 = remoteWorkflow.forbid(
      '"$("$vale_bin" --version)"',
    );
    if (admittedContract50.isErr()) return err(admittedContract50.error);
    const admittedContract51 = remoteWorkflow.requireBefore({
      first: "name: Report Kubernetes worker node",
      second: "uses: actions/checkout@v7",
    });
    if (admittedContract51.isErr()) return err(admittedContract51.error);
    const admittedContract52 = remoteWorkflow.requireBefore({
      first: "uses: ./.github/actions/nook-docker-setup",
      second: "name: Run task batch",
    });
    if (admittedContract52.isErr()) return err(admittedContract52.error);
    const admittedContract53 = remoteWorkflow.require(
      "inputs.dispatch_nonce || 'default'",
    );
    if (admittedContract53.isErr()) return err(admittedContract53.error);
    const worker = await new ArcWorkerRestoreContract(root).assert();
    if (worker.isErr()) return err(worker.error);
    const cache = await new DockerCacheSelectionContract(root).assert();
    if (cache.isErr()) return err(cache.error);
    const frontend = await new DockerfileFrontendContract(root).assert();
    if (frontend.isErr()) return err(frontend.error);
    const hive = await new ArcHiveRenderContract({
      root,
    }).execute();
    if (hive.isErr()) return err(hive.error);

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
