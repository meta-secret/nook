import { err, ok, type Result } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import type { ExtensionSessionLeaseFailure } from './session-lease'
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
  withActivatedExtensionIdentity,
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

export type SessionOperationContext = {
  ensureWasm: () => ReturnType<typeof initNookWasm>
  getManager: () => Promise<NookVaultManager>
  activateSession: () => Promise<DeviceResult>
  deviceResult: (activeManager: NookVaultManager) => Promise<DeviceResult>
  currentGeneration: () => number
  renewSessionExpiry: (
    generation: number,
  ) => Result<void, ExtensionSessionLeaseFailure>
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
      type: ExtensionSessionMessageType.ClassifyGrantAuthority
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
        return ok({ ok: true })
      }
      case ExtensionSessionMessageType.MigrateAuthProviders: {
        const activeManager = await getManager()
        if (
          (await activeManager.device_protection_status()) !==
          DeviceProtectionStatus.Unlocked
        ) {
          return ok({ ok: true, migrated: false })
        }
        await activeManager.load_auth_providers_snapshot()
        return ok({ ok: true, migrated: true })
      }
      case ExtensionSessionMessageType.Status: {
        const activeManager = await getManager()
        const status = await activeManager.device_protection_status()
        return ok({
          ok: true,
          status,
          ...(status === DeviceProtectionStatus.Unlocked
            ? { device: await deviceResult(activeManager) }
            : {}),
        })
      }
      case ExtensionSessionMessageType.BeginPasskeySetup: {
        const activeManager = await getManager()
        const setup = await activeManager.begin_device_protection()
        const userHandle = setup.userHandle
        const prfInput = setup.prfInput
        setup.free()
        return ok({
          ok: true,
          setup: {
            userHandle: PasskeyBrowserBytes.toWire(userHandle),
            prfInput: PasskeyBrowserBytes.toWire(prfInput),
          } satisfies PasskeySetup,
        })
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
        return ok({ ok: true, device: await activateSession() })
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
        return ok({ ok: true, device: await activateSession() })
      }
      case ExtensionSessionMessageType.UnlockOptions: {
        const options = await (await getManager()).passkey_unlock_options()
        try {
          return ok({
            ok: true,
            material: {
              credentialId: PasskeyBrowserBytes.toWire(options.credentialId),
              prfInput: PasskeyBrowserBytes.toWire(options.prfInput),
            } satisfies PasskeyUnlockMaterial,
          })
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
        return ok({ ok: true, device: await activateSession() })
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
        return ok({ ok: true, device: await activateSession() })
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
        return ok({ ok: true, device: await activateSession() })
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
        const envelope = await activeManager.seal_extension_identity_handoff({
          recipientPublicKey,
          nonce,
          expectedDeviceId: payload.expectedDeviceId,
          expectedDevicePublicKey: payload.expectedDevicePublicKey,
          expectedDeviceSigningPublicKey:
            payload.expectedDeviceSigningPublicKey,
        })
        const renewal = renewSessionExpiry(generation)
        if (renewal.isErr())
          return err(
            new SessionOperationFailure(SessionOperationFailureKind.Locked),
          )
        return ok({ ok: true, envelope })
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
            return ok({ ok: true, status })
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
        return withActivatedExtensionIdentity(activationArgs)
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
          return ok({
            ok: true,
            accounts: accounts.map((account) => ({
              credentialId: account.credentialId,
              userName: account.userName,
              userDisplayName: account.userDisplayName,
            })),
          })
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
          return ok({
            ok: true,
            accounts: accounts.map((account) => ({
              secretId: account.secretId,
              username: account.username,
              websiteUrl: account.websiteUrl,
              websiteHost: account.websiteHost,
            })),
          })
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
          return ok({
            ok: true,
            username: credential.username,
            password: credential.password,
          })
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
          return ok({
            ok: true,
            accounts: accounts.map((account) => ({
              secretId: account.secretId,
              issuer: account.issuer,
              account: account.account,
            })),
          })
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
          return ok({
            ok: true,
            code: code.code,
            expiresAt: code.expiresAtUnixSeconds * 1_000,
          })
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
            return ok(
              decision === NookWebsiteLoginSaveDecision.AlreadySaved
                ? { ok: true, decision, secretId: plan.secretId }
                : { ok: true, decision },
            )
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
          return ok({
            ok: true,
            decision,
            offerId,
            ...(offer.decision === NookWebsiteLoginSaveDecision.Update
              ? { secretId: offer.replaceSecretId }
              : {}),
            vaultStoreId: grant.vaultStoreId,
          })
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
          return ok({
            ok: true,
            state: PendingLoginSaveLookupState.Unavailable,
          })
        }
        const { offer } = lookup
        return ok({
          ok: true,
          state: PendingLoginSaveLookupState.Available,
          offer: {
            offerId: offer.offerId,
            decision: offer.decision,
            vaultStoreId: offer.vaultStoreId,
          },
        })
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
          return ok({ ok: true, decision: committedOffer.decision })
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
        return ok({ ok: true })
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
      case ExtensionSessionMessageType.Lock:
        return ok({ ok: true })
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
