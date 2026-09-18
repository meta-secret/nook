import { ExtensionSessionDeviceProtectionStatusWire } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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
  type ExtensionSessionDeviceWire,
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

export type {
  ExtensionSessionDeviceWire,
  NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export {
  DeviceMode,
  ExtensionSessionDeviceProtectionStatusWire as DeviceProtectionStatus,
}

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
  type: typeof ExtensionSessionMessageType.Status
  payload: ExtensionControlPayload
}

type ExtensionBeginPasskeySetupRequest = {
  type: typeof ExtensionSessionMessageType.BeginPasskeySetup
  payload: ExtensionControlPayload
}

type ExtensionFinishPasskeySetupRequest = {
  type: typeof ExtensionSessionMessageType.FinishPasskeySetup
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
  type: typeof ExtensionSessionMessageType.RecoverPasskey
  payload: {
    credentialId: number[]
    userHandle: number[]
    prfOutput: number[]
    queue: ExtensionSessionQueue
  }
}

type ExtensionUnlockOptionsRequest = {
  type: typeof ExtensionSessionMessageType.UnlockOptions
  payload: ExtensionControlPayload
}

type ExtensionUnlockPasskeyRequest = {
  type: typeof ExtensionSessionMessageType.UnlockPasskey
  payload: { prfOutput: number[]; queue: ExtensionSessionQueue }
}

type ExtensionCreatePinRequest = {
  type: typeof ExtensionSessionMessageType.CreatePin
  payload: { pin: string; queue: ExtensionSessionQueue }
}

type ExtensionUnlockPinRequest = {
  type: typeof ExtensionSessionMessageType.UnlockPin
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

type PublicKeyCredentialWithPrf = PublicKeyCredential

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

type ExtensionRuntimeResponseDecoder<Response> = (response: unknown) => Response

type ExtensionRuntimeMessageRequest<Response> = {
  readonly message: ExtensionRuntimeRequest
  readonly decode: ExtensionRuntimeResponseDecoder<Response>
}

type ExtensionSessionResponseRequest<Response> = {
  readonly message: ExtensionSessionRequest
  readonly decode: ExtensionRuntimeResponseDecoder<Response>
}

type ExtensionRuntimeStartupResponse =
  { readonly ok: true } | { readonly ok: false; readonly reason?: string }

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

  private runtimeMessage<Response>(
    request: ExtensionRuntimeMessageRequest<Response>,
  ): Promise<Response> {
    const deferred = Promise.withResolvers<Response>()
    chrome.runtime.sendMessage(request.message, (runtimeResponse: unknown) => {
      if (chrome.runtime.lastError?.message) {
        deferred.reject(new Error(chrome.runtime.lastError.message))
        return
      }
      try {
        deferred.resolve(request.decode(runtimeResponse))
      } catch {
        deferred.reject(
          new Error('Extension session returned a malformed response.'),
        )
      }
    })
    return deferred.promise
  }

  private async sessionResponse<Response>(
    request: ExtensionSessionResponseRequest<Response>,
  ): Promise<Response> {
    await this.ensureNookWasm()

    const runtimeStartupRequest: ExtensionRuntimeMessageRequest<ExtensionRuntimeStartupResponse> =
      {
        message: { type: ExtensionRuntimeRequestType.EnsureRuntime },
        decode: (response): ExtensionRuntimeStartupResponse => {
          if (
            !response ||
            typeof response !== 'object' ||
            Array.isArray(response)
          ) {
            throw new Error(
              'Extension session runtime returned a malformed response.',
            )
          }
          if ('ok' in response && response.ok === true) return { ok: true }
          return {
            ok: false,
            ...('reason' in response && typeof response.reason === 'string'
              ? { reason: response.reason }
              : {}),
          }
        },
      }
    const runtime = await this.runtimeMessage(runtimeStartupRequest)
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
    const sessionRuntimeRequest: ExtensionRuntimeMessageRequest<Response> = {
      message: request.message,
      decode: (response) => {
        if (
          !response ||
          typeof response !== 'object' ||
          Array.isArray(response) ||
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
        return request.decode(response)
      },
    }
    return this.runtimeMessage(sessionRuntimeRequest)
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
    const response = credential.response
    if (!(response instanceof AuthenticatorAssertionResponse)) {
      throw new Error(
        'Passkey assertion did not include an assertion response.',
      )
    }
    if (!response.userHandle) {
      throw new Error('Passkey assertion did not include its user handle.')
    }
    return this.bytes(response.userHandle)
  }

  private prfOutput(credential: PublicKeyCredential): number[] {
    const prf = credential.getClientExtensionResults().prf
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
      return credential
    } catch (error) {
      const args: ConstructorParameters<typeof PasskeyCeremonyFailure>[0] = {
        error: error instanceof Error ? error : new Error(),
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
      return credential
    } catch (error) {
      const args: ConstructorParameters<typeof PasskeyCeremonyFailure>[0] = {
        error: error instanceof Error ? error : new Error(),
        action: PasskeyOperation.Create,
      }
      throw new PasskeyCeremonyFailure(args).error
    }
  }

  async extensionDeviceProtectionStatus(): Promise<ExtensionSessionDeviceProtectionStatusWire> {
    const request: ExtensionStatusRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const statusResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_status_details>
    > = {
      message: request,
      decode: decode_extension_session_status_details,
    }
    const status = await this.sessionResponse(statusResponseRequest)
    const deviceStatus = status.status
    if (typeof deviceStatus !== 'number') {
      throw new Error('Extension device protection status is unavailable.')
    }

    if (
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Missing ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Plaintext ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Passkey ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Pin ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Unlocked
    ) {
      return deviceStatus
    }
    if (
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Loading ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.PinSetup ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Error ||
      deviceStatus === ExtensionSessionDeviceProtectionStatusWire.Unknown
    ) {
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
    const statusResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_status_details>
    > = {
      message: request,
      decode: decode_extension_session_status_details,
    }
    const status = await this.sessionResponse(statusResponseRequest)
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
    const setupResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_passkey_setup_material_response>
    > = {
      message: beginRequest,
      decode: decode_passkey_setup_material_response,
    }
    const setup = await this.sessionResponse(setupResponseRequest)
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
    const finishResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_device_response>
    > = {
      message: finishRequest,
      decode: decode_extension_session_device_response,
    }
    const finishResponse = await this.sessionResponse(finishResponseRequest)
    return finishResponse.device
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
    const recoveryResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_device_response>
    > = {
      message: request,
      decode: decode_extension_session_device_response,
    }
    const response = await this.sessionResponse(recoveryResponseRequest)
    return response.device
  }

  async unlockExtensionPasskey(): Promise<ExtensionSessionDeviceWire> {
    await this.ensureNookWasm()
    const optionsRequest: ExtensionUnlockOptionsRequest = {
      type: ExtensionSessionMessageType.UnlockOptions,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const materialResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_passkey_unlock_material_response>
    > = {
      message: optionsRequest,
      decode: decode_passkey_unlock_material_response,
    }
    const material = await this.sessionResponse(materialResponseRequest)
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
    const unlockResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_device_response>
    > = {
      message: request,
      decode: decode_extension_session_device_response,
    }
    const response = await this.sessionResponse(unlockResponseRequest)
    return response.device
  }

  async createExtensionPin(pin: string): Promise<ExtensionSessionDeviceWire> {
    const request: ExtensionCreatePinRequest = {
      type: ExtensionSessionMessageType.CreatePin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const createPinResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_device_response>
    > = {
      message: request,
      decode: decode_extension_session_device_response,
    }
    const response = await this.sessionResponse(createPinResponseRequest)
    return response.device
  }

  async unlockExtensionPin(pin: string): Promise<ExtensionSessionDeviceWire> {
    const request: ExtensionUnlockPinRequest = {
      type: ExtensionSessionMessageType.UnlockPin,
      payload: { pin, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const unlockPinResponseRequest: ExtensionSessionResponseRequest<
      ReturnType<typeof decode_extension_session_device_response>
    > = {
      message: request,
      decode: decode_extension_session_device_response,
    }
    const response = await this.sessionResponse(unlockPinResponseRequest)
    return response.device
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
