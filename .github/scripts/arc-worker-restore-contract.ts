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
  Live = "live",
  Terminating = "terminating",
  Disappeared = "disappeared",
}

enum WorkerServiceState {
  Active = "active",
  Fresh = "fresh",
  Invalid = "invalid",
  Resumed = "resumed",
}

enum PreparingTaintCase {
  Ambiguous = "ambiguous",
  Exact = "exact",
  Missing = "missing",
  WrongEffect = "wrong-effect",
  WrongValue = "wrong-value",
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
  static assert(source: string): void {
    const fixtures = [
      { active: true, expected: WorkerServiceState.Active, installed: true },
      { active: false, expected: WorkerServiceState.Resumed, installed: true },
      { active: false, expected: WorkerServiceState.Fresh, installed: false },
      { active: true, expected: WorkerServiceState.Invalid, installed: false },
    ] as const;
    for (const fixture of fixtures) {
      const observed = WorkerServiceStateContract.resolve(
        fixture.installed,
        fixture.active,
      );
      if (observed !== fixture.expected) {
        throw new Error("k0s worker service-state transition is unsafe");
      }
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
    ]);
  }

  private static resolve(
    installed: boolean,
    active: boolean,
  ): WorkerServiceState {
    if (!installed && active) return WorkerServiceState.Invalid;
    if (!installed) return WorkerServiceState.Fresh;
    if (active) return WorkerServiceState.Active;
    return WorkerServiceState.Resumed;
  }
}

class ActiveRunnerSelectorContract {
  static decode(source: string): SelectorDecodeOutcome {
    const selectors = Array.from(
      source.matchAll(/active_runners=.*?\| jq \\\s*\n\s*'([^']+)'/gs),
      (match) => match[1],
    );
    if (selectors.length !== 2) return { kind: SelectorDecodeKind.Missing };
    return { kind: SelectorDecodeKind.Found, selectors };
  }

  static assert(source: string): void {
    const outcome = ActiveRunnerSelectorContract.decode(source);
    if (outcome.kind === SelectorDecodeKind.Missing) {
      throw new Error("k0s worker install active-runner selector is missing");
    }
    const [nonTerminating, allActive] = outcome.selectors;
    const fixtures = new Map([
      [
        RunnerDrainCase.Live,
        {
          expected: [1, 1],
          pod: { metadata: {}, status: { phase: "Running" } },
        },
      ],
      [
        RunnerDrainCase.Terminating,
        {
          expected: [0, 1],
          pod: {
            metadata: { deletionTimestamp: "2026-09-08T05:17:03Z" },
            status: { phase: "Running" },
          },
        },
      ],
      [RunnerDrainCase.Disappeared, { expected: [0, 0], pod: false }],
    ] as const);
    for (const [label, fixture] of fixtures) {
      const items = fixture.pod === false ? [] : [fixture.pod];
      const selection = Bun.spawnSync({
        cmd: [
          "jq",
          "-c",
          "-nr",
          "--argjson",
          "input",
          JSON.stringify({ items }),
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
    const tasksSource = await Bun.file(
      resolve(root, "infra/tasks/k0s-workers.yml"),
    ).text();
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
      tasksSource,
      "k0s:worker:install",
      "k0s:worker:kata:verify",
    );
    const install = new TextContract({
      label: "k0s:worker:install",
      source: installSource,
    });
    const restoreSource = ArcWorkerRestoreContract.taskSource(
      tasksSource,
      "k0s:worker:restore",
      "k0s:worker:status",
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
    tasks.requireAll([
      "10.202.0.1",
      "10.202.0.2",
      "INFRA_WORKER_MESH_ADDRESS",
      "nook.nokey.sh/arc-build=preparing:NoSchedule",
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
      'cleanup() { rm -f "$token_temp"; }',
      "trap cleanup EXIT",
      'cat > "$token_temp"',
      'test -s "$token_temp"',
      'worker_service_state="$(',
      "sudo -n systemctl cat k0sworker.service",
      "sudo -n systemctl start k0sworker.service",
      "printf resumed",
      "printf fresh",
      'case "$worker_service_state" in active|resumed|fresh)',
      "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      "actions.github.com/scale-set-name",
      "select(.metadata.deletionTimestamp == n" +
        'ull and (.status.phase == "Pending" or .status.phase == "Running"))',
      'select(.status.phase == "Pending" or .status.phase == "Running")',
      "Timed out waiting for $active_runners ARC runner(s) on $node",
      "Timed out waiting for $active_runners terminating ARC runner(s) on $node",
      "sudo -n systemctl restart k0sworker.service",
      "sudo -n systemctl is-active --quiet k0sworker.service",
      'sudo -n k0s kubectl wait "node/$node" --for=condition=Ready --timeout=5m',
    ]);
    install.forbidAll([
      'bash -c "\\$(printf %s',
      "infra/k0s/scripts/k0s-worker-restore-transport",
      ".github/scripts/k0s-worker-restore-transport.ts",
      "encoded_program",
      "base64 -d",
      'echo "$token"',
      '--token "$token"',
    ]);
    ActiveRunnerSelectorContract.assert(installSource);
    WorkerServiceStateContract.assert(installSource);
    install.requireBefore({
      first: "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      second: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
    });
    install.requireBefore({
      first: "Timed out waiting for $active_runners ARC runner(s) on $node",
      second: 'worker_service_state="$(',
    });
    install.requireBefore({
      first: "printf resumed",
      second:
        "Timed out waiting for $active_runners terminating ARC runner(s) on $node",
    });
    install.requireBefore({
      first:
        "Timed out waiting for $active_runners terminating ARC runner(s) on $node",
      second: 'token="$(ssh -n -o BatchMode=yes "$controller_target"',
    });
    install.requireBefore({
      first: 'test -s "$token_temp"',
      second: "sudo -n k0s install worker",
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
}
