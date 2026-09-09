import {
  type PasskeySetupResponse,
  type PasskeyUnlockResponse,
  PasskeySetupResponse as PasskeySetupResponseSchema,
  PasskeyUnlockResponse as PasskeyUnlockResponseSchema,
} from './passkey-session-response'
import { ExtensionRuntimeRequestType } from './extension-runtime-request-type'
import { ExtensionSessionMessageType } from './extension-session-message-type'
import {
  default as initNookWasm,
  build_passkey_creation_options,
  build_passkey_prf_request_options,
  build_passkey_recovery_request_options,
  configure_vault_application,
  default_password_generation_options,
  default_translation_catalog,
  DeviceMode,
  DeviceProtectionStatus,
  generate_password,
  get_translation_catalog,
  NookAppLocaleParse,
  parse_app_locale,
  resolve_app_locale_from_tags,
  resolve_translation_catalog,
  supported_app_locale_code,
  VaultApplication,
  type NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  type ExtensionSessionQueue,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../offscreen/session-request-adapter'
import {
  PasskeyOperation,
  PasskeyCeremonyFailure,
} from './passkey-ceremony-error'

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

export type ExtensionDeviceProtectionResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type ExtensionControlPayload = { queue: ExtensionSessionQueue }

type ExtensionStatusRequest = {
  type: ExtensionSessionMessageType.Status
  payload: ExtensionControlPayload
}

type ExtensionBeginPasskeySetupRequest = {
  type: ExtensionSessionMessageType.BeginPasskeySetup
  payload: ExtensionControlPayload
}

type ExtensionFinishPasskeySetupRequest = {
  type: ExtensionSessionMessageType.FinishPasskeySetup
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
  type: ExtensionSessionMessageType.RecoverPasskey
  payload: {
    credentialId: number[]
    userHandle: number[]
    prfOutput: number[]
    queue: ExtensionSessionQueue
  }
}

type ExtensionUnlockOptionsRequest = {
  type: ExtensionSessionMessageType.UnlockOptions
  payload: ExtensionControlPayload
}

type ExtensionUnlockPasskeyRequest = {
  type: ExtensionSessionMessageType.UnlockPasskey
  payload: { prfOutput: number[]; queue: ExtensionSessionQueue }
}

type ExtensionCreatePinRequest = {
  type: ExtensionSessionMessageType.CreatePin
  payload: { pin: string; queue: ExtensionSessionQueue }
}

type ExtensionUnlockPinRequest = {
  type: ExtensionSessionMessageType.UnlockPin
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
  [ExtensionSessionMessageType.Status]: ExtensionStatusResponse
  [ExtensionSessionMessageType.BeginPasskeySetup]: PasskeySetupResponse
  [ExtensionSessionMessageType.FinishPasskeySetup]: ExtensionDeviceResponse
  [ExtensionSessionMessageType.RecoverPasskey]: ExtensionDeviceResponse
  [ExtensionSessionMessageType.UnlockOptions]: PasskeyUnlockResponse
  [ExtensionSessionMessageType.UnlockPasskey]: ExtensionDeviceResponse
  [ExtensionSessionMessageType.CreatePin]: ExtensionDeviceResponse
  [ExtensionSessionMessageType.UnlockPin]: ExtensionDeviceResponse
}

type ExtensionSessionSuccess = {
  [RequestType in keyof ExtensionSessionResponseByType]: {
    ok: true
  } & ExtensionSessionResponseByType[RequestType]
}[keyof ExtensionSessionResponseByType]

type ExtensionRuntimeResponse =
  | { ok: true }
  | ExtensionSessionSuccess
  | { ok: false; reason: string }
  | { ok: false; error: string }

type ExtensionSessionRuntimeResponse<Request extends ExtensionSessionRequest> =
  | ({ ok: true } & ExtensionSessionResponseByType[Request['type']])
  | { ok: false; error: string }

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
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

export type CreateExtensionPasskeyArgs = {
  passkeyLabel: string
  deviceMode: DeviceMode
}

export type ExtensionAppLocaleCandidates = string[]

enum WasmCatalogReadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

type WasmCatalogRead =
  | { kind: WasmCatalogReadKind.Available; catalog: string }
  | { kind: WasmCatalogReadKind.Unavailable }

/** Owns the browser runtime resources shared by these interactions. */
class ExtensionWasmRuntime {
  private extensionWasmStartup: ExtensionWasmStartup = {
    kind: ExtensionWasmStartupKind.NotStarted,
  }
  ensureNookWasm() {
    if (
      this.extensionWasmStartup.kind === ExtensionWasmStartupKind.Initializing
    ) {
      return this.extensionWasmStartup.operation
    }
    const operation = initNookWasm().then((value) => {
      configure_vault_application(VaultApplication.Extension)
      return value
    })
    this.extensionWasmStartup = {
      kind: ExtensionWasmStartupKind.Initializing,
      operation,
    }
    return operation
  }

  private runtimeMessage(
    message: ExtensionRuntimeRequest,
  ): Promise<ExtensionRuntimeResponse> {
    // Promise owns this callback's resolve and reject signature.
    // eslint-disable-next-line max-params
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        message,
        (runtimeResponse: ExtensionRuntimeResponse) => {
          if (chrome.runtime.lastError?.message) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          if (
            !runtimeResponse ||
            typeof runtimeResponse !== 'object' ||
            Array.isArray(runtimeResponse)
          ) {
            reject(
              new Error('Extension session returned a malformed response.'),
            )
            return
          }
          resolve(runtimeResponse)
        },
      )
    })
  }

  private extensionSessionRuntimeMessage<
    ExtensionSessionMessage extends ExtensionSessionRequest,
  >(
    message: ExtensionSessionMessage,
  ): Promise<ExtensionSessionRuntimeResponse<ExtensionSessionMessage>> {
    return this.runtimeMessage(message) as Promise<
      ExtensionSessionRuntimeResponse<ExtensionSessionMessage>
    >
  }

  private async sessionResponse<
    ExtensionSessionMessage extends ExtensionSessionRequest,
  >(
    message: ExtensionSessionMessage,
  ): Promise<ExtensionSessionResponseByType[ExtensionSessionMessage['type']]> {
    const runtimeRequest: ExtensionRuntimeRequest = {
      type: ExtensionRuntimeRequestType.EnsureRuntime,
    }
    const runtime = await this.runtimeMessage(runtimeRequest)
    if (!('ok' in runtime) || runtime.ok !== true) {
      throw new Error(
        'reason' in runtime && typeof runtime.reason === 'string'
          ? runtime.reason
          : 'Extension session runtime could not start.',
      )
    }
    const response = await this.extensionSessionRuntimeMessage(message)
    if (!('ok' in response) || response.ok !== true) {
      throw new Error(
        'error' in response && typeof response.error === 'string'
          ? response.error
          : 'Extension session operation failed.',
      )
    }
    return response
  }

  private deviceProtectionStatus(value: number): DeviceProtectionStatus {
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

  private extensionDevice(
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

  private bytes(value: ArrayBuffer | ArrayBufferView): number[] {
    return Array.from(
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    )
  }

  private credentialId(credential: PublicKeyCredential): number[] {
    return this.bytes(credential.rawId)
  }

  private assertionUserHandle(credential: PublicKeyCredential): number[] {
    const response = credential.response as AuthenticatorAssertionResponse
    if (!response.userHandle) {
      throw new Error('Passkey assertion did not include its user handle.')
    }
    return this.bytes(response.userHandle)
  }

  private prfOutput(credential: PublicKeyCredential): number[] {
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
    return this.bytes(prf.results.first)
  }

  private async getPasskey(
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
      const args: ConstructorParameters<typeof PasskeyCeremonyFailure>[0] = {
        error,
        action: PasskeyOperation.Get,
      }
      throw new PasskeyCeremonyFailure(args).error
    }
  }

  private async createPasskey(
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
      const args: ConstructorParameters<typeof PasskeyCeremonyFailure>[0] = {
        error,
        action: PasskeyOperation.Create,
      }
      throw new PasskeyCeremonyFailure(args).error
    }
  }

  async extensionDeviceProtectionStatus(): Promise<DeviceProtectionStatus> {
    const request: ExtensionStatusRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response = await this.sessionResponse(request)
    const deviceStatus = this.deviceProtectionStatus(response.status)
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

  async extensionSessionDevice(): Promise<ExtensionSessionDeviceState> {
    const request: ExtensionStatusRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response = await this.sessionResponse(request)
    const status = this.deviceProtectionStatus(response.status)
    if (status !== DeviceProtectionStatus.Unlocked) {
      return { kind: ExtensionSessionDeviceStateKind.Locked }
    }
    return {
      kind: ExtensionSessionDeviceStateKind.Active,
      device: this.extensionDevice(response.device),
    }
  }

  async createExtensionPasskey(
    args: CreateExtensionPasskeyArgs,
  ): Promise<ExtensionDeviceProtectionResult> {
    const { passkeyLabel, deviceMode } = args
    await this.ensureNookWasm()
    const beginRequest: ExtensionBeginPasskeySetupRequest = {
      type: ExtensionSessionMessageType.BeginPasskeySetup,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const setup = PasskeySetupResponseSchema.decodePasskeySetupResponse(
      await this.sessionResponse(beginRequest),
    )
    const creationOptions = build_passkey_creation_options(
      '',
      'Nook Extension',
      passkeyLabel,
      new Uint8Array(setup.userHandle),
      new Uint8Array(setup.prfInput),
    )
    const created = await this.createPasskey(creationOptions)
    const prfRequest = build_passkey_prf_request_options(
      '',
      new Uint8Array(this.credentialId(created)),
      new Uint8Array(setup.prfInput),
    )
    const asserted = await this.getPasskey(prfRequest)
    const finishRequest: ExtensionFinishPasskeySetupRequest = {
      type: ExtensionSessionMessageType.FinishPasskeySetup,
      payload: {
        credentialId: this.credentialId(created),
        userHandle: setup.userHandle,
        prfInput: setup.prfInput,
        prfOutput: this.prfOutput(asserted),
        deviceMode,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const finishResponse = await this.sessionResponse(finishRequest)
    return this.extensionDevice(finishResponse.device)
  }

  async recoverExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
    await this.ensureNookWasm()
    const options = build_passkey_recovery_request_options('')
    const credential = await this.getPasskey(options)
    const request: ExtensionRecoverPasskeyRequest = {
      type: ExtensionSessionMessageType.RecoverPasskey,
      payload: {
        credentialId: this.credentialId(credential),
        userHandle: this.assertionUserHandle(credential),
        prfOutput: this.prfOutput(credential),
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const response = await this.sessionResponse(request)
    return this.extensionDevice(response.device)
  }

  async unlockExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
    await this.ensureNookWasm()
    const optionsRequest: ExtensionUnlockOptionsRequest = {
      type: ExtensionSessionMessageType.UnlockOptions,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const material = PasskeyUnlockResponseSchema.decodePasskeyUnlockResponse(
      await this.sessionResponse(optionsRequest),
    )
    const options = build_passkey_prf_request_options(
      '',
      new Uint8Array(material.credentialId),
      new Uint8Array(material.prfInput),
    )
    const credential = await this.getPasskey(options)
    const request: ExtensionUnlockPasskeyRequest = {
      type: ExtensionSessionMessageType.UnlockPasskey,
      payload: {
        prfOutput: this.prfOutput(credential),
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const response = await this.sessionResponse(request)
    return this.extensionDevice(response.device)
  }

  async createExtensionPin(
    pin: string,
  ): Promise<ExtensionDeviceProtectionResult> {
    const request: ExtensionCreatePinRequest = {
      type: ExtensionSessionMessageType.CreatePin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response = await this.sessionResponse(request)
    return this.extensionDevice(response.device)
  }

  async unlockExtensionPin(
    pin: string,
  ): Promise<ExtensionDeviceProtectionResult> {
    const request: ExtensionUnlockPinRequest = {
      type: ExtensionSessionMessageType.UnlockPin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response = await this.sessionResponse(request)
    return this.extensionDevice(response.device)
  }

  async generateSuggestedPassword(): Promise<string> {
    await this.ensureNookWasm()
    return generate_password(default_password_generation_options())
  }

  async parseStoredAppLocale(
    input: StoredAppLocaleInput,
  ): Promise<StoredAppLocaleParse> {
    await this.ensureNookWasm()
    if (input.kind === StoredAppLocaleInputKind.Missing) {
      return { kind: StoredAppLocaleParseKind.Unsupported }
    }
    const parsed = parse_app_locale(input.value)
    return parsed === NookAppLocaleParse.Unsupported
      ? { kind: StoredAppLocaleParseKind.Unsupported }
      : {
          kind: StoredAppLocaleParseKind.Supported,
          locale: supported_app_locale_code(parsed) as NookAppLocale,
        }
  }

  async selectExtensionAppLocale(
    tags: ExtensionAppLocaleCandidates,
  ): Promise<NookAppLocale> {
    await this.ensureNookWasm()
    return resolve_app_locale_from_tags(tags) as NookAppLocale
  }

  async getResolvedTranslationCatalog(locale: NookAppLocale): Promise<string> {
    await this.ensureNookWasm()
    const catalog = this.readWasmCatalog(locale)
    return catalog.kind === WasmCatalogReadKind.Available
      ? resolve_translation_catalog(locale, catalog.catalog)
      : default_translation_catalog(locale)
  }

  private readWasmCatalog(locale: NookAppLocale): WasmCatalogRead {
    try {
      return {
        kind: WasmCatalogReadKind.Available,
        catalog: get_translation_catalog(locale),
      }
    } catch {
      return { kind: WasmCatalogReadKind.Unavailable }
    }
  }
}

export const extensionWasmRuntime = new ExtensionWasmRuntime()
