import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

interface ContractInput {
  fragment: string;
  label: string;
  source: string;
}

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

function requireFragment(input: ContractInput): void {
  if (!input.source.includes(input.fragment)) {
    throw new Error(`${input.label} is missing ${input.fragment}`);
  }
}

function forbidFragment(input: ContractInput): void {
  if (input.source.includes(input.fragment)) {
    throw new Error(`${input.label} contains prohibited ${input.fragment}`);
  }
}

const installer = await read("infra/operator-ssh.ts");
const inventory = await read("infra/k0s/config/operator-ssh.yaml");
const tasks = await read("infra/tasks/operator-ssh.yml");
const rootTasks = await read("infra/Taskfile.yml");

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
  requireFragment({
    fragment,
    label: "operator SSH installer",
    source: installer,
  });
}

for (const fragment of [
  "StrictHostKeyChecking no",
  "accept-new",
  "cloudflared access ssh",
]) {
  forbidFragment({ fragment, label: "operator SSH installer", source: installer });
}

for (const fragment of [
  "alias: nook-home-lan",
  "accessFallback: ssh.bynull.link",
  "hostKeyFingerprint: SHA256:",
]) {
  requireFragment({ fragment, label: "operator SSH inventory", source: inventory });
}

requireFragment({
  fragment: "ssh:home:configure:",
  label: "operator SSH tasks",
  source: tasks,
});
requireFragment({
  fragment: 'INFRA_MESH_SSH_TARGET: \'{{default "nook-home-lan"',
  label: "infrastructure root Taskfile",
  source: rootTasks,
});

console.log("Home operator SSH contract: ok");
