import initNookWasm, {
  configureVaultApplication,
  currentCodeFromOtpauthUri,
  NookExternalEventLogRecords,
  NookVaultManager,
  previewOtpauthUri,
  providerWasmArgs,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  SessionOperationQueue,
  type SessionOperationPriority,
} from '../lib/session-operation-queue'

const SESSION_DURATION_MS = 15 * 60 * 1000
const INTERACTIVE_QUEUE_TIMEOUT_MS = 5_000

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

let initPromise: Promise<unknown> | undefined
let manager: NookVaultManager | undefined
let sessionTimer: ReturnType<typeof setTimeout> | undefined
let sessionGeneration = 0
let sessionDeadlineAt = 0

const LOGIN_SAVE_OFFER_TTL_MS = 2 * 60 * 1000

type PendingLoginSaveOffer = {
  offerId: string
  origin: string
  username: string
  password: string
  vaultStoreId: string
  decision: 'create' | 'update'
  replaceSecretId?: string
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
}

const pendingLoginSaveOffers = new Map<string, PendingLoginSaveOffer>()
const sessionOperations = new SessionOperationQueue()

function clearLoginSaveOffer(offer: PendingLoginSaveOffer | undefined): void {
  if (!offer) return
  offer.username = ''
  offer.password = ''
  clearTimeout(offer.expiryTimer)
  pendingLoginSaveOffers.delete(offer.offerId)
}

function purgeExpiredLoginSaveOffers(now = Date.now()): void {
  for (const offer of [...pendingLoginSaveOffers.values()]) {
    if (offer.expiresAt <= now) {
      clearLoginSaveOffer(offer)
    }
  }
}

function findPendingLoginSaveOffer(
  origin: string,
): PendingLoginSaveOffer | undefined {
  purgeExpiredLoginSaveOffers()
  for (const offer of pendingLoginSaveOffers.values()) {
    if (offer.origin === origin) return offer
  }
  return undefined
}

function ensureWasm(): Promise<unknown> {
  initPromise ??= initNookWasm({
    module_or_path: chrome.runtime.getURL('offscreen/nook_wasm_bg.wasm'),
  }).then((value) => {
    configureVaultApplication('extension')
    return value
  })
  return initPromise
}

async function getManager(): Promise<NookVaultManager> {
  await ensureWasm()
  manager ??= new NookVaultManager()
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
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionDeadlineAt = Date.now() + SESSION_DURATION_MS
  sessionTimer = setTimeout(() => {
    if (generation !== sessionGeneration) return
    sessionTimer = undefined
    sessionDeadlineAt = 0
    sessionGeneration += 1
    manager = undefined
    sessionOperations.close(new Error('Extension device identity is locked.'))
    chrome.runtime.sendMessage({ type: 'nook:extension-session-expired' })
  }, SESSION_DURATION_MS)
}

async function activateSession(): Promise<DeviceResult> {
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
    throw new Error('Extension device identity is locked.')
  }
  scheduleSessionExpiry(generation)
}

function messageType(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return undefined
  }
  return typeof message.type === 'string' ? message.type : undefined
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
      provider.storeId === vaultStoreId &&
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
  switch (messageType(message)) {
    case 'nook:extension-session-status': {
      const activeManager = await getManager()
      const status = await activeManager.deviceProtectionStatus()
      return {
        ok: true,
        status,
        ...(status === 'unlocked'
          ? { device: await deviceResult(activeManager) }
          : {}),
      }
    }
    case 'nook:extension-session-begin-passkey-setup': {
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
    case 'nook:extension-session-finish-passkey-setup': {
      const payload = messagePayload(message)
      const activeManager = await getManager()
      const credentialId = toBytes(payload.credentialId)
      const userHandle = toBytes(payload.userHandle)
      const prfInput = toBytes(payload.prfInput)
      const prfOutput = toBytes(payload.prfOutput)
      const deviceMode = payload.deviceMode
      if (deviceMode !== 'standard' && deviceMode !== 'anti-hacker') {
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
    case 'nook:extension-session-recover-passkey': {
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
    case 'nook:extension-session-unlock-options': {
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
    case 'nook:extension-session-unlock-passkey': {
      const prfOutput = toBytes(messagePayload(message).prfOutput)
      try {
        await (await getManager()).unlockDeviceIdentity(prfOutput)
      } finally {
        prfOutput.fill(0)
      }
      return { ok: true, device: await activateSession() }
    }
    case 'nook:extension-session-create-pin': {
      const pin = messagePayload(message).pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).finishPinDeviceProtection(pin)
      return { ok: true, device: await activateSession() }
    }
    case 'nook:extension-session-unlock-pin': {
      const pin = messagePayload(message).pin
      if (typeof pin !== 'string')
        throw new Error('Extension session received an invalid PIN.')
      await (await getManager()).unlockPinDeviceIdentity(pin)
      return { ok: true, device: await activateSession() }
    }
    case 'nook:extension-session-seal-identity-handoff': {
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
      if (status !== 'unlocked') {
        throw new Error('Extension device identity is locked.')
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
    case 'nook:extension-session-import-vault': {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      const records = payload.eventLogRecords
      const providers = payload.providers
      if (!Array.isArray(records) || !Array.isArray(providers)) {
        throw new Error('Extension session received an invalid vault import.')
      }
      const activeManager = await getManager()
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
      const existing = await activeManager.loadAuthProviders()
      const merged = new Map<string, StorageProvider>(
        existing.providers.map((provider) => [provider.id, provider]),
      )
      for (const provider of providers) {
        if (
          provider &&
          typeof provider === 'object' &&
          'id' in provider &&
          typeof provider.id === 'string'
        ) {
          // The Rust/Tsify ABI performs the complete shape validation when the
          // snapshot is saved; this guard only narrows the merge key here.
          merged.set(provider.id, provider as StorageProvider)
        }
      }
      await activeManager.saveAuthProviders({
        providers: Array.from(merged.values()),
        activeVaultStoreId: grant.vaultStoreId,
      })
      return { ok: true, status }
    }
    case 'nook:extension-session-update-vault': {
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
    case 'nook:extension-session-list-passkeys': {
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
    case 'nook:extension-session-list-logins': {
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
    case 'nook:extension-session-reveal-login': {
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
    case 'nook:extension-session-list-authenticators': {
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
    case 'nook:extension-session-authenticator-code': {
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
    case 'nook:extension-session-authenticator-enroll-preview': {
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
    case 'nook:extension-session-authenticator-enroll-code': {
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
    case 'nook:extension-session-authenticator-enroll-confirm': {
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
    case 'nook:extension-session-authenticator-backup-attach': {
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
    case 'nook:extension-session-plan-login-save': {
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
        if (decision !== 'create' && decision !== 'update') {
          payload.password = ''
          return { ok: true, decision, secretId: plan.secretId }
        }
        purgeExpiredLoginSaveOffers()
        for (const existing of [...pendingLoginSaveOffers.values()]) {
          if (existing.origin === payload.origin) {
            clearLoginSaveOffer(existing)
          }
        }
        const offerId = crypto.randomUUID()
        const replaceSecretId =
          decision === 'update' && typeof plan.secretId === 'string'
            ? plan.secretId
            : undefined
        const offer: PendingLoginSaveOffer = {
          offerId,
          origin: payload.origin,
          username: payload.username,
          password: payload.password,
          vaultStoreId: grant.vaultStoreId,
          decision,
          replaceSecretId,
          expiresAt: Date.now() + LOGIN_SAVE_OFFER_TTL_MS,
          expiryTimer: setTimeout(() => {
            clearLoginSaveOffer(pendingLoginSaveOffers.get(offerId))
          }, LOGIN_SAVE_OFFER_TTL_MS),
        }
        pendingLoginSaveOffers.set(offerId, offer)
        payload.password = ''
        return {
          ok: true,
          decision,
          offerId,
          secretId: replaceSecretId,
          vaultStoreId: grant.vaultStoreId,
        }
      } finally {
        plan.free()
      }
    }
    case 'nook:extension-session-pending-login-save': {
      const payload = messagePayload(message)
      if (typeof payload.origin !== 'string') {
        throw new Error(
          'Extension session received an invalid pending login save lookup.',
        )
      }
      const offer = findPendingLoginSaveOffer(payload.origin)
      if (!offer) {
        return { ok: true, offer: undefined }
      }
      return {
        ok: true,
        offer: {
          offerId: offer.offerId,
          decision: offer.decision,
          vaultStoreId: offer.vaultStoreId,
        },
      }
    }
    case 'nook:extension-session-commit-login-save': {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.offerId !== 'string') {
        throw new Error(
          'Extension session received an invalid login save commit.',
        )
      }
      purgeExpiredLoginSaveOffers()
      const offer = pendingLoginSaveOffers.get(payload.offerId)
      if (!offer || offer.origin !== (payload.origin as string)) {
        throw new Error('Login save offer is missing or expired.')
      }
      if (offer.vaultStoreId !== grant.vaultStoreId) {
        throw new Error('Login save offer does not match the vault grant.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      try {
        await activeManager.commitWebsiteLoginSave(
          offer.origin,
          offer.username,
          offer.password,
          offer.replaceSecretId ?? '',
        )
        await flushPasskeyEventToProviders(activeManager, grant.vaultStoreId)
        return { ok: true, decision: offer.decision }
      } finally {
        clearLoginSaveOffer(offer)
      }
    }
    case 'nook:extension-session-dismiss-login-save': {
      const payload = messagePayload(message)
      if (typeof payload.offerId !== 'string') {
        throw new Error(
          'Extension session received an invalid login save dismissal.',
        )
      }
      clearLoginSaveOffer(pendingLoginSaveOffers.get(payload.offerId))
      return { ok: true }
    }
    case 'nook:extension-session-register-passkey': {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.requestJson !== 'string') {
        throw new Error('Extension session received an invalid registration.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      const registration = await activeManager.registerWebsitePasskey(
        payload.requestJson,
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
    }
    case 'nook:extension-session-assert-passkey': {
      const payload = messagePayload(message)
      const grant = extensionVaultGrant(payload)
      if (typeof payload.requestJson !== 'string') {
        throw new Error('Extension session received an invalid assertion.')
      }
      const activeManager = await getManager()
      await openPasskeyVault(activeManager, grant)
      const assertion = await activeManager.assertWebsitePasskey(
        payload.requestJson,
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
    }
    default:
      return undefined
  }
}

function sessionMessagePriority(type: string): SessionOperationPriority {
  switch (type) {
    case 'nook:extension-session-seal-identity-handoff':
    case 'nook:extension-session-plan-login-save':
    case 'nook:extension-session-commit-login-save':
    case 'nook:extension-session-reveal-login':
    case 'nook:extension-session-authenticator-code':
    case 'nook:extension-session-authenticator-enroll-confirm':
    case 'nook:extension-session-authenticator-backup-attach':
    case 'nook:extension-session-register-passkey':
    case 'nook:extension-session-assert-passkey':
    case 'nook:extension-session-unlock-passkey':
    case 'nook:extension-session-unlock-pin':
      return 'interactive'
    default:
      return 'normal'
  }
}

function requestedQueueExpiry(
  payload: Record<string, unknown>,
): number | undefined {
  const value = payload.queueExpiresAt
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(value, Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS)
}

const sensitiveSessionFields: Readonly<
  Record<string, readonly string[] | undefined>
> = {
  'nook:extension-session-finish-passkey-setup': [
    'credentialId',
    'userHandle',
    'prfInput',
    'prfOutput',
  ],
  'nook:extension-session-recover-passkey': [
    'credentialId',
    'userHandle',
    'prfOutput',
  ],
  'nook:extension-session-unlock-passkey': ['prfOutput'],
  'nook:extension-session-create-pin': ['pin'],
  'nook:extension-session-unlock-pin': ['pin'],
  'nook:extension-session-plan-login-save': ['password'],
  'nook:extension-session-authenticator-enroll-preview': ['otpauthUri'],
  'nook:extension-session-authenticator-enroll-code': ['otpauthUri'],
  'nook:extension-session-authenticator-enroll-confirm': ['otpauthUri'],
  'nook:extension-session-authenticator-backup-attach': ['codes'],
}

function copySensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return value
}

function clearSensitiveValue(value: unknown): void {
  if (Array.isArray(value) || value instanceof Uint8Array) value.fill(0)
}

function enqueueSensitiveSessionMessage(
  message: Record<string, unknown>,
  payload: Record<string, unknown>,
  fields: readonly string[],
): Promise<unknown> {
  let pendingPayload: Record<string, unknown> | undefined = { ...payload }
  for (const field of fields) {
    pendingPayload[field] = copySensitiveValue(payload[field])
    clearSensitiveValue(payload[field])
    payload[field] = typeof payload[field] === 'string' ? '' : []
  }
  const clearPending = () => {
    if (!pendingPayload) return
    for (const field of fields) {
      clearSensitiveValue(pendingPayload[field])
      pendingPayload[field] = undefined
    }
    pendingPayload = undefined
  }
  return sessionOperations.enqueue(
    async () => {
      const operationPayload = pendingPayload
      pendingPayload = undefined
      if (!operationPayload) {
        throw new Error('Extension session request expired.')
      }
      try {
        return await handleMessage({ ...message, payload: operationPayload })
      } finally {
        for (const field of fields) {
          clearSensitiveValue(operationPayload[field])
          operationPayload[field] = undefined
        }
      }
    },
    {
      priority: 'interactive',
      expiresAt: Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS,
      onExpire: clearPending,
    },
  )
}

function enqueueSessionMessage(message: unknown): Promise<unknown> {
  const type = messageType(message)
  if (!type) return Promise.resolve(undefined)
  const payload = messagePayload(message)
  const requestedExpiry = requestedQueueExpiry(payload)
  const priority = requestedExpiry
    ? payload.queuePriority === 'interactive'
      ? 'interactive'
      : 'probe'
    : sessionMessagePriority(type)
  const sensitiveFields = sensitiveSessionFields[type]
  if (sensitiveFields) {
    return enqueueSensitiveSessionMessage(
      message as Record<string, unknown>,
      payload,
      sensitiveFields,
    )
  }

  const expiresAt =
    requestedExpiry ??
    (type === 'nook:extension-session-seal-identity-handoff'
      ? Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS
      : undefined)
  return sessionOperations.enqueue(() => handleMessage(message), {
    priority,
    expiresAt,
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (messageType(message) === 'nook:extension-session-lock') return false
  const serviceWorkerOnly =
    messageType(message) === 'nook:extension-session-seal-identity-handoff'
  const serviceWorkerSender =
    sender.tab === undefined &&
    (sender.url === undefined ||
      sender.url === chrome.runtime.getURL('background/service-worker.js'))
  if (
    sender.id !== chrome.runtime.id ||
    (serviceWorkerOnly && !serviceWorkerSender) ||
    !messageType(message)?.startsWith('nook:extension-session-')
  ) {
    return false
  }
  if (messageType(message) === 'nook:extension-session-dismiss-login-save') {
    void handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Extension session failed.',
        }),
      )
    return true
  }
  void enqueueSessionMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : 'Extension session failed.',
      }),
    )
  return true
})
