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

const root = resolve(import.meta.dir, "../..");
const { PATH: executablePath = "" } = process.env;
const taskfile = resolve(root, "infra/tasks/k0s.yml");
const start = '        cni_migrated="$cni_was_unmasqueraded"\n';
const end =
  "        if sudo -n test -e /var/lib/hive/k0s-recovery/neo4j-secrets.yaml.enc; then\n";

class CniMigrationSource {
  read(): Result<string, OperationalContractFailure> {
    const task = new FixtureFile(taskfile).read();
    if (task.isErr()) return err(task.error);
    return new FixtureEmbeddedSource(task.value)
      .between(start, end)
      .map((embedded) => start.trimStart() + embedded.replace(/^ {8}/gm, ""));
  }
}
class CniMigrationFixture {
  constructor(private readonly work: string) {}
  execute(): Result<void, OperationalContractFailure> {
    const work = this.work;
    const mockBin = join(work, "bin");
    const log = join(work, "commands.log");
    const namespaceManifest = join(work, "infra/k0s/manifests/namespaces.yaml");
    const prepared1 = new FixtureDirectory(mockBin).create();
    if (prepared1.isErr()) return err(prepared1.error);
    const prepared2 = new FixtureDirectory(
      resolve(namespaceManifest, ".."),
    ).create();
    if (prepared2.isErr()) return err(prepared2.error);
    const prepared6 = new FixtureFile(namespaceManifest).copyFrom(
      resolve(root, "infra/k0s/manifests/namespaces.yaml"),
    );
    if (prepared6.isErr()) return err(prepared6.error);
    const manifestResult = new FixtureFile(namespaceManifest).read();
    if (manifestResult.isErr()) return err(manifestResult.error);
    const manifest = manifestResult.value;
    for (const fragment of [
      "name: hive-data",
      "hive.nook.sh/role: data",
      "name: hive-system",
      "hive.nook.sh/role: workers",
    ]) {
      if (!manifest.includes(fragment))
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `namespace manifest missing: ${fragment}`,
        });
    }
    const cni = join(work, "10-kuberouter.conflist");
    const prepared3 = new FixtureFile(cni).write(
      '{"plugins":[{"type":"bridge","ipMasq":true}]}\n',
    );
    if (prepared3.isErr()) return err(prepared3.error);
    const fixtureCommand = join(mockBin, "fixture-command");
    const prepared4 = new FixtureFile(fixtureCommand).write(
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
    if (prepared4.isErr()) return err(prepared4.error);
    const prepared7 = new FixtureFile(fixtureCommand).makeExecutable();
    if (prepared7.isErr()) return err(prepared7.error);
    const harness = join(work, "harness.sh");
    const migration = new CniMigrationSource().read();
    if (migration.isErr()) return err(migration.error);
    const fixtureMigration = migration.value.replaceAll(
      "sudo -n ",
      `${JSON.stringify(fixtureCommand)} `,
    );
    const prepared5 = new FixtureFile(harness).write(
      `#!/usr/bin/env bash
set -euo pipefail
export MOCK_LOG=${JSON.stringify(log)}
cni_config=${cni}
cni_config_next=""
cni_was_unmasqueraded=true
remote_dir=${work}
${fixtureMigration}
`,
    );
    if (prepared5.isErr()) return err(prepared5.error);
    const prepared8 = new FixtureFile(harness).makeExecutable();
    if (prepared8.isErr()) return err(prepared8.error);
    const runInput = {
      cmd: [harness],
      env: {
        ...process.env,
        PATH: `${mockBin}:${executablePath}`,
        MOCK_LOG: log,
      },
      stdout: OperationalProbeStream.Inherit,
      stderr: OperationalProbeStream.Inherit,
    };
    const run = new OperationalCommandProbe(runInput).execute();
    if (run.isErr()) return err(run.error);
    const result = run.value;
    if (result.exitCode !== 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `CNI migration harness exited ${result.exitCode}`,
      });
    const commandsResult = new FixtureFile(log).read();
    if (commandsResult.isErr()) return err(commandsResult.error);
    const commands = commandsResult.value;
    const namespaceApply = `k0s kubectl apply -f ${namespaceManifest}`;
    if (!commands.includes(namespaceApply))
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `missing command: ${namespaceApply}`,
      });
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
          return err({
            kind: OperationalContractFailureKind.Requirement,
            message: `missing command: ${command}`,
          });
      }
    }
    if (!commands.includes("k0s kubectl rollout restart deployment/coredns")) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "CNI migration must restart CoreDNS",
      });
    }
    console.log("k0s CNI rewrite migration rollouts: ok");
    return ok();
  }
}
class CniMigrationContract {
  execute(): Result<void, OperationalContractFailure> {
    const workspace = new FixtureWorkspaceRequest(
      "nook-cni-migration-",
    ).create();
    if (workspace.isErr()) return err(workspace.error);
    return workspace.value.finish(
      new CniMigrationFixture(workspace.value.path).execute(),
    );
  }
}
const outcome = new CniMigrationContract().execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
