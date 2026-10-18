import { resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import {
  OperationalCommandProbe,
  OperationalContractFailureKind,
  OperationalContractSource,
  OperationalProbeStream,
  type OperationalContractFailure,
} from "./operational-contract";
import { TextContract } from "./text-contract";

/** Native ARC placement and maintenance, independent of remote Task dispatch. */
export class ArcSeparationContract {
  constructor(private readonly root: string) {}

  async assert(): Promise<Result<void, OperationalContractFailure>> {
    const sources = [
      {
        path: "infra/k0s/manifests/arc/browser-runner-scale-set-values.yaml",
        required: [
          "runnerScaleSetName: nook-k0s-browser",
          "minRunners: 0",
          "maxRunners: 4",
          "type: kubernetes-novolume",
          "nook.nokey.sh/node-role: control-storage",
          "nook.nokey.sh/role: arc-browser-runner",
          "nook.nokey.sh/arc-workload: build",
          "name: nook-arc-browser-hook",
          "automountServiceAccountToken: true",
          "ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER",
          "ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE",
          "ghcr.io/meta-secret/nook-arc-runner@sha256:64dc2f6c9e51f560165bacf3b21e87875be70271830924dae3fe0dae4407e10b",
        ],
        forbidden: [
          "NOOK_BUILDKIT",
          "docker-client",
          "privileged: true",
          "hostPath:",
        ],
      },
      {
        path: "infra/k0s/manifests/arc/browser-hook.yaml",
        required: [
          "name: nook-arc-browser-hook",
          "nook.nokey.sh/role: arc-browser-job",
          "nook.nokey.sh/arc-spread-group: browser",
          "nook.nokey.sh/arc-workload: browser",
          'nook.nokey.sh/arc-container-job: "true"',
          "automountServiceAccountToken: false",
          "fsGroup: 1000",
          "fsGroupChangePolicy: OnRootMismatch",
          "name: fs-init",
          "ghcr.io/actions/actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda",
          "chmod -R g+rwX /mnt/work/nook",
          "mountPath: /mnt/externals",
          "mountPath: /mnt/work",
          "mountPath: /mnt/github",
          "mountPath: /home/runner/_work",
          "allowPrivilegeEscalation: false",
          'drop: ["ALL"]',
          "type: RuntimeDefault",
        ],
        forbidden: [
          "NOOK_BUILDKIT",
          "docker-client",
          "docker.sock",
          "hostPath:",
          "privileged: true",
          "resources:",
          "podAntiAffinity:",
          "requiredDuringSchedulingIgnoredDuringExecution:",
        ],
      },
      {
        path: "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
        required: ["maxRunners: 35", "nook.nokey.sh/arc-workload: build"],
        forbidden: [],
      },
      {
        path: "infra/k0s/manifests/arc/container-runner-scale-set-values.yaml",
        required: ["maxRunners: 16", "nook.nokey.sh/arc-workload: build"],
        forbidden: [],
      },
      {
        path: "infra/k0s/manifests/arc/container-hook.yaml",
        required: [
          "nook.nokey.sh/arc-workload: build",
          "NOOK_BUILDKIT_ADDR",
        ],
        forbidden: [],
      },
      {
        path: "infra/k0s/config/arc-browser-nodes",
        required: ["nook-rise-s-2\n"],
        forbidden: ["nook-rise-s-1", "bynull-servo", "ovh-us"],
      },
      {
        path: "infra/k0s/manifests/arc/network-policy.yaml",
        required: ["arc-job-container"],
        forbidden: ["arc-browser-job", "arc-browser-runner"],
      },
      {
        path: "infra/tasks/arc-placement.yml",
        required: [
          "infra/k0s/config/arc-browser-nodes",
          "workload=build",
          "workload=browser",
          '"nook.nokey.sh/arc-workload=$workload"',
          "nodeSelector: .nodeSelector",
          "affinity: .affinity",
          "(general,hive,container,browser)",
        ],
        forbidden: [],
      },
      {
        path: "infra/tasks/arc.yml",
        required: [
          "helm template nook-k0s-browser",
          "helm upgrade --install nook-k0s-browser",
          "browser-hook.yaml",
          "browser-runner-scale-set-values.yaml",
        ],
        forbidden: [],
      },
      {
        path: "infra/tasks/arc-smoke.yml",
        required: [
          "gh variable set NOOK_BROWSER_RUNS_ON --repo meta-secret/nook --body nook-k0s-browser",
          "gh variable set NOOK_BROWSER_RUNS_ON --repo meta-secret/nook --body ubuntu-latest",
        ],
        forbidden: [],
      },
    ];
    for (const source of sources) {
      const loaded = await new OperationalContractSource(
        resolve(this.root, source.path),
      ).read();
      if (loaded.isErr()) return err(loaded.error);
      const contract = new TextContract({
        label: source.path,
        source: loaded.value,
      });
      const required = contract.requireAll(source.required);
      if (required.isErr()) return err(required.error);
      const forbidden = contract.forbidAll(source.forbidden);
      if (forbidden.isErr()) return err(forbidden.error);
    }
    const loaded = await new OperationalContractSource(
      resolve(this.root, "infra/tasks/arc-separation.yml"),
    ).read();
    if (loaded.isErr()) return err(loaded.error);
    const source = loaded.value;
    const tasks = new TextContract({
      label: "ARC separation rollout",
      source,
    });
    const required = tasks.requireAll([
      "pools=(nook-k0s nook-k0s-container nook-k0s-hive)",
      "pools+=(nook-k0s-browser)",
      "--reuse-values --set minRunners=0 --set maxRunners=0",
      "kubectl get ephemeralrunnersets",
      "kubectl get ephemeralrunners",
      "kubectl get autoscalinglisteners",
      'kubectl patch ephemeralrunnerset "$runner_set"',
      '--type=merge -p \'{"spec":{"replicas":0,"patchID":0}}\'',
      '.kind == "AutoscalingRunnerSet" and .uid == $uid',
      "nook-k0s:35 nook-k0s-container:16 nook-k0s-browser:4 nook-k0s-hive:10",
      "- task: arc:placement:hive",
      "- task: arc:separation:idle",
      "- task: arc:separation:status",
      '"arc-job-container"',
      '"arc-browser-job"',
      ".spec.runnerScaleSetId > 0",
    ]);
    if (required.isErr()) return err(required.error);
    const forbidden = tasks.forbidAll([
      "kubectl delete",
      "helm uninstall",
      "rollout restart",
      "buildkit.yaml",
      "storage:prepare",
      "arc:deploy",
      "sleep ",
      "while :;",
      "until kubectl",
      "--force",
      "--atomic",
      "arc:build-hosts:activate",
    ]);
    if (forbidden.isErr()) return err(forbidden.error);
    const applyOrder = tasks.requireBefore({
      first: "- task: arc:separation:idle",
      second: "- task: arc:placement:labels",
    });
    if (applyOrder.isErr()) return err(applyOrder.error);
    const drainOrder = tasks.requireBefore({
      first: "still has its old listener; inspect native reconciliation",
      second: 'kubectl patch ephemeralrunnerset "$runner_set"',
    });
    if (drainOrder.isErr()) return err(drainOrder.error);
    return new ArcSeparationDrainContract(source).assert();
  }
}

class ArcSeparationDrainContract {
  constructor(private readonly source: string) {}

  assert(): Result<void, OperationalContractFailure> {
    const podGuard = this.source.match(
      /remaining=.*?\| jq '([^']+)'/s,
    )?.[1];
    const templateGuard = this.source.match(
      /jq -e '(\.items \| length >= 4[^']+)'/,
    )?.[1];
    const replicaGuard = this.source.match(
      /jq -e '(all\(\.items\[\]; \(\.spec\.replicas[^']+)'/,
    )?.[1];
    const listenerGuard = this.source.match(
      /jq -e --arg pool "\$pool" '([^']+)'/,
    )?.[1];
    if (!podGuard || !templateGuard || !replicaGuard || !listenerGuard) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "ARC separation drain guards are missing",
      });
    }
    const currentTemplate = {
      spec: {
        ephemeralRunnerSpec: {
          spec: { nodeSelector: { "nook.nokey.sh/arc-workload": "build" } },
        },
      },
    };
    const fixtures: { guard: string; input: object; expected: string }[] = [
      { guard: listenerGuard, input: { items: [] }, expected: "true" },
      {
        guard: listenerGuard,
        input: {
          items: [
            {
              spec: {
                autoscalingRunnerSetNamespace: "arc-runners",
                autoscalingRunnerSetName: "nook-k0s",
              },
            },
          ],
        },
        expected: "true",
      },
      {
        guard: listenerGuard,
        input: {
          items: [
            {
              spec: {
                autoscalingRunnerSetNamespace: "arc-runners",
                autoscalingRunnerSetName: "nook-k0s",
                minRunners: 0,
                maxRunners: 35,
              },
            },
          ],
        },
        expected: "false",
      },
      {
        guard: listenerGuard,
        input: {
          items: [
            {
              metadata: {
                deletionTimestamp: "2026-10-18T00:00:00Z",
                finalizers: [
                  "autoscalinglistener.actions.github.com/finalizer",
                ],
              },
              spec: {
                autoscalingRunnerSetNamespace: "arc-runners",
                autoscalingRunnerSetName: "nook-k0s",
                minRunners: 0,
                maxRunners: 35,
              },
            },
          ],
        },
        expected: "false",
      },
      {
        guard: templateGuard,
        input: { items: Array.from({ length: 4 }, () => currentTemplate) },
        expected: "true",
      },
      {
        guard: templateGuard,
        input: {
          items: [
            currentTemplate,
            currentTemplate,
            currentTemplate,
            { spec: { ephemeralRunnerSpec: { spec: {} } } },
          ],
        },
        expected: "false",
      },
      {
        guard: replicaGuard,
        input: {
          items: [
            { spec: { replicas: 0 }, status: { currentReplicas: 0 } },
          ],
        },
        expected: "true",
      },
      {
        guard: replicaGuard,
        input: {
          items: [
            { spec: { replicas: 1 }, status: { currentReplicas: 0 } },
          ],
        },
        expected: "false",
      },
      {
        guard: replicaGuard,
        input: {
          items: [
            { spec: { replicas: 0 }, status: { currentReplicas: 1 } },
          ],
        },
        expected: "false",
      },
      { guard: podGuard, input: { items: [] }, expected: "0" },
    ];
    for (const role of ["arc-job-container", "arc-browser-job"]) {
      for (const phase of ["Pending", "Running"]) {
        fixtures.push({
          guard: podGuard,
          input: {
            items: [
              {
                metadata: {
                  labels: { "nook.nokey.sh/role": role },
                  deletionTimestamp: "2026-10-18T00:00:00Z",
                },
                status: { phase },
              },
            ],
          },
          expected: "1",
        });
      }
    }
    fixtures.push({
      guard: podGuard,
      input: {
        items: [
          {
            metadata: {
              labels: {
                "actions.github.com/scale-set-name": "nook-k0s-hive",
              },
            },
            status: { phase: "Pending" },
          },
        ],
      },
      expected: "1",
    });
    for (const fixture of fixtures) {
      const result = new OperationalCommandProbe({
        cmd: [
          "jq",
          "-c",
          "-n",
          "--argjson",
          "input",
          JSON.stringify(fixture.input),
          `"nook-k0s" as $pool | $input | (${fixture.guard})`,
        ],
        stdout: OperationalProbeStream.Pipe,
        stderr: OperationalProbeStream.Pipe,
      }).execute();
      if (result.isErr()) return err(result.error);
      if (
        result.value.exitCode !== 0 ||
        result.value.stdout.trim() !== fixture.expected
      ) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message:
            "ARC separation must reject stale templates and pending or terminating work",
        });
      }
    }
    return ok();
  }
}
