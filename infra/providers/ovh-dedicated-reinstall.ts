import { err, ok, type Result } from "neverthrow";
import { OvhFailure, OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhDocument } from "./ovh-dedicated-document";
import { OvhDedicatedGetServer, OvhDedicatedOvhApi, OvhDedicatedRequireCompatibleTemplate } from "./ovh-dedicated-api";
import { OvhHostIdentityStore, OvhLocalFile, OvhPrivatePaths, OvhRecoveryMarkerStore } from "./ovh-dedicated-local";
import { HostIdentityCreation, HttpMethod, OvhTaskOutcome, OvhTaskStatus, ProvisionResult,
  RecoveryMarkerStatus, ReinstallAuthorization, type HostIdentity, type ProvisionContext,
  type ReinstallRequest } from "./ovh-dedicated-contracts";

export enum ReinstallDecision { Required = "required", Converged = "converged" }
export class OvhReinstallIntent {
  constructor(private readonly request: {
    allowReinstall: ReinstallAuthorization; currentOperatingSystem: string; desiredOperatingSystem: string;
  }) {}
  decision(): Result<ReinstallDecision, OvhFailure> {
    if (this.request.allowReinstall === ReinstallAuthorization.Replace) return ok(ReinstallDecision.Required);
    if (this.request.currentOperatingSystem === this.request.desiredOperatingSystem) return ok(ReinstallDecision.Converged);
    if (this.request.currentOperatingSystem === "none_64") return ok(ReinstallDecision.Required);
    return err(new OvhFailure(OvhFailureKind.ReinstallRefused,
      `refusing to replace ${this.request.currentOperatingSystem}; declare disaster recovery explicitly`));
  }
}
class OvhHostIdentityInstallScript {
  constructor(private readonly identity: HostIdentity) {}
  encode(): string {
    const script = `#!/bin/sh
set -eu
install -d -m 0755 /etc/ssh
cat > /etc/ssh/ssh_host_ed25519_key <<'NOOK_PRIVATE_KEY'
${this.identity.privateKey.trim()}
NOOK_PRIVATE_KEY
cat > /etc/ssh/ssh_host_ed25519_key.pub <<'NOOK_PUBLIC_KEY'
${this.identity.publicKey.trim()}
NOOK_PUBLIC_KEY
chmod 0600 /etc/ssh/ssh_host_ed25519_key
chmod 0644 /etc/ssh/ssh_host_ed25519_key.pub
systemctl restart ssh.service
`;
    return Buffer.from(script).toString("base64");
  }
}
enum ReinstallPreparationKind { Ready = "ready", Consumed = "consumed" }
interface ReadyReinstall {
  kind: ReinstallPreparationKind.Ready; context: ProvisionContext; hostIdentity: HostIdentity; publicKey: string;
}
type ReinstallPreparation = ReadyReinstall | { kind: ReinstallPreparationKind.Consumed };
export enum ReinstallSubmissionKind { Unchanged = "unchanged", Submitted = "submitted" }
type ReinstallSubmission =
  | { kind: ReinstallSubmissionKind.Unchanged }
  | { kind: ReinstallSubmissionKind.Submitted; task: SubmittedOvhReinstall };

export class OvhReinstallPreparation {
  constructor(private readonly paths: OvhPrivatePaths) {}
  async prepare(input: ProvisionContext): Promise<Result<PreparedOvhReinstall, OvhFailure>> {
    const context = input;
    const compatible = await new OvhDedicatedRequireCompatibleTemplate(context).execute();
    if (compatible.isErr()) return err(compatible.error);
    const publicKey = await new OvhLocalFile(this.paths.expand(context.definition.sshPublicKeyFile)).read();
    if (publicKey.isErr()) return err(publicKey.error);
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(context.hostname))
      return err(new OvhFailure(OvhFailureKind.Identity, "hostname is not a valid lowercase host label"));
    if (!/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey.value.trim()))
      return err(new OvhFailure(OvhFailureKind.Identity, "SSH public key must be an OpenSSH ed25519 or RSA key"));
    const hostIdentity = await new OvhHostIdentityStore(this.paths).load({ allowCreate: HostIdentityCreation.Create, hostname: context.hostname });
    if (hostIdentity.isErr()) return err(hostIdentity.error);
    return ok(new PreparedOvhReinstall({ kind: ReinstallPreparationKind.Ready,
      context, hostIdentity: hostIdentity.value, publicKey: publicKey.value.trim() }));
  }
}

/** Owns one dispatch permission, consumed before the first asynchronous effect. */
class PreparedOvhReinstall {
  #state: ReinstallPreparation;
  constructor(input: ReadyReinstall) { this.#state = input; }
  async submit(markers: OvhRecoveryMarkerStore): Promise<Result<ReinstallSubmission, OvhFailure>> {
    if (this.#state.kind === ReinstallPreparationKind.Consumed)
      return err(new OvhFailure(OvhFailureKind.Consumed, "OVH reinstall preparation has already been consumed"));
    const { context, hostIdentity, publicKey } = this.#state;
    this.#state = { kind: ReinstallPreparationKind.Consumed };
    const payload: ReinstallRequest = { customizations: { hostname: context.hostname,
      postInstallationScript: new OvhHostIdentityInstallScript(hostIdentity).encode(), sshKey: publicKey },
      operatingSystem: context.definition.operatingSystem };
    const current = await new OvhDedicatedGetServer(context).execute();
    if (current.isErr()) return err(current.error);
    const decision = new OvhReinstallIntent({ allowReinstall: context.allowReinstall,
      currentOperatingSystem: current.value.os, desiredOperatingSystem: context.definition.operatingSystem }).decision();
    if (decision.isErr()) return err(decision.error);
    if (decision.value === ReinstallDecision.Converged) return ok({ kind: ReinstallSubmissionKind.Unchanged });
    const persisted = await markers.persist(context);
    if (persisted.isErr()) return err(persisted.error);
    const task = await new OvhDedicatedOvhApi({ credentials: context.credentials,
      decode: (text) => new OvhDocument(text).task(), request: {
        body: JSON.stringify(payload), method: HttpMethod.Post,
        path: `/dedicated/server/${encodeURIComponent(context.definition.serviceName)}/reinstall`,
      } }).execute();
    if (task.isErr()) return err(task.error);
    return ok({ kind: ReinstallSubmissionKind.Submitted,
      task: new SubmittedOvhReinstall({ context, taskId: task.value.taskId }) });
  }
}
enum SubmittedReinstallKind { Awaiting = "awaiting", Consumed = "consumed" }
interface ReinstallTask { context: ProvisionContext; taskId: number }
type SubmittedReinstall =
  | { kind: SubmittedReinstallKind.Awaiting; task: ReinstallTask }
  | { kind: SubmittedReinstallKind.Consumed };
class SubmittedOvhReinstall {
  #state: SubmittedReinstall;
  constructor(task: ReinstallTask) { this.#state = { kind: SubmittedReinstallKind.Awaiting, task }; }
  async complete(): Promise<Result<ProvisionResult, OvhFailure>> {
    if (this.#state.kind === SubmittedReinstallKind.Consumed)
      return err(new OvhFailure(OvhFailureKind.Consumed, "OVH reinstall task has already been consumed"));
    const { context, taskId } = this.#state.task;
    this.#state = { kind: SubmittedReinstallKind.Consumed };
    const deadline = Date.now() + 45 * 60 * 1000;
    for (;;) {
      if (Date.now() >= deadline) return err(new OvhFailure(OvhFailureKind.Timeout, "OVH reinstall task exceeded 45 minutes"));
      const task = await new OvhDedicatedOvhApi({ credentials: context.credentials,
        decode: (text) => new OvhDocument(text).task(), request: { method: HttpMethod.Get,
          path: `/dedicated/server/${encodeURIComponent(context.definition.serviceName)}/task/${taskId}` } }).execute();
      if (task.isErr()) return err(task.error);
      const outcome = OvhTaskStatus.outcome(task.value.status);
      if (outcome === OvhTaskOutcome.Completed) break;
      if (outcome === OvhTaskOutcome.Failed) return err(new OvhFailure(OvhFailureKind.Task, `OVH reinstall task ended in ${task.value.status}`));
      process.stderr.write(`OVH reinstall ${task.value.status}\n`);
      await Bun.sleep(15_000);
    }
    const installed = await new OvhDedicatedGetServer(context).execute();
    if (installed.isErr()) return err(installed.error);
    if (installed.value.os !== context.definition.operatingSystem)
      return err(new OvhFailure(OvhFailureKind.Task, "OVH task completed without the declared operating system"));
    return ok(ProvisionResult.Reinstalled);
  }
}
export class OvhDedicatedProvision {
  constructor(private readonly paths: OvhPrivatePaths) {}
  async execute(input: ProvisionContext): Promise<Result<ProvisionResult, OvhFailure>> {
    const current = await new OvhDedicatedGetServer(input).execute();
    if (current.isErr()) return err(current.error);
    const markers = new OvhRecoveryMarkerStore(this.paths);
    const marker = await markers.load(input);
    if (marker.isErr()) return err(marker.error);
    if (marker.value.status === RecoveryMarkerStatus.Pending) return ok(ProvisionResult.Reinstalled);
    const decision = new OvhReinstallIntent({ allowReinstall: input.allowReinstall,
      currentOperatingSystem: current.value.os, desiredOperatingSystem: input.definition.operatingSystem }).decision();
    if (decision.isErr()) return err(decision.error);
    if (decision.value === ReinstallDecision.Converged) return ok(ProvisionResult.Unchanged);
    const prepared = await new OvhReinstallPreparation(this.paths).prepare(input);
    if (prepared.isErr()) return err(prepared.error);
    const submitted = await prepared.value.submit(markers);
    if (submitted.isErr()) return err(submitted.error);
    if (submitted.value.kind === ReinstallSubmissionKind.Unchanged) return ok(ProvisionResult.Unchanged);
    return submitted.value.task.complete();
  }
}
