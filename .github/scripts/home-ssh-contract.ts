import { err, ok, type Result } from "neverthrow";
import { resolve } from "node:path";

class HomeSshContractRead {
  constructor(private readonly request: string) {}
  async execute(): Promise<Result<string, HomeSshContractFailure>> {
    const relative = this.request;

    try {
      return ok(await Bun.file(resolve(root, relative)).text());
    } catch {
      return err({
        kind: HomeSshContractFailureKind.Source,
        message: `Unable to read ${relative}`,
      });
    }
  }
}

class HomeSshContractRequireFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): Result<void, HomeSshContractFailure> {
    const input = this.request;

    if (!input.source.includes(input.fragment)) {
      return err({
        kind: HomeSshContractFailureKind.Contract,
        message: `${input.label} is missing ${input.fragment}`,
      });
    }
    return ok();
  }
}

class HomeSshContractForbidFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): Result<void, HomeSshContractFailure> {
    const input = this.request;

    if (input.source.includes(input.fragment)) {
      return err({
        kind: HomeSshContractFailureKind.Contract,
        message: `${input.label} contains prohibited ${input.fragment}`,
      });
    }
    return ok();
  }
}

const root = resolve(import.meta.dir, "../..");

interface ContractInput {
  fragment: string;
  label: string;
  source: string;
}

class HomeSshConfigurationContract {
  async execute(): Promise<Result<void, HomeSshContractFailure>> {
    const installerResult = await new HomeSshContractRead(
      "infra/operator-ssh.ts",
    ).execute();
    if (installerResult.isErr()) return err(installerResult.error);
    const installer = installerResult.value;
    const inventoryResult = await new HomeSshContractRead(
      "infra/k0s/config/operator-ssh.yaml",
    ).execute();
    if (inventoryResult.isErr()) return err(inventoryResult.error);
    const inventory = inventoryResult.value;
    const tasksResult = await new HomeSshContractRead(
      "infra/tasks/operator-ssh.yml",
    ).execute();
    if (tasksResult.isErr()) return err(tasksResult.error);
    const tasks = tasksResult.value;
    const rootTasksResult = await new HomeSshContractRead(
      "infra/Taskfile.yml",
    ).execute();
    if (rootTasksResult.isErr()) return err(rootTasksResult.error);
    const rootTasks = rootTasksResult.value;

    for (const fragment of [
      "ssh-keyscan",
      "home SSH host identity does not match the pinned fingerprint",
      "StrictHostKeyChecking yes",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "ProxyCommand none",
      ".nook/infra/home-known-hosts",
      "BatchMode=yes",
      "metadata.isSymbolicLink()",
      "return ok(await realpath(this.path))",
      "SSH config path is a dangling symbolic link",
    ]) {
      const contract1 = new HomeSshContractRequireFragment({
        fragment,
        label: "operator SSH installer",
        source: installer,
      }).execute();
      if (contract1.isErr()) return err(contract1.error);
    }

    for (const fragment of [
      "StrictHostKeyChecking no",
      "accept-new",
      "cloudflared access ssh",
    ]) {
      const contract2 = new HomeSshContractForbidFragment({
        fragment,
        label: "operator SSH installer",
        source: installer,
      }).execute();
      if (contract2.isErr()) return err(contract2.error);
    }

    for (const fragment of [
      "alias: nook-home-lan",
      "accessFallback: ssh.bynull.link",
      "hostKeyFingerprint: SHA256:",
    ]) {
      const contract3 = new HomeSshContractRequireFragment({
        fragment,
        label: "operator SSH inventory",
        source: inventory,
      }).execute();
      if (contract3.isErr()) return err(contract3.error);
    }

    const contract4 = new HomeSshContractRequireFragment({
      fragment: "ssh:home:configure:",
      label: "operator SSH tasks",
      source: tasks,
    }).execute();
    if (contract4.isErr()) return err(contract4.error);
    const contract5 = new HomeSshContractRequireFragment({
      fragment: 'INFRA_MESH_SSH_TARGET: \'{{default "nook-home-lan"',
      label: "infrastructure root Taskfile",
      source: rootTasks,
    }).execute();
    if (contract5.isErr()) return err(contract5.error);

    return ok();
  }
}
enum HomeSshContractFailureKind {
  Source = "source",
  Contract = "contract",
}
interface HomeSshContractFailure {
  readonly kind: HomeSshContractFailureKind;
  readonly message: string;
}
const outcome = await new HomeSshConfigurationContract().execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
} else console.log("Home operator SSH contract: ok");
