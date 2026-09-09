import { resolve } from "node:path";

import { TextContract } from "./text-contract";

enum SelectorDecodeKind {
  Found = "found",
  Missing = "missing",
}

type SelectorDecodeOutcome =
  | { kind: SelectorDecodeKind.Found; selectors: readonly string[] }
  | { kind: SelectorDecodeKind.Missing };

enum RunnerDrainCase {
  Both = "both",
  BrowserOnly = "browser-only",
  BrowserTerminating = "browser-terminating",
  Disappeared = "disappeared",
  ScaleSetOnly = "scale-set-only",
  ScaleSetTerminating = "scale-set-terminating",
}

enum WorkerServiceState {
  Active = "active",
  Fresh = "fresh",
  Invalid = "invalid",
  Resumed = "resumed",
}

enum WorkerServiceInputState {
  InstalledActive = "installed-active",
  InstalledInactive = "installed-inactive",
  MissingActive = "missing-active",
  MissingInactive = "missing-inactive",
}

enum WorkerReclaimInputState {
  ActiveExisting = "active-existing",
  ActiveWithoutUnit = "active-without-unit",
  FreshExisting = "fresh-existing",
  ResumedExisting = "resumed-existing",
}

enum WorkerReclaimOutcome {
  Accepted = "accepted",
  Rejected = "rejected",
}

enum PreparingTaintCase {
  Ambiguous = "ambiguous",
  Exact = "exact",
  Missing = "missing",
  WrongEffect = "wrong-effect",
  WrongValue = "wrong-value",
}

enum WorkerTokenCleanupCase {
  FollowUpFailure = "follow-up-failure",
  FollowUpFailureAndCleanupFailure = "follow-up-and-cleanup-failure",
  Success = "success",
  SuccessAndCleanupFailure = "success-and-cleanup-failure",
}

class WorkerTokenCleanupContract {
  static assert(source: string): void {
    const sessionStart = source.indexOf(
      "        {\n          printf '%s\\n' \"$worker_mesh_address\"",
    );
    const sessionEnd = source.indexOf("        token=\n", sessionStart);
    if (sessionStart < 0 || sessionEnd < 0) {
      throw new Error("k0s worker token-bearing SSH session is missing");
    }
    const session = new TextContract({
      label: "k0s worker token-bearing SSH session",
      source: source.slice(sessionStart, sessionEnd),
    });
    session.count({
      fragment: 'ssh -o BatchMode=yes -J "$controller_target" "$worker_target"',
      expected: 1,
    });
    session.requireAll([
      "printf '%s' \"$token\"",
      "IFS= read -r worker_mesh_address",
      'token_temp="$(mktemp)"',
      "trap cleanup_worker_token EXIT",
      'cat > "$token_temp"',
      'sudo -n install -m 0600 "$token_temp" /etc/k0s/worker-token',
      "sudo -n k0s install worker",
      "sudo -n rm -f /etc/k0s/worker-token",
      "sudo -n test ! -e /etc/k0s/worker-token",
    ]);
    const start = source.indexOf("        cleanup_worker_token() {");
    const end = source.indexOf("        trap cleanup_worker_token EXIT", start);
    if (start < 0 || end < 0) {
      throw new Error("k0s worker token cleanup function is missing");
    }
    const cleanupFunction = source.slice(start, end);
    const cases = [
      {
        kind: WorkerTokenCleanupCase.Success,
        commandStatus: 0,
        cleanupStatus: 0,
        expectedStatus: 0,
      },
      {
        kind: WorkerTokenCleanupCase.FollowUpFailure,
        commandStatus: 37,
        cleanupStatus: 0,
        expectedStatus: 37,
      },
      {
        kind: WorkerTokenCleanupCase.FollowUpFailureAndCleanupFailure,
        commandStatus: 37,
        cleanupStatus: 9,
        expectedStatus: 37,
      },
      {
        kind: WorkerTokenCleanupCase.SuccessAndCleanupFailure,
        commandStatus: 0,
        cleanupStatus: 9,
        expectedStatus: 1,
      },
    ] as const;
    for (const scenario of cases) {
      const program = `
set -euo pipefail
rm() {
  printf 'temp-delete-attempted\\n'
  return "$cleanup_result"
}
sudo() {
  printf 'remote-delete-attempted\\n'
  return "$cleanup_result"
}
${cleanupFunction}
cleanup_result=${scenario.cleanupStatus}
token_temp=/tmp/nook-worker-token-contract
trap cleanup_worker_token EXIT
exit ${scenario.commandStatus}
`;
      const result = Bun.spawnSync({
        cmd: ["bash"],
        stdin: new Blob([program]),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (
        result.exitCode !== scenario.expectedStatus ||
        result.stdout.toString() !==
          "temp-delete-attempted\n" +
            "remote-delete-attempted\n" +
            "remote-delete-attempted\n"
      ) {
        throw new Error(`k0s worker token cleanup failed: ${scenario.kind}`);
      }
      const error = result.stderr.toString();
      if (
        scenario.cleanupStatus !== 0 &&
        !error.includes(
          `token cleanup failed after command status ${scenario.commandStatus}`,
        )
      ) {
        throw new Error("k0s worker token cleanup failure is not actionable");
      }
    }
  }
}

class WorkerPreparingTaintContract {
  static assert(source: string): void {
    const contract = new TextContract({
      label: "k0s worker preparing taint",
      source,
    });
    contract.requireAll([
      'preparing_taint_state="$(jq -r',
      'select(.key == "nook.nokey.sh/arc-build")',
      '.value == "preparing" and .effect == "NoSchedule"',
      "test \"$preparing_taint_state\" = $'1\\t1'",
    ]);
    const fixtures = new Map([
      [
        PreparingTaintCase.Exact,
        [
          {
            key: "nook.nokey.sh/arc-build",
            value: "preparing",
            effect: "NoSchedule",
          },
        ],
      ],
      [PreparingTaintCase.Missing, []],
      [
        PreparingTaintCase.WrongValue,
        [
          {
            key: "nook.nokey.sh/arc-build",
            value: "wrong",
            effect: "NoSchedule",
          },
        ],
      ],
      [
        PreparingTaintCase.WrongEffect,
        [
          {
            key: "nook.nokey.sh/arc-build",
            value: "preparing",
            effect: "PreferNoSchedule",
          },
        ],
      ],
      [
        PreparingTaintCase.Ambiguous,
        [
          {
            key: "nook.nokey.sh/arc-build",
            value: "preparing",
            effect: "NoSchedule",
          },
          {
            key: "nook.nokey.sh/arc-build",
            value: "wrong",
            effect: "NoSchedule",
          },
        ],
      ],
    ] as const);
    const query = `[.spec.taints[]? |
      select(.key == "nook.nokey.sh/arc-build")] |
      [length, map(select(.value == "preparing" and .effect == "NoSchedule")) |
      length] | @tsv`;
    for (const [label, taints] of fixtures) {
      const result = Bun.spawnSync({
        cmd: [
          "jq",
          "-nr",
          "--argjson",
          "node",
          JSON.stringify({ spec: { taints } }),
          `$node | ${query}`,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      const accepted =
        result.exitCode === 0 && result.stdout.toString().trim() === "1\t1";
      if (accepted !== (label === PreparingTaintCase.Exact)) {
        throw new Error(`k0s worker preparing taint accepted ${label}`);
      }
    }
  }
}

class WorkerServiceStateContract {
  private static readonly resolutions: Record<
    WorkerServiceInputState,
    WorkerServiceState
  > = {
    [WorkerServiceInputState.InstalledActive]: WorkerServiceState.Active,
    [WorkerServiceInputState.InstalledInactive]: WorkerServiceState.Resumed,
    [WorkerServiceInputState.MissingActive]: WorkerServiceState.Invalid,
    [WorkerServiceInputState.MissingInactive]: WorkerServiceState.Fresh,
  };
  private static readonly reclaimOutcomes: Record<
    WorkerReclaimInputState,
    WorkerReclaimOutcome
  > = {
    [WorkerReclaimInputState.ActiveExisting]: WorkerReclaimOutcome.Accepted,
    [WorkerReclaimInputState.ActiveWithoutUnit]: WorkerReclaimOutcome.Rejected,
    [WorkerReclaimInputState.FreshExisting]: WorkerReclaimOutcome.Accepted,
    [WorkerReclaimInputState.ResumedExisting]: WorkerReclaimOutcome.Accepted,
  };

  static assert(source: string): void {
    const fixtures = [
      {
        expected: WorkerServiceState.Active,
        input: WorkerServiceInputState.InstalledActive,
      },
      {
        expected: WorkerServiceState.Resumed,
        input: WorkerServiceInputState.InstalledInactive,
      },
      {
        expected: WorkerServiceState.Fresh,
        input: WorkerServiceInputState.MissingInactive,
      },
      {
        expected: WorkerServiceState.Invalid,
        input: WorkerServiceInputState.MissingActive,
      },
    ] as const;
    for (const fixture of fixtures) {
      const observed = WorkerServiceStateContract.resolve(fixture.input);
      if (observed !== fixture.expected) {
        throw new Error("k0s worker service-state transition is unsafe");
      }
    }
    for (const input of [
      WorkerReclaimInputState.ActiveExisting,
      WorkerReclaimInputState.FreshExisting,
      WorkerReclaimInputState.ResumedExisting,
    ]) {
      if (
        WorkerServiceStateContract.reclaimOutcomes[input] !==
        WorkerReclaimOutcome.Accepted
      ) {
        throw new Error(`k0s worker reclaim rejected ${input}`);
      }
    }
    if (
      WorkerServiceStateContract.reclaimOutcomes[
        WorkerReclaimInputState.ActiveWithoutUnit
      ] !== WorkerReclaimOutcome.Rejected
    ) {
      throw new Error(
        "k0s worker reclaim accepted active service without unit",
      );
    }
    const contract = new TextContract({
      label: "k0s worker service-state transition",
      source,
    });
    contract.requireAll([
      "sudo -n systemctl cat k0sworker.service",
      "sudo -n systemctl start k0sworker.service",
      "printf resumed",
      "printf fresh",
      "active service has no installed unit",
      'if test "$worker_service_state" = fresh && test -z "$node"; then',
      'test -n "$node"',
      '.metadata.labels["nook.nokey.sh/node-role"]',
      '.metadata.labels["nook.nokey.sh/arc-build"]',
      'if test "$worker_service_state" != fresh; then',
    ]);
    contract.requireBefore({
      first: 'test -n "$node"',
      second:
        "Timed out waiting for $active_workloads terminating ARC workload(s) on $node",
    });
  }

  private static resolve(input: WorkerServiceInputState): WorkerServiceState {
    return WorkerServiceStateContract.resolutions[input];
  }
}

class ArcWorkloadDrainContract {
  static decode(source: string): SelectorDecodeOutcome {
    const selectors = Array.from(
      source.matchAll(/active_workloads=.*?\| jq '([^']+)'/gs),
      (match) => match[1],
    );
    if (selectors.length !== 2) return { kind: SelectorDecodeKind.Missing };
    return { kind: SelectorDecodeKind.Found, selectors };
  }

  static assert(source: string): void {
    const outcome = ArcWorkloadDrainContract.decode(source);
    if (outcome.kind === SelectorDecodeKind.Missing) {
      throw new Error("k0s worker install workload selectors are missing");
    }
    const [nonTerminating, allActive] = outcome.selectors;
    const scaleSetPod = {
      metadata: {
        labels: { "actions.github.com/scale-set-name": "nook-k0s" },
      },
      status: { phase: "Running" },
    };
    const browserPod = {
      metadata: { labels: { "nook.nokey.sh/role": "arc-job-container" } },
      status: { phase: "Pending" },
    };
    const terminatingScaleSetPod = {
      ...scaleSetPod,
      metadata: {
        ...scaleSetPod.metadata,
        deletionTimestamp: "2026-09-08T05:17:03Z",
      },
    };
    const terminatingBrowserPod = {
      ...browserPod,
      metadata: {
        ...browserPod.metadata,
        deletionTimestamp: "2026-09-08T05:17:03Z",
      },
    };
    const fixtures = new Map([
      [RunnerDrainCase.ScaleSetOnly, { expected: [1, 1], pods: [scaleSetPod] }],
      [RunnerDrainCase.BrowserOnly, { expected: [1, 1], pods: [browserPod] }],
      [
        RunnerDrainCase.Both,
        { expected: [2, 2], pods: [scaleSetPod, browserPod] },
      ],
      [
        RunnerDrainCase.ScaleSetTerminating,
        { expected: [0, 1], pods: [terminatingScaleSetPod] },
      ],
      [
        RunnerDrainCase.BrowserTerminating,
        { expected: [0, 1], pods: [terminatingBrowserPod] },
      ],
      [RunnerDrainCase.Disappeared, { expected: [0, 0], pods: [] }],
    ] as const);
    for (const [label, fixture] of fixtures) {
      const selection = Bun.spawnSync({
        cmd: [
          "jq",
          "-c",
          "-nr",
          "--argjson",
          "input",
          JSON.stringify({ items: fixture.pods }),
          `$input | [(${nonTerminating}), (${allActive})]`,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (
        selection.exitCode !== 0 ||
        selection.stdout.toString().trim() !== JSON.stringify(fixture.expected)
      ) {
        throw new Error(`k0s worker ${label} drain selector failed`);
      }
    }
  }
}

export class ArcWorkerRestoreContract {
  static async assert(root: string): Promise<void> {
    const workerTasksSource = await Bun.file(
      resolve(root, "infra/tasks/k0s-workers.yml"),
    ).text();
    const restoreTasksSource = await Bun.file(
      resolve(root, "infra/tasks/k0s-worker-restore.yml"),
    ).text();
    const tasksSource = [workerTasksSource, restoreTasksSource].join("\n");
    const tasks = new TextContract({
      label: "k0s worker tasks",
      source: tasksSource,
    });
    const sync = ArcWorkerRestoreContract.taskSection(
      tasksSource,
      "k0s:worker:sync",
      "k0s:mesh:ensure",
    );
    const installSource = ArcWorkerRestoreContract.taskSource(
      restoreTasksSource,
      "k0s:worker:install",
      "k0s:worker:restore",
    );
    const install = new TextContract({
      label: "k0s:worker:install",
      source: installSource,
    });
    const restoreSource = ArcWorkerRestoreContract.finalTaskSource(
      restoreTasksSource,
      "k0s:worker:restore",
    );
    const restore = new TextContract({
      label: "k0s:worker:restore",
      source: restoreSource,
    });
    const status = ArcWorkerRestoreContract.taskSection(
      tasksSource,
      "k0s:worker:status",
      "k0s:worker:deploy",
    );
    const mesh = new TextContract({
      label: "k0s fleet worker mesh reconciliation",
      source: await Bun.file(
        resolve(root, "infra/k0s/scripts/k0s-worker-mesh-reconcile"),
      ).text(),
    });
    const containerHook = new TextContract({
      label: "ARC browser job container hook",
      source: await Bun.file(
        resolve(root, "infra/k0s/manifests/arc/container-hook.yaml"),
      ).text(),
    });
    tasks.requireAll([
      "10.202.0.1",
      "10.202.0.2",
      "INFRA_WORKER_MESH_ADDRESS",
      "nook.nokey.sh/arc-build=preparing:NoSchedule",
    ]);
    containerHook.requireAll([
      "namespace: arc-runners",
      "nook.nokey.sh/role: arc-job-container",
    ]);
    sync.requireAll([
      'controller_target="{{.INFRA_SSH_TARGET}}"',
      'ssh -n -o BatchMode=yes -J "$controller_target" "$worker_target"',
      'ssh -o BatchMode=yes -J "$controller_target" "$worker_target"',
    ]);
    tasks.count({
      fragment:
        'iifname "wg-nook" ip saddr 10.244.0.0/16 tcp dport 10250 accept comment "nook k0s worker kubelet mesh pods"',
      expected: 2,
    });
    install.requireAll([
      'worker_ssh_user="$(ssh -n -o BatchMode=yes -J "$controller_target"',
      'ssh -o BatchMode=yes -J "$controller_target" "$worker_target" bash -s --',
      'ssh -n -o BatchMode=yes -J "$controller_target" \\',
      "printf '%s' \"$token\"",
      'token_temp="$(mktemp)"',
      'cat > "$token_temp"',
      'test -s "$token_temp"',
      'worker_service_state="$(',
      "sudo -n systemctl cat k0sworker.service",
      "sudo -n systemctl start k0sworker.service",
      "printf resumed",
      "printf fresh",
      'case "$worker_service_state" in active|resumed|fresh)',
      "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      '.metadata.labels["actions.github.com/scale-set-name"] != n' + "ull",
      '.metadata.labels["nook.nokey.sh/role"] == "arc-job-container"',
      ".metadata.deletionTimestamp == n" + "ull",
      '.status.phase == "Pending" or .status.phase == "Running"',
      "Timed out waiting for $active_workloads ARC workload(s) on $node",
      "Timed out waiting for $active_workloads terminating ARC workload(s) on $node",
      "sudo -n systemctl restart k0sworker.service",
      "sudo -n systemctl is-active --quiet k0sworker.service",
      'sudo -n k0s kubectl wait "node/$node" --for=condition=Ready --timeout=5m',
      "trap cleanup_worker_token EXIT",
      "sudo -n rm -f /etc/k0s/worker-token",
      "sudo -n test ! -e /etc/k0s/worker-token",
      "token cleanup failed after command status $original_status",
    ]);
    install.forbidAll([
      'bash -c "\\$(printf %s',
      "infra/k0s/scripts/k0s-worker-restore-transport",
      ".github/scripts/k0s-worker-restore-transport.ts",
      "encoded_program",
      "base64 -d",
      'echo "$token"',
      '--token "$token"',
      "delete_worker_token",
      "worker_token_uploaded",
    ]);
    ArcWorkloadDrainContract.assert(installSource);
    WorkerServiceStateContract.assert(installSource);
    WorkerTokenCleanupContract.assert(installSource);
    WorkerPreparingTaintContract.assert(installSource);
    install.requireBefore({
      first: "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      second: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
    });
    install.requireBefore({
      first: "Timed out waiting for $active_workloads ARC workload(s) on $node",
      second: 'worker_service_state="$(',
    });
    install.requireBefore({
      first: "printf resumed",
      second:
        "Timed out waiting for $active_workloads terminating ARC workload(s) on $node",
    });
    install.requireBefore({
      first:
        "Timed out waiting for $active_workloads terminating ARC workload(s) on $node",
      second: 'token="$(ssh -n -o BatchMode=yes "$controller_target"',
    });
    install.requireBefore({
      first: 'test -s "$token_temp"',
      second: "sudo -n k0s install worker",
    });
    install.requireBefore({
      first: "trap cleanup_worker_token EXIT",
      second: 'cat > "$token_temp"',
    });
    restore.requireAll([
      "- task: k0s:worker:install",
      "test \"$(printf '%s\\n' \"$node\" | sed '/^$/d' | wc -l | tr -d ' ')\" = 1",
      'select(.type == "Ready") | .status',
      '.metadata.labels["nook.nokey.sh/node-role"]',
      '.metadata.labels["nook.nokey.sh/arc-build"]',
      'kubectl uncordon "$node"',
      "nook.nokey.sh/arc-build=preparing:NoSchedule-",
      "test \"$preparing_taint_state\" = $'1\\t1'",
      ".spec.unschedulable // false",
      "test \"$(jq -c '[.spec.taints[]?] | sort_by(.key, .effect, .value)'",
    ]);
    WorkerPreparingTaintContract.assert(restoreSource);
    for (const first of [
      "- task: k0s:worker:install",
      'select(.type == "Ready") | .status',
      'preserved_taints="$(jq -c',
      "test \"$preparing_taint_state\" = $'1\\t1'",
    ])
      restore.requireBefore({ first, second: 'kubectl uncordon "$node"' });
    restore.forbidAll([
      "k0s:mesh:ensure",
      "k0s:worker-mesh:reconcile",
      "kata:install",
      "k0s:worker:kata:verify",
      "arc:deploy",
      "rollout restart",
    ]);
    status.requireAll([
      'controller_target="{{.INFRA_SSH_TARGET}}"',
      'ssh -o BatchMode=yes -J "$controller_target" \\',
      "\"{{.INFRA_WORKER_SSH_TARGET}}\" 'bash -s'",
    ]);
    status.forbid('ssh -o BatchMode=yes "{{.INFRA_WORKER_SSH_TARGET}}"');
    mesh.count({
      fragment: "sudo -n systemctl restart k0sworker.service",
      expected: 1,
    });
    mesh.requireAll([
      'controller_kubelet_rule=\'    iifname "wg-nook" ip saddr 10.201.0.1 tcp dport 10250 accept comment "nook k0s worker kubelet controller"\'',
      "legacy_controller_kubelet_rule='    iifname \"wg-nook\" ip saddr 10.201.0.1 tcp dport 10250 accept'",
      'if test "$controller_kubelet_count" != 1; then',
      "Worker firewall must contain exactly one controller kubelet rule",
      "$0 == canonical || $0 == legacy { print canonical; print rule; next }",
      'sudo -n nft --check --file "$firewall_next"',
      'sudo -n install -m 0644 "$firewall_next" /etc/nftables.conf',
      'sudo -n nft --check --file "$live"',
      'sudo -n nft --file "$live"',
      "inspect_worker_containerd_auth",
      'set_mesh_pending "$node_name"',
      'restart) wait_for_arc_runners "$node_name"',
      "actions.github.com/scale-set-name",
      "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
      "sudo -n systemctl is-active --quiet k0sworker.service",
      "sport = :10250",
      "k0s worker did not start a clean containerd invocation",
      'wait_for_node_ready "$node_name"',
      "Worker containerd auth state changed during reconciliation",
      "/var/lib/k0s/nook-containerd-auth-clean-invocation",
      'previous_invocation="$invocation"',
    ]);
    mesh.requireBefore({
      first: 'previous_invocation="$invocation"',
      second: "sudo -n systemctl restart k0sworker.service",
    });
    mesh.requireBefore({
      first: "sudo -n systemctl restart k0sworker.service",
      second: "k0s worker did not start a clean containerd invocation",
    });
  }

  private static taskSection(
    source: string,
    startName: string,
    endName: string,
  ): TextContract {
    return new TextContract({
      label: startName,
      source: ArcWorkerRestoreContract.taskSource(source, startName, endName),
    });
  }

  private static taskSource(
    source: string,
    startName: string,
    endName: string,
  ): string {
    const start = source.indexOf(`  ${startName}:`);
    const end = source.indexOf(`  ${endName}:`, start);
    if (start < 0 || end < 0) throw new Error(`${startName} task is missing`);
    return source.slice(start, end);
  }

  private static finalTaskSource(source: string, taskName: string): string {
    const start = source.indexOf(`  ${taskName}:`);
    if (start < 0) throw new Error(`${taskName} task is missing`);
    return source.slice(start);
  }
}
