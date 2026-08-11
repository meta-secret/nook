import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { isoTimestamp } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
import {
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";

import {
  NookEnrollmentIssueInput,
  type NookEnrollmentProvider,
  NookVaultNameState,
  OnboardingType,
  enrollment_icloud_shared_provider_for_architecture,
  enrollment_provider_for_architecture,
  enrollment_shared_provider_for_architecture,
  encrypt_labeled_enrollment_payload,
  encrypt_unlabeled_enrollment_payload,
} from "$app-wasm";
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  githubPatValue,
  githubRepositoryValue,
  isConfiguredOAuthFile,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthFileName,
  OAuthFileNameKind,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  prepare_shared_storage_grant,
  createSharedStorageTarget,
  existingSharedStorageTarget,
  provider_onboarding_type,
  provider_oauth_preset_for_provider,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
  unavailableSharedStorageGrantCredential,
} from "$lib/vault/architecture-model";

enum CatalogVaultLabelKind {
  Missing = "missing",
  Present = "present",
}

type CatalogVaultLabel =
  | { kind: CatalogVaultLabelKind.Missing }
  | { kind: CatalogVaultLabelKind.Present; label: string };

const log = createLogger("vault-password");

export async function issueEnrollmentCode({
  state,
  entryId,
  password,
  providerId,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
  readonly providerId: string;
}): Promise<string> {
  if (!state.hasManager) {
    throw new Error("Vault engine is not available.");
  }
  // Password verification borrows the wasm manager synchronously (`&self`).
  // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
  // wait for any *already in-flight* `&mut self` storage future to release its
  // borrow before verify runs, or wasm-bindgen's borrow detector trips.
  state.isPasswordBusy = true;
  log.info("enrollment code issue started");
  try {
    // Wait for the queued wasm op to settle. We deliberately do NOT
    // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
    // future leaves its IndexedDB transaction dangling, which surfaces later as
    // "database is not open" and poisons subsequent borrows. Surface a
    // retriable error instead.
    try {
      const raceStorageTimeoutArgs: Parameters<
        typeof state.raceStorageTimeout
      >[0] = { promise: state.waitForStorageChain(), label: "Vault storage" };
      await state.raceStorageTimeout(raceStorageTimeoutArgs);
    } catch {
      throw new Error("Vault storage is busy. Try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The target entry is already loaded in memory after `addVaultPassword`.
    // Only hit storage when it is genuinely missing — a redundant refresh can
    // otherwise queue behind (or race) background sync work and stall
    // enrollment on the shared storage chain.
    if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
      const refreshed = await state.refreshPasswordEntriesList();
      if (!refreshed || state.passwordEntries.length === 0) {
        throw new Error(
          "Add a backup vault password first; enrollment codes wrap that password.",
        );
      }
      if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
        throw new Error(
          "Password entry not found. Wait for sync to finish and try again.",
        );
      }
    }
    // `verify_vault_password` returns false on a wrong password but can also
    // throw if the underlying age decryptor rejects — treat both as "wrong
    // password" so the UI message stays predictable.
    let verified: boolean;
    try {
      verified = await state.enqueueStorage(async () => {
        await Promise.resolve();
        return state.requireManager().verify_vault_password(entryId, password);
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new Error("Password does not match the vault.");
    }
    log.info("enrollment password verified");
    const selectedProvider = state.providers.find((p) => p.id === providerId);
    if (!selectedProvider) {
      throw new Error("Choose a sync provider.");
    }
    if (selectedProvider.type === "local") {
      throw new Error(
        "Choose a cloud sync provider — local vault is already on state device.",
      );
    }
    if (selectedProvider.type === "local-folder") {
      throw new Error(
        "Local backup folders cannot be embedded in enrollment codes. Choose a cloud provider or have the other browser choose the same folder.",
      );
    }
    const githubPat = githubPatValue(selectedProvider.githubPat);
    const githubRepo = githubRepositoryValue(selectedProvider.githubRepo);
    const selectedOauth = selectedProvider.oauthFile;
    const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
    const usesSharedProviderGrant =
      provider_onboarding_type(selectedProvider, state.vaultArchitecture) ===
      OnboardingType.SharedProviderGrant;
    const usesSharedICloud =
      usesSharedProviderGrant &&
      isConfiguredOAuthFile(selectedOauth) &&
      selectedOauth.config.preset === "icloud";
    log.info("enrollment provider selected");
    if (usesSharedProviderGrant && !usesSharedICloud && !sharedJoinerIdentity) {
      throw new Error(
        state.t(I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired),
      );
    }
    if (
      selectedProvider.type === "github" &&
      !usesSharedProviderGrant &&
      (!githubPat || !githubRepo)
    ) {
      throw new Error(
        state.t(I18N_KEYS.ErrorsGithubEnrollmentCredentialsRequired),
      );
    }
    state.sharedGrantInstructions = "";
    let sharedStorageTarget: SharedStorageTarget = {
      kind: SharedStorageTargetKind.NotBound,
    };
    let enrollmentProviderRow: StorageProvider = selectedProvider;
    if (usesSharedProviderGrant) {
      if (usesSharedICloud) {
        if (selectedOauth.config.iCloudShareTarget.state === "personal") {
          throw new Error(
            state.t(I18N_KEYS.ProviderSetupIcloudSharedTargetRequired),
          );
        }
        const targetId = selectedOauth.config.iCloudShareTarget.value;
        sharedStorageTarget = {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: targetId,
        };
      } else {
        if (!isConfiguredOAuthFile(selectedOauth)) {
          throw new Error(state.t(I18N_KEYS.ErrorsSharedProviderOauthRequired));
        }
        const accessCredential = oauthAccessToken(selectedOauth.config);
        log.info("shared enrollment grant started");
        const fileName = oauthFileName(selectedOauth.config);
        const storageTargetHint =
          fileName.kind === OAuthFileNameKind.Resolved
            ? fileName.fileName
            : githubRepo;
        const folderId = selectedOauth.config.folderId;
        const prepareSharedStorageGrantArgs: Parameters<
          typeof prepare_shared_storage_grant
        >[0] = {
          providerType: selectedProvider.type,
          oauthPreset: provider_oauth_preset_for_provider(selectedProvider),
          joinerIdentityKind: "email",
          joinerIdentity: sharedJoinerIdentity,
          storageTargetHint: suggestedSharedStorageTarget(
            storageTargetHint || "shared folder",
          ),
          storageTarget:
            folderId.state === "folderId"
              ? existingSharedStorageTarget(folderId.value)
              : createSharedStorageTarget(),
          credential:
            accessCredential.kind === OAuthAccessTokenKind.Available
              ? sharedStorageGrantAccessToken(accessCredential.token)
              : unavailableSharedStorageGrantCredential(),
        };
        const grant = await prepare_shared_storage_grant(
          prepareSharedStorageGrantArgs,
        );
        log.info("shared enrollment grant prepared");
        if (grant.kind === "unsupported") {
          throw new Error(state.t(grant.reasonKey));
        }
        const grantTarget = grant.target;
        if (grant.kind === "granted") {
          if (grantTarget.state === "unavailable") {
            throw new Error(
              state.t(I18N_KEYS.ProviderSetupGoogleSharedCreateFailed),
            );
          }
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: grantTarget.storageTargetId,
          };
          const tArgs2: Parameters<typeof state.t>[0] = {
            key: grant.note,
            replacements: {
              email: sharedJoinerIdentity,
              folder:
                grantTarget.state === "named"
                  ? grantTarget.storageTargetName
                  : grantTarget.storageTargetId,
            },
          };
          state.sharedGrantInstructions = state.t(tArgs2);
        } else if (grant.kind === "manual-grant-required") {
          if (grantTarget.state !== "unavailable") {
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grantTarget.storageTargetId,
            };
          }
          const tArgs: Parameters<typeof state.t>[0] = {
            key: grant.instructionsKey,
            replacements: {
              email: grant.joinerIdentity,
              folder:
                grantTarget.state === "named"
                  ? grantTarget.storageTargetName
                  : grantTarget.state === "identified"
                    ? grantTarget.storageTargetId
                    : "shared folder",
            },
          };
          state.sharedGrantInstructions = state.t(tArgs);
        }
        if (
          sharedStorageTarget.kind === SharedStorageTargetKind.Bound &&
          isConfiguredOAuthFile(selectedOauth)
        ) {
          const updatedOauth = bind_google_drive_shared_folder(
            selectedOauth.config,
            sharedStorageTarget.storageTargetId,
          );
          enrollmentProviderRow = {
            ...selectedProvider,
            oauthFile: configuredOAuthFile(updatedOauth),
          };
          state.configureOauthFile(updatedOauth);
          state.providers = state.providers.map((row) =>
            row.id === selectedProvider.id ? enrollmentProviderRow : row,
          );
          await state.persistProviders();

          if (
            (() => {
              const shouldFlushSharedDriveGrantArgs: Parameters<
                typeof shouldFlushSharedDriveGrant
              >[0] = { grant, accessCredential };
              return shouldFlushSharedDriveGrant(
                shouldFlushSharedDriveGrantArgs,
              );
            })()
          ) {
            // The target is not usable until it contains the current vault
            // event log, even when collaborator access needs manual completion.
            // Await Rust/WASM fan-out before issuing the enrollment code.
            const targetArgs: ReturnType<typeof state.providerWasmArgs> =
              state.providerWasmArgs(enrollmentProviderRow);
            await state.enqueueStorage(() =>
              state
                .requireManager()
                .flush_event_outbox_for_provider(...targetArgs),
            );
          }
        }
      }
      if (usesSharedICloud) {
        const targetArgs: ReturnType<typeof state.providerWasmArgs> =
          state.providerWasmArgs(enrollmentProviderRow);
        await state.enqueueStorage(() =>
          state.requireManager().flush_event_outbox_for_provider(...targetArgs),
        );
      }
    }
    const provider: NookEnrollmentProvider =
      usesSharedProviderGrant &&
      sharedStorageTarget.kind === SharedStorageTargetKind.Bound
        ? usesSharedICloud
          ? enrollment_icloud_shared_provider_for_architecture(
              enrollmentProviderRow,
              state.vaultArchitecture,
              sharedStorageTarget.storageTargetId,
            )
          : enrollment_shared_provider_for_architecture(
              enrollmentProviderRow,
              state.vaultArchitecture,
              sharedJoinerIdentity,
              sharedStorageTarget.storageTargetId,
            )
        : enrollment_provider_for_architecture(
            enrollmentProviderRow,
            state.vaultArchitecture,
          );
    log.info("enrollment provider payload prepared");
    let catalogVaultName: CatalogVaultLabel = {
      kind: CatalogVaultLabelKind.Missing,
    };
    if (state.activeVault.kind === ActiveVaultKind.Open) {
      for (const entry of state.localVaults) {
        const label = entry.label.trim();
        if (entry.storeId === state.activeVault.storeId && label) {
          catalogVaultName = {
            kind: CatalogVaultLabelKind.Present,
            label,
          };
          break;
        }
      }
    }
    // The local catalog is the durable browser-level label index. Keep it as
    // the enrollment fallback while older/synced projections without
    // `vault_name` are still supported.
    const manager = state.requireManager();
    const vaultName: CatalogVaultLabel =
      manager.vaultNameState === NookVaultNameState.Named
        ? {
            kind: CatalogVaultLabelKind.Present,
            label: manager.vaultName,
          }
        : catalogVaultName;
    log.info("enrollment vault name loaded");
    const payload =
      vaultName.kind === CatalogVaultLabelKind.Present
        ? NookEnrollmentIssueInput.named(
            provider,
            vaultName.label,
            entryId,
            isoTimestamp(),
          )
        : NookEnrollmentIssueInput.unnamed(provider, entryId, isoTimestamp());
    const selectedPassword = state.passwordEntries.find(
      (e) => e.id === entryId,
    );
    const code =
      selectedPassword && selectedPassword.label.trim()
        ? encrypt_labeled_enrollment_payload(
            payload,
            password,
            selectedPassword.label,
          )
        : encrypt_unlabeled_enrollment_payload(payload, password);
    state.enrollmentCode = code;
    state.beginEnrollmentEntry(entryId);
    log.info("enrollment code issued");
    return code;
  } finally {
    state.isPasswordBusy = false;
  }
}
