import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface HomeSshDefinition {
  accessFallback: string;
  address: string;
  alias: string;
  expectedHostname: string;
  hostKeyFingerprint: string;
  identityFile: string;
  user: string;
}

interface OperatorSshInventory {
  home: HomeSshDefinition;
}

interface CommandInput {
  args: string[];
  command: string;
  stdin?: string;
}

interface InstallPaths {
  includeDirectory: string;
  includeFile: string;
  knownHostsFile: string;
  nookDirectory: string;
  sshConfig: string;
  sshDirectory: string;
}

const inventoryPath = resolve(
  import.meta.dir,
  "k0s/config/operator-ssh.yaml",
);
const includeDirective = "Include ~/.ssh/config.d/*.conf";

export function renderManagedConfig(home: HomeSshDefinition): string {
  return [
    "# Managed by task infra:ssh:home:configure.",
    `Host ${home.alias}`,
    `  HostName ${home.address}`,
    `  User ${home.user}`,
    `  IdentityFile ${home.identityFile}`,
    "  IdentitiesOnly yes",
    "  PreferredAuthentications publickey",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
    "  StrictHostKeyChecking yes",
    "  UserKnownHostsFile ~/.nook/infra/home-known-hosts",
    "  ProxyCommand none",
    "",
    `# Off-network fallback remains: ssh ${home.accessFallback}`,
    "",
  ].join("\n");
}

export function ensureInclude(config: string): string {
  const bodyWithoutManagedIncludes = config
    .split("\n")
    .filter((line) => line.trim() !== includeDirective)
    .join("\n")
    .replace(/^\n+/, "");
  const body =
    bodyWithoutManagedIncludes.length === 0
      ? ""
      : `${bodyWithoutManagedIncludes.replace(/\n*$/, "")}\n`;
  return `${includeDirective}\n\n${body}`;
}

export function requireInventory(home: HomeSshDefinition): void {
  if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(home.alias)) {
    throw new Error("home SSH alias is invalid");
  }
  const octets = home.address.split(".").map((octet) => Number(octet));
  const [first = -1, second = -1, , fourth = -1] = octets;
  const validIpv4 =
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
  const privateAddress =
    validIpv4 &&
    (first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168));
  const usableHost = privateAddress && fourth !== 0 && fourth !== 255;
  if (!usableHost) {
    throw new Error("home SSH address must be a private LAN address");
  }
  if (!/^[a-z_][a-z0-9_-]*$/.test(home.user)) {
    throw new Error("home SSH user is invalid");
  }
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(home.hostKeyFingerprint)) {
    throw new Error("home SSH host fingerprint is invalid");
  }
  if (
    home.alias === home.accessFallback ||
    !home.accessFallback.endsWith(".bynull.link")
  ) {
    throw new Error("home SSH Access fallback must remain a distinct hostname");
  }
}

function run(input: CommandInput): string {
  const result = Bun.spawnSync([input.command, ...input.args], {
    stdin: "stdin" in input ? Buffer.from(input.stdin) : null,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`${input.command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.toString();
}

async function loadInventory(): Promise<OperatorSshInventory> {
  const source = await Bun.file(inventoryPath).text();
  const inventory = Bun.YAML.parse(source) as OperatorSshInventory;
  if (!inventory.home) throw new Error("operator SSH inventory has no home entry");
  requireInventory(inventory.home);
  return inventory;
}

function installPaths(): InstallPaths {
  const operatorHome = homedir();
  return {
    includeDirectory: join(operatorHome, ".ssh", "config.d"),
    includeFile: join(operatorHome, ".ssh", "config.d", "nook-infra.conf"),
    knownHostsFile: join(operatorHome, ".nook", "infra", "home-known-hosts"),
    nookDirectory: join(operatorHome, ".nook", "infra"),
    sshConfig: join(operatorHome, ".ssh", "config"),
    sshDirectory: join(operatorHome, ".ssh"),
  };
}

function scanHostKey(home: HomeSshDefinition): string {
  const key = run({
    args: ["-T", "5", "-t", "ed25519", home.address],
    command: "ssh-keyscan",
  });
  const keyLines = key
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (keyLines.length !== 1) {
    throw new Error("home SSH scan did not return exactly one Ed25519 key");
  }
  const fingerprint = run({
    args: ["-E", "sha256", "-lf", "-"],
    command: "ssh-keygen",
    stdin: `${keyLines[0]}\n`,
  })
    .trim()
    .split(/\s+/)[1];
  if (fingerprint !== home.hostKeyFingerprint) {
    throw new Error(
      "home SSH host identity does not match the pinned fingerprint",
    );
  }
  return `${keyLines[0]}\n`;
}

async function writePrivateFile(input: {
  content: string;
  path: string;
}): Promise<void> {
  const next = `${input.path}.next.${process.pid}`;
  await writeFile(next, input.content, { mode: 0o600 });
  await chmod(next, 0o600);
  await rename(next, input.path);
}

export async function writableConfigPath(path: string): Promise<string> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return path;
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    try {
      return await realpath(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("SSH config path is a dangling symbolic link");
      }
      throw error;
    }
  }
  if (!metadata.isFile()) throw new Error("SSH config path is not a regular file");
  return path;
}

async function install(): Promise<void> {
  const inventory = await loadInventory();
  const paths = installPaths();
  await mkdir(paths.sshDirectory, { mode: 0o700, recursive: true });
  await mkdir(paths.includeDirectory, { mode: 0o700, recursive: true });
  await mkdir(paths.nookDirectory, { mode: 0o700, recursive: true });
  await chmod(dirname(paths.nookDirectory), 0o700);
  await chmod(paths.nookDirectory, 0o700);
  await chmod(paths.sshDirectory, 0o700);
  await chmod(paths.includeDirectory, 0o700);

  await writePrivateFile({
    content: scanHostKey(inventory.home),
    path: paths.knownHostsFile,
  });
  await writePrivateFile({
    content: renderManagedConfig(inventory.home),
    path: paths.includeFile,
  });

  let config = "";
  const sshConfig = await writableConfigPath(paths.sshConfig);
  try {
    config = await readFile(sshConfig, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  await writePrivateFile({
    content: ensureInclude(config),
    path: sshConfig,
  });
  await status();
  console.log(`Browserless SSH alias ${inventory.home.alias} is ready`);
}

async function status(): Promise<void> {
  const inventory = await loadInventory();
  const hostname = run({
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      inventory.home.alias,
      "hostname -s",
    ],
    command: "ssh",
  }).trim();
  if (hostname !== inventory.home.expectedHostname) {
    throw new Error("home SSH alias reached an unexpected host");
  }
  console.log(`Home SSH route reached ${hostname} without interactive auth`);
}

if (import.meta.main) {
  const operation = process.argv[2];
  if (operation === "install") await install();
  else if (operation === "status") await status();
  else throw new Error("usage: bun infra/operator-ssh.ts <install|status>");
}
