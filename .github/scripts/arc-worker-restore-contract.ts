import { resolve } from "node:path";

import {
  WorkerRestoreTransport,
  WorkerRestoreTransportArguments,
  type WorkerRestoreTransportWire,
} from "./k0s-worker-restore-transport";
import { TextContract } from "./text-contract";

enum SelectorDecodeKind {
  Found = "found",
  Missing = "missing",
}

type SelectorDecodeOutcome =
  | { kind: SelectorDecodeKind.Found; selector: string }
  | { kind: SelectorDecodeKind.Missing };

enum RestoreProgramFrame {
  Invalid = "not-base64!",
  Empty = "",
  InvalidShell = "aWYgdGhlbgo=",
}

class ActiveRunnerSelectorContract {
  static decode(source: string): SelectorDecodeOutcome {
    const match = source.match(/active_runners=.*?\| jq \\\s*\n\s*'([^']+)'/s);
    if (!Array.isArray(match)) return { kind: SelectorDecodeKind.Missing };
    return { kind: SelectorDecodeKind.Found, selector: match[1] };
  }

  static assert(source: string): void {
    const outcome = ActiveRunnerSelectorContract.decode(source);
    if (outcome.kind === SelectorDecodeKind.Missing) {
      throw new Error("k0s worker install active-runner selector is missing");
    }
    const selection = Bun.spawnSync({
      cmd: [
        "jq",
        "-nr",
        "--argjson",
        "input",
        JSON.stringify({
          items: [
            { metadata: {}, status: { phase: "Pending" } },
            { metadata: {}, status: { phase: "Running" } },
            {
              metadata: { deletionTimestamp: "2026-09-08T05:17:03Z" },
              status: { phase: "Running" },
            },
            { metadata: {}, status: { phase: "Succeeded" } },
          ],
        }),
        `$input | ${outcome.selector}`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (
      selection.exitCode !== 0 ||
      selection.stdout.toString().trim() !== "2"
    ) {
      throw new Error(
        `k0s worker install active-runner selector failed: ${selection.stderr.toString()}`,
      );
    }
  }
}

class WorkerRestoreTransportContract {
  static async assert(root: string): Promise<void> {
    const transportPath = resolve(
      root,
      ".github/scripts/k0s-worker-restore-transport.ts",
    );
    const transport = new TextContract({
      label: "k0s worker restore transport",
      source: await Bun.file(transportPath).text(),
    });
    transport.requireAll([
      'if ! IFS= read -r encoded_program || test -z "$encoded_program"; then',
      'if ! printf \'%s\' "$encoded_program" | base64 -d > "$program_file"; then',
      'if ! test -s "$program_file"; then',
      'bash -n "$program_file"',
      'bash "$program_file" "$@"',
      "stdin: new Blob([wire.payload])",
    ]);
    const restoreProbe = `set -euo pipefail
IFS= read -r token
test "$token" = framed-token
printf restore-transport-ok
exit 0`;
    const successArguments = WorkerRestoreTransportArguments.parse([
      "controller",
      "worker",
      "10.202.0.3",
      "secondary",
      Buffer.from(restoreProbe).toString("base64"),
    ]);
    const successWire = WorkerRestoreTransport.wire(
      successArguments,
      "framed-token\n",
    );
    WorkerRestoreTransportContract.assertTokenOutsideArguments(successWire);
    const output = await WorkerRestoreTransportContract.execute(successWire);
    if (output !== "restore-transport-ok") {
      throw new Error("k0s worker restore transport round trip failed");
    }
    for (const frame of Object.values(RestoreProgramFrame)) {
      let rejected = false;
      try {
        const argumentsValue = WorkerRestoreTransportArguments.parse([
          "controller",
          "worker",
          "10.202.0.3",
          "secondary",
          frame,
        ]);
        const wire = WorkerRestoreTransport.wire(
          argumentsValue,
          "framed-token\n",
        );
        await WorkerRestoreTransportContract.execute(wire);
      } catch {
        rejected = true;
      }
      if (!rejected) {
        throw new Error(
          "k0s worker restore transport accepted an invalid frame",
        );
      }
    }
  }

  private static assertTokenOutsideArguments(
    wire: WorkerRestoreTransportWire,
  ): void {
    if (wire.sshArguments.some((value) => value.includes("framed-token"))) {
      throw new Error("k0s worker restore token entered SSH arguments");
    }
    const remoteCommand = wire.sshArguments.join(" ");
    if (
      !remoteCommand.includes(wire.meshAddress) ||
      !remoteCommand.includes(wire.arcTier)
    ) {
      throw new Error("k0s worker restore arguments left the SSH wire");
    }
  }

  private static async execute(
    wire: WorkerRestoreTransportWire,
  ): Promise<string> {
    const frameEnd = wire.payload.indexOf("\n");
    if (frameEnd < 1) throw new Error("missing encoded program frame");
    const encodedProgram = wire.payload.slice(0, frameEnd);
    const token = wire.payload.slice(frameEnd + 1);
    const decoded = Bun.spawnSync({
      cmd: ["base64", "-d"],
      stdin: new Blob([encodedProgram]),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (decoded.exitCode !== 0 || decoded.stdout.length === 0) {
      throw new Error("invalid encoded program frame");
    }
    const syntax = Bun.spawnSync({
      cmd: ["bash", "-n"],
      stdin: new Blob([decoded.stdout]),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (syntax.exitCode !== 0) throw new Error("invalid decoded program");
    const execution = Bun.spawnSync({
      cmd: ["bash"],
      stdin: new Blob([decoded.stdout, "\n", token]),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (execution.exitCode !== 0) throw new Error("decoded program failed");
    return execution.stdout.toString();
  }
}

class ArcWorkerRestoreContract {
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
    const restore = ArcWorkerRestoreContract.taskSection(
      tasksSource,
      "k0s:worker:restore",
      "k0s:worker:status",
    );
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
      ".github/scripts/k0s-worker-restore-transport.ts",
      "printf '%s' \"$token\"",
      "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      "actions.github.com/scale-set-name",
      "select(.metadata.deletionTimestamp == n" +
        'ull and (.status.phase == "Pending" or .status.phase == "Running"))',
      "Timed out waiting for $active_runners ARC runner(s) on $node",
      "worker_was_active=false",
      "sudo -n systemctl restart k0sworker.service",
      "sudo -n systemctl is-active --quiet k0sworker.service",
      'sudo -n k0s kubectl wait "node/$node" --for=condition=Ready --timeout=5m',
    ]);
    install.forbidAll([
      'bash -c "\\$(printf %s',
      "infra/k0s/scripts/k0s-worker-restore-transport",
    ]);
    ActiveRunnerSelectorContract.assert(installSource);
    install.requireBefore({
      first: "nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite",
      second: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
    });
    install.requireBefore({
      first: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
      second: "sudo -n systemctl restart k0sworker.service",
    });
    install.requireBefore({
      first: "sudo -n systemctl restart k0sworker.service",
      second:
        'sudo -n k0s kubectl wait "node/$node" --for=condition=Ready --timeout=5m',
    });
    restore.requireAll([
      "- task: k0s:worker:install",
      "test \"$(printf '%s\\n' \"$node\" | sed '/^$/d' | wc -l | tr -d ' ')\" = 1",
      'select(.type == "Ready") | .status',
      '.metadata.labels["nook.nokey.sh/node-role"]',
      '.metadata.labels["nook.nokey.sh/arc-build"]',
      'kubectl uncordon "$node"',
      "nook.nokey.sh/arc-build=preparing:NoSchedule-",
      ".spec.unschedulable // false",
      "test \"$(jq -c '[.spec.taints[]?] | sort_by(.key, .effect, .value)'",
    ]);
    for (const first of [
      "- task: k0s:worker:install",
      'select(.type == "Ready") | .status',
      'preserved_taints="$(jq -c',
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
    await WorkerRestoreTransportContract.assert(root);
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

export async function assertArcWorkerRestoreContract(input: {
  root: string;
}): Promise<void> {
  await ArcWorkerRestoreContract.assert(input.root);
}
