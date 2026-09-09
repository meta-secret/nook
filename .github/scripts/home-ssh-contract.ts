import { resolve } from "node:path";

class HomeSshContractRead {
  constructor(private readonly request: string) {}
  async execute(): Promise<string> {
    const relative = this.request;

    return Bun.file(resolve(root, relative)).text();
  }
}

class HomeSshContractRequireFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): void {
    const input = this.request;

    if (!input.source.includes(input.fragment)) {
      throw new Error(`${input.label} is missing ${input.fragment}`);
    }
  }
}

class HomeSshContractForbidFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): void {
    const input = this.request;

    if (input.source.includes(input.fragment)) {
      throw new Error(`${input.label} contains prohibited ${input.fragment}`);
    }
  }
}

const root = resolve(import.meta.dir, "../..");

interface ContractInput {
  fragment: string;
  label: string;
  source: string;
}

const installer = await new HomeSshContractRead(
  "infra/operator-ssh.ts",
).execute();
const inventory = await new HomeSshContractRead(
  "infra/k0s/config/operator-ssh.yaml",
).execute();
const tasks = await new HomeSshContractRead(
  "infra/tasks/operator-ssh.yml",
).execute();
const rootTasks = await new HomeSshContractRead("infra/Taskfile.yml").execute();

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
  "return await realpath(path)",
  "SSH config path is a dangling symbolic link",
]) {
  new HomeSshContractRequireFragment({
    fragment,
    label: "operator SSH installer",
    source: installer,
  }).execute();
}

for (const fragment of [
  "StrictHostKeyChecking no",
  "accept-new",
  "cloudflared access ssh",
]) {
  new HomeSshContractForbidFragment({
    fragment,
    label: "operator SSH installer",
    source: installer,
  }).execute();
}

for (const fragment of [
  "alias: nook-home-lan",
  "accessFallback: ssh.bynull.link",
  "hostKeyFingerprint: SHA256:",
]) {
  new HomeSshContractRequireFragment({
    fragment,
    label: "operator SSH inventory",
    source: inventory,
  }).execute();
}

new HomeSshContractRequireFragment({
  fragment: "ssh:home:configure:",
  label: "operator SSH tasks",
  source: tasks,
}).execute();
new HomeSshContractRequireFragment({
  fragment: 'INFRA_MESH_SSH_TARGET: \'{{default "nook-home-lan"',
  label: "infrastructure root Taskfile",
  source: rootTasks,
}).execute();

console.log("Home operator SSH contract: ok");
