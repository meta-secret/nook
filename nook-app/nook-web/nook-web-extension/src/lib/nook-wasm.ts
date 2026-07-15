import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
  type PasswordGenerationOptions,
} from '../../../nook-web-shared/src/password/generator'
import {
  default as initNookWasm,
  configureVaultApplication,
  generatePassword as wasmGeneratePassword,
  get_translation_catalog as wasmGetTranslationCatalog,
  NookVaultManager,
  parseAppLocale as wasmParseAppLocale,
  resolveAppLocaleFromTags as wasmResolveAppLocaleFromTags,
  resolveTranslationCatalog as wasmResolveTranslationCatalog,
  translateFromCatalog as wasmTranslateFromCatalog,
  type NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

let initPromise: Promise<unknown> | undefined

export type { NookAppLocale }

export function ensureNookWasm() {
  initPromise ??= initNookWasm().then((value) => {
    configureVaultApplication('extension')
    return value
  })
  return initPromise
}

export type ExtensionDeviceProtectionResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type ExtensionDeviceIdentityHandoff = {
  identitySecret: string
}

export type ExtensionDeviceProtectionStatus =
  | 'missing'
  | 'plaintext'
  | 'passkey'
  | 'pin'
  | 'unlocked'

export type ExtensionDeviceMode = 'standard' | 'anti-hacker'

async function withDeviceManager<T>(
  action: (manager: NookVaultManager) => Promise<T>,
): Promise<T> {
  await ensureNookWasm()
  const manager = new NookVaultManager()
  try {
    return await action(manager)
  } finally {
    manager.free()
  }
}

async function deviceResult(
  manager: NookVaultManager,
): Promise<ExtensionDeviceProtectionResult> {
  return {
    deviceId: manager.device_id,
    devicePublicKey: manager.device_public_key,
    deviceSigningPublicKey: await manager.deviceSigningPublicKey(),
  }
}

export async function extensionDeviceProtectionStatus(): Promise<ExtensionDeviceProtectionStatus> {
  return withDeviceManager(async (manager) => {
    const status = await manager.deviceProtectionStatus()
    if (
      status === 'missing' ||
      status === 'plaintext' ||
      status === 'passkey' ||
      status === 'pin' ||
      status === 'unlocked'
    ) {
      return status
    }
    throw new Error(`Unsupported extension device protection status: ${status}`)
  })
}

export async function createExtensionPasskey(
  passkeyLabel: string,
  deviceMode: ExtensionDeviceMode,
): Promise<ExtensionDeviceProtectionResult> {
  return withDeviceManager(async (manager) => {
    await manager.setupDeviceProtectionWithPasskeyMode(
      '',
      'Nook Extension',
      passkeyLabel,
      deviceMode,
    )
    return deviceResult(manager)
  })
}

export async function recoverExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  return withDeviceManager(async (manager) => {
    await manager.recoverDeviceProtectionWithPasskey('')
    return deviceResult(manager)
  })
}

export async function unlockExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  return withDeviceManager(async (manager) => {
    await manager.unlockDeviceProtectionWithPasskey('')
    return deviceResult(manager)
  })
}

export async function createExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  return withDeviceManager(async (manager) => {
    await manager.finishPinDeviceProtection(pin)
    return deviceResult(manager)
  })
}

export async function unlockExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  return withDeviceManager(async (manager) => {
    await manager.unlockPinDeviceIdentity(pin)
    return deviceResult(manager)
  })
}

async function unlockedExtensionIdentityHandoff(
  unlock: (manager: NookVaultManager) => Promise<void>,
): Promise<ExtensionDeviceIdentityHandoff> {
  return withDeviceManager(async (manager) => {
    await unlock(manager)
    return {
      identitySecret: manager.exportExtensionDeviceIdentityForHandoff(),
    }
  })
}

export function unlockExtensionPasskeyForHandoff(): Promise<ExtensionDeviceIdentityHandoff> {
  return unlockedExtensionIdentityHandoff((manager) =>
    manager.unlockDeviceProtectionWithPasskey(''),
  )
}

export function unlockExtensionPinForHandoff(
  pin: string,
): Promise<ExtensionDeviceIdentityHandoff> {
  return unlockedExtensionIdentityHandoff((manager) =>
    manager.unlockPinDeviceIdentity(pin),
  )
}

export async function generateSuggestedPassword(
  options: PasswordGenerationOptions = defaultPasswordGenerationOptions,
): Promise<string> {
  await ensureNookWasm()
  return generatePasswordWithOptions(wasmGeneratePassword, options)
}

export async function parseStoredAppLocale(
  value: string | undefined,
): Promise<NookAppLocale | undefined> {
  await ensureNookWasm()
  return wasmParseAppLocale(value) as NookAppLocale | undefined
}

export async function resolveAppLocaleFromTags(
  tags: string[],
): Promise<NookAppLocale> {
  await ensureNookWasm()
  return wasmResolveAppLocaleFromTags(tags) as NookAppLocale
}

export async function getResolvedTranslationCatalog(
  locale: NookAppLocale,
): Promise<string> {
  await ensureNookWasm()
  let wasmCatalog: string | undefined
  try {
    wasmCatalog = wasmGetTranslationCatalog(locale)
  } catch {
    wasmCatalog = undefined
  }
  return wasmResolveTranslationCatalog(locale, wasmCatalog)
}

export function translateFromExtensionCatalog(
  catalog: string,
  locale: NookAppLocale,
  key: string,
): string {
  return wasmTranslateFromCatalog(catalog, locale, key)
}
