import {
  currentCodeFromOtpauthUri,
  DeviceMode,
  DeviceProtectionStatus,
  NookExternalEventLogRecords,
  NookWebsiteLoginSaveDecision,
  NookVaultManager,
  previewOtpauthUri,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { AuthProvidersSnapshot } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { scrubProviderCredentials } from '../lib/provider-credential-staging'
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
  openPasskeyVault,
} from './session-vault-operations'
import { toBytes, toNumbers } from './session-key-material'
import { extensionVaultGrant } from './session-vault-grant'
import {
  clearWebsitePasskeyRequests,
  handleWebsitePasskeyOperation,
  type WebsitePasskeyOperationArgs,
} from './session-website-passkey-operations'

const SESSION_LOCKED_ERROR = 'EXTENSION_SESSION_LOCKED'

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
  ensureWasm: () => Promise<unknown>
  getManager: () => Promise<NookVaultManager>
  activateSession: () => Promise<DeviceResult>
  deviceResult: (activeManager: NookVaultManager) => Promise<DeviceResult>
  currentGeneration: () => number
  renewSessionExpiry: (generation: number) => void
  resetOperations: (error: Error) => void
}

export type HandleSessionMessageArgs = {
  message: ExtensionSessionRequest
  context: SessionOperationContext
}

export async function handleSessionMessage({
  message,
  context,
}: HandleSessionMessageArgs): Promise<object> {
  const {
    ensureWasm,
    getManager,
    activateSession,
    deviceResult,
    renewSessionExpiry,
  } = context
  const sessionGeneration = context.currentGeneration()
  switch (message.type) {
    case ExtensionSessionMessageType.Reset: {
      pendingLoginSaveOfferStore.clearAll()
      clearWebsitePasskeyRequests()
      context.resetOperations(new Error('Extension session reset.'))
      const activeManager = await getManager()
      activeManager.resetVaultSession()
      return { ok: true }
    }
    case ExtensionSessionMessageType.MigrateAuthProviders: {
      const activeManager = await getManager()
      if (
        (await activeManager.deviceProtectionStatus()) !==
        DeviceProtectionStatus.Unlocked
      ) {
        return { ok: true, migrated: false }
      }
      await activeManager.loadAuthProviders()
      return { ok: true, migrated: true }
    }
    case ExtensionSessionMessageType.Status: {
      const activeManager = await getManager()
      const status = await activeManager.deviceProtectionStatus()
      return {
        ok: true,
        status,
        ...(status === DeviceProtectionStatus.Unlocked
          ? { device: await deviceResult(activeManager) }
          : {}),
      }
    }
    case ExtensionSessionMessageType.BeginPasskeySetup: {
      const activeManager = await getManager()
      const setup = await activeManager.beginDeviceProtection()
      const userHandle = setup.userHandle
      const prfInput = setup.prfInput
      setup.free()
      return {
        ok: true,
        setup: {
          userHandle: toNumbers(userHandle),
          prfInput: toNumbers(prfInput),
        } satisfies PasskeySetup,
      }
    }
    case ExtensionSessionMessageType.FinishPasskeySetup: {
      const payload = message.payload
      const activeManager = await getManager()
      const credentialId = toBytes(payload.credentialId)
      const userHandle = toBytes(payload.userHandle)
      const prfInput = toBytes(payload.prfInput)
      const prfOutput = toBytes(payload.prfOutput)
      const deviceMode = payload.deviceMode as DeviceMode
      if (
        deviceMode !== DeviceMode.Standard &&
        deviceMode !== DeviceMode.AntiHacker
      ) {
        throw new Error('Unsupported extension device protection mode.')
      }
      try {
        await activeManager.finishDeviceProtectionWithMode(
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
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.RecoverPasskey: {
      const payload = message.payload
      const activeManager = await getManager()
      const credentialId = toBytes(payload.credentialId)
      const userHandle = toBytes(payload.userHandle)
      const prfOutput = toBytes(payload.prfOutput)
      try {
        await activeManager.recoverDeviceProtectionWithPasskeyMaterial(
          credentialId,
          userHandle,
          prfOutput,
        )
      } finally {
        credentialId.fill(0)
        userHandle.fill(0)
        prfOutput.fill(0)
      }
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.UnlockOptions: {
      const options = await (await getManager()).passkeyUnlockOptions()
      try {
        return {
          ok: true,
          material: {
            credentialId: toNumbers(options.credentialId),
            prfInput: toNumbers(options.prfInput),
          } satisfies PasskeyUnlockMaterial,
        }
      } finally {
        options.free()
      }
    }
    case ExtensionSessionMessageType.UnlockPasskey: {
      const prfOutput = toBytes(message.payload.prfOutput)
      try {
        await (await getManager()).unlockDeviceIdentity(prfOutput)
      } finally {
        prfOutput.fill(0)
      }
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.CreatePin: {
      const pin = message.payload.pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).finishPinDeviceProtection(pin)
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.UnlockPin: {
      const pin = message.payload.pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).unlockPinDeviceIdentity(pin)
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.SealIdentityHandoff: {
      const generation = sessionGeneration
      const payload = message.payload
      const recipientPublicKey = payload.recipientPublicKey
      const nonce = payload.nonce
      if (typeof recipientPublicKey !== 'string' || typeof nonce !== 'string') {
        throw new Error(
          'Extension session received an invalid identity handoff.',
        )
      }
      const activeManager = await getManager()
      const status = await activeManager.deviceProtectionStatus()
      if (status !== DeviceProtectionStatus.Unlocked) {
        throw new Error(SESSION_LOCKED_ERROR)
      }
      const device = await deviceResult(activeManager)
      if (
        payload.expectedDeviceId !== device.deviceId ||
        payload.expectedDevicePublicKey !== device.devicePublicKey ||
        payload.expectedDeviceSigningPublicKey !== device.deviceSigningPublicKey
      ) {
        throw new Error(
          'Extension identity request does not match this device.',
        )
      }
      const envelope = await activeManager.sealExtensionIdentityHandoff(
        recipientPublicKey,
        nonce,
      )
      renewSessionExpiry(generation)
      return { ok: true, envelope }
    }
    case ExtensionSessionMessageType.ImportVault: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      const records = payload.eventLogRecords
      const providers = payload.providers
      if (!Array.isArray(records) || !Array.isArray(providers)) {
        throw new Error('Extension session received an invalid vault import.')
      }
      const activeManager = await getManager()
      const providerSnapshot: AuthProvidersSnapshot = {
        providers: providers as StorageProvider[],
        activeVaultStoreId: { state: 'unselected' },
      }
      const grantedProviders =
        decodeStorageProviders(providerSnapshot).providers
      try {
        const recordValues = NookExternalEventLogRecords.fromArray(records)
        const statusValue = await activeManager.importExtensionEventLogRecords(
          grant.vaultStoreId,
          grant.deviceId,
          grant.devicePublicKey,
          grant.deviceSigningPublicKey,
          recordValues,
        )
        const status = statusValue.toObject()
        statusValue.free()
        const protection = await activeManager.deviceProtectionStatus()
        if (protection === DeviceProtectionStatus.Unlocked) {
          const nookTypedArgs0_2: Parameters<
            typeof activeManager.replaceAuthProvidersForVault
          >[0] = {
            providers: grantedProviders,
            activeVaultStoreId: {
              state: 'storeId',
              value: grant.vaultStoreId,
            },
          }
          await activeManager.replaceAuthProvidersForVault(nookTypedArgs0_2)
        } else {
          // Pairing may race a closed/locked offscreen session. Website grants are
          // already sealed for this device public key, so replace this vault's
          // complete provider set without unlock, including an empty set.
          const lockedManager = activeManager as NookVaultManager & {
            savePresealedAuthProviders: (
              snapshot: AuthProvidersSnapshot,
            ) => Promise<void>
          }
          const nookTypedArgs0_3: Parameters<
            typeof lockedManager.savePresealedAuthProviders
          >[0] = {
            providers: grantedProviders,
            activeVaultStoreId: {
              state: 'storeId',
              value: grant.vaultStoreId,
            },
          }
          await lockedManager.savePresealedAuthProviders(nookTypedArgs0_3)
        }
        return { ok: true, status }
      } finally {
        scrubProviderCredentials(grantedProviders)
      }
    }
    case ExtensionSessionMessageType.UpdateVault: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (!Array.isArray(payload.eventLogRecords)) {
        throw new Error(
          'Extension session received an invalid event-log update.',
        )
      }
      const recordValues = NookExternalEventLogRecords.fromArray(
        payload.eventLogRecords,
      )
      const activeManager = await getManager()
      const statusValue = await activeManager.importExtensionEventLogRecords(
        grant.vaultStoreId,
        grant.deviceId,
        grant.devicePublicKey,
        grant.deviceSigningPublicKey,
        recordValues,
      )
      const status = statusValue.toObject()
      statusValue.free()
      return { ok: true, status }
    }
    case ExtensionSessionMessageType.ListPasskeys: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.rpId !== 'string' ||
        typeof payload.origin !== 'string'
      ) {
        throw new Error('Extension session received an invalid passkey lookup.')
      }
      const activeManager = await getManager()
      const nookTypedArgs0_0: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_0)
      const accounts = await activeManager.listWebsitePasskeyAccounts(
        payload.rpId,
        payload.origin,
      )
      try {
        return {
          ok: true,
          accounts: accounts.map((account) => ({
            credentialId: account.credentialId,
            userName: account.userName,
            userDisplayName: account.userDisplayName,
          })),
        }
      } finally {
        accounts.forEach((account) => account.free())
      }
    }
    case ExtensionSessionMessageType.ListLogins: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (typeof payload.origin !== 'string') {
        throw new Error('Extension session received an invalid login lookup.')
      }
      const activeManager = await getManager()
      const nookTypedArgs0_1: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_1)
      const accounts = await activeManager.listWebsiteLoginAccounts(
        payload.origin,
      )
      try {
        return {
          ok: true,
          accounts: accounts.map((account) => ({
            secretId: account.secretId,
            username: account.username,
            websiteUrl: account.websiteUrl,
            websiteHost: account.websiteHost,
          })),
        }
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
        throw new Error('Extension session received an invalid login reveal.')
      }
      const activeManager = await getManager()
      const nookTypedArgs0_2: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_2)
      const credential = await activeManager.revealWebsiteLoginForFill(
        payload.secretId,
        payload.origin,
      )
      try {
        return {
          ok: true,
          username: credential.username,
          password: credential.password,
        }
      } finally {
        credential.free()
      }
    }
    case ExtensionSessionMessageType.ListAuthenticators: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (typeof payload.query !== 'string') {
        throw new Error(
          'Extension session received an invalid authenticator search.',
        )
      }
      const activeManager = await getManager()
      const nookTypedArgs0_3: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_3)
      const accounts = await activeManager.listAuthenticatorAccounts(
        payload.query,
      )
      try {
        return {
          ok: true,
          accounts: accounts.map((account) => ({
            secretId: account.secretId,
            issuer: account.issuer,
            account: account.account,
          })),
        }
      } finally {
        accounts.forEach((account) => account.free())
      }
    }
    case ExtensionSessionMessageType.AuthenticatorCode: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (typeof payload.secretId !== 'string') {
        throw new Error(
          'Extension session received an invalid authenticator selection.',
        )
      }
      const activeManager = await getManager()
      const nookTypedArgs0_4: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_4)
      const code = await activeManager.currentAuthenticatorCodeForFill(
        payload.secretId,
        Math.floor(Date.now() / 1000),
      )
      try {
        return { ok: true, code: code.code }
      } finally {
        code.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollPreview: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await ensureWasm()
      const preview = previewOtpauthUri(payload.otpauthUri)
      try {
        return {
          ok: true,
          preview: {
            issuer: preview.issuer,
            account: preview.account,
            websiteUrl: preview.websiteUrl,
            algorithm: preview.algorithm,
            digits: preview.digits,
            period: preview.period,
          },
        }
      } finally {
        preview.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollCode: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await ensureWasm()
      const code = currentCodeFromOtpauthUri(payload.otpauthUri)
      try {
        return { ok: true, code: code.code }
      } finally {
        code.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollConfirm: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.otpauthUri !== 'string' ||
        typeof payload.origin !== 'string'
      ) {
        throw new Error('Extension session received an invalid enrollment.')
      }
      const activeManager = await getManager()
      const nookTypedArgs0_5: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_5)
      const secretId = await activeManager.addAuthenticatorFromOtpauth(
        payload.otpauthUri,
        payload.origin,
      )
      const nookTypedArgs0_6: Parameters<
        typeof flushPasskeyEventToProviders
      >[0] = {
        activeManager,
        vaultStoreId: grant.vaultStoreId,
      }
      await flushPasskeyEventToProviders(nookTypedArgs0_6)
      return { ok: true, secretId }
    }
    case ExtensionSessionMessageType.AuthenticatorBackupAttach: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.secretId !== 'string' ||
        typeof payload.mode !== 'string' ||
        !Array.isArray(payload.codes) ||
        !payload.codes.every((code) => typeof code === 'string')
      ) {
        throw new Error(
          'Extension session received an invalid backup-code attach.',
        )
      }
      const activeManager = await getManager()
      const nookTypedArgs0_7: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_7)
      const secretId = await activeManager.attachAuthenticatorBackupCodes(
        payload.secretId,
        payload.codes,
        payload.mode,
      )
      const nookTypedArgs0_8: Parameters<
        typeof flushPasskeyEventToProviders
      >[0] = {
        activeManager,
        vaultStoreId: grant.vaultStoreId,
      }
      await flushPasskeyEventToProviders(nookTypedArgs0_8)
      return { ok: true, secretId }
    }
    case ExtensionSessionMessageType.PlanLoginSave: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.origin !== 'string' ||
        typeof payload.username !== 'string' ||
        typeof payload.password !== 'string'
      ) {
        throw new Error(
          'Extension session received an invalid login save plan.',
        )
      }
      const activeManager = await getManager()
      const nookTypedArgs0_9: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(nookTypedArgs0_9)
      const plan = await activeManager.planWebsiteLoginSave(
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
          return decision === NookWebsiteLoginSaveDecision.AlreadySaved
            ? { ok: true, decision, secretId: plan.secretId }
            : { ok: true, decision }
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
        return {
          ok: true,
          decision,
          offerId,
          ...(offer.decision === NookWebsiteLoginSaveDecision.Update
            ? { secretId: offer.replaceSecretId }
            : {}),
          vaultStoreId: grant.vaultStoreId,
        }
      } finally {
        plan.free()
      }
    }
    case ExtensionSessionMessageType.PendingLoginSave: {
      const payload = message.payload
      if (typeof payload.origin !== 'string') {
        throw new Error(
          'Extension session received an invalid pending login save lookup.',
        )
      }
      const lookup = pendingLoginSaveOfferStore.findByOrigin(payload.origin)
      if (lookup.state === PendingLoginSaveLookupState.Unavailable) {
        return { ok: true, state: PendingLoginSaveLookupState.Unavailable }
      }
      const { offer } = lookup
      return {
        ok: true,
        state: PendingLoginSaveLookupState.Available,
        offer: {
          offerId: offer.offerId,
          decision: offer.decision,
          vaultStoreId: offer.vaultStoreId,
        },
      }
    }
    case ExtensionSessionMessageType.CommitLoginSave: {
      const payload = message.payload
      const grant = extensionVaultGrant(payload)
      if (typeof payload.offerId !== 'string') {
        throw new Error(
          'Extension session received an invalid login save commit.',
        )
      }
      const lookup = pendingLoginSaveOfferStore.findById(payload.offerId)
      if (
        lookup.state === PendingLoginSaveLookupState.Unavailable ||
        lookup.offer.origin !== (payload.origin as string)
      ) {
        throw new Error('Login save offer is missing or expired.')
      }
      const { offer } = lookup
      if (offer.vaultStoreId !== grant.vaultStoreId) {
        throw new Error('Login save offer does not match the vault grant.')
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
      await openPasskeyVault(nookTypedArgs0_10)
      try {
        await activeManager.commitWebsiteLoginSave(
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
        await flushPasskeyEventToProviders(nookTypedArgs0_11)
        return { ok: true, decision: committedOffer.decision }
      } finally {
        pendingLoginSaveOfferStore.clearOffer(committedOffer)
      }
    }
    case ExtensionSessionMessageType.DismissLoginSave: {
      const payload = message.payload
      if (typeof payload.offerId !== 'string') {
        throw new Error(
          'Extension session received an invalid login save dismissal.',
        )
      }
      pendingLoginSaveOfferStore.clearById(payload.offerId)
      return { ok: true }
    }
    case ExtensionSessionMessageType.CancelPasskey:
    case ExtensionSessionMessageType.RegisterPasskey:
    case ExtensionSessionMessageType.AssertPasskey: {
      const operationArgs: WebsitePasskeyOperationArgs = {
        message,
        getManager,
      }
      return handleWebsitePasskeyOperation(operationArgs)
    }
    case ExtensionSessionMessageType.Lock:
      return { ok: true }
    default:
      throw new Error('Extension session received an unsupported request.')
  }
}
