import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { PATH: executablePath = "" } = process.env;

const root = resolve(import.meta.dir, "../..");
const taskfile = resolve(root, "infra/tasks/k0s.yml");
const rollbackStart = "        rollback_k0s_firewall() {\n";
const replaceStart = "        replace_k0s_firewall_rules() {\n";
const functionEnd = "        trap rollback_k0s_firewall EXIT\n";

function functionSource(input: { start: string; declaration: string }): string {
  const task = readFileSync(taskfile, "utf8");
  const body = task
    .split(input.start)[1]
    .split(functionEnd)[0]
    .replace(/^ {8}/gm, "");
  return `${input.declaration}\n${body}`;
}

function uninstallFilter(): string {
  const task = readFileSync(taskfile, "utf8");
  const start = "        sudo -n awk \\\n          '";
  const end = '\' \\\n          /etc/nftables.conf > "$firewall_config"\n';
  return task.split(start)[1].split(end)[0];
}

function executable(input: { path: string; source: string }): void {
  writeFileSync(input.path, input.source);
  chmodSync(input.path, 0o755);
}

const rollbackInput = {
  start: rollbackStart,
  declaration: "rollback_k0s_firewall() {",
};
const rollbackSource = functionSource(rollbackInput);
const replaceInput = {
  start: replaceStart,
  declaration: "replace_k0s_firewall_rules() {",
};
const replaceSource = functionSource(replaceInput);

enum RollbackExitMode {
  Error = "error",
  Signal = "signal",
}

function rollbackCase(exitMode: RollbackExitMode): void {
  const work = mkdtempSync(join(tmpdir(), "nook-firewall-rollback-"));
  try {
    const mockBin = join(work, "bin");
    mkdirSync(mockBin);
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
    writeFileSync(
      inputState,
      'add rule inet bynull_filter input accept comment "nook k0s pod control plane v3"\n',
    );
    writeFileSync(
      forwardState,
      'add rule inet bynull_filter forward accept comment "nook k0s pod egress v3 next"\n',
    );
    writeFileSync(config, "mutated config\n");
    writeFileSync(fragment, "mutated fragment\n");
    writeFileSync(previousConfig, originalConfig);
    writeFileSync(previousFragment, originalFragment);
    writeFileSync(
      previousLive,
      `flush chain inet bynull_filter input\n${originalInput}flush chain inet bynull_filter forward\n${originalForward}`,
    );
    const sudoMock = {
      path: join(mockBin, "sudo"),
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
    executable(sudoMock);
    const trigger =
      exitMode === RollbackExitMode.Error ? "false" : "kill -TERM $$";
    const harness = {
      path: join(work, "harness.sh"),
      source: `#!/usr/bin/env bash
set -Eeuo pipefail
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
${rollbackSource}
trap rollback_k0s_firewall EXIT
trap rollback_k0s_firewall ERR
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
${trigger}
`,
    };
    executable(harness);
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
      stdout: "inherit" as const,
      stderr: "inherit" as const,
    };
    const result = Bun.spawnSync(processInput);
    const expectedCode = exitMode === "error" ? 1 : 143;
    if (result.exitCode !== expectedCode) {
      throw new Error(
        `${exitMode} rollback exited ${result.exitCode}, expected ${expectedCode}`,
      );
    }
    for (const comparison of [
      [inputState, originalInput],
      [forwardState, originalForward],
      [config, originalConfig],
      [fragment, originalFragment],
    ]) {
      if (readFileSync(comparison[0], "utf8") !== comparison[1]) {
        throw new Error(`rollback did not restore ${comparison[0]}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function successfulReplacementCase(): void {
  const work = mkdtempSync(join(tmpdir(), "nook-firewall-replace-"));
  try {
    const mockBin = join(work, "bin");
    mkdirSync(mockBin);
    const inputState = join(work, "input");
    const forwardState = join(work, "forward");
    const next = join(work, "next.nft");
    writeFileSync(
      inputState,
      'tcp dport 6443 accept comment "nook k0s pod control plane v2"\n' +
        'jump audit comment "unrelated input jump"\n' +
        'counter drop comment "later input drop"\n',
    );
    writeFileSync(
      forwardState,
      'ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress install"\n' +
        'jump audit comment "unrelated forward jump"\n' +
        'counter drop comment "later forward drop"\n',
    );
    const sudoMock = {
      path: join(mockBin, "sudo"),
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
    executable(sudoMock);
    const harness = {
      path: join(work, "harness.sh"),
      source: `#!/usr/bin/env bash
set -Eeuo pipefail
firewall_live_next=${next}
${replaceSource}
replace_k0s_firewall_rules committed
`,
    };
    executable(harness);
    const processInput = {
      cmd: [harness.path],
      env: {
        ...process.env,
        PATH: `${mockBin}:${executablePath}`,
        MOCK_INPUT_STATE: inputState,
        MOCK_FORWARD_STATE: forwardState,
      },
      stdout: "inherit" as const,
      stderr: "inherit" as const,
    };
    const result = Bun.spawnSync(processInput);
    if (result.exitCode !== 0)
      throw new Error(`replacement exited ${result.exitCode}`);
    const expectedInput =
      'iifname "kube-bridge" ip saddr 10.244.0.0/16 tcp dport { 6443, 8132, 10250 } accept comment "nook k0s pod control plane v3"\n' +
      'jump audit comment "unrelated input jump"\n' +
      'counter drop comment "later input drop"\n';
    const expectedForward =
      'iifname "kube-bridge" ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress v3"\n' +
      'jump audit comment "unrelated forward jump"\n' +
      'counter drop comment "later forward drop"\n';
    const actualInput = readFileSync(inputState, "utf8");
    const actualForward = readFileSync(forwardState, "utf8");
    if (actualInput !== expectedInput)
      throw new Error(`input ordering changed:\n${actualInput}`);
    if (actualForward !== expectedForward)
      throw new Error(`forward ordering changed:\n${actualForward}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

rollbackCase(RollbackExitMode.Error);
rollbackCase(RollbackExitMode.Signal);
successfulReplacementCase();
const nftablesConfig =
  'table inet bynull_filter {}\n  include   "/etc/nftables.d/nook-k0s.nft"   # managed\n' +
  'include "/etc/nftables.d/unrelated.nft"\n';
const awkInput = {
  cmd: ["awk", uninstallFilter()],
  stdin: Buffer.from(nftablesConfig),
};
const filtered = Bun.spawnSync(awkInput);
if (filtered.exitCode !== 0)
  throw new Error("nftables uninstall filter failed");
const filteredText = filtered.stdout.toString();
if (filteredText.includes("nook-k0s.nft"))
  throw new Error("managed include was retained");
if (!filteredText.includes('include "/etc/nftables.d/unrelated.nft"')) {
  throw new Error("unrelated include was removed");
}
console.log("k0s firewall error and signal rollback: ok");
console.log("k0s firewall successful replacement ordering: ok");
console.log("k0s firewall include uninstall variants: ok");
