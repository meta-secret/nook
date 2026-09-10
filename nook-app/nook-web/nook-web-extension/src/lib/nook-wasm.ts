import { ExtensionSessionDeviceProtectionStatusWire as DeviceProtectionStatus } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionRuntimeRequestType } from './extension-runtime-request-type'
import { ExtensionSessionMessageType } from './extension-session-message-type'
import {
  default as initNookWasm,
  decode_passkey_setup_material_response,
  decode_passkey_unlock_material_response,
  build_passkey_creation_options,
  build_passkey_prf_request_options,
  build_passkey_recovery_request_options,
  configure_vault_application,
  default_password_generation_options,
  default_translation_catalog,
  DeviceMode,
  decode_extension_session_status_details,
  decode_extension_session_device_response,
  type ExtensionSessionOperationResponseWire,
  type ExtensionSessionDeviceWire,
  generate_password,
  get_translation_catalog,
  NookAppLocaleParse,
  parse_app_locale,
  type PasskeySetupMaterialResponse,
  type PasskeyUnlockMaterialResponse,
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

export type {
  ExtensionSessionDeviceWire,
  NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

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
      device: ExtensionSessionDeviceWire
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

  private runtimeMessage(message: ExtensionRuntimeRequest): Promise<unknown> {
    // Promise owns this callback's resolve and reject signature.
    // eslint-disable-next-line max-params
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (runtimeResponse: unknown) => {
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

  private async sessionResponse<Response>(
    message: ExtensionSessionRequest,
  ): Promise<Response> {
    await this.ensureNookWasm()
    const runtime = await this.runtimeMessage({
      type: ExtensionRuntimeRequestType.EnsureRuntime,
    })
    if (
      !runtime ||
      typeof runtime !== 'object' ||
      !('ok' in runtime) ||
      runtime.ok !== true
    ) {
      throw new Error(
        runtime &&
          typeof runtime === 'object' &&
          'reason' in runtime &&
          typeof runtime.reason === 'string'
          ? runtime.reason
          : 'Extension session runtime could not start.',
      )
    }
    const response = await this.runtimeMessage(message)
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true
    ) {
      throw new Error(
        response &&
          typeof response === 'object' &&
          'error' in response &&
          typeof response.error === 'string'
          ? response.error
          : 'Extension session operation failed.',
      )
    }
    return response as Response
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
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    const deviceStatus =
      decode_extension_session_status_details(response).status
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
      case DeviceProtectionStatus.Unknown:
        throw new Error(
          `Unsupported extension device protection status: ${deviceStatus}`,
        )
    }
    throw new Error('Unsupported extension device protection status.')
  }

  async extensionSessionDevice(): Promise<ExtensionSessionDeviceState> {
    const request: ExtensionStatusRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    const status = decode_extension_session_status_details(response)
    if (status.kind === 'inactive') {
      return { kind: ExtensionSessionDeviceStateKind.Locked }
    }
    return {
      kind: ExtensionSessionDeviceStateKind.Active,
      device: status.device,
    }
  }

  async createExtensionPasskey(
    args: CreateExtensionPasskeyArgs,
  ): Promise<ExtensionSessionDeviceWire> {
    const { passkeyLabel, deviceMode } = args
    await this.ensureNookWasm()
    const beginRequest: ExtensionBeginPasskeySetupRequest = {
      type: ExtensionSessionMessageType.BeginPasskeySetup,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const setupResponse =
      await this.sessionResponse<PasskeySetupMaterialResponse>(beginRequest)
    const setup = decode_passkey_setup_material_response(setupResponse)
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
    const finishResponse =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(
        finishRequest,
      )
    return decode_extension_session_device_response(finishResponse).device
  }

  async recoverExtensionPasskey(): Promise<ExtensionSessionDeviceWire> {
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
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    return decode_extension_session_device_response(response).device
  }

  async unlockExtensionPasskey(): Promise<ExtensionSessionDeviceWire> {
    await this.ensureNookWasm()
    const optionsRequest: ExtensionUnlockOptionsRequest = {
      type: ExtensionSessionMessageType.UnlockOptions,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const materialResponse =
      await this.sessionResponse<PasskeyUnlockMaterialResponse>(optionsRequest)
    const material = decode_passkey_unlock_material_response(materialResponse)
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
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    return decode_extension_session_device_response(response).device
  }

  async createExtensionPin(pin: string): Promise<ExtensionSessionDeviceWire> {
    const request: ExtensionCreatePinRequest = {
      type: ExtensionSessionMessageType.CreatePin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    return decode_extension_session_device_response(response).device
  }

  async unlockExtensionPin(pin: string): Promise<ExtensionSessionDeviceWire> {
    const request: ExtensionUnlockPinRequest = {
      type: ExtensionSessionMessageType.UnlockPin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const response =
      await this.sessionResponse<ExtensionSessionOperationResponseWire>(request)
    return decode_extension_session_device_response(response).device
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
          locale: supported_app_locale_code(parsed),
        }
  }

  async selectExtensionAppLocale(
    tags: ExtensionAppLocaleCandidates,
  ): Promise<NookAppLocale> {
    await this.ensureNookWasm()
    return resolve_app_locale_from_tags(tags)
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
