import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { OvhFailure, OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhDocument } from "./ovh-dedicated-document";
import { RecoveryMarkerCompatibilityKind } from "./ovh-dedicated-observations";
import { OvhDedicatedGetServer, OvhDedicatedOvhApi } from "./ovh-dedicated-api";
import { HostIdentityCreation, HttpMethod, RecoveryMarkerStatus,
  type DedicatedServerDefinition, type DedicatedServerInventory, type HostIdentity,
  type HostIdentityInput, type OvhCredentials, type OvhRecoveryMarker,
  type RecoveryMarkerState } from "./ovh-dedicated-contracts";

export class OvhPrivatePaths {
  constructor(private readonly home: string) {}
  credentialFile(): string { return resolve(this.home, ".nook/ovh-api.json"); }
  identityRoot(): string { return resolve(this.home, ".nook/infra/ovh-host-identities"); }
  recoveryRoot(): string { return resolve(this.home, ".nook/infra/ovh-recovery"); }
  expand(input: string): string {
    if (input === "~") return this.home;
    return input.startsWith("~/") ? resolve(this.home, input.slice(2)) : resolve(input);
  }
}
export enum OvhPathPresence { Present = "present", Absent = "absent" }
export class OvhLocalFile {
  constructor(private readonly path: string) {}
  async read(): Promise<Result<string, OvhFailure>> {
    try { return ok(await readFile(this.path, "utf8")); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to read OVH local file")); }
  }
  async presence(): Promise<Result<OvhPathPresence, OvhFailure>> {
    try { await stat(this.path); return ok(OvhPathPresence.Present); }
    catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return ok(OvhPathPresence.Absent);
      return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to inspect OVH local file"));
    }
  }
  async writePrivate(content: string): Promise<Result<void, OvhFailure>> {
    try { await writeFile(this.path, content, { mode: 0o600 }); return ok(); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to write private OVH file")); }
  }
}
interface RecoveryRequest { definition: DedicatedServerDefinition; hostname: string }
export class OvhRecoveryMarkerStore {
  constructor(private readonly paths: OvhPrivatePaths) {}
  private path(hostname: string): string { return resolve(this.paths.recoveryRoot(), `${hostname}.json`); }
  async load(request: RecoveryRequest): Promise<Result<RecoveryMarkerState, OvhFailure>> {
    const file = new OvhLocalFile(this.path(request.hostname));
    const presence = await file.presence();
    if (presence.isErr()) return err(presence.error);
    if (presence.value === OvhPathPresence.Absent) return ok({ status: RecoveryMarkerStatus.Absent });
    const source = await file.read();
    if (source.isErr()) return err(source.error);
    const marker = new OvhDocument(source.value).recoveryMarker();
    if (marker.isErr()) return err(marker.error);
    const compatibility = marker.value.compatibility(request);
    if (compatibility.kind === RecoveryMarkerCompatibilityKind.DifferentInventory)
      return err(new OvhFailure(OvhFailureKind.RecoveryMarker, `recovery marker for ${request.hostname} does not match inventory`));
    return ok({ status: RecoveryMarkerStatus.Pending, marker: compatibility.marker });
  }
  async persist(request: RecoveryRequest): Promise<Result<void, OvhFailure>> {
    const path = this.path(request.hostname);
    const next = `${path}.next`;
    const marker: OvhRecoveryMarker = { hostname: request.hostname,
      operatingSystem: request.definition.operatingSystem, serviceName: request.definition.serviceName, version: 1 };
    try {
      await mkdir(this.paths.recoveryRoot(), { mode: 0o700, recursive: true });
      await chmod(this.paths.recoveryRoot(), 0o700);
      await writeFile(next, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
      await chmod(next, 0o600); await rename(next, path); await chmod(path, 0o600);
      return ok();
    } catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to persist OVH recovery marker")); }
  }
  async clear(request: RecoveryRequest): Promise<Result<void, OvhFailure>> {
    const state = await this.load(request);
    if (state.isErr()) return err(state.error);
    if (state.value.status === RecoveryMarkerStatus.Absent) return ok();
    try { await rm(this.path(request.hostname)); return ok(); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to remove OVH recovery marker")); }
  }
}
class OvhHostKeyCommand {
  constructor(private readonly args: string[]) {}
  async execute(): Promise<Result<string, OvhFailure>> {
    try {
      const child = Bun.spawn(["ssh-keygen", ...this.args], { stderr: "pipe", stdout: "pipe" });
      const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (exitCode !== 0) return err(new OvhFailure(OvhFailureKind.Command, "ssh-keygen failed"));
      return ok(stdout.trim());
    } catch { return err(new OvhFailure(OvhFailureKind.Command, "Unable to execute ssh-keygen")); }
  }
}
export class OvhHostIdentityStore {
  constructor(private readonly paths: OvhPrivatePaths) {}
  private async prepareDirectory(directory: string): Promise<Result<void, OvhFailure>> {
    try {
      await mkdir(directory, { mode: 0o700, recursive: true });
      await chmod(this.paths.identityRoot(), 0o700); await chmod(directory, 0o700);
      return ok();
    } catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to prepare private OVH host identity directory")); }
  }
  private async protectKeypair(privateKeyPath: string): Promise<Result<void, OvhFailure>> {
    try { await chmod(privateKeyPath, 0o600); await chmod(`${privateKeyPath}.pub`, 0o600); return ok(); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to protect OVH host identity files")); }
  }
  async load(input: HostIdentityInput): Promise<Result<HostIdentity, OvhFailure>> {
    const directory = resolve(this.paths.identityRoot(), input.hostname);
    const privateKeyPath = resolve(directory, "ssh_host_ed25519_key");
    const publicKeyPath = `${privateKeyPath}.pub`;
    const prepared = await this.prepareDirectory(directory);
    if (prepared.isErr()) return err(prepared.error);
    const privateKeyPresence = await new OvhLocalFile(privateKeyPath).presence();
    if (privateKeyPresence.isErr()) return err(privateKeyPresence.error);
    if (privateKeyPresence.value === OvhPathPresence.Absent) {
      if (input.allowCreate === HostIdentityCreation.Existing)
        return err(new OvhFailure(OvhFailureKind.Identity,
          `missing trusted SSH host identity for ${input.hostname}; restore it or explicitly reinstall the server`));
      const generated = await new OvhHostKeyCommand(["-q", "-t", "ed25519", "-N", "", "-C", `nook-host:${input.hostname}`, "-f", privateKeyPath]).execute();
      if (generated.isErr()) return err(generated.error);
    }
    const publicKeyPresence = await new OvhLocalFile(publicKeyPath).presence();
    if (publicKeyPresence.isErr()) return err(publicKeyPresence.error);
    if (publicKeyPresence.value === OvhPathPresence.Absent) {
      const publicKey = await new OvhHostKeyCommand(["-y", "-f", privateKeyPath]).execute();
      if (publicKey.isErr()) return err(publicKey.error);
      const written = await new OvhLocalFile(publicKeyPath).writePrivate(`${publicKey.value}\n`);
      if (written.isErr()) return err(written.error);
    }
    const protectedKeys = await this.protectKeypair(privateKeyPath);
    if (protectedKeys.isErr()) return err(protectedKeys.error);
    const derived = await new OvhHostKeyCommand(["-y", "-f", privateKeyPath]).execute();
    if (derived.isErr()) return err(derived.error);
    const stored = await new OvhLocalFile(publicKeyPath).read();
    if (stored.isErr()) return err(stored.error);
    const storedPublicKey = stored.value.trim();
    if (derived.value.split(/\s+/).slice(0, 2).join(" ") !== storedPublicKey.split(/\s+/).slice(0, 2).join(" "))
      return err(new OvhFailure(OvhFailureKind.Identity, `stored SSH host keypair for ${input.hostname} does not match`));
    const fingerprintOutput = await new OvhHostKeyCommand(["-l", "-f", publicKeyPath, "-E", "sha256"]).execute();
    if (fingerprintOutput.isErr()) return err(fingerprintOutput.error);
    const [, fingerprint = ""] = fingerprintOutput.value.split(/\s+/);
    if (!fingerprint.startsWith("SHA256:")) return err(new OvhFailure(OvhFailureKind.Identity, "generated SSH host identity has no SHA256 fingerprint"));
    const privateKey = await new OvhLocalFile(privateKeyPath).read();
    if (privateKey.isErr()) return err(privateKey.error);
    return ok({ fingerprint, privateKey: privateKey.value, publicKey: `${storedPublicKey}\n` });
  }
}
export class OvhInventoryFile {
  constructor(private readonly path: string) {}
  async load(): Promise<Result<DedicatedServerInventory, OvhFailure>> {
    const source = await new OvhLocalFile(this.path).read();
    if (source.isErr()) return err(source.error);
    let value: unknown;
    try { value = Bun.YAML.parse(source.value); }
    catch { return err(new OvhFailure(OvhFailureKind.Schema, "OVH server inventory is not valid YAML")); }
    return new OvhDocument(value).inventory();
  }
}
export class OvhCredentialStore {
  constructor(private readonly paths: OvhPrivatePaths) {}
  private async parse(path: string): Promise<Result<OvhCredentials, OvhFailure>> {
    const source = await new OvhLocalFile(path).read();
    if (source.isErr()) return err(source.error);
    const parsed = new OvhDocument(source.value).credentials();
    if (parsed.isErr()) return err(parsed.error);
    const requiredCredentials = Object.entries(parsed.value);
    for (const [label, value] of requiredCredentials)
      if (value.trim().length === 0) return err(new OvhFailure(OvhFailureKind.Schema, `OVH ${label} must not be empty`));
    return parsed;
  }
  private async prepare(target: string): Promise<Result<void, OvhFailure>> {
    try { await mkdir(dirname(target), { mode: 0o700, recursive: true }); await chmod(dirname(target), 0o700); return ok(); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to prepare OVH credential store")); }
  }
  private async protect(target: string): Promise<Result<void, OvhFailure>> {
    try { await chmod(target, 0o600); return ok(); }
    catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to protect OVH credential store")); }
  }
  private async install(request: { source: string; target: string }): Promise<Result<void, OvhFailure>> {
    const { source, target } = request;
    const next = `${target}.next`;
    try {
      await writeFile(next, await readFile(source), { mode: 0o600 }); await chmod(next, 0o600);
      await rename(next, target); await chmod(target, 0o600); return ok();
    } catch { return err(new OvhFailure(OvhFailureKind.Filesystem, "Unable to install OVH credentials")); }
  }
  async load(definition: DedicatedServerDefinition): Promise<Result<OvhCredentials, OvhFailure>> {
    const target = this.paths.credentialFile();
    const { OVH_CREDENTIAL_FILE: credentialFile = target } = process.env;
    const source = this.paths.expand(credentialFile);
    const prepared = await this.prepare(target);
    if (prepared.isErr()) return err(prepared.error);
    if (source === target) {
      const protectedFile = await this.protect(target);
      if (protectedFile.isErr()) return err(protectedFile.error);
      return this.parse(target);
    }
    const candidate = await this.parse(source);
    if (candidate.isErr()) return err(candidate.error);
    const validation = await new OvhDedicatedOvhApi({
      credentials: candidate.value, request: { method: HttpMethod.Get, path: "/auth/currentCredential" },
      decode: (text) => new OvhDocument(text).credentialValidation(),
    }).execute();
    if (validation.isErr()) return err(validation.error);
    const server = await new OvhDedicatedGetServer({ credentials: candidate.value, definition }).execute();
    if (server.isErr()) return err(server.error);
    const installed = await this.install({ source, target });
    if (installed.isErr()) return err(installed.error);
    return candidate;
  }
}
