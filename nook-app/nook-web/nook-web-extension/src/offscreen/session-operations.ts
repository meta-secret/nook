import { err, ok, type Result } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import type {
  ActiveExtensionSessionLease,
  ExtensionSessionGeneration,
  ExtensionSessionLeaseFailure,
} from './session-lease'
import {
  DeviceMode,
  DeviceProtectionStatus,
  NookExternalEventLogRecords,
  NookWebsiteLoginSaveDecision,
  NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { handleAuthenticatorEnrollmentMessage } from './authenticator-enrollment-session'
import { ExtensionSessionMessageType } from './session-message-dispatch'
import { type ExtensionSessionRequest } from './session-request-adapter'
import {
  LOGIN_SAVE_OFFER_TTL_MS,
  PendingLoginSaveLookupState,
  pendingLoginSaveOfferStore,
  type PendingLoginSaveOffer,
} from './login-save-offers'
import {
  flushPasskeyEventToProviders,
  type ActivatedExtensionIdentityOperation,
  importExtensionVault,
  type ImportExtensionVaultArgs,
  openPasskeyVault,
  ActivatedExtensionIdentityLifecycle,
} from './session-vault-operations'
import { PasskeyBrowserBytes } from './session-key-material'
import { extensionVaultGrant } from './session-vault-grant'
import {
  type WebsitePasskeyOperationArgs,
  type WebsitePasskeyOperationResponse,
  sessionWebsitePasskeys,
} from './session-website-passkey-operations'

export type DeviceResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type PasskeySetup = {
  userHandle: number[]
  prfInput: number[]
}

type PasskeyUnlockMaterial = {
  credentialId: number[]
  prfInput: number[]
}

type SessionAcknowledgement = { readonly ok: true }
type AuthProviderMigrationResponse = {
  readonly ok: true
  readonly migrated: boolean
}
type SessionStatusResponse =
  | {
      readonly ok: true
      readonly status: DeviceProtectionStatus.Unlocked
      readonly device: DeviceResult
    }
  | {
      readonly ok: true
      readonly status: Exclude<
        DeviceProtectionStatus,
        DeviceProtectionStatus.Unlocked
      >
    }
type PasskeySetupResponse = {
  readonly ok: true
  readonly setup: PasskeySetup
}
type DeviceActivationResponse = {
  readonly ok: true
  readonly device: DeviceResult
}
type PasskeyUnlockOptionsResponse = {
  readonly ok: true
  readonly material: PasskeyUnlockMaterial
}
type IdentityHandoffSealRequest = Parameters<
  NookVaultManager['seal_extension_identity_handoff']
>[0]
type IdentityHandoffSealResponse = {
  readonly ok: true
  readonly envelope: Awaited<
    ReturnType<NookVaultManager['seal_extension_identity_handoff']>
  >
}
type WebsitePasskeyAccountListResponse = {
  readonly ok: true
  readonly accounts: ReadonlyArray<{
    readonly credentialId: string
    readonly userName: string
    readonly userDisplayName: string
  }>
}
type WebsiteLoginAccountListResponse = {
  readonly ok: true
  readonly accounts: ReadonlyArray<{
    readonly secretId: string
    readonly username: string
    readonly websiteUrl: string
    readonly websiteHost: string
  }>
}
type WebsiteLoginRevealResponse = {
  readonly ok: true
  readonly username: string
  readonly password: string
}
type AuthenticatorAccountListResponse = {
  readonly ok: true
  readonly accounts: ReadonlyArray<{
    readonly secretId: string
    readonly issuer: string
    readonly account: string
  }>
}
type AuthenticatorCodeResponse = {
  readonly ok: true
  readonly code: string
  readonly expiresAt: number
}
type LoginSavePlanResponse =
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.AlreadySaved
      readonly secretId: string
    }
  | {
      readonly ok: true
      readonly decision: Exclude<
        NookWebsiteLoginSaveDecision,
        NookWebsiteLoginSaveDecision.AlreadySaved
      >
    }
type LoginSaveOfferResponse =
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.Create
      readonly offerId: string
      readonly vaultStoreId: string
    }
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.Update
      readonly offerId: string
      readonly secretId: string
      readonly vaultStoreId: string
    }
type PendingLoginSaveResponse =
  | {
      readonly ok: true
      readonly state: PendingLoginSaveLookupState.Unavailable
    }
  | {
      readonly ok: true
      readonly state: PendingLoginSaveLookupState.Available
      readonly offer: {
        readonly offerId: string
        readonly decision:
          | NookWebsiteLoginSaveDecision.Create
          | NookWebsiteLoginSaveDecision.Update
        readonly vaultStoreId: string
      }
    }
type LoginSaveCommitResponse = {
  readonly ok: true
  readonly decision:
    NookWebsiteLoginSaveDecision.Create | NookWebsiteLoginSaveDecision.Update
}

export type SessionOperationContext = {
  ensureWasm: () => ReturnType<typeof initNookWasm>
  getManager: () => Promise<NookVaultManager>
  activateSession: () => Promise<DeviceResult>
  deviceResult: (activeManager: NookVaultManager) => Promise<DeviceResult>
  currentGeneration: () => ExtensionSessionGeneration
  renewSessionExpiry: (
    generation: ExtensionSessionGeneration,
  ) => Result<ActiveExtensionSessionLease, ExtensionSessionLeaseFailure>
  resetOperations: (error: SessionOperationFailure) => void
}

export type HandleSessionMessageArgs = {
  message: ExtensionSessionRequest
  context: SessionOperationContext
}

type ClassifySessionGrantAuthorityArgs = {
  manager: Pick<NookVaultManager, 'classify_extension_grant_authority'>
  payload: Extract<
    ExtensionSessionRequest,
    {
      type: typeof ExtensionSessionMessageType.ClassifyGrantAuthority
    }
  >['payload']
}

export function classifySessionGrantAuthority({
  manager,
  payload,
}: ClassifySessionGrantAuthorityArgs) {
  return manager.classify_extension_grant_authority(
    payload.stored_json,
    payload.vault_store_id,
  )
}

export async function handleSessionMessage({
  message,
  context,
}: HandleSessionMessageArgs) {
  try {
    const {
      ensureWasm,
      getManager,
      activateSession,
      deviceResult,
      renewSessionExpiry,
    } = context
    const sessionGeneration = context.currentGeneration()
    switch (message.type) {
      case ExtensionSessionMessageType.ClassifyGrantAuthority: {
        const args: ClassifySessionGrantAuthorityArgs = {
          manager: await getManager(),
          payload: message.payload,
        }
        return ok(classifySessionGrantAuthority(args))
      }
      case ExtensionSessionMessageType.Reset: {
        pendingLoginSaveOfferStore.clearAll()
        sessionWebsitePasskeys.clearWebsitePasskeyRequests()
        context.resetOperations(
          new SessionOperationFailure(SessionOperationFailureKind.Closed),
        )
        const activeManager = await getManager()
        activeManager.reset_vault_session()
        const response: SessionAcknowledgement = { ok: true }
        return ok(response)
      }
      case ExtensionSessionMessageType.MigrateAuthProviders: {
        const activeManager = await getManager()
        if (
          (await activeManager.device_protection_status()) !==
          DeviceProtectionStatus.Unlocked
        ) {
          const response: AuthProviderMigrationResponse = {
            ok: true,
            migrated: false,
          }
          return ok(response)
        }
        await activeManager.load_auth_providers_snapshot()
        const response: AuthProviderMigrationResponse = {
          ok: true,
          migrated: true,
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.Status: {
        const activeManager = await getManager()
        const status = await activeManager.device_protection_status()
        const response: SessionStatusResponse =
          status === DeviceProtectionStatus.Unlocked
            ? {
                ok: true,
                status,
                device: await deviceResult(activeManager),
              }
            : { ok: true, status }
        return ok(response)
      }
      case ExtensionSessionMessageType.BeginPasskeySetup: {
        const activeManager = await getManager()
        const setup = await activeManager.begin_device_protection()
        const userHandle = setup.userHandle
        const prfInput = setup.prfInput
        setup.free()
        const response: PasskeySetupResponse = {
          ok: true,
          setup: {
            userHandle: PasskeyBrowserBytes.toWire(userHandle),
            prfInput: PasskeyBrowserBytes.toWire(prfInput),
          } satisfies PasskeySetup,
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.FinishPasskeySetup: {
        const payload = message.payload
        const activeManager = await getManager()
        const credentialId = PasskeyBrowserBytes.fromWire(payload.credentialId)
        const userHandle = PasskeyBrowserBytes.fromWire(payload.userHandle)
        const prfInput = PasskeyBrowserBytes.fromWire(payload.prfInput)
        const prfOutput = PasskeyBrowserBytes.fromWire(payload.prfOutput)
        const deviceMode = payload.deviceMode as DeviceMode
        if (
          deviceMode !== DeviceMode.Standard &&
          deviceMode !== DeviceMode.AntiHacker
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        try {
          await activeManager.finish_device_protection_with_mode(
            credentialId,
            userHandle,
            prfInput,
            prfOutput,
            deviceMode,
          )
        } finally {
          credentialId.fill(0)
          userHandle.fill(0)
          prfInput.fill(0)
          prfOutput.fill(0)
        }
        const response: DeviceActivationResponse = {
          ok: true,
          device: await activateSession(),
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.RecoverPasskey: {
        const payload = message.payload
        const activeManager = await getManager()
        const credentialId = PasskeyBrowserBytes.fromWire(payload.credentialId)
        const userHandle = PasskeyBrowserBytes.fromWire(payload.userHandle)
        const prfOutput = PasskeyBrowserBytes.fromWire(payload.prfOutput)
        try {
          await activeManager.recover_device_protection_with_passkey_material(
            credentialId,
            userHandle,
            prfOutput,
          )
        } finally {
          credentialId.fill(0)
          userHandle.fill(0)
          prfOutput.fill(0)
        }
        const response: DeviceActivationResponse = {
          ok: true,
          device: await activateSession(),
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.UnlockOptions: {
        const options = await (await getManager()).passkey_unlock_options()
        try {
          const response: PasskeyUnlockOptionsResponse = {
            ok: true,
            material: {
              credentialId: PasskeyBrowserBytes.toWire(options.credentialId),
              prfInput: PasskeyBrowserBytes.toWire(options.prfInput),
            } satisfies PasskeyUnlockMaterial,
          }
          return ok(response)
        } finally {
          options.free()
        }
      }
      case ExtensionSessionMessageType.UnlockPasskey: {
        const prfOutput = PasskeyBrowserBytes.fromWire(
          message.payload.prfOutput,
        )
        try {
          await (await getManager()).unlock_device_identity(prfOutput)
        } finally {
          prfOutput.fill(0)
        }
        const response: DeviceActivationResponse = {
          ok: true,
          device: await activateSession(),
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.CreatePin: {
        const pin = message.payload.pin
        if (typeof pin !== 'string')
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        await (await getManager()).finish_pin_device_protection(pin)
        const response: DeviceActivationResponse = {
          ok: true,
          device: await activateSession(),
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.UnlockPin: {
        const pin = message.payload.pin
        if (typeof pin !== 'string')
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        await (await getManager()).unlock_pin_device_identity(pin)
        const response: DeviceActivationResponse = {
          ok: true,
          device: await activateSession(),
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.SealIdentityHandoff: {
        const generation = sessionGeneration
        const payload = message.payload
        const recipientPublicKey = payload.recipientPublicKey
        const nonce = payload.nonce
        if (
          typeof recipientPublicKey !== 'string' ||
          typeof nonce !== 'string'
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const status = await activeManager.device_protection_status()
        if (status !== DeviceProtectionStatus.Unlocked) {
          return err(
            new SessionOperationFailure(SessionOperationFailureKind.Locked),
          )
        }
        const sealRequest: IdentityHandoffSealRequest = {
          recipientPublicKey,
          nonce,
          expectedDeviceId: payload.expectedDeviceId,
          expectedDevicePublicKey: payload.expectedDevicePublicKey,
          expectedDeviceSigningPublicKey:
            payload.expectedDeviceSigningPublicKey,
        }
        const envelope =
          await activeManager.seal_extension_identity_handoff(sealRequest)
        const renewal = renewSessionExpiry(generation)
        if (renewal.isErr())
          return err(
            new SessionOperationFailure(SessionOperationFailureKind.Locked),
          )
        const response: IdentityHandoffSealResponse = { ok: true, envelope }
        return ok(response)
      }
      case ExtensionSessionMessageType.ImportVault: {
        const activeManager = await getManager()
        const importArgs: ImportExtensionVaultArgs = {
          activeManager,
          message,
        }
        return importExtensionVault(importArgs)
      }
      case ExtensionSessionMessageType.UpdateVault: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (!Array.isArray(payload.eventLogRecords)) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const recordValues = NookExternalEventLogRecords.from_array(
          payload.eventLogRecords,
        )
        const activeManager = await getManager()
        const operation = async () => {
          try {
            const statusValue =
              await activeManager.import_extension_event_log_records_js(
                grant.vaultStoreId,
                grant.deviceId,
                grant.devicePublicKey,
                grant.deviceSigningPublicKey,
                recordValues,
              )
            const status = statusValue.to_object()
            statusValue.free()
            type VaultUpdateResponse = {
              readonly ok: true
              readonly status: typeof status
            }
            const response: VaultUpdateResponse = { ok: true, status }
            return ok(response)
          } catch {
            return err(
              new SessionOperationFailure(SessionOperationFailureKind.Failed),
            )
          }
        }
        const activationArgs: ActivatedExtensionIdentityOperation<
          Awaited<ReturnType<typeof operation>>
        > = {
          activeManager,
          deviceId: grant.deviceId,
          operation,
        }
        return new ActivatedExtensionIdentityLifecycle(activationArgs).run()
      }
      case ExtensionSessionMessageType.ListPasskeys: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (
          typeof payload.rpId !== 'string' ||
          typeof payload.origin !== 'string'
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_0: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission0 = await openPasskeyVault(nookTypedArgs0_0)
        if (admission0.isErr()) return err(admission0.error)
        const accounts = await activeManager.list_website_passkey_accounts(
          payload.rpId,
          payload.origin,
        )
        try {
          const response: WebsitePasskeyAccountListResponse = {
            ok: true,
            accounts: accounts.map((account) => ({
              credentialId: account.credentialId,
              userName: account.userName,
              userDisplayName: account.userDisplayName,
            })),
          }
          return ok(response)
        } finally {
          accounts.forEach((account) => account.free())
        }
      }
      case ExtensionSessionMessageType.ListLogins: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (typeof payload.origin !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_1: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission1 = await openPasskeyVault(nookTypedArgs0_1)
        if (admission1.isErr()) return err(admission1.error)
        const accounts = await activeManager.list_website_login_accounts(
          payload.origin,
        )
        try {
          const response: WebsiteLoginAccountListResponse = {
            ok: true,
            accounts: accounts.map((account) => ({
              secretId: account.secretId,
              username: account.username,
              websiteUrl: account.websiteUrl,
              websiteHost: account.websiteHost,
            })),
          }
          return ok(response)
        } finally {
          accounts.forEach((account) => account.free())
        }
      }
      case ExtensionSessionMessageType.RevealLogin: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (
          typeof payload.origin !== 'string' ||
          typeof payload.secretId !== 'string'
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_2: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission2 = await openPasskeyVault(nookTypedArgs0_2)
        if (admission2.isErr()) return err(admission2.error)
        const credential = await activeManager.reveal_website_login_for_fill(
          payload.secretId,
          payload.origin,
        )
        try {
          const response: WebsiteLoginRevealResponse = {
            ok: true,
            username: credential.username,
            password: credential.password,
          }
          return ok(response)
        } finally {
          credential.free()
        }
      }
      case ExtensionSessionMessageType.ListAuthenticators: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (typeof payload.query !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_3: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission3 = await openPasskeyVault(nookTypedArgs0_3)
        if (admission3.isErr()) return err(admission3.error)
        const accounts = await activeManager.list_authenticator_accounts_js(
          payload.query,
        )
        try {
          const response: AuthenticatorAccountListResponse = {
            ok: true,
            accounts: accounts.map((account) => ({
              secretId: account.secretId,
              issuer: account.issuer,
              account: account.account,
            })),
          }
          return ok(response)
        } finally {
          accounts.forEach((account) => account.free())
        }
      }
      case ExtensionSessionMessageType.AuthenticatorCode: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (typeof payload.secretId !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_4: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission4 = await openPasskeyVault(nookTypedArgs0_4)
        if (admission4.isErr()) return err(admission4.error)
        const code = await activeManager.current_authenticator_code_for_fill(
          payload.secretId,
          Math.floor(Date.now() / 1000),
        )
        try {
          const response: AuthenticatorCodeResponse = {
            ok: true,
            code: code.code,
            expiresAt: code.expiresAtUnixSeconds * 1_000,
          }
          return ok(response)
        } finally {
          code.free()
        }
      }
      case ExtensionSessionMessageType.AuthenticatorEnrollPreview:
      case ExtensionSessionMessageType.AuthenticatorEnrollCode:
      case ExtensionSessionMessageType.AuthenticatorEnrollConfirm:
      case ExtensionSessionMessageType.AuthenticatorBackupAttach: {
        const authenticatorArgs: Parameters<
          typeof handleAuthenticatorEnrollmentMessage
        >[0] = {
          message,
          dependencies: {
            ensureWasm,
            getManager,
            extensionVaultGrant,
          },
        }
        return handleAuthenticatorEnrollmentMessage(authenticatorArgs)
      }
      case ExtensionSessionMessageType.PlanLoginSave: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (
          typeof payload.origin !== 'string' ||
          typeof payload.username !== 'string' ||
          typeof payload.password !== 'string'
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await getManager()
        const nookTypedArgs0_9: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission5 = await openPasskeyVault(nookTypedArgs0_9)
        if (admission5.isErr()) return err(admission5.error)
        const plan = await activeManager.plan_website_login_save(
          payload.origin,
          payload.username,
          payload.password,
        )
        try {
          const decision = plan.decision
          if (
            decision !== NookWebsiteLoginSaveDecision.Create &&
            decision !== NookWebsiteLoginSaveDecision.Update
          ) {
            payload.password = ''
            const response: LoginSavePlanResponse =
              decision === NookWebsiteLoginSaveDecision.AlreadySaved
                ? { ok: true, decision, secretId: plan.secretId }
                : { ok: true, decision }
            return ok(response)
          }
          pendingLoginSaveOfferStore.clearForOrigin(payload.origin)
          const offerId = crypto.randomUUID()
          const commonOffer = {
            offerId,
            origin: payload.origin,
            username: payload.username,
            password: payload.password,
            vaultStoreId: grant.vaultStoreId,
            expiresAt: Date.now() + LOGIN_SAVE_OFFER_TTL_MS,
            expiryTimer: setTimeout(() => {
              pendingLoginSaveOfferStore.clearById(offerId)
            }, LOGIN_SAVE_OFFER_TTL_MS),
          }
          let offer: PendingLoginSaveOffer
          if (decision === NookWebsiteLoginSaveDecision.Update) {
            const replaceSecretId = plan.secretId
            offer = {
              ...commonOffer,
              decision: NookWebsiteLoginSaveDecision.Update,
              replaceSecretId,
            }
          } else {
            offer = {
              ...commonOffer,
              decision: NookWebsiteLoginSaveDecision.Create,
            }
          }
          pendingLoginSaveOfferStore.store(offer)
          payload.password = ''
          const response: LoginSaveOfferResponse =
            offer.decision === NookWebsiteLoginSaveDecision.Update
              ? {
                  ok: true,
                  decision: offer.decision,
                  offerId,
                  secretId: offer.replaceSecretId,
                  vaultStoreId: grant.vaultStoreId,
                }
              : {
                  ok: true,
                  decision: offer.decision,
                  offerId,
                  vaultStoreId: grant.vaultStoreId,
                }
          return ok(response)
        } finally {
          plan.free()
        }
      }
      case ExtensionSessionMessageType.PendingLoginSave: {
        const payload = message.payload
        if (typeof payload.origin !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const lookup = pendingLoginSaveOfferStore.findByOrigin(payload.origin)
        if (lookup.state === PendingLoginSaveLookupState.Unavailable) {
          const response: PendingLoginSaveResponse = {
            ok: true,
            state: PendingLoginSaveLookupState.Unavailable,
          }
          return ok(response)
        }
        const { offer } = lookup
        const response: PendingLoginSaveResponse = {
          ok: true,
          state: PendingLoginSaveLookupState.Available,
          offer: {
            offerId: offer.offerId,
            decision: offer.decision,
            vaultStoreId: offer.vaultStoreId,
          },
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.CommitLoginSave: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (typeof payload.offerId !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const lookup = pendingLoginSaveOfferStore.findById(payload.offerId)
        if (
          lookup.state === PendingLoginSaveLookupState.Unavailable ||
          lookup.offer.origin !== (payload.origin as string)
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const { offer } = lookup
        if (offer.vaultStoreId !== grant.vaultStoreId) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        pendingLoginSaveOfferStore.removeForCommit(offer)
        const committedOffer: Parameters<
          typeof pendingLoginSaveOfferStore.clearOffer
        >[0] = { ...offer }
        offer.username = ''
        offer.password = ''
        const activeManager = await getManager()
        const nookTypedArgs0_10: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission6 = await openPasskeyVault(nookTypedArgs0_10)
        if (admission6.isErr()) return err(admission6.error)
        try {
          await activeManager.commit_website_login_save(
            committedOffer.origin,
            committedOffer.username,
            committedOffer.password,
            committedOffer.decision === NookWebsiteLoginSaveDecision.Update
              ? committedOffer.replaceSecretId
              : '',
          )
          const nookTypedArgs0_11: Parameters<
            typeof flushPasskeyEventToProviders
          >[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          const admission7 =
            await flushPasskeyEventToProviders(nookTypedArgs0_11)
          if (admission7.isErr()) return err(admission7.error)
          const response: LoginSaveCommitResponse = {
            ok: true,
            decision: committedOffer.decision,
          }
          return ok(response)
        } finally {
          pendingLoginSaveOfferStore.clearOffer(committedOffer)
        }
      }
      case ExtensionSessionMessageType.DismissLoginSave: {
        const payload = message.payload
        if (typeof payload.offerId !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        pendingLoginSaveOfferStore.clearById(payload.offerId)
        const response: SessionAcknowledgement = { ok: true }
        return ok(response)
      }
      case ExtensionSessionMessageType.CancelPasskey:
      case ExtensionSessionMessageType.RegisterPasskey:
      case ExtensionSessionMessageType.AssertPasskey: {
        const operationArgs: WebsitePasskeyOperationArgs = {
          message,
          getManager,
          openVault: openPasskeyVault,
          flushEvent: flushPasskeyEventToProviders,
        }
        const response: WebsitePasskeyOperationResponse =
          await sessionWebsitePasskeys.handleWebsitePasskeyOperation(
            operationArgs,
          )
        return response
      }
      case ExtensionSessionMessageType.Lock: {
        const response: SessionAcknowledgement = { ok: true }
        return ok(response)
      }
      default:
        return err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        )
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}
