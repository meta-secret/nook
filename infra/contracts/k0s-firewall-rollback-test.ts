import { err, ok, type Result } from "neverthrow";
import {
  FixtureFile,
  FixtureDirectory,
  FixtureWorkspaceRequest,
  FixtureEmbeddedSource,
} from "./operational-fixture";
import {
  OperationalCommandProbe,
  OperationalProbeStream,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { join, resolve } from "node:path";

class FirewallFunctionSource {
  constructor(
    private readonly request: { start: string; declaration: string },
  ) {}
  execute(): Result<string, OperationalContractFailure> {
    const input = this.request;

    const task = new FixtureFile(taskfile).read();
    if (task.isErr()) return err(task.error);
    return new FixtureEmbeddedSource(task.value)
      .between(input.start, functionEnd)
      .map((body) => `${input.declaration}\n${body.replace(/^ {8}/gm, "")}`);
  }
}

class FirewallExecutable {
  constructor(private readonly request: { path: string; source: string }) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    const prepared3 = new FixtureFile(input.path).write(input.source);
    if (prepared3.isErr()) return err(prepared3.error);
    return new FixtureFile(input.path).makeExecutable();
  }
}

class FirewallRollbackScenario {
  constructor(
    private readonly request: { mode: RollbackExitMode; source: string },
  ) {}
  execute(): Result<void, OperationalContractFailure> {
    const workspace = new FixtureWorkspaceRequest(
      "nook-firewall-rollback-",
    ).create();
    if (workspace.isErr()) return err(workspace.error);
    return workspace.value.finish(this.executeIn(workspace.value.path));
  }
  private executeIn(work: string): Result<void, OperationalContractFailure> {
    const exitMode = this.request.mode;
    const rollbackSource = this.request.source;
    const mockBin = join(work, "bin");
    const prepared1 = new FixtureDirectory(mockBin).create();
    if (prepared1.isErr()) return err(prepared1.error);
    const inputState = join(work, "input");
    const forwardState = join(work, "forward");
    const config = join(work, "nftables.conf");
    const fragment = join(work, "nook-k0s.nft");
    const previousConfig = join(work, "previous.conf");
    const previousFragment = join(work, "previous.nft");
    const previousLive = join(work, "previous-live.nft");
    const originalInput =
      'add rule inet bynull_filter input tcp dport 6443 accept comment "nook k0s pod control plane v2"\n' +
      'add rule inet bynull_filter input counter drop comment "later input rule"\n';
    const originalForward =
      'add rule inet bynull_filter forward ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress v2"\n' +
      'add rule inet bynull_filter forward counter drop comment "later forward rule"\n';
    const originalConfig = "table inet bynull_filter { # original }\n";
    const originalFragment = originalInput + originalForward;
    const prepared4 = new FixtureFile(inputState).write(
      'add rule inet bynull_filter input accept comment "nook k0s pod control plane v3"\n',
    );
    if (prepared4.isErr()) return err(prepared4.error);
    const prepared5 = new FixtureFile(forwardState).write(
      'add rule inet bynull_filter forward accept comment "nook k0s pod egress v3 next"\n',
    );
    if (prepared5.isErr()) return err(prepared5.error);
    const prepared6 = new FixtureFile(config).write("mutated config\n");
    if (prepared6.isErr()) return err(prepared6.error);
    const prepared7 = new FixtureFile(fragment).write("mutated fragment\n");
    if (prepared7.isErr()) return err(prepared7.error);
    const prepared8 = new FixtureFile(previousConfig).write(originalConfig);
    if (prepared8.isErr()) return err(prepared8.error);
    const prepared9 = new FixtureFile(previousFragment).write(originalFragment);
    if (prepared9.isErr()) return err(prepared9.error);
    const prepared10 = new FixtureFile(previousLive).write(
      `flush chain inet bynull_filter input\n${originalInput}flush chain inet bynull_filter forward\n${originalForward}`,
    );
    if (prepared10.isErr()) return err(prepared10.error);
    const fixtureCommand = {
      path: join(mockBin, "fixture-command"),
      source: `#!/usr/bin/env bash
set -euo pipefail
if test "\${1:-}" = -n; then shift; fi
if test "\${1:-}" = nft && test "\${2:-}" = --handle; then
  chain="\${7}"
  if test "$chain" = input; then state="$MOCK_INPUT_STATE"; else state="$MOCK_FORWARD_STATE"; fi
  while IFS= read -r line; do
    expression="\${line#* $chain }"
    printf '  %s # handle 1\\n' "$expression"
  done < "$state"
elif test "\${1:-}" = nft && test "\${2:-}" = delete; then
  if test "\${5}" = input; then : > "$MOCK_INPUT_STATE"; else : > "$MOCK_FORWARD_STATE"; fi
elif test "\${1:-}" = nft && test "\${2:-}" = --file; then
  : > "$MOCK_INPUT_STATE"
  : > "$MOCK_FORWARD_STATE"
  while IFS= read -r line; do
    case "$line" in
      'flush chain '*) ;;
      *' input '*) printf '%s\\n' "$line" >> "$MOCK_INPUT_STATE" ;;
      *' forward '*) printf '%s\\n' "$line" >> "$MOCK_FORWARD_STATE" ;;
    esac
  done < "$3"
elif test "\${1:-}" = install; then
  source="\${@: -2:1}"
  destination="\${@: -1}"
  if test "$destination" = /etc/nftables.conf; then target="$MOCK_CONFIG"; else target="$MOCK_FRAGMENT"; fi
  cp "$source" "$target"
elif test "\${1:-}" = rm && test "\${2:-}" = -f; then
  rm -f "$MOCK_FRAGMENT"
else
  printf 'unexpected sudo command: %s\\n' "$*" >&2
  exit 2
fi
`,
    };
    const fixtureCommandReady = new FirewallExecutable(
      fixtureCommand,
    ).execute();
    if (fixtureCommandReady.isErr()) return err(fixtureCommandReady.error);
    const fixtureRollbackSource = rollbackSource.replaceAll(
      "sudo -n ",
      `${JSON.stringify(fixtureCommand.path)} `,
    );
    const trigger =
      exitMode === RollbackExitMode.Error ? "false" : "kill -TERM $$";
    const harness = {
      path: join(work, "harness.sh"),
      source: `#!/usr/bin/env bash
set -Eeuo pipefail
export MOCK_INPUT_STATE=${JSON.stringify(inputState)}
export MOCK_FORWARD_STATE=${JSON.stringify(forwardState)}
export MOCK_CONFIG=${JSON.stringify(config)}
export MOCK_FRAGMENT=${JSON.stringify(fragment)}
firewall_fragment=${join(work, "temporary-fragment")}
firewall_config=${join(work, "temporary-config")}
firewall_previous_config=${previousConfig}
firewall_previous_fragment=${previousFragment}
firewall_previous_live=${previousLive}
firewall_live_next=${join(work, "live-next.nft")}
firewall_fragment_existed=true
firewall_rollback_armed=true
encryption_config=""
cni_config_next=""
recovery_key=""
encrypted_backup=""
expected_mac=""
${fixtureRollbackSource}
trap rollback_k0s_firewall EXIT
trap rollback_k0s_firewall ERR
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
${trigger}
`,
    };
    const harnessReady = new FirewallExecutable(harness).execute();
    if (harnessReady.isErr()) return err(harnessReady.error);
    const processInput = {
      cmd: [harness.path],
      env: {
        ...process.env,
        PATH: `${mockBin}:${executablePath}`,
        MOCK_INPUT_STATE: inputState,
        MOCK_FORWARD_STATE: forwardState,
        MOCK_CONFIG: config,
        MOCK_FRAGMENT: fragment,
      },
      stdout: OperationalProbeStream.Inherit,
      stderr: OperationalProbeStream.Inherit,
    };
    const processResult = new OperationalCommandProbe(processInput).execute();
    if (processResult.isErr()) return err(processResult.error);
    const result = processResult.value;
    const expectedCode = exitMode === RollbackExitMode.Error ? 1 : 143;
    if (result.exitCode !== expectedCode) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${exitMode} rollback exited ${result.exitCode}, expected ${expectedCode}`,
      });
    }
    for (const comparison of [
      [inputState, originalInput],
      [forwardState, originalForward],
      [config, originalConfig],
      [fragment, originalFragment],
    ] as const) {
      const restored = new FixtureFile(comparison[0]).read();
      if (restored.isErr()) return err(restored.error);
      if (restored.value !== comparison[1]) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `rollback did not restore ${comparison[0]}`,
        });
      }
    }
    return ok();
  }
}

const { PATH: executablePath = "" } = process.env;

const root = resolve(import.meta.dir, "../..");
const taskfile = resolve(root, "infra/tasks/k0s.yml");
const rollbackStart = "        rollback_k0s_firewall() {\n";
const replaceStart = "        replace_k0s_firewall_rules() {\n";
const functionEnd = "        trap rollback_k0s_firewall EXIT\n";

class FirewallUninstallSource {
  read(): Result<string, OperationalContractFailure> {
    const task = new FixtureFile(taskfile).read();
    if (task.isErr()) return err(task.error);
    const start = "        sudo -n awk \\\n          '";
    const end = '\' \\\n          /etc/nftables.conf > "$firewall_config"\n';
    return new FixtureEmbeddedSource(task.value).between(start, end);
  }
}

enum RollbackExitMode {
  Error = "error",
  Signal = "signal",
}

class FirewallReplacementScenario {
  constructor(private readonly source: string) {}
  execute(): Result<void, OperationalContractFailure> {
    const workspace = new FixtureWorkspaceRequest(
      "nook-firewall-replace-",
    ).create();
    if (workspace.isErr()) return err(workspace.error);
    return workspace.value.finish(this.executeIn(workspace.value.path));
  }
  private executeIn(work: string): Result<void, OperationalContractFailure> {
    const replaceSource = this.source;
    const mockBin = join(work, "bin");
    const prepared2 = new FixtureDirectory(mockBin).create();
    if (prepared2.isErr()) return err(prepared2.error);
    const inputState = join(work, "input");
    const forwardState = join(work, "forward");
    const next = join(work, "next.nft");
    const prepared11 = new FixtureFile(inputState).write(
      'tcp dport 6443 accept comment "nook k0s pod control plane v2"\n' +
        'jump audit comment "unrelated input jump"\n' +
        'counter drop comment "later input drop"\n',
    );
    if (prepared11.isErr()) return err(prepared11.error);
    const prepared12 = new FixtureFile(forwardState).write(
      'ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress install"\n' +
        'jump audit comment "unrelated forward jump"\n' +
        'counter drop comment "later forward drop"\n',
    );
    if (prepared12.isErr()) return err(prepared12.error);
    const fixtureCommand = {
      path: join(mockBin, "fixture-command"),
      source: `#!/usr/bin/env bash
set -euo pipefail
if test "\${1:-}" = -n; then shift; fi
if test "\${1:-}" = nft && test "\${2:-}" = --handle; then
  chain="\${7}"
  if test "$chain" = input; then state="$MOCK_INPUT_STATE"; else state="$MOCK_FORWARD_STATE"; fi
  handle=0
  while IFS= read -r expression; do
    handle=$((handle + 1))
    printf '  %s # handle %s\\n' "$expression" "$handle"
  done < "$state"
elif test "\${1:-}" = nft && test "\${2:-}" = --check; then
  exit 0
elif test "\${1:-}" = nft && test "\${2:-}" = --file; then
  : > "$MOCK_INPUT_STATE"
  : > "$MOCK_FORWARD_STATE"
  while IFS= read -r line; do
    set -- $line
    if test "\${1:-}" = flush; then continue; fi
    if test "\${1:-}" = add && test "\${2:-}" = rule; then
      chain="$5"
      shift 5
      if test "$chain" = input; then state="$MOCK_INPUT_STATE"; else state="$MOCK_FORWARD_STATE"; fi
      printf '%s\\n' "$*" >> "$state"
    fi
  done < "$3"
else
  printf 'unexpected sudo command: %s\\n' "$*" >&2
  exit 2
fi
`,
    };
    const fixtureCommandReady = new FirewallExecutable(
      fixtureCommand,
    ).execute();
    if (fixtureCommandReady.isErr()) return err(fixtureCommandReady.error);
    const fixtureReplaceSource = replaceSource.replaceAll(
      "sudo -n ",
      `${JSON.stringify(fixtureCommand.path)} `,
    );
    const harness = {
      path: join(work, "harness.sh"),
      source: `#!/usr/bin/env bash
set -Eeuo pipefail
export MOCK_INPUT_STATE=${JSON.stringify(inputState)}
export MOCK_FORWARD_STATE=${JSON.stringify(forwardState)}
firewall_live_next=${next}
${fixtureReplaceSource}
replace_k0s_firewall_rules committed
`,
    };
    const harnessReady = new FirewallExecutable(harness).execute();
    if (harnessReady.isErr()) return err(harnessReady.error);
    const processInput = {
      cmd: [harness.path],
      env: {
        ...process.env,
        PATH: `${mockBin}:${executablePath}`,
        MOCK_INPUT_STATE: inputState,
        MOCK_FORWARD_STATE: forwardState,
      },
      stdout: OperationalProbeStream.Inherit,
      stderr: OperationalProbeStream.Inherit,
    };
    const processResult = new OperationalCommandProbe(processInput).execute();
    if (processResult.isErr()) return err(processResult.error);
    const result = processResult.value;
    if (result.exitCode !== 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `replacement exited ${result.exitCode}`,
      });
    const expectedInput =
      'iifname "kube-bridge" ip saddr 10.244.0.0/16 tcp dport { 6443, 8132, 10250 } accept comment "nook k0s pod control plane v3"\n' +
      'jump audit comment "unrelated input jump"\n' +
      'counter drop comment "later input drop"\n';
    const expectedForward =
      'iifname "kube-bridge" ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress v3"\n' +
      'jump audit comment "unrelated forward jump"\n' +
      'counter drop comment "later forward drop"\n';
    const actualInputResult = new FixtureFile(inputState).read();
    if (actualInputResult.isErr()) return err(actualInputResult.error);
    const actualInput = actualInputResult.value;
    const actualForwardResult = new FixtureFile(forwardState).read();
    if (actualForwardResult.isErr()) return err(actualForwardResult.error);
    const actualForward = actualForwardResult.value;
    if (actualInput !== expectedInput)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `input ordering changed:\n${actualInput}`,
      });
    if (actualForward !== expectedForward)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `forward ordering changed:\n${actualForward}`,
      });
    return ok();
  }
}

class FirewallContract {
  execute(): Result<void, OperationalContractFailure> {
    const rollbackInput = {
      start: rollbackStart,
      declaration: "rollback_k0s_firewall() {",
    };
    const rollbackSourceResult = new FirewallFunctionSource(
      rollbackInput,
    ).execute();
    if (rollbackSourceResult.isErr()) return err(rollbackSourceResult.error);
    const rollbackSource = rollbackSourceResult.value;
    const replaceInput = {
      start: replaceStart,
      declaration: "replace_k0s_firewall_rules() {",
    };
    const replaceSourceResult = new FirewallFunctionSource(
      replaceInput,
    ).execute();
    if (replaceSourceResult.isErr()) return err(replaceSourceResult.error);
    const replaceSource = replaceSourceResult.value;

    const rollbackError = new FirewallRollbackScenario({
      mode: RollbackExitMode.Error,
      source: rollbackSource,
    }).execute();
    if (rollbackError.isErr()) return err(rollbackError.error);
    const rollbackSignal = new FirewallRollbackScenario({
      mode: RollbackExitMode.Signal,
      source: rollbackSource,
    }).execute();
    if (rollbackSignal.isErr()) return err(rollbackSignal.error);
    const replacement = new FirewallReplacementScenario(
      replaceSource,
    ).execute();
    if (replacement.isErr()) return err(replacement.error);
    const nftablesConfig =
      'table inet bynull_filter {}\n  include   "/etc/nftables.d/nook-k0s.nft"   # managed\n' +
      'include "/etc/nftables.d/unrelated.nft"\n';
    const filter = new FirewallUninstallSource().read();
    if (filter.isErr()) return err(filter.error);
    const awkInput = {
      cmd: ["awk", filter.value],
      stdout: OperationalProbeStream.Pipe,
      stderr: OperationalProbeStream.Pipe,
      stdin: new Blob([nftablesConfig]),
    };
    const filteredResult = new OperationalCommandProbe(awkInput).execute();
    if (filteredResult.isErr()) return err(filteredResult.error);
    const filtered = filteredResult.value;
    if (filtered.exitCode !== 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "nftables uninstall filter failed",
      });
    const filteredText = filtered.stdout.toString();
    if (filteredText.includes("nook-k0s.nft"))
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "managed include was retained",
      });
    if (!filteredText.includes('include "/etc/nftables.d/unrelated.nft"')) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "unrelated include was removed",
      });
    }
    console.log("k0s firewall error and signal rollback: ok");
    console.log("k0s firewall successful replacement ordering: ok");
    console.log("k0s firewall include uninstall variants: ok");

    return ok();
  }
}
const outcome = new FirewallContract().execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
