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

const root = resolve(import.meta.dir, "../..");
const taskfile = resolve(root, "infra/tasks/host-services.yml");
const taskStart = "  services:repair-network:\n";
const scriptStart = "        set -euo pipefail\n";
const scriptEnd = "        REMOTE\n";

function repairSource(remoteDirectory: string): string {
  const source = readFileSync(taskfile, "utf8").split(taskStart)[1];
  const embedded = source.split(scriptStart)[1].split(scriptEnd)[0];
  const dedented = embedded.replace(/^ {8}/gm, "");
  return `#!/usr/bin/env bash\nset -euo pipefail\n${dedented}`.replace(
    'remote_dir="{{.INFRA_REMOTE_DIR}}"',
    `remote_dir=${remoteDirectory}`,
  );
}

function executable(input: { path: string; source: string }): void {
  writeFileSync(input.path, input.source);
  chmodSync(input.path, 0o755);
}

interface RepairResult {
  code: number;
  commands: string;
}

function runCase(input: { existing: string[]; version: string }): RepairResult {
  const work = mkdtempSync(join(tmpdir(), "nook-network-repair-"));
  try {
    writeFileSync(join(work, "compose.yaml"), "services: {}\n");
    const mockBin = join(work, "bin");
    const state = join(work, "state");
    const log = join(work, "commands.log");
    mkdirSync(mockBin);
    mkdirSync(state);
    for (const item of input.existing) {
      writeFileSync(join(state, item), "");
    }
    const dockerMock = {
      path: join(mockBin, "docker"),
      source: `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "$MOCK_LOG"
if test "\${1:-}" = version; then printf '%s\\n' "$MOCK_DOCKER_VERSION"; fi
`,
    };
    executable(dockerMock);
    const sudoMock = {
      path: join(mockBin, "sudo"),
      source: `#!/usr/bin/env bash
set -euo pipefail
if test "\${1:-}" = -n; then shift; fi
printf 'sudo %s\\n' "$*" >> "$MOCK_LOG"
test "\${1:-}" = iptables
shift
table=""
operation=""
chain=""
while test "$#" -gt 0; do
  case "$1" in
    --table) table="$2"; shift 2 ;;
    --list|--new-chain|--check|--append) operation="$1"; chain="$2"; shift 2 ;;
    *) shift ;;
  esac
done
marker="$MOCK_STATE/$table-$chain"
case "$operation" in
  --list) test -e "$marker" ;;
  --new-chain) : > "$marker" ;;
  --check) test -e "$marker-return" ;;
  --append) : > "$marker-return" ;;
  *) exit 2 ;;
esac
`,
    };
    executable(sudoMock);
    const curlMock = {
      path: join(mockBin, "curl"),
      source: "#!/bin/sh\nprintf '401\\n'\n",
    };
    executable(curlMock);
    const harness = {
      path: join(work, "harness.sh"),
      source: repairSource(work),
    };
    executable(harness);
    const processInput = {
      cmd: [harness.path],
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        MOCK_LOG: log,
        MOCK_STATE: state,
        MOCK_DOCKER_VERSION: input.version,
      },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };
    const result = Bun.spawnSync(processInput);
    return { code: result.exitCode, commands: readFileSync(log, "utf8") };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const missingInput = { existing: [], version: "26.1.4" };
const missing = runCase(missingInput);
if (missing.code !== 0)
  throw new Error(`missing-chain case exited ${missing.code}`);
for (const command of [
  "--table nat --new-chain DOCKER",
  "--table filter --new-chain DOCKER",
  "--table filter --new-chain DOCKER-ISOLATION-STAGE-1",
  "--table filter --new-chain DOCKER-ISOLATION-STAGE-2",
]) {
  if (!missing.commands.includes(command))
    throw new Error(`missing command: ${command}`);
}
if (
  missing.commands.lastIndexOf("sudo iptables") >=
  missing.commands.indexOf(" down --remove-orphans")
) {
  throw new Error("firewall repair must finish before Compose is restarted");
}

const partialInput = {
  existing: ["nat-DOCKER", "filter-DOCKER", "filter-DOCKER-ISOLATION-STAGE-1"],
  version: "26.1.4",
};
const partial = runCase(partialInput);
if (partial.code !== 0)
  throw new Error(`partial-chain case exited ${partial.code}`);
for (const command of [
  "sudo iptables --table nat --new-chain DOCKER",
  "sudo iptables --table filter --new-chain DOCKER",
  "sudo iptables --table filter --new-chain DOCKER-ISOLATION-STAGE-1",
]) {
  if (partial.commands.split("\n").includes(command))
    throw new Error(`unexpected command: ${command}`);
}
for (const fragment of [
  "--table filter --new-chain DOCKER-ISOLATION-STAGE-2",
  "--append DOCKER-ISOLATION-STAGE-1 --jump RETURN",
  "--append DOCKER-ISOLATION-STAGE-2 --jump RETURN",
]) {
  if (!partial.commands.includes(fragment))
    throw new Error(`missing command: ${fragment}`);
}

const unsupportedInput = { existing: [], version: "27.0.1" };
const unsupported = runCase(unsupportedInput);
if (unsupported.code !== 1)
  throw new Error(`unsupported-version case exited ${unsupported.code}`);
for (const fragment of [
  "iptables",
  " down --remove-orphans",
  " up --detach --wait",
]) {
  if (unsupported.commands.includes(fragment))
    throw new Error(`unsupported version ran: ${fragment}`);
}
console.log("Docker network repair missing, partial, and version guards: ok");
