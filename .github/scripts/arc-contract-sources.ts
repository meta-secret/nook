import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractSource,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { resolve } from "node:path";
import { TextContract } from "./text-contract";
export interface ArcContractSources {
  runnersSource: string;
  runners: TextContract;
  containerRunnersSource: string;
  containerRunners: TextContract;
  containerHookSource: string;
  containerHook: TextContract;
  containerJobNodesSource: string;
  containerJobNodes: TextContract;
  buildkit: TextContract;
  buildkitContainer: TextContract;
  network: TextContract;
  tasks: TextContract;
  dockerSetup: TextContract;
  runtimeSmoke: TextContract;
  ciWorkflow: TextContract;
  mainWorkflow: TextContract;
  prWorkflow: TextContract;
  authSensitiveJob: TextContract;
  hiveWorkflow: TextContract;
  repositoryPolicySource: string;
  repositoryPolicyWorkflow: TextContract;
  webResearchWorkflow: TextContract;
  nodeSetup: TextContract;
  webTasks: TextContract;
  webDockerTasks: TextContract;
  extensionTasks: TextContract;
  wasmCacheProofSource: string;
  wasmCacheProof: TextContract;
  remoteWorkflow: TextContract;
}
export class ArcContractSourceInventory {
  constructor(private readonly root: string) {}
  async load(): Promise<
    Result<ArcContractSources, OperationalContractFailure>
  > {
    const readSource22 = await new OperationalContractSource(
      resolve(
        this.root,
        "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
      ),
    ).read();
    if (readSource22.isErr()) return err(readSource22.error);
    const runnersSource = readSource22.value;
    const runners = new TextContract({
      label: "ARC runner scale set",
      source: runnersSource,
    });
    const readSource21 = await new OperationalContractSource(
      resolve(
        this.root,
        "infra/k0s/manifests/arc/container-runner-scale-set-values.yaml",
      ),
    ).read();
    if (readSource21.isErr()) return err(readSource21.error);
    const containerRunnersSource = readSource21.value;
    const containerRunners = new TextContract({
      label: "ARC Kubernetes container scale set",
      source: containerRunnersSource,
    });
    const readSource20 = await new OperationalContractSource(
      resolve(this.root, "infra/k0s/manifests/arc/container-hook.yaml"),
    ).read();
    if (readSource20.isErr()) return err(readSource20.error);
    const containerHookSource = readSource20.value;
    const containerHook = new TextContract({
      label: "ARC Kubernetes container hook",
      source: containerHookSource,
    });
    const readSource19 = await new OperationalContractSource(
      resolve(this.root, "infra/k0s/config/arc-container-job-nodes"),
    ).read();
    if (readSource19.isErr()) return err(readSource19.error);
    const containerJobNodesSource = readSource19.value;
    const containerJobNodes = new TextContract({
      label: "ARC container-job node inventory",
      source: containerJobNodesSource,
    });
    const readSource18 = await new OperationalContractSource(
      resolve(this.root, "infra/k0s/manifests/arc/buildkit.yaml"),
    ).read();
    if (readSource18.isErr()) return err(readSource18.error);
    const buildkitSource = readSource18.value;
    const buildkit = new TextContract({
      label: "ARC persistent BuildKit",
      source: buildkitSource,
    });
    const buildkitContainerStart = buildkitSource.indexOf(
      "        - name: buildkitd",
    );
    const buildkitContainerEnd = buildkitSource.indexOf(
      "          volumeMounts:",
    );
    if (buildkitContainerStart < 0 || buildkitContainerEnd < 0) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC persistent BuildKit container envelope is missing",
      });
    }
    const buildkitContainer = new TextContract({
      label: "ARC persistent BuildKit container",
      source: buildkitSource.slice(),
    });
    const readSource17 = await new OperationalContractSource(
      resolve(this.root, "infra/k0s/manifests/arc/network-policy.yaml"),
    ).read();
    if (readSource17.isErr()) return err(readSource17.error);
    const network = new TextContract({
      label: "ARC network policy",
      source: readSource17.value,
    });
    const readSource16 = await new OperationalContractSource(
      resolve(this.root, "infra/tasks/arc.yml"),
    ).read();
    if (readSource16.isErr()) return err(readSource16.error);
    const arcTasksSource = readSource16.value;
    const tasks = new TextContract({
      label: "ARC operations",
      source: arcTasksSource,
    });
    const registryTransport = new TextContract({
      label: "ARC standalone registry transport configuration",
      source: arcTasksSource.slice(
        arcTasksSource.indexOf("  arc:network:configure:"),
        arcTasksSource.indexOf("  arc:buildkit:storage:prepare:"),
      ),
    });
    const admittedContract1 = registryTransport.requireAll([
      "for node in ovh-us bynull-servo; do",
      "ovh-us:debian@10.202.0.1|bynull-servo:bynull@10.202.0.3)",
      'test "$(hostname -s)" = "$expected_node"',
      "sudo -n modprobe tcp_bbr",
      "/etc/modules-load.d/nook-tcp-congestion-control.conf",
      "/etc/sysctl.d/99-nook-tcp-congestion-control.conf",
      '.Labels["io.kubernetes.pod.namespace"] == "arc-runners"',
      '.Labels["io.kubernetes.container.name"] == "buildkitd"',
      'test("^nook-buildkit-[0-9]+$")',
      'if test "${#buildkit_pids[@]}" != 1; then',
      "Expected exactly one running home BuildKit container",
      'sudo -n nsenter -t "${buildkit_pids[0]}" -n sysctl -w',
      'test "$(sudo -n nsenter -t "${buildkit_pids[0]}" -n',
      "unshare --net cat /proc/sys/net/ipv4/tcp_congestion_control",
    ]);
    if (admittedContract1.isErr()) return err(admittedContract1.error);
    const admittedContract2 = registryTransport.requireBefore({
      first: 'if test "${#buildkit_pids[@]}" != 1; then',
      second: 'sudo -n nsenter -t "${buildkit_pids[0]}" -n sysctl -w',
    });
    if (admittedContract2.isErr()) return err(admittedContract2.error);
    const admittedContract3 = registryTransport.forbidAll([
      "nook-buildkit-0",
      "rollout restart",
      "uncordon",
    ]);
    if (admittedContract3.isErr()) return err(admittedContract3.error);
    const admittedContract4 = tasks.forbid("- task: arc:network:configure");
    if (admittedContract4.isErr()) return err(admittedContract4.error);
    const readSource15 = await new OperationalContractSource(
      resolve(this.root, "infra/k0s/config/nook-tcp-congestion-control.conf"),
    ).read();
    if (readSource15.isErr()) return err(readSource15.error);
    const admittedContract5 = new TextContract({
      label: "ARC TCP boot module",
      source: readSource15.value,
    }).require("tcp_bbr\n");
    if (admittedContract5.isErr()) return err(admittedContract5.error);
    const readSource14 = await new OperationalContractSource(
      resolve(
        this.root,
        "infra/k0s/config/99-nook-tcp-congestion-control.conf",
      ),
    ).read();
    if (readSource14.isErr()) return err(readSource14.error);
    const admittedContract6 = new TextContract({
      label: "ARC TCP congestion policy",
      source: readSource14.value,
    }).require("net.ipv4.tcp_congestion_control = bbr\n");
    if (admittedContract6.isErr()) return err(admittedContract6.error);
    const readSource13 = await new OperationalContractSource(
      resolve(this.root, ".github/actions/nook-docker-setup/action.yml"),
    ).read();
    if (readSource13.isErr()) return err(readSource13.error);
    const dockerSetup = new TextContract({
      label: "Docker setup action",
      source: readSource13.value,
    });
    const readSource12 = await new OperationalContractSource(
      resolve(this.root, ".github/scripts/arc-runtime-smoke.sh"),
    ).read();
    if (readSource12.isErr()) return err(readSource12.error);
    const runtimeSmoke = new TextContract({
      label: "ARC BuildKit smoke",
      source: readSource12.value,
    });
    const ciSource = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/ci.yml"),
    ).read();
    if (ciSource.isErr()) return err(ciSource.error);
    const ciWorkflow = new TextContract({
      label: "Central CI workflow",
      source: ciSource.value,
    });
    const readSource11 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/main.yml"),
    ).read();
    if (readSource11.isErr()) return err(readSource11.error);
    const mainWorkflow = new TextContract({
      label: "Main workflow",
      source: readSource11.value,
    });
    const readSource10 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/pr.yml"),
    ).read();
    if (readSource10.isErr()) return err(readSource10.error);
    const prWorkflowSource = readSource10.value;
    const prWorkflow = new TextContract({
      label: "PR workflow",
      source: prWorkflowSource,
    });
    const authSensitiveJobStart = prWorkflowSource.indexOf("  extension-e2e:");
    const authSensitiveJobEnd = prWorkflowSource.indexOf("  preview:");
    if (authSensitiveJobStart < 0 || authSensitiveJobEnd < 0) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "PR extension e2e job is missing",
      });
    }
    const authSensitiveJob = new TextContract({
      label: "PR extension e2e job",
      source: prWorkflowSource.slice(),
    });
    const readSource9 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/hive.yml"),
    ).read();
    if (readSource9.isErr()) return err(readSource9.error);
    const hiveWorkflow = new TextContract({
      label: "Hive workflow",
      source: readSource9.value,
    });
    const readSource8 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/repository-policy.yml"),
    ).read();
    if (readSource8.isErr()) return err(readSource8.error);
    const repositoryPolicySource = readSource8.value;
    const repositoryPolicyWorkflow = new TextContract({
      label: "repository policy workflow",
      source: repositoryPolicySource,
    });
    const readSource7 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/web-research.yml"),
    ).read();
    if (readSource7.isErr()) return err(readSource7.error);
    const webResearchWorkflow = new TextContract({
      label: "web research workflow",
      source: readSource7.value,
    });
    const readSource6 = await new OperationalContractSource(
      resolve(this.root, ".github/actions/nook-node-setup/action.yml"),
    ).read();
    if (readSource6.isErr()) return err(readSource6.error);
    const nodeSetup = new TextContract({
      label: "ARC shell Node setup",
      source: readSource6.value,
    });
    const readSource5 = await new OperationalContractSource(
      resolve(this.root, "nook-app/nook-web/Taskfile.yml"),
    ).read();
    if (readSource5.isErr()) return err(readSource5.error);
    const webTasks = new TextContract({
      label: "web browser tasks",
      source: readSource5.value,
    });
    const readSource4 = await new OperationalContractSource(
      resolve(this.root, "nook-app/nook-web/docker/Taskfile.yml"),
    ).read();
    if (readSource4.isErr()) return err(readSource4.error);
    const webDockerTasks = new TextContract({
      label: "web Docker browser tasks",
      source: readSource4.value,
    });
    const readSource3 = await new OperationalContractSource(
      resolve(this.root, "nook-app/nook-web/nook-web-extension/Taskfile.yml"),
    ).read();
    if (readSource3.isErr()) return err(readSource3.error);
    const extensionTasks = new TextContract({
      label: "extension browser tasks",
      source: readSource3.value,
    });
    const readSource2 = await new OperationalContractSource(
      resolve(this.root, ".github/scripts/verify-wasm-gha-cache.sh"),
    ).read();
    if (readSource2.isErr()) return err(readSource2.error);
    const wasmCacheProofSource = readSource2.value;
    const wasmCacheProof = new TextContract({
      label: "portable WASM cache proof",
      source: wasmCacheProofSource,
    });
    const readSource1 = await new OperationalContractSource(
      resolve(this.root, ".github/workflows/remote.yml"),
    ).read();
    if (readSource1.isErr()) return err(readSource1.error);
    const remoteWorkflow = new TextContract({
      label: "Remote workflow",
      source: readSource1.value,
    });
    return ok({
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
      repositoryPolicySource,
      repositoryPolicyWorkflow,
      webResearchWorkflow,
      nodeSetup,
      webTasks,
      webDockerTasks,
      extensionTasks,
      wasmCacheProofSource,
      wasmCacheProof,
      remoteWorkflow,
    });
  }
}
