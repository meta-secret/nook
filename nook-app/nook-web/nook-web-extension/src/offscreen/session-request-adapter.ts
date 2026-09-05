import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { SerializedStorageProvider } from '../lib/provider-credential-staging'
import {
  extensionSessionProviderIdentities,
  scrubProviderCredentials,
} from '../lib/provider-credential-staging'
import {
  ExtensionSessionRequestValidation,
  type ExtensionSessionRequest as GeneratedExtensionSessionRequest,
  type ExtensionSessionRequestWire,
  type PasskeyCeremonyQueueDisposition,
  type QueueDisposition,
  validate_extension_session_request,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'

export const EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS = 5_000

type EnumeratedExtensionSessionRequest<Request> = Request extends {
  type: infer RequestType extends string
}
  ? Omit<Request, 'type'> & {
      type: Extract<ExtensionSessionMessageType, RequestType>
    }
  : never

type TypedExtensionSessionRequest =
  EnumeratedExtensionSessionRequest<GeneratedExtensionSessionRequest>

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
  > & { providers: SerializedStorageProvider[] }
}
export type ExtensionSessionTransportRequest =
  | GeneratedExtensionSessionNonImportRequest
  | ExtensionSessionImportTransportRequest
export type ParsedExtensionSessionTransportRequest =
  EnumeratedExtensionSessionRequest<ExtensionSessionTransportRequest>
type TypedExtensionSessionImportRequest = Extract<
  TypedExtensionSessionRequest,
  { type: ExtensionSessionMessageType.ImportVault }
>
export type ExtensionSessionNonImportRequest = Exclude<
  TypedExtensionSessionRequest,
  TypedExtensionSessionImportRequest
>
type ExtensionSessionImportRequest = {
  type: TypedExtensionSessionImportRequest['type']
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

enum ExtensionSessionIngressStageKind {
  Invalid = 'invalid',
  Staged = 'staged',
}

enum CompanionWasmReadinessKind {
  Ready = 'ready',
  Expired = 'expired',
}

type ExtensionSessionIngressStage =
  | { kind: ExtensionSessionIngressStageKind.Invalid }
  | {
      kind: ExtensionSessionIngressStageKind.Staged
      request: ParsedExtensionSessionTransportRequest
    }

const sensitiveSessionFields: Readonly<
  Record<ExtensionSessionMessageType, readonly string[]>
> = {
  [ExtensionSessionMessageType.ClassifyGrantAuthority]: ['stored_json'],
  [ExtensionSessionMessageType.Reset]: [],
  [ExtensionSessionMessageType.MigrateAuthProviders]: [],
  [ExtensionSessionMessageType.Status]: [],
  [ExtensionSessionMessageType.BeginPasskeySetup]: [],
  [ExtensionSessionMessageType.FinishPasskeySetup]: [
    'credentialId',
    'userHandle',
    'prfInput',
    'prfOutput',
  ],
  [ExtensionSessionMessageType.RecoverPasskey]: [
    'credentialId',
    'userHandle',
    'prfOutput',
  ],
  [ExtensionSessionMessageType.UnlockOptions]: [],
  [ExtensionSessionMessageType.UnlockPasskey]: ['prfOutput'],
  [ExtensionSessionMessageType.CreatePin]: ['pin'],
  [ExtensionSessionMessageType.UnlockPin]: ['pin'],
  [ExtensionSessionMessageType.SealIdentityHandoff]: [],
  [ExtensionSessionMessageType.ImportVault]: [],
  [ExtensionSessionMessageType.UpdateVault]: [],
  [ExtensionSessionMessageType.ListPasskeys]: [],
  [ExtensionSessionMessageType.ListLogins]: [],
  [ExtensionSessionMessageType.RevealLogin]: [],
  [ExtensionSessionMessageType.ListAuthenticators]: [],
  [ExtensionSessionMessageType.AuthenticatorCode]: [],
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]: ['codes'],
  [ExtensionSessionMessageType.PlanLoginSave]: ['username', 'password'],
  [ExtensionSessionMessageType.PendingLoginSave]: [],
  [ExtensionSessionMessageType.CommitLoginSave]: [],
  [ExtensionSessionMessageType.DismissLoginSave]: [],
  [ExtensionSessionMessageType.CancelPasskey]: [],
  [ExtensionSessionMessageType.RegisterPasskey]: ['requestJson'],
  [ExtensionSessionMessageType.AssertPasskey]: ['requestJson'],
  [ExtensionSessionMessageType.Lock]: [],
}

function clearSensitiveFieldValue(value: unknown): void {
  if (Array.isArray(value)) value.fill(0)
}

type ExtensionSessionSensitiveValue = string | number[] | string[]

type SetExtensionSessionSensitiveValueArgs = {
  payload: ExtensionSessionNonImportRequest['payload']
  field: string
  value: ExtensionSessionSensitiveValue
}

function setExtensionSessionSensitiveValue(
  args: SetExtensionSessionSensitiveValueArgs,
): void {
  Reflect.set(args.payload, args.field, args.value)
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
  value: unknown,
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
    const value = Reflect.get(request.payload, field)
    clearSensitiveFieldValue(value)
    Reflect.set(request.payload, field, typeof value === 'string' ? '' : [])
  }
}

export function stageExtensionSessionSensitiveRequest(
  request: ExtensionSessionNonImportRequest,
): ExtensionSessionSensitiveStage {
  const fields = sensitiveSessionFields[request.type]
  if (fields.length === 0) {
    return { kind: ExtensionSessionSensitiveStageKind.NotRequired }
  }
  const stagedPayload = { ...request.payload } as typeof request.payload
  for (const field of fields) {
    const value = Reflect.get(request.payload, field)
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

function isExtensionSessionMessageType(
  value: string,
): value is ExtensionSessionMessageType {
  return Object.prototype.hasOwnProperty.call(sensitiveSessionFields, value)
}

type ExtensionSessionQueueEnvelope = {
  kind: string
}

function isExtensionSessionQueueEnvelope(
  value: unknown,
): value is ExtensionSessionQueueEnvelope {
  if (!value || typeof value !== 'object') return false
  return 'kind' in value && typeof value.kind === 'string'
}

function hasExtensionSessionQueue(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  return 'queue' in payload && isExtensionSessionQueueEnvelope(payload.queue)
}

function stageExtensionSessionIngressRequest(
  value: unknown,
): ExtensionSessionIngressStage {
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    !isExtensionSessionMessageType(value.type) ||
    !('payload' in value) ||
    !value.payload ||
    typeof value.payload !== 'object'
  ) {
    return { kind: ExtensionSessionIngressStageKind.Invalid }
  }

  const request = value as ParsedExtensionSessionTransportRequest
  if (!hasExtensionSessionQueue(request.payload)) {
    clearExtensionSessionIngressRequest(request)
    return { kind: ExtensionSessionIngressStageKind.Invalid }
  }
  if (request.type === ExtensionSessionMessageType.ImportVault) {
    const providers = request.payload.providers
    if (!Array.isArray(providers)) {
      request.payload.providers = []
      return { kind: ExtensionSessionIngressStageKind.Invalid }
    }
    try {
      const stagedProviders = structuredClone(providers)
      scrubProviderCredentials(providers)
      request.payload.providers = []
      return {
        kind: ExtensionSessionIngressStageKind.Staged,
        request: {
          ...request,
          payload: { ...request.payload, providers: stagedProviders },
        },
      }
    } catch {
      scrubProviderCredentials(providers)
      request.payload.providers = []
      return { kind: ExtensionSessionIngressStageKind.Invalid }
    }
  }

  const sensitiveStage = stageExtensionSessionSensitiveRequest(request)
  if (sensitiveStage.kind === ExtensionSessionSensitiveStageKind.Invalid) {
    return { kind: ExtensionSessionIngressStageKind.Invalid }
  }
  return {
    kind: ExtensionSessionIngressStageKind.Staged,
    request:
      sensitiveStage.kind === ExtensionSessionSensitiveStageKind.Staged
        ? sensitiveStage.request
        : request,
  }
}

function clearExtensionSessionIngressRequest(
  request: ParsedExtensionSessionTransportRequest,
): void {
  if (request.type === ExtensionSessionMessageType.ImportVault) {
    scrubProviderCredentials(request.payload.providers)
    request.payload.providers = []
    return
  }
  clearExtensionSessionSensitiveRequest(request)
}

export async function parseExtensionSessionRequest(
  value: unknown,
): Promise<ExtensionSessionRequestParse> {
  const ingressStage = stageExtensionSessionIngressRequest(value)
  if (ingressStage.kind === ExtensionSessionIngressStageKind.Invalid) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  const request = ingressStage.request
  const defaultExpiresAt = Date.now() + EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS
  const queue = request.payload.queue
  const expiresAt =
    queue.kind === ExtensionSessionQueueKind.Deadline
      ? Math.min(queue.expiresAt, defaultExpiresAt)
      : defaultExpiresAt
  if (expiresAt <= Date.now()) {
    clearExtensionSessionIngressRequest(request)
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  const readinessDeadline = new AbortController()
  const expiry = new Promise<CompanionWasmReadinessKind>((resolve) => {
    const readinessTimer = setTimeout(
      () => {
        clearExtensionSessionIngressRequest(request)
        resolve(CompanionWasmReadinessKind.Expired)
      },
      Math.max(0, expiresAt - Date.now()),
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
    const validationRequest =
      request.type === ExtensionSessionMessageType.ImportVault
        ? {
            ...request,
            payload: {
              ...request.payload,
              providers: extensionSessionProviderIdentities(
                request.payload.providers,
              ),
            },
          }
        : request
    const requestWire: ExtensionSessionRequestWire =
      validationRequest as ExtensionSessionRequestWire
    if (
      validate_extension_session_request(requestWire) !==
      ExtensionSessionRequestValidation.Accepted
    ) {
      clearExtensionSessionIngressRequest(request)
      return { kind: ExtensionSessionRequestParseKind.Invalid }
    }
  } catch {
    clearExtensionSessionIngressRequest(request)
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  } finally {
    readinessDeadline.abort()
  }
  return {
    kind: ExtensionSessionRequestParseKind.Parsed,
    request,
  }
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
  return { ...request, payload } as Request
}
