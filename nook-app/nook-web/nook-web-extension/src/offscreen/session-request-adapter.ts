import { Effect, ParseResult, Schema } from 'effect'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  CompanionIdentityDiscoverySessionTransportRequest as GeneratedCompanionIdentityDiscoverySessionTransportRequest,
  CompanionIdentityHandoffSessionTransportRequest as GeneratedCompanionIdentityHandoffSessionTransportRequest,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ProviderCredentialBuffer } from '../lib/provider-credential-staging'
import {
  decode_companion_identity_discovery_session_transport_request,
  decode_companion_identity_handoff_session_transport_request,
  decode_extension_session_request,
  type ExtensionSessionRequest as GeneratedExtensionSessionRequest,
  type ExtensionStorageProviderIdentity,
  type PasskeyCeremonyQueueDisposition,
  type QueueDisposition,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type {
  ExtensionSessionRuntimeMessageInput,
  ExtensionSessionRuntimeMessageValue,
} from '../background/service-worker/session-runtime-messages'
import { ExtensionPairingStorageProviderPayloadDecoder } from '../../../nook-web-shared/src/extension/runtime-messages'

export const EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS = 5_000

export enum ExtensionSessionQueueKind {
  MessageDefault = 'message-default',
  Deadline = 'deadline',
}

export enum ExtensionSessionQueuePriority {
  Probe = 'probe',
  Interactive = 'interactive',
}

export type ExtensionSessionQueue = QueueDisposition

const messageDefaultQueue: ExtensionSessionQueue = {
  kind: ExtensionSessionQueueKind.MessageDefault,
}

export const MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE =
  Object.freeze(messageDefaultQueue)

export function extensionSessionProbeDeadline(
  expiresAt: number,
): ExtensionSessionQueue {
  return {
    kind: ExtensionSessionQueueKind.Deadline,
    expiresAt,
    priority: ExtensionSessionQueuePriority.Probe,
  }
}

export function extensionSessionInteractiveDeadline(
  expiresAt: number,
): ExtensionSessionQueue {
  return {
    kind: ExtensionSessionQueueKind.Deadline,
    expiresAt,
    priority: ExtensionSessionQueuePriority.Interactive,
  }
}

export function extensionSessionPasskeyCeremonyDeadline(
  expiresAt: number,
): PasskeyCeremonyQueueDisposition {
  return {
    kind: ExtensionSessionQueueKind.Deadline,
    expiresAt,
    priority: ExtensionSessionQueuePriority.Interactive,
  }
}

type GeneratedExtensionSessionImportRequest = Extract<
  GeneratedExtensionSessionRequest,
  { type: `${ExtensionSessionMessageType.ImportVault}` }
>
type GeneratedExtensionSessionNonImportRequest = Exclude<
  GeneratedExtensionSessionRequest,
  GeneratedExtensionSessionImportRequest
>
type ExtensionSessionImportTransportRequest = {
  type: GeneratedExtensionSessionImportRequest['type']
  payload: Omit<
    GeneratedExtensionSessionImportRequest['payload'],
    'providers'
  > & {
    providers: StorageProvider[]
  }
}
export type ExtensionSessionTransportRequest =
  | GeneratedExtensionSessionNonImportRequest
  | ExtensionSessionImportTransportRequest
  | CompanionIdentityDiscoverySessionTransportRequest
  | CompanionIdentityHandoffSessionTransportRequest

export const COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE =
  'nook:extension-session-authorize-companion-identity-handoff'
export const COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE =
  'nook:extension-session-discover-companion-identity'

export type CompanionIdentityDiscoverySessionTransportRequest =
  GeneratedCompanionIdentityDiscoverySessionTransportRequest
export type CompanionIdentityHandoffSessionTransportRequest =
  GeneratedCompanionIdentityHandoffSessionTransportRequest

export type ParsedExtensionSessionTransportRequest = ExtensionSessionRequest
export type ExtensionSessionNonImportRequest =
  GeneratedExtensionSessionNonImportRequest
type ExtensionSessionImportRequest = {
  type: GeneratedExtensionSessionImportRequest['type']
  payload: Omit<
    GeneratedExtensionSessionImportRequest['payload'],
    'providers'
  > & {
    providers: StorageProvider[]
  }
}
export type ExtensionSessionRequest =
  ExtensionSessionNonImportRequest | ExtensionSessionImportRequest

export enum ExtensionSessionRequestParseKind {
  Invalid = 'invalid',
  Parsed = 'parsed',
}

export enum ExtensionSessionRequestDecodeFailureKind {
  RawEnvelope = 'raw-envelope-decode-failed',
  SessionRequest = 'session-request-decode-failed',
  CompanionIdentityDiscovery = 'companion-identity-discovery-decode-failed',
  CompanionIdentityHandoff = 'companion-identity-handoff-decode-failed',
  StorageProvider = 'storage-provider-decode-failed',
  ImportProviders = 'import-providers-decode-failed',
}

export type ExtensionSessionRequestDecodeFailure = {
  kind: ExtensionSessionRequestDecodeFailureKind
}

type ExtensionSessionRawEnvelope = {
  type: string
  payload: ExtensionSessionRuntimeMessageValue
}

type ExtensionSessionRawEnvelopeHeader = Pick<ExtensionSessionRawEnvelope, 'type'>

const extensionSessionRawEnvelopeHeaderSchema = Schema.Struct({
  type: Schema.String,
}) satisfies Schema.Schema<ExtensionSessionRawEnvelopeHeader>

enum ExtensionSessionPayloadField {
  Payload = 'payload',
  Providers = 'providers',
  GithubPat = 'githubPat',
  OauthFile = 'oauthFile',
  Config = 'config',
  AccessToken = 'accessToken',
  RefreshToken = 'refreshToken',
}

enum ExtensionSessionSensitiveField {
  StoredJson = 'stored_json',
  CredentialId = 'credentialId',
  UserHandle = 'userHandle',
  PrfInput = 'prfInput',
  PrfOutput = 'prfOutput',
  Pin = 'pin',
  OtpauthUri = 'otpauthUri',
  Codes = 'codes',
  Username = 'username',
  Password = 'password',
  RequestJson = 'requestJson',
}

export function decodeExtensionSessionRawEnvelope(
  value: ExtensionSessionRuntimeMessageValue,
): Effect.Effect<
  ExtensionSessionRawEnvelope,
  ParseResult.ParseError | ExtensionSessionRequestDecodeFailure
> {
  return Effect.flatMap(
    Schema.decodeUnknown(extensionSessionRawEnvelopeHeaderSchema)(value),
    ({ type }) => {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return Effect.fail<ExtensionSessionRequestDecodeFailure>({
          kind: ExtensionSessionRequestDecodeFailureKind.RawEnvelope,
        })
      }
      if (!(ExtensionSessionPayloadField.Payload in value)) {
        return Effect.fail<ExtensionSessionRequestDecodeFailure>({
          kind: ExtensionSessionRequestDecodeFailureKind.RawEnvelope,
        })
      }
      return Effect.succeed({
        type,
        payload: value[ExtensionSessionPayloadField.Payload],
      })
    },
  )
}

export function decodeCompanionIdentityDiscoverySessionTransportRequest(
  value: ExtensionSessionRuntimeMessageValue,
): Effect.Effect<
  CompanionIdentityDiscoverySessionTransportRequest,
  ExtensionSessionRequestDecodeFailure
> {
  return Effect.try({
    try: () => decode_companion_identity_discovery_session_transport_request(value),
    catch: (): ExtensionSessionRequestDecodeFailure => ({
      kind: ExtensionSessionRequestDecodeFailureKind.CompanionIdentityDiscovery,
    }),
  })
}

export function decodeCompanionIdentityHandoffSessionTransportRequest(
  value: ExtensionSessionRuntimeMessageValue,
): Effect.Effect<
  CompanionIdentityHandoffSessionTransportRequest,
  ExtensionSessionRequestDecodeFailure
> {
  return Effect.try({
    try: () => decode_companion_identity_handoff_session_transport_request(value),
    catch: (): ExtensionSessionRequestDecodeFailure => ({
      kind: ExtensionSessionRequestDecodeFailureKind.CompanionIdentityHandoff,
    }),
  })
}

export type ExtensionSessionRequestParse =
  | { kind: ExtensionSessionRequestParseKind.Invalid }
  | {
      kind: ExtensionSessionRequestParseKind.Parsed
      request: ParsedExtensionSessionTransportRequest
    }

export enum ExtensionSessionSensitiveStageKind {
  Invalid = 'invalid',
  NotRequired = 'not-required',
  Staged = 'staged',
}

export type ExtensionSessionSensitiveStage =
  | { kind: ExtensionSessionSensitiveStageKind.Invalid }
  | { kind: ExtensionSessionSensitiveStageKind.NotRequired }
  | {
      kind: ExtensionSessionSensitiveStageKind.Staged
      request: ExtensionSessionNonImportRequest
    }

enum CompanionWasmReadinessKind {
  Ready = 'ready',
  Expired = 'expired',
}

type ExtensionSessionIngressStage =
  | { kind: ExtensionSessionSensitiveStageKind.Invalid }
  | {
      kind: ExtensionSessionSensitiveStageKind.Staged
      envelope: ExtensionSessionRawEnvelope
    }

const sensitiveSessionFields: Readonly<
  Record<ExtensionSessionMessageType, readonly ExtensionSessionSensitiveField[]>
> = {
  [ExtensionSessionMessageType.ClassifyGrantAuthority]: [
    ExtensionSessionSensitiveField.StoredJson,
  ],
  [ExtensionSessionMessageType.Reset]: [],
  [ExtensionSessionMessageType.MigrateAuthProviders]: [],
  [ExtensionSessionMessageType.Status]: [],
  [ExtensionSessionMessageType.BeginPasskeySetup]: [],
  [ExtensionSessionMessageType.FinishPasskeySetup]: [
    ExtensionSessionSensitiveField.CredentialId,
    ExtensionSessionSensitiveField.UserHandle,
    ExtensionSessionSensitiveField.PrfInput,
    ExtensionSessionSensitiveField.PrfOutput,
  ],
  [ExtensionSessionMessageType.RecoverPasskey]: [
    ExtensionSessionSensitiveField.CredentialId,
    ExtensionSessionSensitiveField.UserHandle,
    ExtensionSessionSensitiveField.PrfOutput,
  ],
  [ExtensionSessionMessageType.UnlockOptions]: [],
  [ExtensionSessionMessageType.UnlockPasskey]: [
    ExtensionSessionSensitiveField.PrfOutput,
  ],
  [ExtensionSessionMessageType.CreatePin]: [ExtensionSessionSensitiveField.Pin],
  [ExtensionSessionMessageType.UnlockPin]: [ExtensionSessionSensitiveField.Pin],
  [ExtensionSessionMessageType.SealIdentityHandoff]: [],
  [ExtensionSessionMessageType.ImportVault]: [],
  [ExtensionSessionMessageType.UpdateVault]: [],
  [ExtensionSessionMessageType.ListPasskeys]: [],
  [ExtensionSessionMessageType.ListLogins]: [],
  [ExtensionSessionMessageType.RevealLogin]: [],
  [ExtensionSessionMessageType.ListAuthenticators]: [],
  [ExtensionSessionMessageType.AuthenticatorCode]: [],
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]: [
    ExtensionSessionSensitiveField.OtpauthUri,
  ],
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]: [
    ExtensionSessionSensitiveField.OtpauthUri,
  ],
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]: [
    ExtensionSessionSensitiveField.OtpauthUri,
  ],
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]: [
    ExtensionSessionSensitiveField.Codes,
  ],
  [ExtensionSessionMessageType.PlanLoginSave]: [
    ExtensionSessionSensitiveField.Username,
    ExtensionSessionSensitiveField.Password,
  ],
  [ExtensionSessionMessageType.PendingLoginSave]: [],
  [ExtensionSessionMessageType.CommitLoginSave]: [],
  [ExtensionSessionMessageType.DismissLoginSave]: [],
  [ExtensionSessionMessageType.CancelPasskey]: [],
  [ExtensionSessionMessageType.RegisterPasskey]: [
    ExtensionSessionSensitiveField.RequestJson,
  ],
  [ExtensionSessionMessageType.AssertPasskey]: [
    ExtensionSessionSensitiveField.RequestJson,
  ],
  [ExtensionSessionMessageType.Lock]: [],
}

type ExtensionSessionPayloadTarget =
  | ExtensionSessionRuntimeMessageInput
  | ExtensionSessionNonImportRequest['payload']

type ExtensionSessionPayloadProperty =
  | ExtensionSessionPayloadField
  | ExtensionSessionSensitiveField

const safeReflect: {
  get(
    target: ExtensionSessionPayloadTarget,
    propertyKey: ExtensionSessionPayloadProperty,
  ): ExtensionSessionRuntimeMessageValue
  set<Value>(
    target: ExtensionSessionPayloadTarget,
    propertyKey: ExtensionSessionPayloadProperty,
    value: Value,
  ): boolean
} = Reflect

function clearSensitiveFieldValue(
  value: ExtensionSessionRuntimeMessageValue,
): void {
  if (!Array.isArray(value)) return
  if (value.every((entry) => typeof entry === 'string')) value.fill('')
  else value.fill(0)
}

type ExtensionSessionSensitiveValue = string | number[] | string[]

type SetExtensionSessionSensitiveValueArgs = {
  payload: ExtensionSessionNonImportRequest['payload']
  field: ExtensionSessionSensitiveField
  value: ExtensionSessionSensitiveValue
}

function setExtensionSessionSensitiveValue(
  args: SetExtensionSessionSensitiveValueArgs,
): void {
  safeReflect.set(args.payload, args.field, args.value)
}

enum ExtensionSessionSensitiveValueCopyKind {
  Invalid = 'invalid',
  Copied = 'copied',
}

type ExtensionSessionSensitiveValueCopy =
  | { kind: ExtensionSessionSensitiveValueCopyKind.Invalid }
  | {
      kind: ExtensionSessionSensitiveValueCopyKind.Copied
      value: ExtensionSessionSensitiveValue
    }

function copyExtensionSessionSensitiveValue(
  value: ExtensionSessionRuntimeMessageValue,
): ExtensionSessionSensitiveValueCopy {
  if (typeof value === 'string') {
    return { kind: ExtensionSessionSensitiveValueCopyKind.Copied, value }
  }
  if (!Array.isArray(value)) {
    return { kind: ExtensionSessionSensitiveValueCopyKind.Invalid }
  }
  if (value.every((entry) => typeof entry === 'number')) {
    return {
      kind: ExtensionSessionSensitiveValueCopyKind.Copied,
      value: [...value],
    }
  }
  if (value.every((entry) => typeof entry === 'string')) {
    return {
      kind: ExtensionSessionSensitiveValueCopyKind.Copied,
      value: [...value],
    }
  }
  return { kind: ExtensionSessionSensitiveValueCopyKind.Invalid }
}

export function clearExtensionSessionSensitiveRequest(
  request: ExtensionSessionNonImportRequest,
): void {
  for (const field of sensitiveSessionFields[request.type]) {
    const value = safeReflect.get(request.payload, field)
    clearSensitiveFieldValue(value)
    safeReflect.set(request.payload, field, typeof value === 'string' ? '' : [])
  }
}

export function stageExtensionSessionSensitiveRequest(
  request: ExtensionSessionNonImportRequest,
): ExtensionSessionSensitiveStage {
  const fields = sensitiveSessionFields[request.type]
  if (fields.length === 0) {
    return { kind: ExtensionSessionSensitiveStageKind.NotRequired }
  }
  const stagedPayload: typeof request.payload = { ...request.payload }
  for (const field of fields) {
    const value = safeReflect.get(request.payload, field)
    const copiedValue = copyExtensionSessionSensitiveValue(value)
    if (copiedValue.kind === ExtensionSessionSensitiveValueCopyKind.Invalid) {
      clearExtensionSessionSensitiveRequest(request)
      const stagedRequestArgs: ReplaceExtensionSessionRequestPayloadArgs<
        typeof request
      > = { request, payload: stagedPayload }
      clearExtensionSessionSensitiveRequest(
        replaceExtensionSessionRequestPayload(stagedRequestArgs),
      )
      return { kind: ExtensionSessionSensitiveStageKind.Invalid }
    }
    const stagedValue: ExtensionSessionSensitiveValue = copiedValue.value
    const stagedValueArgs: SetExtensionSessionSensitiveValueArgs = {
      payload: stagedPayload,
      field,
      value: stagedValue,
    }
    setExtensionSessionSensitiveValue(stagedValueArgs)
    clearSensitiveFieldValue(value)
    const clearedValue: ExtensionSessionSensitiveValue =
      typeof value === 'string' ? '' : []
    const clearedValueArgs: SetExtensionSessionSensitiveValueArgs = {
      payload: request.payload,
      field,
      value: clearedValue,
    }
    setExtensionSessionSensitiveValue(clearedValueArgs)
  }
  const replacementArgs: ReplaceExtensionSessionRequestPayloadArgs<
    typeof request
  > = {
    request,
    payload: stagedPayload,
  }
  return {
    kind: ExtensionSessionSensitiveStageKind.Staged,
    request: replaceExtensionSessionRequestPayload(replacementArgs),
  }
}

class ExtensionSessionIngressAdmission {
  constructor(private readonly value: ExtensionSessionRuntimeMessageValue) {}

  private decodeEnvelope():
    | { kind: ExtensionSessionSensitiveStageKind.Invalid }
    | {
        kind: ExtensionSessionSensitiveStageKind.Staged
        envelope: ExtensionSessionRawEnvelope
      } {
    const decoded = Effect.runSync(
      Effect.either(decodeExtensionSessionRawEnvelope(this.value)),
    )
    if (decoded._tag === 'Left') {
      return { kind: ExtensionSessionSensitiveStageKind.Invalid }
    }
    return {
      kind: ExtensionSessionSensitiveStageKind.Staged,
      envelope: decoded.right,
    }
  }

  stage(): ExtensionSessionIngressStage {
    const decoded = this.decodeEnvelope()
    if (decoded.kind === ExtensionSessionSensitiveStageKind.Invalid) return decoded
    let stagedEnvelope: ExtensionSessionRawEnvelope
    try {
      const staged = structuredClone(this.value)
      const stagedDecoded = Effect.runSync(
        Effect.either(decodeExtensionSessionRawEnvelope(staged)),
      )
      if (stagedDecoded._tag === 'Left') {
        clearRawExtensionSessionSecrets(decoded.envelope)
        return { kind: ExtensionSessionSensitiveStageKind.Invalid }
      }
      stagedEnvelope = stagedDecoded.right
    } catch {
      clearRawExtensionSessionSecrets(decoded.envelope)
      return { kind: ExtensionSessionSensitiveStageKind.Invalid }
    }
    clearRawExtensionSessionSecrets(decoded.envelope)
    return {
      kind: ExtensionSessionSensitiveStageKind.Staged,
      envelope: stagedEnvelope,
    }
  }
}

function clearRawProviderCredentials(value: ExtensionSessionRuntimeMessageValue): void {
  if (!Array.isArray(value)) return
  for (const provider of value) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      continue
    }
    if (ExtensionSessionPayloadField.GithubPat in provider) {
      safeReflect.set(provider, ExtensionSessionPayloadField.GithubPat, {
        state: 'missing',
      })
    }
    if (ExtensionSessionPayloadField.OauthFile in provider) {
      const oauthFile = safeReflect.get(
        provider,
        ExtensionSessionPayloadField.OauthFile,
      )
      if (
        oauthFile &&
        typeof oauthFile === 'object' &&
        !Array.isArray(oauthFile)
      ) {
        if (ExtensionSessionPayloadField.Config in oauthFile) {
          const config = safeReflect.get(
            oauthFile,
            ExtensionSessionPayloadField.Config,
          )
          if (
            config &&
            typeof config === 'object' &&
            !Array.isArray(config)
          ) {
            if (ExtensionSessionPayloadField.AccessToken in config)
              safeReflect.set(
                config,
                ExtensionSessionPayloadField.AccessToken,
                { state: 'signedOut' },
              )
            if (ExtensionSessionPayloadField.RefreshToken in config)
              safeReflect.set(
                config,
                ExtensionSessionPayloadField.RefreshToken,
                { state: 'notIssued' },
              )
          }
        }
        if (ExtensionSessionPayloadField.AccessToken in oauthFile)
          safeReflect.set(
            oauthFile,
            ExtensionSessionPayloadField.AccessToken,
            '',
          )
        if (ExtensionSessionPayloadField.RefreshToken in oauthFile)
          safeReflect.set(
            oauthFile,
            ExtensionSessionPayloadField.RefreshToken,
            '',
          )
      }
    }
  }
}

function clearRawExtensionSessionSecrets(
  envelope: ExtensionSessionRawEnvelope,
): void {
  const payload = envelope.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  if (envelope.type === ExtensionSessionMessageType.ImportVault) {
    const providers = safeReflect.get(payload, ExtensionSessionPayloadField.Providers)
    clearRawProviderCredentials(providers)
    safeReflect.set(payload, ExtensionSessionPayloadField.Providers, [])
    return
  }
  const fields = Object.entries(sensitiveSessionFields).find(
    ([type]) => type === envelope.type,
  )?.[1]
  if (!fields) return
  for (const field of fields) {
    const value = safeReflect.get(payload, field)
    clearSensitiveFieldValue(value)
    safeReflect.set(payload, field, typeof value === 'string' ? '' : [])
  }
}

export async function parseExtensionSessionRequest(
  value: ExtensionSessionRuntimeMessageValue,
): Promise<ExtensionSessionRequestParse> {
  const ingressStage = new ExtensionSessionIngressAdmission(value).stage()
  if (ingressStage.kind === ExtensionSessionSensitiveStageKind.Invalid) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  const envelope = ingressStage.envelope
  const deadline = Date.now() + EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS
  let request: ExtensionSessionRequest | undefined
  const readinessDeadline = new AbortController()
  const expiry = new Promise<CompanionWasmReadinessKind>((resolve) => {
    const readinessTimer = setTimeout(
      () => {
        clearRawExtensionSessionSecrets(envelope)
        resolve(CompanionWasmReadinessKind.Expired)
      },
      Math.max(0, deadline - Date.now()),
    )
    const abortListenerOptions: AddEventListenerOptions = { once: true }
    readinessDeadline.signal.addEventListener(
      'abort',
      () => clearTimeout(readinessTimer),
      abortListenerOptions,
    )
  })
  try {
    const readiness = await Promise.race([
      companionWasmReady.then(() => CompanionWasmReadinessKind.Ready),
      expiry,
    ])
    if (readiness === CompanionWasmReadinessKind.Expired) {
      return { kind: ExtensionSessionRequestParseKind.Invalid }
    }
    const decoded = Effect.runSync(
      Effect.either(decodeExtensionSessionIngress(envelope)),
    )
    if (decoded._tag === 'Left') return { kind: ExtensionSessionRequestParseKind.Invalid }
    request = decoded.right
    const queue = request.payload.queue
    const expiresAt =
      queue.kind === ExtensionSessionQueueKind.Deadline
        ? Math.min(queue.expiresAt, deadline)
        : deadline
    if (expiresAt <= Date.now()) {
      clearExtensionSessionRequest(request)
      return { kind: ExtensionSessionRequestParseKind.Invalid }
    }
  } catch {
    clearRawExtensionSessionSecrets(envelope)
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  } finally {
    clearRawExtensionSessionSecrets(envelope)
    readinessDeadline.abort()
  }
  if (!request) return { kind: ExtensionSessionRequestParseKind.Invalid }
  return {
    kind: ExtensionSessionRequestParseKind.Parsed,
    request,
  }
}

function clearExtensionSessionRequest(request: ExtensionSessionRequest): void {
  if (request.type === ExtensionSessionMessageType.ImportVault) {
    new ProviderCredentialBuffer(request.payload.providers).clear()
    return
  }
  clearExtensionSessionSensitiveRequest(request)
}

function decodeExtensionSessionIngress(
  envelope: ExtensionSessionRawEnvelope,
): Effect.Effect<ExtensionSessionRequest, ExtensionSessionRequestDecodeFailure> {
  if (envelope.type !== ExtensionSessionMessageType.ImportVault) {
    return Effect.gen(function* () {
      const decoded = yield* Effect.try({
        try: () => decode_extension_session_request(envelope),
        catch: (): ExtensionSessionRequestDecodeFailure => ({
          kind: ExtensionSessionRequestDecodeFailureKind.SessionRequest,
        }),
      })
      if (decoded.type === ExtensionSessionMessageType.ImportVault) {
        return yield* Effect.fail<ExtensionSessionRequestDecodeFailure>({
          kind: ExtensionSessionRequestDecodeFailureKind.SessionRequest,
        })
      }
      return decoded
    })
  }
  return Effect.gen(function* () {
    const rawPayload = envelope.payload
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return yield* Effect.fail<ExtensionSessionRequestDecodeFailure>({
        kind: ExtensionSessionRequestDecodeFailureKind.ImportProviders,
      })
    }
    const rawProviders = safeReflect.get(
      rawPayload,
      ExtensionSessionPayloadField.Providers,
    )
    if (!Array.isArray(rawProviders)) {
      return yield* Effect.fail<ExtensionSessionRequestDecodeFailure>({
        kind: ExtensionSessionRequestDecodeFailureKind.ImportProviders,
      })
    }
    const decodedProviders: StorageProvider[] = []
    for (const provider of rawProviders) {
      const decodedProvider = yield* Effect.either(
        Effect.mapError(
          ExtensionPairingStorageProviderPayloadDecoder.decode(provider),
          (): ExtensionSessionRequestDecodeFailure => ({
            kind: ExtensionSessionRequestDecodeFailureKind.StorageProvider,
          }),
        ),
      )
      if (decodedProvider._tag === 'Left') {
        new ProviderCredentialBuffer(decodedProviders).clear()
        return yield* Effect.fail(decodedProvider.left)
      }
      decodedProviders.push(decodedProvider.right)
    }
    const identities: ExtensionStorageProviderIdentity[] =
      decodedProviders.map((provider) => ({
        id: provider.id,
        type: provider.type,
      }))
    if (
      !safeReflect.set(
        rawPayload,
        ExtensionSessionPayloadField.Providers,
        identities,
      )
    ) {
      new ProviderCredentialBuffer(decodedProviders).clear()
      return yield* Effect.fail<ExtensionSessionRequestDecodeFailure>({
        kind: ExtensionSessionRequestDecodeFailureKind.ImportProviders,
      })
    }
    const decodedRequest = yield* Effect.either(
      Effect.try({
        try: () => decode_extension_session_request(envelope),
        catch: (): ExtensionSessionRequestDecodeFailure => ({
          kind: ExtensionSessionRequestDecodeFailureKind.SessionRequest,
        }),
      }),
    )
    if (decodedRequest._tag === 'Left') {
      new ProviderCredentialBuffer(decodedProviders).clear()
      return yield* Effect.fail(decodedRequest.left)
    }
    if (decodedRequest.right.type !== ExtensionSessionMessageType.ImportVault) {
      new ProviderCredentialBuffer(decodedProviders).clear()
      return yield* Effect.fail<ExtensionSessionRequestDecodeFailure>({
        kind: ExtensionSessionRequestDecodeFailureKind.SessionRequest,
      })
    }
    return {
      ...decodedRequest.right,
      payload: {
        ...decodedRequest.right.payload,
        providers: decodedProviders,
      },
    }
  })
}

type ReplaceExtensionSessionRequestPayloadArgs<
  Request extends ExtensionSessionNonImportRequest,
> = {
  request: Request
  payload: Request['payload']
}

export function replaceExtensionSessionRequestPayload<
  Request extends ExtensionSessionNonImportRequest,
>({
  request,
  payload,
}: ReplaceExtensionSessionRequestPayloadArgs<Request>): Request {
  const replacement: Request = { ...request }
  Reflect.set(replacement, ExtensionSessionPayloadField.Payload, payload)
  return replacement
}
