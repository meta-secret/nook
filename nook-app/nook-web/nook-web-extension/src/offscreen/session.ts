import initNookWasm, {
  configureVaultApplication,
  loadAuthProviders,
  NookAuthProvidersSnapshotValue,
  NookExternalEventLogRecords,
  NookStorageProviderValue,
  NookVaultManager,
  providerWasmArgs,
  saveAuthProviders,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

const SESSION_DURATION_MS = 15 * 60 * 1000

type DeviceMode = 'standard' | 'anti-hacker'

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

type StoredProvider = {
  id: string
  type: string
  storeId?: string
}

type LoadedProviders = {
  snapshot: {
    providers: StoredProvider[]
    activeVaultStoreId?: string
  }
}

let initPromise: Promise<unknown> | undefined
let manager: NookVaultManager | undefined
let sessionTimer: ReturnType<typeof setTimeout> | undefined

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

function armSessionExpiry(): void {
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    const activeManager = manager
    manager = undefined
    sessionTimer = undefined
    activeManager?.lockDeviceIdentity()
    activeManager?.free()
    chrome.runtime.sendMessage({ type: 'nook:extension-session-expired' })
  }, SESSION_DURATION_MS)
}

async function activateSession(): Promise<DeviceResult> {
  const activeManager = await getManager()
  armSessionExpiry()
  return deviceResult(activeManager)
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
  const loadedValue = await loadAuthProviders(activeManager)
  const loaded = loadedValue.toObject() as LoadedProviders
  loadedValue.free()
  const providers = loaded.snapshot.providers.filter(
    (provider) =>
      provider.storeId === vaultStoreId &&
      provider.type !== 'local' &&
      provider.type !== 'local-folder',
  )
  await Promise.allSettled(
    providers.map(async (provider) => {
      const providerValue = NookStorageProviderValue.fromObject(provider)
      const args = providerWasmArgs(providerValue)
      providerValue.free()
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
          deviceMode as DeviceMode,
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
      armSessionExpiry()
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
      const existingValue = await loadAuthProviders(activeManager)
      const existing = existingValue.toObject() as LoadedProviders
      existingValue.free()
      const merged = new Map(
        existing.snapshot.providers.map((provider) => [provider.id, provider]),
      )
      for (const provider of providers as StoredProvider[]) {
        if (provider && typeof provider.id === 'string')
          merged.set(provider.id, provider)
      }
      const snapshotValue = NookAuthProvidersSnapshotValue.fromObject({
        providers: Array.from(merged.values()),
        activeVaultStoreId: grant.vaultStoreId,
      })
      try {
        await saveAuthProviders(activeManager, snapshotValue)
      } finally {
        snapshotValue.free()
      }
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
      const statusValue = await (
        await getManager()
      ).importExtensionEventLogRecords(
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  void handleMessage(message)
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
