import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      'stdin: new Blob([argumentsValue.encodedProgram, "\\n", token])',
    ]);
    const probeDirectory = await mkdtemp(
      join(tmpdir(), "nook-restore-contract-"),
    );
    try {
      const sshProbe = join(probeDirectory, "ssh");
      await writeFile(
        sshProbe,
        '#!/usr/bin/env bash\nset -euo pipefail\nfor value in "$@"; do\n' +
          '  test "$value" != framed-token\ndone\nremote="${!#}"\n' +
          'bash -c "$remote"\n',
      );
      await chmod(sshProbe, 0o700);
      const restoreProbe = `set -euo pipefail
test "$1" = 10.202.0.3
test "$2" = secondary
IFS= read -r token
test "$token" = framed-token
printf restore-transport-ok`;
      const environment = {
        ...process.env,
        PATH: `${probeDirectory}:${process.env.PATH}`,
      };
      const success = Bun.spawnSync({
        cmd: [
          "bun",
          transportPath,
          "controller",
          "worker",
          "10.202.0.3",
          "secondary",
          Buffer.from(restoreProbe).toString("base64"),
        ],
        env: environment,
        stdin: new Blob(["framed-token\n"]),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (
        success.exitCode !== 0 ||
        success.stdout.toString() !== "restore-transport-ok"
      ) {
        throw new Error(
          `k0s worker restore transport round trip failed: ${success.stderr.toString()}`,
        );
      }
      for (const frame of Object.values(RestoreProgramFrame)) {
        const failure = Bun.spawnSync({
          cmd: [
            "bun",
            transportPath,
            "controller",
            "worker",
            "10.202.0.3",
            "secondary",
            frame,
          ],
          env: environment,
          stdin: new Blob(["framed-token\n"]),
          stdout: "pipe",
          stderr: "pipe",
        });
        if (failure.exitCode === 0) {
          throw new Error(
            "k0s worker restore transport accepted an invalid frame",
          );
        }
      }
    } finally {
      await rm(probeDirectory, { recursive: true, force: true });
    }
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
