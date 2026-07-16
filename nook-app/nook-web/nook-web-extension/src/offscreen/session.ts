import initNookWasm, {
  configureVaultApplication,
  NookVaultManager,
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
    default:
      return undefined
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
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
