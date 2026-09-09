import {
  EnrollmentIssueFailure,
  EnrollmentIssueRejection,
  type EnrollmentCodeIssueResult,
} from '$lib/vault/enrollment-issue-failure'
import { SharedStorageGrantFailure } from '$lib/auth/oauth-failure'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'

import { VaultState } from '$lib/vault.svelte'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import { isoTimestamp } from '$lib/nook'
import { browserLogRuntime } from '$lib/runtime/log'
import {
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedStorageTarget,
} from '$lib/vault/password-enrollment'
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
} from '$app-wasm'
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  githubPatValue,
  githubRepositoryValue,
  isConfiguredOAuthFile,
  oauthAccessToken,
  OAuthFilePresentation,
  OAuthFileNameKind,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  prepare_shared_storage_grant,
  createSharedStorageTarget,
  existingSharedStorageTarget,
  provider_onboarding_type,
  provider_oauth_preset_for_provider,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
  unavailableSharedStorageGrantCredential,
} from '$lib/vault/architecture-model'

enum CatalogVaultLabelKind {
  Missing = 'missing',
  Present = 'present',
}

type CatalogVaultLabel =
  | { kind: CatalogVaultLabelKind.Missing }
  | { kind: CatalogVaultLabelKind.Present; label: string }

const log = browserLogRuntime.createLogger('vault-password')

export type EnrollmentCodeIssueRequest = {
  readonly entryId: string
  readonly password: string
  readonly providerId: string
}

/** Owns browser orchestration for one password enrollment issue context. */
export class PasswordEnrollmentIssue {
  constructor(private readonly state: VaultState) {}

  async issueEnrollmentCode({
    entryId,
    password,
    providerId,
  }: EnrollmentCodeIssueRequest): Promise<EnrollmentCodeIssueResult> {
    const state = this.state
    if (!state.hasManager) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    }
    // Password verification borrows the wasm manager synchronously (`&self`).
    // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
    // wait for any *already in-flight* `&mut self` storage future to release its
    // borrow before verify runs, or wasm-bindgen's borrow detector trips.
    state.isPasswordBusy = true
    log.info('enrollment code issue started')
    try {
      // Wait for the queued wasm op to settle. We deliberately do NOT
      // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
      // future leaves its IndexedDB transaction dangling, which surfaces later as
      // "database is not open" and poisons subsequent borrows. Surface a
      // retriable error instead.
      const idle = await state.raceStorageTimeout({
        promise: state.waitForStorageChain().then(() => storageOk(undefined)),
        releaseLateValue: () => {},
      })
      if (idle.isErr()) return storageErr(idle.error)
      await new Promise((resolve) => setTimeout(resolve, 0))

      // The target entry is already loaded in memory after `addVaultPassword`.
      // Only hit storage when it is genuinely missing — a redundant refresh can
      // otherwise queue behind (or race) background sync work and stall
      // enrollment on the shared storage chain.
      if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
        const refreshed = await state.refreshPasswordEntriesList()
        if (refreshed.isErr()) return storageErr(refreshed.error)
        if (state.passwordEntries.length === 0) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.BackupPasswordRequired,
            ),
          )
        }
        if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.PasswordEntryMissing,
            ),
          )
        }
      }
      // `verify_vault_password` returns false on a wrong password but can also
      // throw if the underlying age decryptor rejects — treat both as "wrong
      // password" so the UI message stays predictable.
      const verification = await state.enqueueStorage(async () => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        try {
          return storageOk(admitted.value.verify_vault_password(entryId, password))
        } catch {
          return storageOk(false)
        }
      })
      if (verification.isErr()) return storageErr(verification.error)
      const verified = verification.value
      if (!verified) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.PasswordRejected),
        )
      }
      log.info('enrollment password verified')
      const selectedProvider = state.providers.find((p) => p.id === providerId)
      if (!selectedProvider) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.ProviderRequired),
        )
      }
      if (selectedProvider.type === 'local') {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.LocalProvider),
        )
      }
      if (selectedProvider.type === 'local-folder') {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.LocalFolderProvider),
        )
      }
      const githubPat = githubPatValue(selectedProvider.githubPat)
      const githubRepo = githubRepositoryValue(selectedProvider.githubRepo)
      const selectedOauth = selectedProvider.oauthFile
      const sharedJoinerIdentity = state.sharedJoinerIdentity.trim()
      const usesSharedProviderGrant =
        provider_onboarding_type(selectedProvider, state.vaultArchitecture) ===
        OnboardingType.SharedProviderGrant
      const usesSharedICloud =
        usesSharedProviderGrant &&
        isConfiguredOAuthFile(selectedOauth) &&
        selectedOauth.config.preset === 'icloud'
      log.info('enrollment provider selected')
      if (usesSharedProviderGrant && !usesSharedICloud && !sharedJoinerIdentity) {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.SharedIdentityRequired,
          ),
        )
      }
      if (
        selectedProvider.type === 'github' &&
        !usesSharedProviderGrant &&
        (!githubPat || !githubRepo)
      ) {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.GithubCredentialsRequired,
          ),
        )
      }
      state.sharedGrantInstructions = ''
      let sharedStorageTarget: SharedStorageTarget = {
        kind: SharedStorageTargetKind.NotBound,
      }
      let enrollmentProviderRow: StorageProvider = selectedProvider
      if (usesSharedProviderGrant) {
        if (usesSharedICloud) {
          if (selectedOauth.config.iCloudShareTarget.state === 'personal') {
            return storageErr(
              new EnrollmentIssueFailure(
                EnrollmentIssueRejection.ICloudTargetRequired,
              ),
            )
          }
          const targetId = selectedOauth.config.iCloudShareTarget.value
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: targetId,
          }
        } else {
          if (!isConfiguredOAuthFile(selectedOauth)) {
            return storageErr(
              new EnrollmentIssueFailure(
                EnrollmentIssueRejection.OAuthProviderRequired,
              ),
            )
          }
          const accessCredential = oauthAccessToken(selectedOauth.config)
          log.info('shared enrollment grant started')
          const fileName = new OAuthFilePresentation(
            selectedOauth.config,
          ).oauthFileName()
          const storageTargetHint =
            fileName.kind === OAuthFileNameKind.Resolved
              ? fileName.fileName
              : githubRepo
          const folderId = selectedOauth.config.folderId
          const prepareSharedStorageGrantArgs: Parameters<
            typeof prepare_shared_storage_grant
          >[0] = {
            providerType: selectedProvider.type,
            oauthPreset: provider_oauth_preset_for_provider(selectedProvider),
            joinerIdentityKind: 'email',
            joinerIdentity: sharedJoinerIdentity,
            storageTargetHint: suggestedSharedStorageTarget(
              storageTargetHint || 'shared folder',
            ),
            storageTarget:
              folderId.state === 'folderId'
                ? existingSharedStorageTarget(folderId.value)
                : createSharedStorageTarget(),
            credential:
              accessCredential.kind === 'available'
                ? sharedStorageGrantAccessToken(accessCredential.token)
                : unavailableSharedStorageGrantCredential(),
          }
          let grant
          try {
            grant = await prepare_shared_storage_grant(prepareSharedStorageGrantArgs)
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure))
          }
          log.info('shared enrollment grant prepared')
          if (grant.kind === 'unsupported') {
            return storageErr(new SharedStorageGrantFailure(grant))
          }
          const grantTarget = grant.target
          if (grant.kind === 'granted') {
            if (grantTarget.state === 'unavailable') {
              return storageErr(
                new EnrollmentIssueFailure(
                  EnrollmentIssueRejection.SharedTargetUnavailable,
                ),
              )
            }
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grantTarget.storageTargetId,
            }
            const tArgs2: Parameters<typeof state.t>[0] = {
              key: grant.note,
              replacements: {
                email: sharedJoinerIdentity,
                folder:
                  grantTarget.state === 'named'
                    ? grantTarget.storageTargetName
                    : grantTarget.storageTargetId,
              },
            }
            state.sharedGrantInstructions = state.t(tArgs2)
          } else if (grant.kind === 'manual-grant-required') {
            if (grantTarget.state !== 'unavailable') {
              sharedStorageTarget = {
                kind: SharedStorageTargetKind.Bound,
                storageTargetId: grantTarget.storageTargetId,
              }
            }
            const tArgs: Parameters<typeof state.t>[0] = {
              key: grant.instructionsKey,
              replacements: {
                email: grant.joinerIdentity,
                folder:
                  grantTarget.state === 'named'
                    ? grantTarget.storageTargetName
                    : grantTarget.state === 'identified'
                      ? grantTarget.storageTargetId
                      : 'shared folder',
              },
            }
            state.sharedGrantInstructions = state.t(tArgs)
          }
          if (
            sharedStorageTarget.kind === SharedStorageTargetKind.Bound &&
            isConfiguredOAuthFile(selectedOauth)
          ) {
            let updatedOauth
            try {
              updatedOauth = bind_google_drive_shared_folder(
                selectedOauth.config,
                sharedStorageTarget.storageTargetId,
              )
            } catch (failure) {
              return storageErr(new NativeVaultStorageFailure(failure))
            }
            enrollmentProviderRow = {
              ...selectedProvider,
              oauthFile: configuredOAuthFile(updatedOauth),
            }
            const providers = state.providers.map((row) =>
              row.id === selectedProvider.id ? enrollmentProviderRow : row,
            )
            const persistenceOptions: Parameters<typeof state.persistProviders>[0] =
              { replace: false, providers }
            const persistence = await state.persistProviders(persistenceOptions)
            if (persistence.isErr()) return storageErr(persistence.error)
            state.configureOauthFile(updatedOauth)

            if (
              (() => {
                const shouldFlushSharedDriveGrantArgs: Parameters<
                  typeof shouldFlushSharedDriveGrant
                >[0] = { grant, accessCredential }
                return shouldFlushSharedDriveGrant(shouldFlushSharedDriveGrantArgs)
              })()
            ) {
              // The target is not usable until it contains the current vault
              // event log, even when collaborator access needs manual completion.
              // Await Rust/WASM fan-out before issuing the enrollment code.
              const targetArgs: ReturnType<typeof state.providerWasmArgs> =
                state.providerWasmArgs(enrollmentProviderRow)
              const flushed = await state.enqueueStorage(async () => {
                const admittedManager = state.admitManager()
                if (admittedManager.isErr()) return storageErr(admittedManager.error)
                try {
                  return storageOk(
                    await admittedManager.value.flush_event_outbox_for_provider(
                      targetArgs.mode,
                      targetArgs.pat,
                      targetArgs.repo,
                    ),
                  )
                } catch (nativeFailure) {
                  return storageErr(new NativeVaultStorageFailure(nativeFailure))
                }
              })
              if (flushed.isErr()) return storageErr(flushed.error)
            }
          }
        }
        if (usesSharedICloud) {
          const targetArgs: ReturnType<typeof state.providerWasmArgs> =
            state.providerWasmArgs(enrollmentProviderRow)
          const flushed = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager()
            if (admittedManager.isErr()) return storageErr(admittedManager.error)
            try {
              return storageOk(
                await admittedManager.value.flush_event_outbox_for_provider(
                  targetArgs.mode,
                  targetArgs.pat,
                  targetArgs.repo,
                ),
              )
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure))
            }
          })
          if (flushed.isErr()) return storageErr(flushed.error)
        }
      }
      let provider: NookEnrollmentProvider
      try {
        provider =
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
              )
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      log.info('enrollment provider payload prepared')
      let catalogVaultName: CatalogVaultLabel = {
        kind: CatalogVaultLabelKind.Missing,
      }
      if (state.activeVault.kind === ActiveVaultKind.Open) {
        for (const entry of state.localVaults) {
          const label = entry.label.trim()
          if (entry.storeId === state.activeVault.storeId && label) {
            catalogVaultName = {
              kind: CatalogVaultLabelKind.Present,
              label,
            }
            break
          }
        }
      }
      // The local catalog is the durable browser-level label index. Keep it as
      // the enrollment fallback while older/synced projections without
      // `vault_name` are still supported.
      const admitted = state.admitManager()
      if (admitted.isErr()) return storageErr(admitted.error)
      const manager = admitted.value
      let vaultName: CatalogVaultLabel
      try {
        vaultName =
          manager.vaultNameState === NookVaultNameState.Named
            ? { kind: CatalogVaultLabelKind.Present, label: manager.vaultName }
            : catalogVaultName
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      let payload: NookEnrollmentIssueInput
      try {
        payload =
          vaultName.kind === CatalogVaultLabelKind.Present
            ? NookEnrollmentIssueInput.named(
                provider,
                vaultName.label,
                entryId,
                isoTimestamp(),
              )
            : NookEnrollmentIssueInput.unnamed(provider, entryId, isoTimestamp())
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      const selectedPassword = state.passwordEntries.find(
        (entry) => entry.id === entryId,
      )
      let code: string
      try {
        code =
          selectedPassword && selectedPassword.label.trim()
            ? encrypt_labeled_enrollment_payload(
                payload,
                password,
                selectedPassword.label,
              )
            : encrypt_unlabeled_enrollment_payload(payload, password)
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      } finally {
        payload.free()
      }
      state.enrollmentCode = code
      state.beginEnrollmentEntry(entryId)
      log.info('enrollment code issued')
      return storageOk(code)
    } finally {
      state.isPasswordBusy = false
    }
  }
}
