import { err, ok, type Result } from "neverthrow";
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

export enum OperatorSshFailureKind {
  Inventory = "inventory", Address = "address", Identity = "identity",
  Command = "command", Filesystem = "filesystem", DanglingLink = "dangling-link",
  ConfigPath = "config-path", Arguments = "arguments",
}
export interface OperatorSshFailure { kind: OperatorSshFailureKind; message: string }

export class OperatorSshRequireInventory {
  constructor(private readonly home: HomeSshDefinition) {}
  execute(): Result<void, OperatorSshFailure> {
    const home = this.home;
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(home.alias))
      return err({ kind: OperatorSshFailureKind.Inventory, message: "home SSH alias is invalid" });
    const octets = home.address.split(".").map((octet) => Number(octet));
    const [first = -1, second = -1, , fourth = -1] = octets;
    const privateAddress = octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      && (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
    if (!privateAddress || fourth === 0 || fourth === 255)
      return err({ kind: OperatorSshFailureKind.Address, message: "home SSH address must be a private LAN address" });
    if (!/^[a-z_][a-z0-9_-]*$/.test(home.user))
      return err({ kind: OperatorSshFailureKind.Inventory, message: "home SSH user is invalid" });
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(home.hostKeyFingerprint))
      return err({ kind: OperatorSshFailureKind.Identity, message: "home SSH host fingerprint is invalid" });
    if (home.alias === home.accessFallback || !home.accessFallback.endsWith(".bynull.link"))
      return err({ kind: OperatorSshFailureKind.Inventory, message: "home SSH Access fallback must remain a distinct hostname" });
    return ok();
  }
}

class OperatorSshRun {
  constructor(private readonly request: CommandInput) {}
  execute(): Result<string, OperatorSshFailure> {
    const input = this.request;
    let result: ReturnType<typeof Bun.spawnSync>;
    try {
      const command = [input.command, ...input.args];
      result = "stdin" in input
        ? Bun.spawnSync(command, { stdin: Buffer.from(input.stdin), stdout: "pipe", stderr: "pipe" })
        : Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
    } catch { return err({ kind: OperatorSshFailureKind.Command, message: `${input.command} could not start` }); }
    if (result.exitCode !== 0)
      return err({ kind: OperatorSshFailureKind.Command, message: `${input.command} failed with exit ${result.exitCode}` });
    return ok(result.stdout.toString());
  }
}

class OperatorSshScanHostKey {
  constructor(private readonly home: HomeSshDefinition) {}
  execute(): Result<string, OperatorSshFailure> {
    const key = new OperatorSshRun({ args: ["-T", "5", "-t", "ed25519", this.home.address], command: "ssh-keyscan" }).execute();
    if (key.isErr()) return err(key.error);
    const keyLines = key.value.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));
    if (keyLines.length !== 1)
      return err({ kind: OperatorSshFailureKind.Identity, message: "home SSH scan did not return exactly one Ed25519 key" });
    const scanned = new OperatorSshRun({ args: ["-E", "sha256", "-lf", "-"], command: "ssh-keygen", stdin: `${keyLines[0]}\n` }).execute();
    if (scanned.isErr()) return err(scanned.error);
    const fingerprint = scanned.value.trim().split(/\s+/)[1];
    if (fingerprint !== this.home.hostKeyFingerprint)
      return err({ kind: OperatorSshFailureKind.Identity, message: "home SSH host identity does not match the pinned fingerprint" });
    return ok(`${keyLines[0]}\n`);
  }
}

class OperatorSshWritePrivateFile {
  constructor(private readonly request: { content: string; path: string }) {}
  async execute(): Promise<Result<void, OperatorSshFailure>> {
    const next = `${this.request.path}.next.${process.pid}`;
    try {
      await writeFile(next, this.request.content, { mode: 0o600 });
      await chmod(next, 0o600);
      await rename(next, this.request.path);
      return ok();
    } catch { return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to write private SSH configuration file" }); }
  }
}

export class OperatorSshWritableConfigPath {
  constructor(private readonly path: string) {}
  async execute(): Promise<Result<string, OperatorSshFailure>> {
    let metadata;
    try { metadata = await lstat(this.path); }
    catch (failure) {
      if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") return ok(this.path);
      return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to inspect SSH config path" });
    }
    if (metadata.isSymbolicLink()) {
      try { return ok(await realpath(this.path)); }
      catch (failure) {
        if (failure instanceof Error && "code" in failure && failure.code === "ENOENT")
          return err({ kind: OperatorSshFailureKind.DanglingLink, message: "SSH config path is a dangling symbolic link" });
        return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to resolve SSH config symbolic link" });
      }
    }
    if (!metadata.isFile()) return err({ kind: OperatorSshFailureKind.ConfigPath, message: "SSH config path is not a regular file" });
    return ok(this.path);
  }
}

interface HomeSshDefinition {
  accessFallback: string; address: string; alias: string; expectedHostname: string;
  hostKeyFingerprint: string; identityFile: string; user: string;
}
interface OperatorSshInventory { home: HomeSshDefinition }
interface CommandInput { args: string[]; command: string; stdin?: string }
interface InstallPaths {
  includeDirectory: string; includeFile: string; knownHostsFile: string;
  nookDirectory: string; sshConfig: string; sshDirectory: string;
}
const inventoryPath = resolve(import.meta.dir, "k0s/config/operator-ssh.yaml");
const includeDirective = "Include ~/.ssh/config.d/nook-infra.conf";

class OperatorSshInventoryDocument {
  constructor(private readonly source: string) {}
  admit(): Result<OperatorSshInventory, OperatorSshFailure> {
    let value: unknown;
    try { value = Bun.YAML.parse(this.source); }
    catch { return err({ kind: OperatorSshFailureKind.Inventory, message: "operator SSH inventory is not valid YAML" }); }
    if (typeof value !== "object" || !value || !("home" in value) || typeof value.home !== "object" || !value.home)
      return err({ kind: OperatorSshFailureKind.Inventory, message: "operator SSH inventory has no home entry" });
    const home = value.home;
    if (!("accessFallback" in home) || typeof home.accessFallback !== "string" ||
      !("address" in home) || typeof home.address !== "string" ||
      !("alias" in home) || typeof home.alias !== "string" ||
      !("expectedHostname" in home) || typeof home.expectedHostname !== "string" ||
      !("hostKeyFingerprint" in home) || typeof home.hostKeyFingerprint !== "string" ||
      !("identityFile" in home) || typeof home.identityFile !== "string" ||
      !("user" in home) || typeof home.user !== "string")
      return err({ kind: OperatorSshFailureKind.Inventory, message: "operator SSH home inventory has an invalid schema" });
    const definition: HomeSshDefinition = {
      accessFallback: home.accessFallback, address: home.address, alias: home.alias,
      expectedHostname: home.expectedHostname, hostKeyFingerprint: home.hostKeyFingerprint,
      identityFile: home.identityFile, user: home.user,
    };
    return new OperatorSshRequireInventory(definition).execute().map(() => ({ home: definition }));
  }
}

class OperatorSshDirectories {
  constructor(private readonly paths: InstallPaths) {}
  async create(): Promise<Result<void, OperatorSshFailure>> {
    try {
      await mkdir(this.paths.sshDirectory, { mode: 0o700, recursive: true });
      await mkdir(this.paths.includeDirectory, { mode: 0o700, recursive: true });
      await mkdir(this.paths.nookDirectory, { mode: 0o700, recursive: true });
      await chmod(dirname(this.paths.nookDirectory), 0o700);
      await chmod(this.paths.nookDirectory, 0o700);
      await chmod(this.paths.sshDirectory, 0o700);
      await chmod(this.paths.includeDirectory, 0o700);
      return ok();
    } catch { return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to prepare private SSH directories" }); }
  }
}
class OperatorSshExistingConfig {
  constructor(private readonly path: string) {}
  async read(): Promise<Result<string, OperatorSshFailure>> {
    try { return ok(await readFile(this.path, "utf8")); }
    catch (failure) {
      if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") return ok("");
      return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to read existing SSH configuration" });
    }
  }
}

export class OperatorSshInstallation {
  constructor(private readonly home: string, private readonly inventoryFile: string) {}
  async loadInventory(): Promise<Result<OperatorSshInventory, OperatorSshFailure>> {
    let source: string;
    try { source = await Bun.file(this.inventoryFile).text(); }
    catch { return err({ kind: OperatorSshFailureKind.Filesystem, message: "Unable to read operator SSH inventory" }); }
    return new OperatorSshInventoryDocument(source).admit();
  }
  installPaths(): InstallPaths {
    return {
      includeDirectory: join(this.home, ".ssh", "config.d"), includeFile: join(this.home, ".ssh", "config.d", "nook-infra.conf"),
      knownHostsFile: join(this.home, ".nook", "infra", "home-known-hosts"), nookDirectory: join(this.home, ".nook", "infra"),
      sshConfig: join(this.home, ".ssh", "config"), sshDirectory: join(this.home, ".ssh"),
    };
  }
  async install(): Promise<Result<void, OperatorSshFailure>> {
    const inventory = await this.loadInventory();
    if (inventory.isErr()) return err(inventory.error);
    const paths = this.installPaths();
    const directories = await new OperatorSshDirectories(paths).create();
    if (directories.isErr()) return err(directories.error);
    const key = new OperatorSshScanHostKey(inventory.value.home).execute();
    if (key.isErr()) return err(key.error);
    const knownHosts = await new OperatorSshWritePrivateFile({ content: key.value, path: paths.knownHostsFile }).execute();
    if (knownHosts.isErr()) return err(knownHosts.error);
    const included = await new OperatorSshWritePrivateFile({
      content: new OperatorSshRenderManagedConfig(inventory.value.home).execute(), path: paths.includeFile }).execute();
    if (included.isErr()) return err(included.error);
    const sshConfig = await new OperatorSshWritableConfigPath(paths.sshConfig).execute();
    if (sshConfig.isErr()) return err(sshConfig.error);
    const config = await new OperatorSshExistingConfig(sshConfig.value).read();
    if (config.isErr()) return err(config.error);
    const written = await new OperatorSshWritePrivateFile({
      content: new OperatorSshEnsureInclude(config.value).execute(), path: sshConfig.value }).execute();
    if (written.isErr()) return err(written.error);
    const status = await this.status();
    if (status.isErr()) return err(status.error);
    console.log(`Browserless SSH alias ${inventory.value.home.alias} is ready`);
    return ok();
  }
  async status(): Promise<Result<void, OperatorSshFailure>> {
    const inventory = await this.loadInventory();
    if (inventory.isErr()) return err(inventory.error);
    const queried = new OperatorSshRun({ args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
      inventory.value.home.alias, "hostname -s"], command: "ssh" }).execute();
    if (queried.isErr()) return err(queried.error);
    const hostname = queried.value.trim();
    if (hostname !== inventory.value.home.expectedHostname)
      return err({ kind: OperatorSshFailureKind.Identity, message: "home SSH alias reached an unexpected host" });
    console.log(`Home SSH route reached ${hostname} without interactive auth`);
    return ok();
  }
}

enum OperatorSshOperation { Install = "install", Status = "status" }
if (import.meta.main) {
  const installation = new OperatorSshInstallation(homedir(), inventoryPath);
  const operation = process.argv[2];
  const outcome = operation === OperatorSshOperation.Install ? await installation.install()
    : operation === OperatorSshOperation.Status ? await installation.status()
    : err<void, OperatorSshFailure>({ kind: OperatorSshFailureKind.Arguments, message: "usage: bun infra/operator-ssh.ts <install|status>" });
  if (outcome.isErr()) { console.error(outcome.error.message); process.exitCode = 1; }
}
