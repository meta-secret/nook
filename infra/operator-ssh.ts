import {chmod,lstat,mkdir,readFile,realpath,rename,writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname,join,resolve} from "node:path";

export class OperatorSshRenderManagedConfig {
  constructor(private readonly request: HomeSshDefinition) {}
  execute(): string {
    const home = this.request;

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
}

export class OperatorSshEnsureInclude {
  constructor(private readonly request: string) {}
  execute(): string {
    const config = this.request;

    let globalScope = true;
    const bodyWithoutManagedIncludes = config
      .split("\n")
      .filter((line) => {
        if (/^\s*(?:Host|Match)\s+/i.test(line)) globalScope = false;
        return !(globalScope && line.trim() === includeDirective);
      })
      .join("\n")
      .replace(/^\n+/, "");
    const body =
      bodyWithoutManagedIncludes.length === 0
        ? ""
        : `${bodyWithoutManagedIncludes.replace(/\n*$/, "")}\n`;
    return `${includeDirective}\n\n${body}`;
  }
}

export class OperatorSshRequireInventory {
  constructor(private readonly request: HomeSshDefinition) {}
  execute(): void {
    const home = this.request;

    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(home.alias)) {
      throw new Error("home SSH alias is invalid");
    }
    const octets = home.address.split(".").map((octet) => Number(octet));
    const [first = -1, second = -1, , fourth = -1] = octets;
    const validIpv4 =
      octets.length === 4 &&
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
      );
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
      throw new Error(
        "home SSH Access fallback must remain a distinct hostname",
      );
    }
  }
}

class OperatorSshRun {
  constructor(private readonly request: CommandInput) {}
  execute(): string {
    const input = this.request;

    const command = [input.command, ...input.args];
    const result =
      "stdin" in input
        ? Bun.spawnSync(command, {
            stdin: Buffer.from(input.stdin),
            stdout: "pipe",
            stderr: "pipe",
          })
        : Bun.spawnSync(command, {
            stdout: "pipe",
            stderr: "pipe",
          });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString().trim();
      throw new Error(`${input.command} failed${detail ? `: ${detail}` : ""}`);
    }
    return result.stdout.toString();
  }
}

class OperatorSshScanHostKey {
  constructor(private readonly request: HomeSshDefinition) {}
  execute(): string {
    const home = this.request;

    const key = new OperatorSshRun({
      args: ["-T", "5", "-t", "ed25519", home.address],
      command: "ssh-keyscan",
    }).execute();
    const keyLines = key
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (keyLines.length !== 1) {
      throw new Error("home SSH scan did not return exactly one Ed25519 key");
    }
    const fingerprint = new OperatorSshRun({
      args: ["-E", "sha256", "-lf", "-"],
      command: "ssh-keygen",
      stdin: `${keyLines[0]}\n`,
    })
      .execute()
      .trim()
      .split(/\s+/)[1];
    if (fingerprint !== home.hostKeyFingerprint) {
      throw new Error(
        "home SSH host identity does not match the pinned fingerprint",
      );
    }
    return `${keyLines[0]}\n`;
  }
}

class OperatorSshWritePrivateFile {
  constructor(
    private readonly request: {
      content: string;
      path: string;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    const next = `${input.path}.next.${process.pid}`;
    await writeFile(next, input.content, { mode: 0o600 });
    await chmod(next, 0o600);
    await rename(next, input.path);
  }
}

export class OperatorSshWritableConfigPath {
  constructor(private readonly request: string) {}
  async execute(): Promise<string> {
    const path = this.request;

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
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new Error("SSH config path is a dangling symbolic link");
        }
        throw error;
      }
    }
    if (!metadata.isFile())
      throw new Error("SSH config path is not a regular file");
    return path;
  }
}

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

const inventoryPath = resolve(import.meta.dir, "k0s/config/operator-ssh.yaml");
const includeDirective = "Include ~/.ssh/config.d/nook-infra.conf";

export class OperatorSshInstallation {
  constructor(
    private readonly home: string,
    private readonly inventoryFile: string,
  ) {}
  async loadInventory(): Promise<OperatorSshInventory> {
    const source = await Bun.file(this.inventoryFile).text();
    const inventory = Bun.YAML.parse(source) as OperatorSshInventory;
    if (!inventory.home)
      throw new Error("operator SSH inventory has no home entry");
    new OperatorSshRequireInventory(inventory.home).execute();
    return inventory;
  }
  installPaths(): InstallPaths {
    const operatorHome = this.home;
    return {
      includeDirectory: join(operatorHome, ".ssh", "config.d"),
      includeFile: join(operatorHome, ".ssh", "config.d", "nook-infra.conf"),
      knownHostsFile: join(operatorHome, ".nook", "infra", "home-known-hosts"),
      nookDirectory: join(operatorHome, ".nook", "infra"),
      sshConfig: join(operatorHome, ".ssh", "config"),
      sshDirectory: join(operatorHome, ".ssh"),
    };
  }
  async install(): Promise<void> {
    const inventory = await this.loadInventory();
    const paths = this.installPaths();
    await mkdir(paths.sshDirectory, { mode: 0o700, recursive: true });
    await mkdir(paths.includeDirectory, { mode: 0o700, recursive: true });
    await mkdir(paths.nookDirectory, { mode: 0o700, recursive: true });
    await chmod(dirname(paths.nookDirectory), 0o700);
    await chmod(paths.nookDirectory, 0o700);
    await chmod(paths.sshDirectory, 0o700);
    await chmod(paths.includeDirectory, 0o700);

    await new OperatorSshWritePrivateFile({
      content: new OperatorSshScanHostKey(inventory.home).execute(),
      path: paths.knownHostsFile,
    }).execute();
    await new OperatorSshWritePrivateFile({
      content: new OperatorSshRenderManagedConfig(inventory.home).execute(),
      path: paths.includeFile,
    }).execute();

    let config = "";
    const sshConfig = await new OperatorSshWritableConfigPath(
      paths.sshConfig,
    ).execute();
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
    await new OperatorSshWritePrivateFile({
      content: new OperatorSshEnsureInclude(config).execute(),
      path: sshConfig,
    }).execute();
    await this.status();
    console.log(`Browserless SSH alias ${inventory.home.alias} is ready`);
  }
  async status(): Promise<void> {
    const inventory = await this.loadInventory();
    const hostname = new OperatorSshRun({
      args: [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        inventory.home.alias,
        "hostname -s",
      ],
      command: "ssh",
    })
      .execute()
      .trim();
    if (hostname !== inventory.home.expectedHostname) {
      throw new Error("home SSH alias reached an unexpected host");
    }
    console.log(`Home SSH route reached ${hostname} without interactive auth`);
  }
}

if (import.meta.main) {
  const operation = process.argv[2];
  if (operation === "install")
    await new OperatorSshInstallation(homedir(), inventoryPath).install();
  else if (operation === "status")
    await new OperatorSshInstallation(homedir(), inventoryPath).status();
  else throw new Error("usage: bun infra/operator-ssh.ts <install|status>");
}
