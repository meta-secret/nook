import { err, ok, type Result } from "neverthrow";
import type { NookKeyringProviderShares, NookVaultManager } from "$app-wasm";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";
import {
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from "./connect";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedMessage,
} from "$web-shared/extension/runtime-messages";
import {
  ExtensionKeyringMembership,
  type ExtensionKeyringMember,
  type ExtensionKeyringMembershipRequest,
} from "./keyring-membership";

export type ExtensionKeyringCompletion = {
  readonly manager: NookVaultManager;
};

enum ExtensionKeyringApprovalStateKind {
  AwaitingAuthorization = "awaiting-authorization",
  Authorized = "authorized",
  Released = "released",
}

type ExtensionKeyringApprovalState =
  | { readonly kind: ExtensionKeyringApprovalStateKind.AwaitingAuthorization }
  | {
      readonly kind: ExtensionKeyringApprovalStateKind.Authorized;
      readonly member: ExtensionKeyringMember;
      readonly approvedAt: number;
    }
  | { readonly kind: ExtensionKeyringApprovalStateKind.Released };

type ExtensionKeyringAuthorization = {
  readonly member: ExtensionKeyringMember;
  readonly approvedAt: number;
};

type ExtensionKeyringApprovalConstructorRequest = readonly [
  vault: VaultState,
  request: ExtensionConnectRequest,
];

/** The keyring has no other app to hand providers to, or the extension
 * did not ask for them. */
const noProviders: NookKeyringProviderShares = { apps: [] };

/**
 * Admits the browser extension into the unlocked keyring as an app with its
 * own key, then hands it the keyring: its log, the vaults this browser
 * holds and its sync providers. No vault has to be open, and a keyring with
 * no vault yet is approved the same way. Every step runs against the same
 * engine; a lock or another keyring meanwhile ends the approval.
 */
export class ExtensionKeyringApproval {
  private readonly vault: VaultState;
  private readonly request: ExtensionConnectRequest;
  private readonly capturedManager: Result<
    NookVaultManager,
    VaultStorageFailure
  >;
  private authorizationState: ExtensionKeyringApprovalState = {
    kind: ExtensionKeyringApprovalStateKind.AwaitingAuthorization,
  };

  constructor(
    ...constructorRequest: ExtensionKeyringApprovalConstructorRequest
  ) {
    [this.vault, this.request] = constructorRequest;
    this.capturedManager = this.vault.admitManager();
  }

  private membership(): ExtensionKeyringMembership {
    const request: ExtensionKeyringMembershipRequest = {
      vault: this.vault,
      request: this.request,
      admitManager: () => this.admitManager(),
    };
    return new ExtensionKeyringMembership(request);
  }

  /** Add the extension to the keyring: every vault's DEK is encrypted to
   * its key, and the keyring's providers carry the change. */
  async authorize(): Promise<
    Result<ExtensionKeyringMember, VaultStorageFailure>
  > {
    switch (this.authorizationState.kind) {
      case ExtensionKeyringApprovalStateKind.Authorized:
        return ok(this.authorizationState.member);
      case ExtensionKeyringApprovalStateKind.Released:
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionApprovalContextChanged,
          ),
        );
      case ExtensionKeyringApprovalStateKind.AwaitingAuthorization:
        break;
    }
    const manager = this.admitManager();
    if (manager.isErr()) return err(manager.error);
    const added = await this.membership().add();
    if (added.isErr()) return err(added.error);
    // A lock or another engine while the member was added ends the approval.
    const still = this.admitManager();
    if (still.isErr()) return err(still.error);
    if (
      this.authorizationState.kind !==
      ExtensionKeyringApprovalStateKind.AwaitingAuthorization
    )
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.ExtensionApprovalContextChanged,
        ),
      );
    this.authorizationState = {
      kind: ExtensionKeyringApprovalStateKind.Authorized,
      member: added.value,
      approvedAt: Date.now(),
    };
    return ok(added.value);
  }

  async prepareAuthorizedGrant(): Promise<
    Result<ExtensionPairingApprovedMessage, VaultStorageFailure>
  > {
    const authorization = this.admitAuthorization();
    if (authorization.isErr()) return err(authorization.error);
    const { member, approvedAt } = authorization.value;
    const keyring = await this.membership().handOver(member);
    if (keyring.isErr()) return err(keyring.error);
    const providers = await this.providers();
    if (providers.isErr()) return err(providers.error);
    const message: ExtensionPairingApprovedMessage = {
      type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
      payload: {
        deviceId: this.request.deviceId,
        devicePublicKey: this.request.devicePublicKey,
        deviceSigningPublicKey: this.request.deviceSigningPublicKey,
        deviceLabel: this.request.deviceLabel,
        approvedAt,
        scopes: this.request.scopes,
        ...keyring.value,
        providers: providers.value,
      },
    };
    return ok(message);
  }

  /** Every remote provider of the keyring, sealed in Rust to each of its
   * other apps, so the extension syncs on its own; it never sets one up. */
  private async providers(): Promise<
    Result<NookKeyringProviderShares, VaultStorageFailure>
  > {
    if (
      !this.request.scopes.includes(
        ExtensionConnectScope.SyncProviderCredentials,
      )
    )
      return ok(noProviders);
    return this.vault.enqueueStorage(async () => {
      const manager = this.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        return ok(await manager.value.keyring_provider_shares());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
  }

  admitCompletion(): Result<ExtensionKeyringCompletion, VaultStorageFailure> {
    return this.admitAuthorization().andThen(() =>
      this.admitManager().map((manager) => ({ manager })),
    );
  }

  async deliver(message: ExtensionPairingApprovedMessage) {
    const authorization = this.admitAuthorization();
    if (authorization.isErr()) return err(authorization.error);
    const deliveryArgs: Parameters<
      typeof extensionConnectionBrowser.deliverExtensionPairingApproval
    >[0] = {
      request: this.request,
      message,
    };
    const delivery =
      await extensionConnectionBrowser.deliverExtensionPairingApproval(
        deliveryArgs,
      );
    const completion = this.admitCompletion();
    return completion.isErr() ? err(completion.error) : ok(delivery);
  }

  releaseAuthorization(): void {
    this.authorizationState = {
      kind: ExtensionKeyringApprovalStateKind.Released,
    };
  }

  /** The engine this approval started with, while it is still the open one. */
  private admitManager(): Result<NookVaultManager, VaultStorageFailure> {
    if (this.capturedManager.isErr()) return err(this.capturedManager.error);
    const captured = this.capturedManager.value;
    return this.vault
      .admitManager()
      .andThen((current) =>
        current === captured
          ? ok(current)
          : err(
              new VaultStorageFailure(
                VaultStorageFailureKind.ExtensionApprovalContextChanged,
              ),
            ),
      );
  }

  private admitAuthorization(): Result<
    ExtensionKeyringAuthorization,
    VaultStorageFailure
  > {
    const state = this.authorizationState;
    switch (state.kind) {
      case ExtensionKeyringApprovalStateKind.AwaitingAuthorization:
      case ExtensionKeyringApprovalStateKind.Released:
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionApprovalContextChanged,
          ),
        );
      case ExtensionKeyringApprovalStateKind.Authorized:
        return this.admitManager().map(() => ({
          member: state.member,
          approvedAt: state.approvedAt,
        }));
    }
  }
}
