import {
  decodePasskeySetupResponse,
  decodePasskeyUnlockResponse,
  type PasskeySetupResponse,
  type PasskeyUnlockResponse,
} from './passkey-session-response'
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
import {
  type ExtensionSessionQueue,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../offscreen/session-request-adapter'

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

enum ExtensionRuntimeRequestType {
  EnsureRuntime = 'nook:ensure-extension-session-runtime',
  Status = 'nook:extension-session-status',
  BeginPasskeySetup = 'nook:extension-session-begin-passkey-setup',
  FinishPasskeySetup = 'nook:extension-session-finish-passkey-setup',
  RecoverPasskey = 'nook:extension-session-recover-passkey',
  UnlockOptions = 'nook:extension-session-unlock-options',
  UnlockPasskey = 'nook:extension-session-unlock-passkey',
  CreatePin = 'nook:extension-session-create-pin',
  UnlockPin = 'nook:extension-session-unlock-pin',
}

type ExtensionControlPayload = { queue: ExtensionSessionQueue }
type ExtensionStatusRequest = {
  type: ExtensionRuntimeRequestType.Status
  payload: ExtensionControlPayload
}
type ExtensionBeginPasskeySetupRequest = {
  type: ExtensionRuntimeRequestType.BeginPasskeySetup
  payload: ExtensionControlPayload
}
type ExtensionFinishPasskeySetupRequest = {
  type: ExtensionRuntimeRequestType.FinishPasskeySetup
  payload: {
    credentialId: number[]
    userHandle: number[]
    prfInput: number[]
    prfOutput: number[]
    deviceMode: DeviceMode
    queue: ExtensionSessionQueue
  }
}
type ExtensionRecoverPasskeyRequest = {
  type: ExtensionRuntimeRequestType.RecoverPasskey
  payload: {
    credentialId: number[]
    userHandle: number[]
    prfOutput: number[]
    queue: ExtensionSessionQueue
  }
}
type ExtensionUnlockOptionsRequest = {
  type: ExtensionRuntimeRequestType.UnlockOptions
  payload: ExtensionControlPayload
}
type ExtensionUnlockPasskeyRequest = {
  type: ExtensionRuntimeRequestType.UnlockPasskey
  payload: { prfOutput: number[]; queue: ExtensionSessionQueue }
}
type ExtensionCreatePinRequest = {
  type: ExtensionRuntimeRequestType.CreatePin
  payload: { pin: string; queue: ExtensionSessionQueue }
}
type ExtensionUnlockPinRequest = {
  type: ExtensionRuntimeRequestType.UnlockPin
  payload: { pin: string; queue: ExtensionSessionQueue }
}

type ExtensionSessionRequest =
  | ExtensionStatusRequest
  | ExtensionBeginPasskeySetupRequest
  | ExtensionFinishPasskeySetupRequest
  | ExtensionRecoverPasskeyRequest
  | ExtensionUnlockOptionsRequest
  | ExtensionUnlockPasskeyRequest
  | ExtensionCreatePinRequest
  | ExtensionUnlockPinRequest

type ExtensionRuntimeRequest =
  { type: ExtensionRuntimeRequestType.EnsureRuntime } | ExtensionSessionRequest

type ExtensionDeviceResponse = { device: ExtensionDeviceProtectionResult }
type ExtensionStatusResponse = ExtensionDeviceResponse & { status: number }
type ExtensionSessionResponseByType = {
  [ExtensionRuntimeRequestType.Status]: ExtensionStatusResponse
  [ExtensionRuntimeRequestType.BeginPasskeySetup]: PasskeySetupResponse
  [ExtensionRuntimeRequestType.FinishPasskeySetup]: ExtensionDeviceResponse
  [ExtensionRuntimeRequestType.RecoverPasskey]: ExtensionDeviceResponse
  [ExtensionRuntimeRequestType.UnlockOptions]: PasskeyUnlockResponse
  [ExtensionRuntimeRequestType.UnlockPasskey]: ExtensionDeviceResponse
  [ExtensionRuntimeRequestType.CreatePin]: ExtensionDeviceResponse
  [ExtensionRuntimeRequestType.UnlockPin]: ExtensionDeviceResponse
}

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
  }
}

function runtimeMessage(message: ExtensionRuntimeRequest): Promise<object> {
  // Promise owns this callback's resolve and reject signature.
  // eslint-disable-next-line max-params
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (runtimeResponse: object) => {
      if (chrome.runtime.lastError?.message) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (
        !runtimeResponse ||
        typeof runtimeResponse !== 'object' ||
        Array.isArray(runtimeResponse)
      ) {
        reject(new Error('Extension session returned a malformed response.'))
        return
      }
      resolve(runtimeResponse)
    })
  })
}

async function sessionResponse<Request extends ExtensionSessionRequest>(
  message: Request,
): Promise<ExtensionSessionResponseByType[Request['type']]> {
  const runtimeRequest: ExtensionRuntimeRequest = {
    type: ExtensionRuntimeRequestType.EnsureRuntime,
  }
  const runtime = await runtimeMessage(runtimeRequest)
  if (!('ok' in runtime) || runtime.ok !== true) {
    throw new Error(
      'reason' in runtime && typeof runtime.reason === 'string'
        ? runtime.reason
        : 'Extension session runtime could not start.',
    )
  }
  const response = await runtimeMessage(message)
  if (!('ok' in response) || response.ok !== true) {
    throw new Error(
      'error' in response && typeof response.error === 'string'
        ? response.error
        : 'Extension session operation failed.',
    )
  }
  return response as ExtensionSessionResponseByType[Request['type']]
}

function deviceProtectionStatus(value: number): DeviceProtectionStatus {
  if (typeof value !== 'number') {
    throw new Error('Unsupported extension device protection status.')
  }
  switch (value) {
    case DeviceProtectionStatus.Error:
    case DeviceProtectionStatus.Loading:
    case DeviceProtectionStatus.Missing:
    case DeviceProtectionStatus.Passkey:
    case DeviceProtectionStatus.Pin:
    case DeviceProtectionStatus.PinSetup:
    case DeviceProtectionStatus.Plaintext:
    case DeviceProtectionStatus.Unlocked:
      return value
    default:
      throw new Error('Unsupported extension device protection status.')
  }
}

function extensionDevice(
  value: ExtensionDeviceProtectionResult,
): ExtensionDeviceProtectionResult {
  if (!value) {
    throw new Error('Extension session did not return device identity.')
  }
  const device = value
  if (
    typeof device.deviceId !== 'string' ||
    device.deviceId.length === 0 ||
    typeof device.devicePublicKey !== 'string' ||
    device.devicePublicKey.length === 0 ||
    typeof device.deviceSigningPublicKey !== 'string' ||
    device.deviceSigningPublicKey.length === 0
  ) {
    throw new Error('Extension session returned malformed device identity.')
  }
  return {
    deviceId: device.deviceId,
    devicePublicKey: device.devicePublicKey,
    deviceSigningPublicKey: device.deviceSigningPublicKey,
  }
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
  error: object
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
  options: CredentialRequestOptions,
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
    const credential = await navigator.credentials.get(options)
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey get ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    const capturedError =
      error instanceof Object ? error : new Error('Passkey get failed.')
    const args: PasskeyErrorArgs = {
      error: capturedError,
      action: PasskeyOperation.Get,
    }
    throw passkeyError(args)
  }
}

async function createPasskey(
  options: CredentialCreationOptions,
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
    const credential = await navigator.credentials.create(options)
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey create ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    const capturedError =
      error instanceof Object ? error : new Error('Passkey create failed.')
    const args: PasskeyErrorArgs = {
      error: capturedError,
      action: PasskeyOperation.Create,
    }
    throw passkeyError(args)
  }
}

export async function extensionDeviceProtectionStatus(): Promise<DeviceProtectionStatus> {
  const request: ExtensionStatusRequest = {
    type: ExtensionRuntimeRequestType.Status,
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = await sessionResponse(request)
  const deviceStatus = deviceProtectionStatus(response.status)
  switch (deviceStatus) {
    case DeviceProtectionStatus.Missing:
    case DeviceProtectionStatus.Plaintext:
    case DeviceProtectionStatus.Passkey:
    case DeviceProtectionStatus.Pin:
    case DeviceProtectionStatus.Unlocked:
      return deviceStatus
    case DeviceProtectionStatus.Loading:
    case DeviceProtectionStatus.PinSetup:
    case DeviceProtectionStatus.Error:
      throw new Error(
        `Unsupported extension device protection status: ${deviceStatus}`,
      )
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
  const request: ExtensionStatusRequest = {
    type: ExtensionRuntimeRequestType.Status,
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = await sessionResponse(request)
  const status = deviceProtectionStatus(response.status)
  if (status !== DeviceProtectionStatus.Unlocked) {
    return { kind: ExtensionSessionDeviceStateKind.Locked }
  }
  return {
    kind: ExtensionSessionDeviceStateKind.Active,
    device: extensionDevice(response.device),
  }
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
  const beginRequest: ExtensionBeginPasskeySetupRequest = {
    type: ExtensionRuntimeRequestType.BeginPasskeySetup,
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const setup = decodePasskeySetupResponse(await sessionResponse(beginRequest))
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
  const finishRequest: ExtensionFinishPasskeySetupRequest = {
    type: ExtensionRuntimeRequestType.FinishPasskeySetup,
    payload: {
      credentialId: credentialId(created),
      userHandle: setup.userHandle,
      prfInput: setup.prfInput,
      prfOutput: prfOutput(asserted),
      deviceMode,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const finishResponse = await sessionResponse(finishRequest)
  return extensionDevice(finishResponse.device)
}

export async function recoverExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const options = buildPasskeyRecoveryRequestOptions('')
  const credential = await getPasskey(options)
  const request: ExtensionRecoverPasskeyRequest = {
    type: ExtensionRuntimeRequestType.RecoverPasskey,
    payload: {
      credentialId: credentialId(credential),
      userHandle: assertionUserHandle(credential),
      prfOutput: prfOutput(credential),
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sessionResponse(request)
  return extensionDevice(response.device)
}

export async function unlockExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const optionsRequest: ExtensionUnlockOptionsRequest = {
    type: ExtensionRuntimeRequestType.UnlockOptions,
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const material = decodePasskeyUnlockResponse(
    await sessionResponse(optionsRequest),
  )
  const options = buildPasskeyPrfRequestOptions(
    '',
    new Uint8Array(material.credentialId),
    new Uint8Array(material.prfInput),
  )
  const credential = await getPasskey(options)
  const request: ExtensionUnlockPasskeyRequest = {
    type: ExtensionRuntimeRequestType.UnlockPasskey,
    payload: {
      prfOutput: prfOutput(credential),
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sessionResponse(request)
  return extensionDevice(response.device)
}

export async function createExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  const request: ExtensionCreatePinRequest = {
    type: ExtensionRuntimeRequestType.CreatePin,
    payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = await sessionResponse(request)
  return extensionDevice(response.device)
}

export async function unlockExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  const request: ExtensionUnlockPinRequest = {
    type: ExtensionRuntimeRequestType.UnlockPin,
    payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = await sessionResponse(request)
  return extensionDevice(response.device)
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
