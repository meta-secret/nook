import { VaultState } from "$lib/vault.svelte";
import { isoTimestamp, type NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  NookEnrollmentIssueInput,
  OnboardingType,
  StorageProviderType,
  decryptEnrollmentPayload,
  enrollmentProviderForArchitecture,
  encryptEnrollmentPayload,
  hasActiveLocalVault,
  setLocalVaultLabel,
} from "$app-wasm";
import {
  bindGoogleDriveSharedFolder,
  type OAuthFilePreset,
  type StorageProvider,
} from "$lib/auth-providers";
import {
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleDriveSharedAccess,
} from "$lib/google-oauth";
import {
  acceptICloudSharedVault,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
} from "$lib/icloud-oauth";
import {
  prepareSharedStorageGrant,
  providerOnboardingType,
  type SharedStorageGrantOutcome,
} from "$lib/vault-architecture";
import {
  isSentinelPasswordUnlockForbiddenError,
  isSentinelVault,
} from "$lib/vault/sentinel-unlock";

const log = createLogger("vault-password");

type E2ePasswordManager = {
  addVaultPasswordForE2e?: (label: string, password: string) => Promise<void>;
  updateVaultPasswordEntryForE2e?: (
    entryId: string,
    password: string,
  ) => Promise<void>;
};

export async function addVaultPassword(
  state: VaultState,
  label: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  if (!state.isAuthenticated) {
    state.passwordError = "Unlock the vault before adding a password.";
    return;
  }
  const hadPasswords = state.passwordEntries.length > 0;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.manager!;
    await state.enqueueStorage(() => {
      const trimmedLabel = label.trim();
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.addVaultPasswordForE2e
      ) {
        return e2eManager.addVaultPasswordForE2e(trimmedLabel, password);
      }
      return manager.addVaultPassword(trimmedLabel, password);
    });
    await state.refreshPasswordEntriesList();
    log.info("vault password added", { hadPasswords, label: label.trim() });
    state.showSuccess(
      hadPasswords
        ? state.t("toasts.password_added_rotate")
        : state.t("toasts.password_set"),
    );
    await state.hydrateMultiDeviceState();
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to add vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function updateVaultPasswordEntry(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.manager!;
    await state.enqueueStorage(() => {
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.updateVaultPasswordEntryForE2e
      ) {
        return e2eManager.updateVaultPasswordEntryForE2e(entryId, password);
      }
      return manager.updateVaultPasswordEntry(entryId, password);
    });
    await state.refreshPasswordEntriesList();
    state.showSuccess(state.t("toasts.password_updated"));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to update vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function removeVaultPasswordEntry(
  state: VaultState,
  entryId: string,
): Promise<void> {
  if (!state.manager) return;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    await state.enqueueStorage(() =>
      state.manager!.removeVaultPasswordEntry(entryId),
    );
    await state.refreshPasswordEntriesList();
    if (state.activeEnrollmentEntryId === entryId) {
      state.enrollmentCode = "";
      state.activeEnrollmentEntryId = undefined;
    }
    state.showSuccess(state.t("toasts.password_removed"));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to remove vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function setVaultPassword(
  state: VaultState,
  password: string,
): Promise<void> {
  await state.addVaultPassword("Vault password", password);
}

export async function removeVaultPassword(state: VaultState): Promise<void> {
  const entry = state.passwordEntries[0];
  if (!entry) return;
  await state.removeVaultPasswordEntry(entry.id);
}

export async function unlockWithPassword(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }
  if (state.isVerifying) return;
  if (isSentinelVault(state)) {
    state.errorMsg = state.t("architecture_modes.sentinel_password_forbidden");
    state.sentinelCeremonyPrompt = true;
    return;
  }
  if (!state.hasRemoteCredentials()) {
    state.errorMsg =
      state.storageMode === "oauth-file"
        ? state.t("errors.google_sign_in_required")
        : state.t("errors.github_credentials_required");
    return;
  }
  await state.ensureOAuthTokensFresh();
  if (!entryId.trim()) {
    state.errorMsg = state.t("errors.vault_password_required");
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connectWithPassword(
        ...state.wasmStorageArgs(),
        entryId,
        password,
      ),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    if (state.deviceProtectionReady) {
      await state.ensureProviderSaved();
      await state.loadProviders();
    }
    await state.refreshPasswordEntriesList();
    if (state.deviceProtectionReady) {
      void state.hydrateMultiDeviceState();
    }
    state.markVaultUnlocked();
    log.info("vault unlocked with password", {
      mode: state.storageMode,
      secrets: rawRecords.length,
      entryId,
    });
    state.joinEnrollmentPrompt = "none";
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t("toasts.vault_unlocked"));
    state.startIdleSessionTracking();
    if (state.deviceProtectionReady) {
      state.startVaultSync();
    }
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to unlock with password.";
    log.warn("vault password unlock failed", { error: message });
    if (isSentinelPasswordUnlockForbiddenError(e)) {
      state.errorMsg = state.t(
        "architecture_modes.sentinel_password_forbidden",
      );
      state.sentinelCeremonyPrompt = true;
      return;
    }
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}

export function clearEnrollmentCode(state: VaultState) {
  state.enrollmentCode = "";
  state.activeEnrollmentEntryId = undefined;
}

function applySavedEnrollmentProvider(
  state: VaultState,
  provider: StorageProvider | undefined,
) {
  if (!provider || provider.type === "local") {
    state.storageMode = "local";
    state.loginSetupType = "local";
    return;
  }

  state.storageMode = provider.type;
  state.loginSetupType = undefined;
  if (provider.type === "github") {
    state.githubPat = provider.githubPat ?? "";
    state.githubRepo = provider.githubRepo ?? "";
    state.oauthFile = undefined;
    state.localFolder = undefined;
    return;
  }
  if (provider.type === "oauth-file") {
    state.oauthFile = provider.oauthFile ?? undefined;
    state.githubPat = "";
    state.githubRepo = provider.oauthFile?.fileName ?? state.githubRepo;
    state.localFolder = undefined;
    return;
  }

  state.localFolder = provider.localFolder ?? undefined;
  state.githubPat = "";
  state.oauthFile = undefined;
}

export function findSharedGrantProvider(
  providers: StorageProvider[],
  preset: string,
  storageTargetId?: string,
): StorageProvider | undefined {
  const withToken = providers.filter(
    (provider) =>
      provider.type === "oauth-file" &&
      provider.oauthFile?.preset === preset &&
      Boolean(provider.oauthFile.accessToken?.trim()),
  );
  if (storageTargetId) {
    return withToken.find(
      (provider) =>
        provider.oauthFile?.folderId === storageTargetId ||
        provider.oauthFile?.iCloudShareTarget === storageTargetId,
    );
  }
  return withToken[0];
}

export function shouldFlushSharedDriveGrant(
  grant: SharedStorageGrantOutcome,
  accessToken?: string,
): boolean {
  return grant.kind !== "unsupported" && Boolean(accessToken?.trim());
}

async function localVaultHasPasswordEntries(
  state: VaultState,
): Promise<boolean> {
  if (!state.manager) return false;
  if (!state.localVaultPresent && !(await hasActiveLocalVault())) return false;
  try {
    const entries = await state.enqueueStorage(() =>
      state.manager!.fetchVaultPasswordEntries("local", "", ""),
    );
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function connectWithEnrollmentCode(
  state: VaultState,
  code: string,
  password = "",
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const payload = decryptEnrollmentPayload(code, password);
    const entryId = payload.entryId.trim();
    const unlockPassword = password.trim();
    if (!entryId) {
      throw new Error("Enrollment code is missing a vault password entry id.");
    }
    if (!unlockPassword) {
      throw new Error("Enter the vault password for state onboarding QR.");
    }

    let enrollmentStorageArgs: [string, string, string];
    if (payload.provider.type === StorageProviderType.Github) {
      const githubPat = payload.provider.githubPat ?? "";
      const githubRepo = payload.provider.githubRepo ?? "";
      state.storageMode = "github";
      state.githubPat = githubPat;
      state.githubRepo = githubRepo;
      state.loginSetupType = "github";
      enrollmentStorageArgs = ["github", githubPat, githubRepo];
    } else if (payload.onboardingType === OnboardingType.SharedProviderGrant) {
      const preset = (payload.provider.oauthPreset ??
        "google-drive") as OAuthFilePreset;
      const storageTargetId = payload.provider.sharedStorageTargetId?.trim();
      await state.loadProviders();
      let provider = findSharedGrantProvider(
        state.providers,
        preset,
        storageTargetId,
      );
      let sharedProviderNeedsSave = false;
      if (!provider && preset === "google-drive") {
        if (!isGoogleOAuthConfigured()) {
          throw new Error(state.t("provider_setup.google_oauth_unconfigured"));
        }
        const tokens = await requestGoogleDriveSharedAccess({
          prompt: "consent",
        });
        const oauthFile = oauthTokensToConfig(tokens, {
          preset: "google-drive",
          accessToken: tokens.accessToken,
          folderId: storageTargetId || undefined,
          fileName: "nook-events",
        });
        provider = {
          id: "enrollment-shared-oauth",
          type: "oauth-file",
          label: "Shared Google Drive",
          oauthFile,
          createdAt: isoTimestamp(),
        };
        sharedProviderNeedsSave = true;
      }
      if (preset === "icloud") {
        if (!storageTargetId) {
          throw new Error(
            state.t("provider_setup.icloud_shared_target_required"),
          );
        }
        const existingToken = provider?.oauthFile?.accessToken?.trim();
        const tokens = existingToken
          ? {
              accessToken: existingToken,
              accountName: provider?.oauthFile?.accountEmail,
            }
          : await requestICloudWebAuthToken();
        const accepted = await acceptICloudSharedVault(storageTargetId);
        provider = {
          id: provider?.id ?? "enrollment-shared-icloud",
          type: "oauth-file",
          label: provider?.label ?? state.t("provider_picker.icloud"),
          oauthFile: oauthTokensToICloudConfig(tokens, {
            ...(provider?.oauthFile ?? {
              preset: "icloud",
              accessToken: tokens.accessToken,
            }),
            iCloudMode: "shared",
            iCloudShareTarget: accepted.storageTargetId,
            fileName: provider?.oauthFile?.fileName ?? "nook-events",
          }),
          createdAt: provider?.createdAt ?? isoTimestamp(),
        };
        sharedProviderNeedsSave = provider.id === "enrollment-shared-icloud";
      }
      if (!provider) {
        throw new Error(
          "Shared-provider enrollment requires this browser to have matching provider access before connecting.",
        );
      }
      if (
        storageTargetId &&
        preset === "google-drive" &&
        provider.oauthFile &&
        !provider.oauthFile.folderId
      ) {
        provider = {
          ...provider,
          oauthFile: { ...provider.oauthFile, folderId: storageTargetId },
        };
      }
      applySavedEnrollmentProvider(state, provider);
      if (sharedProviderNeedsSave) {
        state.loginSetupType = "oauth-file";
      }
      enrollmentStorageArgs = state.providerWasmArgs(provider);
    } else if (payload.provider.type === StorageProviderType.OauthFile) {
      const oauthProvider: StorageProvider = {
        id: "enrollment-oauth",
        type: "oauth-file",
        label: "Enrollment OAuth provider",
        oauthFile: {
          preset: (payload.provider.oauthPreset ??
            "google-drive") as OAuthFilePreset,
          accessToken: payload.provider.oauthAccessToken ?? "",
          refreshToken: payload.provider.oauthRefreshToken ?? undefined,
          expiresAt: payload.provider.oauthExpiresAt ?? undefined,
          fileId: payload.provider.oauthFileId ?? undefined,
          fileName: payload.provider.oauthFileName ?? undefined,
          accountEmail: payload.provider.oauthAccountEmail ?? undefined,
        },
        createdAt: isoTimestamp(),
      };
      state.storageMode = "oauth-file";
      state.loginSetupType = "oauth-file";
      state.oauthFile = oauthProvider.oauthFile;
      state.githubPat = "";
      state.githubRepo = oauthProvider.oauthFile?.fileName ?? state.githubRepo;
      state.localFolder = undefined;
      enrollmentStorageArgs = state.providerWasmArgs(oauthProvider);
    } else {
      await state.loadProviders();
      const hasLocalPasswordEntries = await localVaultHasPasswordEntries(state);
      const provider = hasLocalPasswordEntries
        ? undefined
        : (state.syncProviders[0] ??
          state.providers.find((candidate) => candidate.type !== "local"));
      applySavedEnrollmentProvider(state, provider);
      enrollmentStorageArgs =
        provider && provider.type !== "local"
          ? state.providerWasmArgs(provider)
          : ["local", "", ""];
    }

    await state.initDeviceIdentity();

    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connectWithPassword(
        ...enrollmentStorageArgs,
        entryId,
        unlockPassword,
      ),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    const vaultName = payload.vaultName?.trim();
    const vaultStoreId = state.manager.vaultStoreId.trim();
    if (vaultName && vaultStoreId) {
      state.manager.setVaultName(vaultName);
      await setLocalVaultLabel(vaultStoreId, vaultName);
    }
    // Password enrollment downloads an existing vault into this browser. Make
    // that inherited store the active local catalog entry before saving the
    // transferred provider credentials.
    await state.refreshLocalVaultCatalog();
    await state.syncActiveVaultStoreIdToAuth();
    await state.ensureProviderSaved();
    await state.loadProviders();
    await state.refreshPasswordEntriesList();
    void state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    state.joinEnrollmentPrompt = "none";
    state.loginEnrollmentCode = "";
    state.prefillEnrollmentCode = "";
    state.enrollmentFromUrlPending = false;
    state.showSuccess(state.t("toasts.device_enrolled"));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    state.errorMsg =
      e instanceof Error
        ? e.message
        : "Failed to enroll with the provided code.";
  } finally {
    state.isVerifying = false;
  }
}

export async function issueEnrollmentCode(
  state: VaultState,
  entryId: string,
  password: string,
  providerId = state.syncProviders[0]?.id ?? "",
): Promise<string> {
  if (!state.manager) {
    throw new Error("Vault engine is not available.");
  }
  // Password verification borrows the wasm manager synchronously (`&self`).
  // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
  // wait for any *already in-flight* `&mut self` storage future to release its
  // borrow before verify runs, or wasm-bindgen's borrow detector trips.
  state.isPasswordBusy = true;
  try {
    // Wait for the queued wasm op to settle. We deliberately do NOT
    // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
    // future leaves its IndexedDB transaction dangling, which surfaces later as
    // "database is not open" and poisons subsequent borrows. Surface a
    // retriable error instead.
    try {
      await state.raceStorageTimeout(
        state.storageChain as Promise<void>,
        "Vault storage",
      );
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
    // `verifyVaultPassword` returns false on a wrong password but can also
    // throw if the underlying age decryptor rejects — treat both as "wrong
    // password" so the UI message stays predictable.
    let verified: boolean;
    try {
      verified = await state.enqueueStorage(async () => {
        await Promise.resolve();
        return state.manager!.verifyVaultPassword(entryId, password);
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new Error("Password does not match the vault.");
    }
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
    const githubPat = selectedProvider.githubPat?.trim() ?? "";
    const githubRepo = selectedProvider.githubRepo?.trim() ?? "";
    const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
    const usesSharedProviderGrant =
      providerOnboardingType(selectedProvider, state.vaultArchitecture) ===
      "shared-provider-grant";
    const usesSharedICloud =
      usesSharedProviderGrant &&
      selectedProvider.oauthFile?.preset === "icloud";
    if (usesSharedProviderGrant && !usesSharedICloud && !sharedJoinerIdentity) {
      throw new Error(
        state.t("errors.validation.shared_joiner_identity_required"),
      );
    }
    if (
      selectedProvider.type === "github" &&
      !usesSharedProviderGrant &&
      (!githubPat || !githubRepo)
    ) {
      throw new Error(
        "GitHub sync provider is missing credentials. Reconnect in Settings and try again.",
      );
    }
    state.sharedGrantInstructions = "";
    let sharedStorageTargetId: string | undefined;
    let enrollmentProviderRow = selectedProvider;
    if (usesSharedProviderGrant) {
      if (usesSharedICloud) {
        sharedStorageTargetId =
          selectedProvider.oauthFile?.iCloudShareTarget?.trim();
        if (!sharedStorageTargetId) {
          throw new Error(
            state.t("provider_setup.icloud_shared_target_required"),
          );
        }
      } else {
        const accessToken = selectedProvider.oauthFile?.accessToken?.trim();
        const grant = await prepareSharedStorageGrant({
          providerType: selectedProvider.type,
          oauthPreset: selectedProvider.oauthFile?.preset,
          joinerIdentityKind: "email",
          joinerIdentity: sharedJoinerIdentity,
          storageTargetHint:
            selectedProvider.oauthFile?.fileName ??
            selectedProvider.githubRepo ??
            undefined,
          storageTargetId: selectedProvider.oauthFile?.folderId,
          accessToken,
        });
        if (grant.kind === "unsupported") {
          throw new Error(state.t(grant.reasonKey));
        }
        if (grant.kind === "granted") {
          sharedStorageTargetId = grant.storageTargetId;
          state.sharedGrantInstructions = state.t(grant.note, {
            email: sharedJoinerIdentity,
            folder: grant.storageTargetName ?? grant.storageTargetId,
          });
        } else if (grant.kind === "manual-grant-required") {
          sharedStorageTargetId = grant.storageTargetId;
          state.sharedGrantInstructions = state.t(grant.instructionsKey, {
            email: grant.joinerIdentity,
            folder:
              grant.storageTargetName ??
              grant.storageTargetId ??
              "shared folder",
          });
        }
        if (sharedStorageTargetId && selectedProvider.oauthFile) {
          const updatedOauth = bindGoogleDriveSharedFolder(
            selectedProvider.oauthFile,
            sharedStorageTargetId,
          );
          enrollmentProviderRow = {
            ...selectedProvider,
            oauthFile: updatedOauth,
          };
          state.oauthFile = updatedOauth;
          state.providers = state.providers.map((row) =>
            row.id === selectedProvider.id ? enrollmentProviderRow : row,
          );
          await state.persistProviders();

          if (shouldFlushSharedDriveGrant(grant, accessToken)) {
            // The target is not usable until it contains the current vault
            // event log, even when collaborator access needs manual completion.
            // Await Rust/WASM fan-out before issuing the enrollment code.
            const targetArgs = state.providerWasmArgs(enrollmentProviderRow);
            await state.enqueueStorage(() =>
              state.manager!.flushEventOutboxForProvider(...targetArgs),
            );
          }
        }
      }
      if (usesSharedICloud) {
        const targetArgs = state.providerWasmArgs(enrollmentProviderRow);
        await state.enqueueStorage(() =>
          state.manager!.flushEventOutboxForProvider(...targetArgs),
        );
      }
    }
    const provider = enrollmentProviderForArchitecture(
      enrollmentProviderRow,
      state.vaultArchitecture,
      usesSharedProviderGrant && !usesSharedICloud
        ? sharedJoinerIdentity
        : undefined,
      sharedStorageTargetId,
    );
    const payload = new NookEnrollmentIssueInput(
      provider,
      state.manager.vaultName ?? "",
      entryId,
      isoTimestamp(),
    );
    const selectedPassword = state.passwordEntries.find(
      (e) => e.id === entryId,
    );
    const code = encryptEnrollmentPayload(
      payload,
      password,
      selectedPassword?.label ?? "",
    );
    state.enrollmentCode = code;
    state.activeEnrollmentEntryId = entryId;
    return code;
  } finally {
    state.isPasswordBusy = false;
  }
}
