import { err, ok, type Result } from "neverthrow";
import {
  approve_extension_device,
  type NookExtensionDeviceApproval,
  type NookVaultManager,
} from "$app-wasm";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import {
  activeVaultScope,
  providerBelongsToVault,
  seal_auth_providers_for_device_public_key,
  type StorageProvider,
  type VaultProviderMembership,
} from "$lib/auth/providers";
import {
  ActiveVaultKind,
  type ActiveVault,
} from "$lib/vault/state/provider.svelte";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from "./connect";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedMessage,
} from "$web-shared/extension/runtime-messages";

export type ExtensionVaultCompletion = {
  readonly manager: NookVaultManager;
};

type ExtensionVaultAuthorizationCapabilityRequest = {
  readonly manager: NookVaultManager;
  readonly authorization: NookExtensionDeviceApproval;
};

/** Holds the live manager and generated approval that authorize one grant. */
class ExtensionVaultAuthorizationCapability {
  readonly manager: NookVaultManager;
  readonly authorization: NookExtensionDeviceApproval;

  constructor(request: ExtensionVaultAuthorizationCapabilityRequest) {
    this.manager = request.manager;
    this.authorization = request.authorization;
  }

  projectStoreIdAtProviderBoundary(): Result<string, VaultStorageFailure> {
    return this.projectApprovedStoreId();
  }

  projectStoreIdAtBrowserBoundary(): Result<string, VaultStorageFailure> {
    return this.projectApprovedStoreId();
  }

  private projectApprovedStoreId(): Result<string, VaultStorageFailure> {
    try {
      const storeId = this.authorization.storeId;
      try {
        return ok(storeId.value);
      } finally {
        storeId.free();
      }
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
}

enum ExtensionVaultManagerContextKind {
  Unavailable = "unavailable",
  Captured = "captured",
}

type ExtensionVaultManagerContextState =
  | {
      readonly kind: ExtensionVaultManagerContextKind.Unavailable;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: ExtensionVaultManagerContextKind.Captured;
      readonly manager: NookVaultManager;
      readonly activeVault: ActiveVault;
    };

/** Owns manager and selected-vault continuity for one approval capability. */
class ExtensionVaultManagerContext {
  private readonly state: ExtensionVaultManagerContextState;

  constructor(private readonly vault: VaultState) {
    const admitted = vault.admitManager();
    this.state = admitted.isErr()
      ? {
          kind: ExtensionVaultManagerContextKind.Unavailable,
          failure: admitted.error,
        }
      : {
          kind: ExtensionVaultManagerContextKind.Captured,
          manager: admitted.value,
          activeVault: vault.activeVault,
        };
  }

  admit(): Result<NookVaultManager, VaultStorageFailure> {
    switch (this.state.kind) {
      case ExtensionVaultManagerContextKind.Unavailable:
        return err(this.state.failure);
      case ExtensionVaultManagerContextKind.Captured:
        return this.vault
          .admitManager()
          .andThen((manager) => this.admitCapturedManager(manager));
    }
  }

  private admitCapturedManager(
    current: NookVaultManager,
  ): Result<NookVaultManager, VaultStorageFailure> {
    const state = this.state;
    switch (state.kind) {
      case ExtensionVaultManagerContextKind.Unavailable:
        return err(state.failure);
      case ExtensionVaultManagerContextKind.Captured: {
        const capturedManager = state.manager;
        return this.vaultSelectionMatches(state.activeVault).andThen(
          (matches) =>
            current === capturedManager && matches
              ? ok(current)
              : err(
                  new VaultStorageFailure(
                    VaultStorageFailureKind.GenerationChanged,
                  ),
                ),
        );
      }
    }
  }

  private vaultSelectionMatches(
    captured: ActiveVault,
  ): Result<boolean, VaultStorageFailure> {
    const current = this.vault.activeVault;
    switch (captured.kind) {
      case ActiveVaultKind.Open:
        switch (current.kind) {
          case ActiveVaultKind.Open:
            return ok(current.storeId === captured.storeId);
          case ActiveVaultKind.Closed:
            return ok(false);
        }
      case ActiveVaultKind.Closed:
        switch (current.kind) {
          case ActiveVaultKind.Open:
            return ok(false);
          case ActiveVaultKind.Closed:
            return ok(true);
        }
    }
  }
}

enum ExtensionVaultApprovalStateKind {
  AwaitingAuthorization = "awaiting-authorization",
  Authorized = "authorized",
  Released = "released",
}

type ExtensionVaultApprovalState =
  | { readonly kind: ExtensionVaultApprovalStateKind.AwaitingAuthorization }
  | {
      readonly kind: ExtensionVaultApprovalStateKind.Authorized;
      readonly authorization: NookExtensionDeviceApproval;
    }
  | { readonly kind: ExtensionVaultApprovalStateKind.Released };

/** Admits one extension grant against the same live vault throughout preparation. */
export class ExtensionVaultApproval {
  private readonly managerContext: ExtensionVaultManagerContext;
  private authorizationState: ExtensionVaultApprovalState = {
    kind: ExtensionVaultApprovalStateKind.AwaitingAuthorization,
  };

  constructor(
    private readonly vault: VaultState,
    private readonly request: ExtensionConnectRequest,
  ) {
    this.managerContext = new ExtensionVaultManagerContext(vault);
  }

  async authorize(): Promise<
    Result<NookExtensionDeviceApproval, VaultStorageFailure>
  > {
    return this.vault.enqueueStorage(async () => {
      switch (this.authorizationState.kind) {
        case ExtensionVaultApprovalStateKind.Authorized:
          return ok(this.authorizationState.authorization);
        case ExtensionVaultApprovalStateKind.Released:
          return err(
            new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
          );
        case ExtensionVaultApprovalStateKind.AwaitingAuthorization: {
          const manager = this.managerContext.admit();
          if (manager.isErr()) return err(manager.error);
          try {
            const authorization = await approve_extension_device(
              manager.value,
              this.request.deviceId,
              this.request.devicePublicKey,
              this.request.deviceSigningPublicKey,
              this.request.deviceLabel,
            );
            this.authorizationState = {
              kind: ExtensionVaultApprovalStateKind.Authorized,
              authorization,
            };
            return ok(authorization);
          } catch (failure) {
            return err(new NativeVaultStorageFailure(failure));
          }
        }
      }
    });
  }

  async prepareAuthorizedGrant(): Promise<
    Result<ExtensionPairingApprovedMessage, VaultStorageFailure>
  > {
    const providerStoreId = await this.vault.enqueueStorage(() => {
      const capability = this.admitAuthorization();
      if (capability.isErr()) return err(capability.error);
      return capability.value.projectStoreIdAtProviderBoundary();
    });
    if (providerStoreId.isErr()) return err(providerStoreId.error);

    let providers: StorageProvider[] = [];
    if (
      this.request.scopes.includes(
        ExtensionConnectScope.SyncProviderCredentials,
      )
    ) {
      const snapshot = await this.vault.enqueueStorage(async () => {
        const capability = this.admitAuthorization();
        if (capability.isErr()) return err(capability.error);
        try {
          return ok(
            await capability.value.manager.load_auth_providers_snapshot(),
          );
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
      });
      if (snapshot.isErr()) return err(snapshot.error);
      try {
        const matching = snapshot.value.providers.filter((provider) => {
          const membership: VaultProviderMembership = {
            provider,
            storeId: providerStoreId.value,
          };
          return providerBelongsToVault(membership);
        });
        const providerSnapshot: Parameters<
          typeof seal_auth_providers_for_device_public_key
        >[1] = {
          providers: matching,
          activeVaultStoreId: activeVaultScope(providerStoreId.value),
        };
        providers = seal_auth_providers_for_device_public_key(
          this.request.devicePublicKey,
          providerSnapshot,
        ).providers;
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    }

    const records = await this.vault.enqueueStorage(async () => {
      const capability = this.admitAuthorization();
      if (capability.isErr()) return err(capability.error);
      try {
        return ok(await capability.value.manager.export_event_log_records_js());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (records.isErr()) return err(records.error);
    try {
      const capability = this.admitAuthorization();
      if (capability.isErr()) return err(capability.error);
      const { authorization } = capability.value;
      const unnamed = this.vault.t(I18N_KEYS.LoginVaultPickerUnnamed);
      let vaultName = unnamed;
      let eventLogRecords: ExtensionPairingApprovedMessage["eventLogRecords"];
      try {
        const entry = this.vault.localVaults.find(
          (candidate) => candidate.storeId === providerStoreId.value,
        );
        if (entry) vaultName = entry.display_label(unnamed);
        eventLogRecords = records.value.to_array();
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      const browserVaultStoreId =
        capability.value.projectStoreIdAtBrowserBoundary();
      if (browserVaultStoreId.isErr()) return err(browserVaultStoreId.error);
      return ok({
        type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
        payload: {
          vaultType: authorization.vaultType,
          deviceId: this.request.deviceId,
          devicePublicKey: this.request.devicePublicKey,
          deviceSigningPublicKey: this.request.deviceSigningPublicKey,
          deviceLabel: this.request.deviceLabel,
          vaultStoreId: browserVaultStoreId.value,
          vaultName,
          approvedAt: authorization.approvedAt,
          scopes: this.request.scopes,
          providers,
        },
        eventLogRecords,
      });
    } finally {
      records.value.free();
    }
  }

  admitCompletion(): Result<ExtensionVaultCompletion, VaultStorageFailure> {
    return this.admitAuthorization().map(({ manager }) => ({ manager }));
  }

  async deliver(message: ExtensionPairingApprovedMessage) {
    const capability = this.admitAuthorization();
    if (capability.isErr()) return err(capability.error);
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
    switch (this.authorizationState.kind) {
      case ExtensionVaultApprovalStateKind.AwaitingAuthorization:
        this.authorizationState = {
          kind: ExtensionVaultApprovalStateKind.Released,
        };
        return;
      case ExtensionVaultApprovalStateKind.Authorized:
        this.authorizationState.authorization.free();
        this.authorizationState = {
          kind: ExtensionVaultApprovalStateKind.Released,
        };
        return;
      case ExtensionVaultApprovalStateKind.Released:
        return;
    }
  }

  private admitAuthorization(): Result<
    ExtensionVaultAuthorizationCapability,
    VaultStorageFailure
  > {
    switch (this.authorizationState.kind) {
      case ExtensionVaultApprovalStateKind.AwaitingAuthorization:
      case ExtensionVaultApprovalStateKind.Released:
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      case ExtensionVaultApprovalStateKind.Authorized: {
        const { authorization } = this.authorizationState;
        return this.managerContext.admit().map(
          (manager) =>
            new ExtensionVaultAuthorizationCapability({
              manager,
              authorization,
            }),
        );
      }
    }
  }
}
