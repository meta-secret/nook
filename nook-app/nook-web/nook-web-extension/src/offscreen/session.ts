import initNookWasm, {
  configureVaultApplication,
  currentCodeFromOtpauthUri,
  DeviceMode,
  DeviceProtectionStatus,
  decodeStorageProviders,
  NookExternalEventLogRecords,
  NookWebsiteLoginSaveDecision,
  NookVaultManager,
  previewOtpauthUri,
  providerWasmArgs,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { scrubProviderCredentials } from '../lib/provider-credential-staging'
import {
  ExtensionSessionMessageType,
  ExtensionSessionMessageDispatcher,
  parseExtensionSessionMessageType,
  SessionMessageTypeParseKind,
} from './session-message-dispatch'
import {
  LOGIN_SAVE_OFFER_TTL_MS,
  PendingLoginSaveLookupState,
  pendingLoginSaveOfferStore,
  type PendingLoginSaveOffer,
} from './login-save-offers'

const SESSION_DURATION_MS = 15 * 60 * 1000
const SESSION_LOCKED_ERROR = 'EXTENSION_SESSION_LOCKED'

type DeviceResult = {
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

type ExtensionVaultGrant = {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

enum WasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type WasmStartup =
  | { kind: WasmStartupKind.NotStarted }
  | { kind: WasmStartupKind.Initializing; operation: Promise<unknown> }
enum VaultManagerAvailabilityKind {
  Locked = 'locked',
  Active = 'active',
}

type VaultManagerAvailability =
  | { kind: VaultManagerAvailabilityKind.Locked }
  | { kind: VaultManagerAvailabilityKind.Active; manager: NookVaultManager }
enum SessionExpiryScheduleKind {
  Stopped = 'stopped',
  Scheduled = 'scheduled',
}

type SessionExpirySchedule =
  | { kind: SessionExpiryScheduleKind.Stopped }
  | {
      kind: SessionExpiryScheduleKind.Scheduled
      timer: ReturnType<typeof setTimeout>
    }

let wasmStartup: WasmStartup = { kind: WasmStartupKind.NotStarted }
let managerAvailability: VaultManagerAvailability = {
  kind: VaultManagerAvailabilityKind.Locked,
}
let sessionExpirySchedule: SessionExpirySchedule = {
  kind: SessionExpiryScheduleKind.Stopped,
}
let sessionGeneration = 0
let sessionDeadlineAt = 0

const canceledWebsitePasskeyRequests = new Set<string>()

function ensureWasm(): Promise<unknown> {
  if (wasmStartup.kind === WasmStartupKind.Initializing) {
    return wasmStartup.operation
  }
  const operation = initNookWasm({
    module_or_path: chrome.runtime.getURL('offscreen/nook_wasm_bg.wasm'),
  }).then((value) => {
    configureVaultApplication(VaultApplication.Extension)
    return value
  })
  wasmStartup = { kind: WasmStartupKind.Initializing, operation }
  return operation
}

async function getManager(): Promise<NookVaultManager> {
  await ensureWasm()
  if (managerAvailability.kind === VaultManagerAvailabilityKind.Active) {
    return managerAvailability.manager
  }
  const manager = new NookVaultManager()
  managerAvailability = { kind: VaultManagerAvailabilityKind.Active, manager }
  return manager
}

function toNumbers(value: Uint8Array): number[] {
  return Array.from(value)
}

function toBytes(value: unknown): Uint8Array {
  if (!Array.isArray(value) || !value.every((byte) => Number.isInteger(byte))) {
    throw new Error('Extension session received invalid key material.')
  }
  return new Uint8Array(value)
}

async function deviceResult(
  activeManager: NookVaultManager,
): Promise<DeviceResult> {
  return {
    deviceId: activeManager.device_id,
    devicePublicKey: activeManager.device_public_key,
    deviceSigningPublicKey: await activeManager.deviceSigningPublicKey(),
  }
}

function scheduleSessionExpiry(generation: number): void {
  if (sessionExpirySchedule.kind === SessionExpiryScheduleKind.Scheduled) {
    clearTimeout(sessionExpirySchedule.timer)
  }
  sessionDeadlineAt = Date.now() + SESSION_DURATION_MS
  sessionExpirySchedule = {
    kind: SessionExpiryScheduleKind.Scheduled,
    timer: setTimeout(() => {
      if (generation !== sessionGeneration) return
      sessionExpirySchedule = { kind: SessionExpiryScheduleKind.Stopped }
      sessionDeadlineAt = 0
      sessionGeneration += 1
      const expiredManager = managerAvailability
      managerAvailability = { kind: VaultManagerAvailabilityKind.Locked }
      if (expiredManager.kind === VaultManagerAvailabilityKind.Active) {
        try {
          expiredManager.manager.lockDeviceIdentity()
          expiredManager.manager.free()
        } catch {
          // The service worker closes this document immediately if a WASM call
          // still owns the manager when the session expires.
        }
      }
      sessionMessageDispatcher.replaceOperations(
        new Error(SESSION_LOCKED_ERROR),
      )
      void chrome.runtime.sendMessage({
        type: 'nook:extension-session-expired',
      })
    }, SESSION_DURATION_MS),
  }
}

async function activateSession(): Promise<DeviceResult> {
  // Expiry closes the queue permanently; unlock must install a fresh queue.
  sessionMessageDispatcher.resetOperations()
  const activeManager = await getManager()
  sessionGeneration += 1
  scheduleSessionExpiry(sessionGeneration)
  return deviceResult(activeManager)
}

function renewSessionExpiry(generation: number): void {
  if (
    generation !== sessionGeneration ||
    sessionDeadlineAt === 0 ||
    Date.now() >= sessionDeadlineAt
  ) {
    throw new Error(SESSION_LOCKED_ERROR)
  }
  scheduleSessionExpiry(generation)
}

function messagePayload(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object' || !('payload' in message)) {
    return {}
  }
  const payload = message.payload
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {}
}

function extensionVaultGrant(
  payload: Record<string, unknown>,
): ExtensionVaultGrant {
  const fields = [
    'vaultStoreId',
    'deviceId',
    'devicePublicKey',
    'deviceSigningPublicKey',
  ] as const
  for (const field of fields) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) {
      throw new Error('Extension session received an invalid vault grant.')
    }
  }
  return {
    vaultStoreId: payload.vaultStoreId as string,
    deviceId: payload.deviceId as string,
    devicePublicKey: payload.devicePublicKey as string,
    deviceSigningPublicKey: payload.deviceSigningPublicKey as string,
  }
}

async function openPasskeyVault(
  activeManager: NookVaultManager,
  grant: ExtensionVaultGrant,
): Promise<void> {
  await activeManager.openExtensionPasskeyVault(
    grant.vaultStoreId,
    grant.deviceId,
    grant.devicePublicKey,
    grant.deviceSigningPublicKey,
  )
}

async function flushPasskeyEventToProviders(
  activeManager: NookVaultManager,
  vaultStoreId: string,
): Promise<void> {
  const snapshot = await activeManager.loadAuthProviders()
  const providers = snapshot.providers.filter(
    (provider) =>
      provider.storeId.state === 'storeId' &&
      provider.storeId.value === vaultStoreId &&
      provider.type !== 'local' &&
      provider.type !== 'local-folder',
  )
  await Promise.allSettled(
    providers.map(async (provider) => {
      const args = providerWasmArgs(provider)
      try {
        await activeManager.flushEventOutboxForProvider(
          args.mode,
          args.pat,
          args.repo,
        )
      } finally {
        args.free()
      }
    }),
  )
}

async function handleMessage(message: unknown): Promise<unknown> {
  const parsedType = parseExtensionSessionMessageType(message)
  if (parsedType.kind === SessionMessageTypeParseKind.Invalid) {
    return { ok: false, error: 'Invalid extension session message.' }
  }
  switch (parsedType.messageType) {
    case ExtensionSessionMessageType.Reset: {
      pendingLoginSaveOfferStore.clearAll()
      canceledWebsitePasskeyRequests.clear()
      sessionMessageDispatcher.replaceOperations(
        new Error('Extension session reset.'),
      )
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
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
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
      const prfOutput = toBytes(messagePayload(message).prfOutput)
      try {
        await (await getManager()).unlockDeviceIdentity(prfOutput)
      } finally {
        prfOutput.fill(0)
      }
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.CreatePin: {
      const pin = messagePayload(message).pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).finishPinDeviceProtection(pin)
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.UnlockPin: {
      const pin = messagePayload(message).pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).unlockPinDeviceIdentity(pin)
      return { ok: true, device: await activateSession() }
    }
    case ExtensionSessionMessageType.SealIdentityHandoff: {
      const generation = sessionGeneration
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
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
          await activeManager.replaceAuthProvidersForVault({
            providers: grantedProviders,
            activeVaultStoreId: {
              state: 'storeId',
              value: grant.vaultStoreId,
            },
          })
        } else {
          // Pairing may race a closed/locked offscreen session. Website grants are
          // already sealed for this device public key, so replace this vault's
          // complete provider set without unlock, including an empty set.
          const lockedManager = activeManager as NookVaultManager & {
            savePresealedAuthProviders: (
              snapshot: AuthProvidersSnapshot,
            ) => Promise<void>
          }
          await lockedManager.savePresealedAuthProviders({
            providers: grantedProviders,
            activeVaultStoreId: {
              state: 'storeId',
              value: grant.vaultStoreId,
            },
          })
        }
        return { ok: true, status }
      } finally {
        scrubProviderCredentials(grantedProviders)
      }
    }
    case ExtensionSessionMessageType.UpdateVault: {
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.rpId !== 'string' ||
        typeof payload.origin !== 'string'
      ) {
        throw new Error('Extension session received an invalid passkey lookup.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.origin !== 'string') {
        throw new Error('Extension session received an invalid login lookup.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.origin !== 'string' ||
        typeof payload.secretId !== 'string'
      ) {
        throw new Error('Extension session received an invalid login reveal.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.query !== 'string') {
        throw new Error(
          'Extension session received an invalid authenticator search.',
        )
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.secretId !== 'string') {
        throw new Error(
          'Extension session received an invalid authenticator selection.',
        )
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.otpauthUri !== 'string' ||
        typeof payload.origin !== 'string'
      ) {
        throw new Error('Extension session received an invalid enrollment.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      const secretId = await activeManager.addAuthenticatorFromOtpauth(
        payload.otpauthUri,
        payload.origin,
      )
      await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
      return { ok: true, secretId }
    }
    case ExtensionSessionMessageType.AuthenticatorBackupAttach: {
      const payload = messagePayload(message)
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
      await openPasskeyVault(activeManager, grant)
      const secretId = await activeManager.attachAuthenticatorBackupCodes(
        payload.secretId,
        payload.codes,
        payload.mode,
      )
      await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
      return { ok: true, secretId }
    }
    case ExtensionSessionMessageType.PlanLoginSave: {
      const payload = messagePayload(message)
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
      await openPasskeyVault(activeManager, grant)
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
      const payload = messagePayload(message)
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
      const payload = messagePayload(message)
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
      const committedOffer = { ...offer }
      offer.username = ''
      offer.password = ''
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      try {
        await activeManager.commitWebsiteLoginSave(
          committedOffer.origin,
          committedOffer.username,
          committedOffer.password,
          committedOffer.decision === NookWebsiteLoginSaveDecision.Update
            ? committedOffer.replaceSecretId
            : '',
        )
        await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
        return { ok: true, decision: committedOffer.decision }
      } finally {
        pendingLoginSaveOfferStore.clearOffer(committedOffer)
      }
    }
    case ExtensionSessionMessageType.DismissLoginSave: {
      const payload = messagePayload(message)
      if (typeof payload.offerId !== 'string') {
        throw new Error(
          'Extension session received an invalid login save dismissal.',
        )
      }
      pendingLoginSaveOfferStore.clearById(payload.offerId)
      return { ok: true }
    }
    case ExtensionSessionMessageType.CancelPasskey: {
      const payload = messagePayload(message)
      if (typeof payload.requestId !== 'string') {
        throw new Error(
          'Extension session received an invalid passkey cancellation.',
        )
      }
      canceledWebsitePasskeyRequests.add(payload.requestId)
      return { ok: true }
    }
    case ExtensionSessionMessageType.RegisterPasskey: {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.requestId !== 'string' ||
        typeof payload.requestJson !== 'string' ||
        typeof payload.queueExpiresAt !== 'number'
      ) {
        throw new Error('Extension session received an invalid registration.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      try {
        const registration = await activeManager.registerWebsitePasskey(
          payload.requestJson,
          () =>
            Date.now() < (payload.queueExpiresAt as number) &&
            !canceledWebsitePasskeyRequests.has(payload.requestId as string),
        )
        try {
          await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
          return {
            ok: true,
            credentialId: registration.credentialId,
            clientDataJSON: registration.clientDataJSON,
            attestationObject: registration.attestationObject,
            transports: registration.transports,
          }
        } finally {
          registration.free()
        }
      } finally {
        canceledWebsitePasskeyRequests.delete(payload.requestId)
      }
    }
    case ExtensionSessionMessageType.AssertPasskey: {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (
        typeof payload.requestId !== 'string' ||
        typeof payload.requestJson !== 'string' ||
        typeof payload.queueExpiresAt !== 'number'
      ) {
        throw new Error('Extension session received an invalid assertion.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      try {
        const assertion = await activeManager.assertWebsitePasskey(
          payload.requestJson,
          () =>
            Date.now() < (payload.queueExpiresAt as number) &&
            !canceledWebsitePasskeyRequests.has(payload.requestId as string),
        )
        try {
          await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
          return {
            ok: true,
            credentialId: assertion.credentialId,
            clientDataJSON: assertion.clientDataJSON,
            authenticatorData: assertion.authenticatorData,
            signature: assertion.signature,
            userHandle: assertion.userHandle,
          }
        } finally {
          assertion.free()
        }
      } finally {
        canceledWebsitePasskeyRequests.delete(payload.requestId)
      }
    }
    case ExtensionSessionMessageType.Lock:
      return
  }
}

const sessionMessageDispatcher = new ExtensionSessionMessageDispatcher({
  handleMessage,
  messagePayload,
})
sessionMessageDispatcher.registerRuntimeListener()
