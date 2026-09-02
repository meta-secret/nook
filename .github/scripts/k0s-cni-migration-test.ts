import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const { PATH: executablePath = "" } = process.env;
const taskfile = resolve(root, "infra/tasks/k0s.yml");
const start = '        cni_migrated="$cni_was_unmasqueraded"\n';
const end =
  "        if sudo -n test -e /var/lib/hive/k0s-recovery/neo4j-secrets.yaml.enc; then\n";

function migrationSource(): string {
  const task = readFileSync(taskfile, "utf8");
  const embedded = task.split(start)[1].split(end)[0].replace(/^ {8}/gm, "");
  return `cni_migrated="$cni_was_unmasqueraded"\n${embedded}`;
}

const work = mkdtempSync(join(tmpdir(), "nook-cni-migration-"));
try {
  const mockBin = join(work, "bin");
  const log = join(work, "commands.log");
  const namespaceManifest = join(work, "infra/k0s/manifests/namespaces.yaml");
  mkdirSync(mockBin);
  mkdirSync(resolve(namespaceManifest, ".."), { recursive: true });
  copyFileSync(
    resolve(root, "infra/k0s/manifests/namespaces.yaml"),
    namespaceManifest,
  );
  const manifest = readFileSync(namespaceManifest, "utf8");
  for (const fragment of [
    "name: hive-data",
    "hive.nook.sh/role: data",
    "name: hive-system",
    "hive.nook.sh/role: workers",
  ]) {
    if (!manifest.includes(fragment))
      throw new Error(`namespace manifest missing: ${fragment}`);
  }
  const cni = join(work, "10-kuberouter.conflist");
  writeFileSync(cni, '{"plugins":[{"type":"bridge","ipMasq":true}]}\n');
  const sudo = join(mockBin, "sudo");
  writeFileSync(
    sudo,
    `#!/usr/bin/env bash
set -euo pipefail
if test "\${1:-}" = -n; then shift; fi
printf '%s\\n' "$*" >> "$MOCK_LOG"
case "\${1:-}" in
  test)
    if test "$2" = -s; then test -s "$3"; else exit 1; fi
    ;;
  jq)
    exec jq "\${@:2}"
    ;;
  install)
    cp "\${@: -2:1}" "\${@: -1}"
    ;;
  k0s)
    exit 0
    ;;
  *)
    printf 'unexpected sudo command: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
  );
  chmodSync(sudo, 0o755);
  const harness = join(work, "harness.sh");
  writeFileSync(
    harness,
    `#!/usr/bin/env bash
set -euo pipefail
cni_config=${cni}
cni_config_next=""
cni_was_unmasqueraded=true
remote_dir=${work}
${migrationSource()}
`,
  );
  chmodSync(harness, 0o755);
  const runInput = {
    cmd: [harness],
    env: {
      ...process.env,
      PATH: `${mockBin}:${executablePath}`,
      MOCK_LOG: log,
    },
    stdout: "inherit" as const,
    stderr: "inherit" as const,
  };
  const result = Bun.spawnSync(runInput);
  if (result.exitCode !== 0)
    throw new Error(`CNI migration harness exited ${result.exitCode}`);
  const commands = readFileSync(log, "utf8");
  const namespaceApply = `k0s kubectl apply -f ${namespaceManifest}`;
  if (!commands.includes(namespaceApply))
    throw new Error(`missing command: ${namespaceApply}`);
  for (const deployment of [
    "hive",
    "hive-workbench-dispatcher",
    "hive-reaper-controller",
  ]) {
    for (const command of [
      `k0s kubectl rollout restart deployment/${deployment} --namespace hive-system`,
      `k0s kubectl rollout status deployment/${deployment} --namespace hive-system --timeout=10m`,
    ]) {
      if (!commands.includes(command))
        throw new Error(`missing command: ${command}`);
    }
  }
  if (!commands.includes("k0s kubectl rollout restart deployment/coredns")) {
    throw new Error("CNI migration must restart CoreDNS");
  }
  console.log("k0s CNI rewrite migration rollouts: ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
