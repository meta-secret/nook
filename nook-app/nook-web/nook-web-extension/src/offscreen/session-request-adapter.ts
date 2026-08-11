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
  validateExtensionSessionRequest,
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
  NotRequired = 'not-required',
  Staged = 'staged',
}

export type ExtensionSessionSensitiveStage =
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
    Reflect.set(stagedPayload, field, Array.isArray(value) ? [...value] : value)
    clearSensitiveFieldValue(value)
    Reflect.set(request.payload, field, typeof value === 'string' ? '' : [])
  }
  const replacementArgs = {
    request,
    payload: stagedPayload,
  } satisfies ReplaceExtensionSessionRequestPayloadArgs<typeof request>
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

function hasExtensionSessionQueue(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  return (
    'queue' in payload &&
    payload.queue !== null &&
    typeof payload.queue === 'object' &&
    'kind' in payload.queue &&
    typeof payload.queue.kind === 'string'
  )
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
      validateExtensionSessionRequest(requestWire) !==
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
