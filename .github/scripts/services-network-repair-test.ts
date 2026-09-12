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

class NetworkRepairSource {
  constructor(private readonly request: string) {}
  execute(): Result<string, OperationalContractFailure> {
    const remoteDirectory = this.request;

    const source = new FixtureFile(taskfile).read();
    if (source.isErr()) return err(source.error);
    const taskOffset = source.value.indexOf(taskStart);
    if (taskOffset < 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Network repair task is missing",
      });
    const embedded = new FixtureEmbeddedSource(
      source.value.slice(taskOffset),
    ).between(scriptStart, scriptEnd);
    if (embedded.isErr()) return err(embedded.error);
    const dedented = embedded.value.replace(/^ {8}/gm, "");
    return ok(
      `#!/usr/bin/env bash\nset -euo pipefail\n${dedented}`.replace(
        'remote_dir="{{.INFRA_REMOTE_DIR}}"',
        `remote_dir=${remoteDirectory}`,
      ),
    );
  }
}

class NetworkRepairExecutable {
  constructor(private readonly request: { path: string; source: string }) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    const prepared3 = new FixtureFile(input.path).write(input.source);
    if (prepared3.isErr()) return err(prepared3.error);
    const executable = new FixtureFile(input.path).makeExecutable();
    return executable;
  }
}

class NetworkRepairScenario {
  constructor(
    private readonly request: { existing: string[]; version: string },
  ) {}
  execute(): Result<RepairResult, OperationalContractFailure> {
    const workspace = new FixtureWorkspaceRequest(
      "nook-network-repair-",
    ).create();
    if (workspace.isErr()) return err(workspace.error);
    return workspace.value.finish(this.executeIn(workspace.value.path));
  }
  private executeIn(
    work: string,
  ): Result<RepairResult, OperationalContractFailure> {
    const input = this.request;
    const prepared4 = new FixtureFile(join(work, "compose.yaml")).write(
      "services: {}\n",
    );
    if (prepared4.isErr()) return err(prepared4.error);
    const mockBin = join(work, "bin");
    const state = join(work, "state");
    const log = join(work, "commands.log");
    const prepared1 = new FixtureDirectory(mockBin).create();
    if (prepared1.isErr()) return err(prepared1.error);
    const prepared2 = new FixtureDirectory(state).create();
    if (prepared2.isErr()) return err(prepared2.error);
    for (const item of input.existing) {
      const prepared5 = new FixtureFile(join(state, item)).write("");
      if (prepared5.isErr()) return err(prepared5.error);
    }
    const dockerMock = {
      path: join(mockBin, "docker"),
      source: `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "$MOCK_LOG"
if test "\${1:-}" = version; then printf '%s\\n' "$MOCK_DOCKER_VERSION"; fi
`,
    };
    const dockerMockReady = new NetworkRepairExecutable(dockerMock).execute();
    if (dockerMockReady.isErr()) return err(dockerMockReady.error);
    const fixtureCommand = {
      path: join(mockBin, "fixture-command"),
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
    const fixtureCommandReady = new NetworkRepairExecutable(
      fixtureCommand,
    ).execute();
    if (fixtureCommandReady.isErr()) return err(fixtureCommandReady.error);
    const curlMock = {
      path: join(mockBin, "curl"),
      source: "#!/bin/sh\nprintf '200\\n'\n",
    };
    const curlMockReady = new NetworkRepairExecutable(curlMock).execute();
    if (curlMockReady.isErr()) return err(curlMockReady.error);
    const source = new NetworkRepairSource(work).execute();
    if (source.isErr()) return err(source.error);
    const fixtureSource = source.value
      .replaceAll("sudo -n ", `${JSON.stringify(fixtureCommand.path)} `)
      .replace(
        "set -euo pipefail\n",
        `set -euo pipefail
export PATH=${JSON.stringify(`${mockBin}:${executablePath}`)}
export MOCK_LOG=${JSON.stringify(log)}
export MOCK_STATE=${JSON.stringify(state)}
export MOCK_DOCKER_VERSION=${JSON.stringify(input.version)}
`,
      );
    const harness = {
      path: join(work, "harness.sh"),
      source: fixtureSource,
    };
    const harnessReady = new NetworkRepairExecutable(harness).execute();
    if (harnessReady.isErr()) return err(harnessReady.error);
    const processInput = {
      cmd: [harness.path],
      env: {
        ...process.env,
        PATH: `${mockBin}:${executablePath}`,
        MOCK_LOG: log,
        MOCK_STATE: state,
        MOCK_DOCKER_VERSION: input.version,
      },
      stdout: OperationalProbeStream.Pipe,
      stderr: OperationalProbeStream.Pipe,
    };
    const result = new OperationalCommandProbe(processInput).execute();
    if (result.isErr()) return err(result.error);
    return new FixtureFile(log)
      .read()
      .map((commands) => ({ code: result.value.exitCode, commands }));
  }
}

const { PATH: executablePath = "" } = process.env;

const root = resolve(import.meta.dir, "../..");
const taskfile = resolve(root, "infra/tasks/host-services.yml");
const taskStart = "  services:repair-network:\n";
const scriptStart = "        set -euo pipefail\n";
const scriptEnd = "        REMOTE\n";

interface RepairResult {
  code: number;
  commands: string;
}

class NetworkRepairContract {
  execute(): Result<void, OperationalContractFailure> {
    const missingInput = { existing: [], version: "26.1.4" };
    const missingOutcome = new NetworkRepairScenario(missingInput).execute();
    if (missingOutcome.isErr()) return err(missingOutcome.error);
    const missing = missingOutcome.value;
    if (missing.code !== 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `missing-chain case exited ${missing.code}`,
      });
    for (const command of [
      "--table nat --new-chain DOCKER",
      "--table filter --new-chain DOCKER",
      "--table filter --new-chain DOCKER-ISOLATION-STAGE-1",
      "--table filter --new-chain DOCKER-ISOLATION-STAGE-2",
    ]) {
      if (!missing.commands.includes(command))
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `missing command: ${command}`,
        });
    }
    if (
      missing.commands.lastIndexOf("sudo iptables") >=
      missing.commands.indexOf(" down --remove-orphans")
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "firewall repair must finish before Compose is restarted",
      });
    }

    const partialInput = {
      existing: [
        "nat-DOCKER",
        "filter-DOCKER",
        "filter-DOCKER-ISOLATION-STAGE-1",
      ],
      version: "26.1.4",
    };
    const partialOutcome = new NetworkRepairScenario(partialInput).execute();
    if (partialOutcome.isErr()) return err(partialOutcome.error);
    const partial = partialOutcome.value;
    if (partial.code !== 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `partial-chain case exited ${partial.code}`,
      });
    for (const command of [
      "sudo iptables --table nat --new-chain DOCKER",
      "sudo iptables --table filter --new-chain DOCKER",
      "sudo iptables --table filter --new-chain DOCKER-ISOLATION-STAGE-1",
    ]) {
      if (partial.commands.split("\n").includes(command))
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `unexpected command: ${command}`,
        });
    }
    for (const fragment of [
      "--table filter --new-chain DOCKER-ISOLATION-STAGE-2",
      "--append DOCKER-ISOLATION-STAGE-1 --jump RETURN",
      "--append DOCKER-ISOLATION-STAGE-2 --jump RETURN",
    ]) {
      if (!partial.commands.includes(fragment))
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `missing command: ${fragment}`,
        });
    }

    const unsupportedInput = { existing: [], version: "27.0.1" };
    const unsupportedOutcome = new NetworkRepairScenario(
      unsupportedInput,
    ).execute();
    if (unsupportedOutcome.isErr()) return err(unsupportedOutcome.error);
    const unsupported = unsupportedOutcome.value;
    if (unsupported.code !== 1)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `unsupported-version case exited ${unsupported.code}`,
      });
    for (const fragment of [
      "iptables",
      " down --remove-orphans",
      " up --detach --wait",
    ]) {
      if (unsupported.commands.includes(fragment))
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `unsupported version ran: ${fragment}`,
        });
    }
    console.log(
      "Docker network repair missing, partial, and version guards: ok",
    );

    return ok();
  }
}
const outcome = new NetworkRepairContract().execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
