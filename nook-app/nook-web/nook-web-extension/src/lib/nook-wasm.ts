import type { ExternalObject, ExternalValue } from './external-value'
import {
  default as initNookWasm,
  buildPasskeyCreationOptions,
  buildPasskeyPrfRequestOptions,
  buildPasskeyRecoveryRequestOptions,
  configureVaultApplication,
  defaultPasswordGenerationOptions as wasmDefaultPasswordGenerationOptions,
  defaultTranslationCatalog as wasmDefaultTranslationCatalog,
  DeviceMode,
  DeviceProtectionStatus,
  generatePassword as wasmGeneratePassword,
  get_translation_catalog as wasmGetTranslationCatalog,
  NookAppLocaleParse,
  parseAppLocale as wasmParseAppLocale,
  resolveAppLocaleFromTags as wasmResolveAppLocaleFromTags,
  resolveTranslationCatalog as wasmResolveTranslationCatalog,
  supportedAppLocaleCode,
  VaultApplication,
  type NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

enum ExtensionWasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type ExtensionWasmStartup =
  | { kind: ExtensionWasmStartupKind.NotStarted }
  | {
      kind: ExtensionWasmStartupKind.Initializing
      operation: ReturnType<typeof initNookWasm>
    }

let extensionWasmStartup: ExtensionWasmStartup = {
  kind: ExtensionWasmStartupKind.NotStarted,
}

export type { NookAppLocale } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
export { DeviceMode, DeviceProtectionStatus }

export enum StoredAppLocaleInputKind {
  Missing = 'missing',
  Stored = 'stored',
}

export type StoredAppLocaleInput =
  | { kind: StoredAppLocaleInputKind.Missing }
  | { kind: StoredAppLocaleInputKind.Stored; value: string }

export enum StoredAppLocaleParseKind {
  Unsupported = 'unsupported',
  Supported = 'supported',
}

export type StoredAppLocaleParse =
  | { kind: StoredAppLocaleParseKind.Unsupported }
  | { kind: StoredAppLocaleParseKind.Supported; locale: NookAppLocale }

export function ensureNookWasm() {
  if (extensionWasmStartup.kind === ExtensionWasmStartupKind.Initializing) {
    return extensionWasmStartup.operation
  }
  const operation = initNookWasm().then((value) => {
    configureVaultApplication(VaultApplication.Extension)
    return value
  })
  extensionWasmStartup = {
    kind: ExtensionWasmStartupKind.Initializing,
    operation,
  }
  return operation
}

export type ExtensionDeviceProtectionResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type SessionResponse<T> = { ok: true } & T

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
  }
}

function runtimeMessage<T>(message: ExternalValue): Promise<T> {
  return new Promise((resolve, reject) => {
    // Chrome owns this callback's response and sender signature.
    // eslint-disable-next-line max-params
    chrome.runtime.sendMessage(message, (response: ExternalValue) => {
      if (chrome.runtime.lastError?.message) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response) {
        reject(new Error('Extension session did not respond.'))
        return
      }
      resolve(response as T)
    })
  })
}

async function sessionMessage<T>(message: ExternalValue): Promise<T> {
  const runtimeRequest: ExternalObject = {
    type: 'nook:ensure-extension-session-runtime',
  }
  const runtime = await runtimeMessage<{ ok?: boolean; reason?: string }>(
    runtimeRequest,
  )
  if (runtime.ok !== true) {
    throw new Error(
      runtime.reason ?? 'Extension session runtime could not start.',
    )
  }
  const response = await runtimeMessage<{ ok?: boolean; error?: string } & T>(
    message,
  )
  if (response.ok !== true) {
    throw new Error(response.error ?? 'Extension session operation failed.')
  }
  return response
}

function bytes(value: ArrayBuffer | ArrayBufferView): number[] {
  return Array.from(
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  )
}

function credentialId(credential: PublicKeyCredential): number[] {
  return bytes(credential.rawId)
}

function assertionUserHandle(credential: PublicKeyCredential): number[] {
  const response = credential.response as AuthenticatorAssertionResponse
  if (!response.userHandle) {
    throw new Error('Passkey assertion did not include its user handle.')
  }
  return bytes(response.userHandle)
}

function prfOutput(credential: PublicKeyCredential): number[] {
  const prf = (
    credential as PublicKeyCredentialWithPrf
  ).getClientExtensionResults().prf
  // `enabled` reports registration support; assertion results are authoritative
  // when the browser returns the requested PRF output.
  if (!prf?.results?.first) {
    throw new Error(
      'PASSKEY_PRF_UNAVAILABLE: The passkey did not return the required PRF output.',
    )
  }
  return bytes(prf.results.first)
}

enum PasskeyOperation {
  Create = 'create',
  Get = 'get',
}

type PasskeyErrorArgs = {
  error: ExternalValue
  action: PasskeyOperation
}

function passkeyError(args: PasskeyErrorArgs): Error {
  const { error, action } = args
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error(
      `PASSKEY_CEREMONY_NOT_ALLOWED: Passkey ${action} request did not finish.`,
    )
  }
  return error instanceof Error
    ? error
    : new Error(`Passkey ${action} ceremony failed.`)
}

async function getPasskey(
  options: ExternalValue,
): Promise<PublicKeyCredentialWithPrf> {
  if (
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    throw new Error(
      'PASSKEY_UNAVAILABLE: Passkeys are not available in this browser.',
    )
  }
  try {
    const credential = await navigator.credentials.get(
      options as CredentialRequestOptions,
    )
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey get ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    const args: PasskeyErrorArgs = {
      error: error as ExternalValue,
      action: PasskeyOperation.Get,
    }
    throw passkeyError(args)
  }
}

async function createPasskey(
  options: ExternalValue,
): Promise<PublicKeyCredentialWithPrf> {
  if (
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    throw new Error(
      'PASSKEY_UNAVAILABLE: Passkeys are not available in this browser.',
    )
  }
  try {
    const credential = await navigator.credentials.create(
      options as CredentialCreationOptions,
    )
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey create ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    const args: PasskeyErrorArgs = {
      error: error as ExternalValue,
      action: PasskeyOperation.Create,
    }
    throw passkeyError(args)
  }
}

export async function extensionDeviceProtectionStatus(): Promise<DeviceProtectionStatus> {
  const request: ExternalObject = { type: 'nook:extension-session-status' }
  const { status } =
    await sessionMessage<SessionResponse<{ status: ExternalValue }>>(request)
  switch (status) {
    case DeviceProtectionStatus.Missing:
    case DeviceProtectionStatus.Plaintext:
    case DeviceProtectionStatus.Passkey:
    case DeviceProtectionStatus.Pin:
    case DeviceProtectionStatus.Unlocked:
      return status
    case DeviceProtectionStatus.Loading:
    case DeviceProtectionStatus.PinSetup:
    case DeviceProtectionStatus.Error:
      throw new Error(
        `Unsupported extension device protection status: ${status}`,
      )
    default:
      throw new Error('Unsupported extension device protection status.')
  }
}

export enum ExtensionSessionDeviceStateKind {
  Locked = 'locked',
  Active = 'active',
}

export type ExtensionSessionDeviceState =
  | { kind: ExtensionSessionDeviceStateKind.Locked }
  | {
      kind: ExtensionSessionDeviceStateKind.Active
      device: ExtensionDeviceProtectionResult
    }

export async function extensionSessionDevice(): Promise<ExtensionSessionDeviceState> {
  const request: ExternalObject = { type: 'nook:extension-session-status' }
  const response = await sessionMessage<
    SessionResponse<{
      status: DeviceProtectionStatus
      device?: ExtensionDeviceProtectionResult
    }>
  >(request)
  return response.status === DeviceProtectionStatus.Unlocked && response.device
    ? { kind: ExtensionSessionDeviceStateKind.Active, device: response.device }
    : { kind: ExtensionSessionDeviceStateKind.Locked }
}

export type CreateExtensionPasskeyArgs = {
  passkeyLabel: string
  deviceMode: DeviceMode
}

export async function createExtensionPasskey(
  args: CreateExtensionPasskeyArgs,
): Promise<ExtensionDeviceProtectionResult> {
  const { passkeyLabel, deviceMode } = args
  await ensureNookWasm()
  const beginRequest: ExternalObject = {
    type: 'nook:extension-session-begin-passkey-setup',
  }
  const { setup } = await sessionMessage<
    SessionResponse<{
      setup: {
        userHandle: number[]
        prfInput: number[]
      }
    }>
  >(beginRequest)
  const creationOptions = buildPasskeyCreationOptions(
    '',
    'Nook Extension',
    passkeyLabel,
    new Uint8Array(setup.userHandle),
    new Uint8Array(setup.prfInput),
  )
  const created = await createPasskey(creationOptions)
  const prfRequest = buildPasskeyPrfRequestOptions(
    '',
    new Uint8Array(credentialId(created)),
    new Uint8Array(setup.prfInput),
  )
  const asserted = await getPasskey(prfRequest)
  const finishRequest: ExternalObject = {
    type: 'nook:extension-session-finish-passkey-setup',
    payload: {
      credentialId: credentialId(created),
      userHandle: setup.userHandle,
      prfInput: setup.prfInput,
      prfOutput: prfOutput(asserted),
      deviceMode,
    },
  }
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >(finishRequest)
  ).device
}

export async function recoverExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const options = buildPasskeyRecoveryRequestOptions('')
  const credential = await getPasskey(options)
  const request: ExternalObject = {
    type: 'nook:extension-session-recover-passkey',
    payload: {
      credentialId: credentialId(credential),
      userHandle: assertionUserHandle(credential),
      prfOutput: prfOutput(credential),
    },
  }
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >(request)
  ).device
}

export async function unlockExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const optionsRequest: ExternalObject = {
    type: 'nook:extension-session-unlock-options',
  }
  const { material } = await sessionMessage<
    SessionResponse<{
      material: { credentialId: number[]; prfInput: number[] }
    }>
  >(optionsRequest)
  const options = buildPasskeyPrfRequestOptions(
    '',
    new Uint8Array(material.credentialId),
    new Uint8Array(material.prfInput),
  )
  const credential = await getPasskey(options)
  const request: ExternalObject = {
    type: 'nook:extension-session-unlock-passkey',
    payload: { prfOutput: prfOutput(credential) },
  }
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >(request)
  ).device
}

export async function createExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  const request: ExternalObject = {
    type: 'nook:extension-session-create-pin',
    payload: { pin },
  }
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >(request)
  ).device
}

export async function unlockExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  const request: ExternalObject = {
    type: 'nook:extension-session-unlock-pin',
    payload: { pin },
  }
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >(request)
  ).device
}

export async function generateSuggestedPassword(): Promise<string> {
  await ensureNookWasm()
  return wasmGeneratePassword(wasmDefaultPasswordGenerationOptions())
}

export async function parseStoredAppLocale(
  input: StoredAppLocaleInput,
): Promise<StoredAppLocaleParse> {
  await ensureNookWasm()
  if (input.kind === StoredAppLocaleInputKind.Missing) {
    return { kind: StoredAppLocaleParseKind.Unsupported }
  }
  const parsed = wasmParseAppLocale(input.value)
  return parsed === NookAppLocaleParse.Unsupported
    ? { kind: StoredAppLocaleParseKind.Unsupported }
    : {
        kind: StoredAppLocaleParseKind.Supported,
        locale: supportedAppLocaleCode(parsed) as NookAppLocale,
      }
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
  const catalog = readWasmCatalog(locale)
  return catalog.kind === WasmCatalogReadKind.Available
    ? wasmResolveTranslationCatalog(locale, catalog.catalog)
    : wasmDefaultTranslationCatalog(locale)
}

enum WasmCatalogReadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

type WasmCatalogRead =
  | { kind: WasmCatalogReadKind.Available; catalog: string }
  | { kind: WasmCatalogReadKind.Unavailable }

function readWasmCatalog(locale: NookAppLocale): WasmCatalogRead {
  try {
    return {
      kind: WasmCatalogReadKind.Available,
      catalog: wasmGetTranslationCatalog(locale),
    }
  } catch {
    return { kind: WasmCatalogReadKind.Unavailable }
  }
}
