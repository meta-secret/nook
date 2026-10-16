import { err, ok, type Result } from "neverthrow";
import {
  NookEnrollmentIssueInput,
  enrollment_provider_for_architecture,
  generate_id,
  seal_invite_passphrase_for_device,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";
import { DeviceJoinMounts } from "$lib/components/add-device/device-join-mounts";
import { isoTimestamp } from "$lib/nook";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";

export enum ExtensionIdentityInvitationKind {
  /** The extension joins the identity with this invite. */
  Invited = "invited",
  /** The identity has no cloud sync provider the extension can join
   * through; only the approved vault is connected. */
  NeedsCloud = "needs-cloud",
}

export type ExtensionIdentityInvitation =
  | {
      readonly kind: ExtensionIdentityInvitationKind.Invited;
      readonly identityId: string;
      readonly identityLabel: string;
      /** Passphrase-encrypted enrollment code: the invite key and every
       * vault's key, as a new device receives them. */
      readonly code: string;
      /** The code's passphrase, sealed to the extension's app key. */
      readonly sealedPassphrase: string;
      /** The cloud mount the extension joins through. */
      readonly mount: StorageProvider;
    }
  | { readonly kind: ExtensionIdentityInvitationKind.NeedsCloud };

type ExtensionIdentityInvitationRequest = {
  readonly vault: VaultState;
  /** The extension installation being connected. */
  readonly devicePublicKey: string;
};

/**
 * Invites the browser extension into the identity the way a new phone or
 * computer is invited: a one-time invite that carries every vault's key, so
 * the extension signs itself in as a member and opens all of the identity's
 * vaults. The passphrase is sealed to the extension,
 * so the invite opens nowhere else.
 */
export class ExtensionIdentityInvite {
  constructor(private readonly request: ExtensionIdentityInvitationRequest) {}

  async issue(): Promise<
    Result<ExtensionIdentityInvitation, VaultStorageFailure>
  > {
    const { vault, devicePublicKey } = this.request;
    const identity = vault.identityControl.snapshot;
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts: vault.identityControl.mounts,
      replication: vault.vaultArchitecture.replication_type,
    };
    const [mount] = new DeviceJoinMounts(mountRequest).compatible;
    if (identity === false || !mount) {
      const needsCloud: ExtensionIdentityInvitation = {
        kind: ExtensionIdentityInvitationKind.NeedsCloud,
      };
      return ok(needsCloud);
    }
    const passphrase = vault.identityControl.newPassphrase();
    let input: NookEnrollmentIssueInput;
    let sealedPassphrase: string;
    try {
      input = NookEnrollmentIssueInput.for_identity(
        enrollment_provider_for_architecture(mount, vault.vaultArchitecture),
        identity.identityId,
        identity.identityLabel,
        generate_id(),
        isoTimestamp(),
      );
      sealedPassphrase = seal_invite_passphrase_for_device(
        devicePublicKey,
        passphrase,
      );
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    const invite: Parameters<typeof vault.identityControl.issueInvite>[0] = {
      input,
      passphrase,
    };
    const issued = await vault.identityControl
      .issueInvite(invite)
      .finally(() => input.free());
    if (issued.isErr()) return err(issued.error);
    const invited: ExtensionIdentityInvitation = {
      kind: ExtensionIdentityInvitationKind.Invited,
      identityId: identity.identityId,
      identityLabel: identity.identityLabel,
      code: issued.value,
      sealedPassphrase,
      mount,
    };
    return ok(invited);
  }
}
