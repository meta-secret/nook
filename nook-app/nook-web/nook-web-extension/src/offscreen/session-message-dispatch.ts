import {
  ProviderCredentialStagingKind,
  scrubProviderCredentials,
  type SerializedExtensionStorageProviders,
  stageProviderCredentials,
} from '../lib/provider-credential-staging'
import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  SessionOperationCleanupKind,
  type EnqueueSessionOperationArgs,
  SessionOperationExpiryKind,
  SessionOperationPriority,
  SessionOperationQueue,
} from '../lib/session-operation-queue'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import {
  clearExtensionSessionSensitiveRequest,
  EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS,
  ExtensionSessionQueueKind,
  ExtensionSessionQueuePriority,
  type ExtensionSessionNonImportRequest,
  type ExtensionSessionRequest,
  type ParsedExtensionSessionTransportRequest,
  ExtensionSessionRequestParseKind,
  ExtensionSessionSensitiveStageKind,
  parseExtensionSessionRequest,
  stageExtensionSessionSensitiveRequest,
} from './session-request-adapter'

export { ExtensionSessionMessageType } from '../lib/extension-session-message-type'

enum SensitivePayloadResidencyKind {
  Resident = 'resident',
  Cleared = 'cleared',
}

type SensitivePayloadResidency =
  | {
      kind: SensitivePayloadResidencyKind.Resident
      request: ExtensionSessionNonImportRequest
    }
  | { kind: SensitivePayloadResidencyKind.Cleared }

export type SessionMessageDispatchContext<SessionResponse> = {
  handleMessage: (message: ExtensionSessionRequest) => Promise<SessionResponse>
  decodeProviders: (
    providers: SerializedExtensionStorageProviders,
  ) => Promise<StorageProvider[]>
}

type InvalidProviderPayloadResponse = {
  ok: false
  error: 'invalid-provider-payload'
}

type InvalidSensitivePayloadResponse = {
  ok: false
  error: 'invalid-sensitive-payload'
}

type ExtensionSessionDispatchResponse<SessionResponse> =
  | SessionResponse
  | InvalidProviderPayloadResponse
  | InvalidSensitivePayloadResponse

function sessionMessagePriority(
  type: ExtensionSessionMessageType,
): SessionOperationPriority {
  switch (type) {
    case ExtensionSessionMessageType.Reset:
      return SessionOperationPriority.Expiry
    case ExtensionSessionMessageType.MigrateAuthProviders:
    case ExtensionSessionMessageType.SealIdentityHandoff:
    case ExtensionSessionMessageType.PlanLoginSave:
    case ExtensionSessionMessageType.CommitLoginSave:
    case ExtensionSessionMessageType.RevealLogin:
    case ExtensionSessionMessageType.AuthenticatorCode:
    case ExtensionSessionMessageType.AuthenticatorEnrollConfirm:
    case ExtensionSessionMessageType.AuthenticatorBackupAttach:
    case ExtensionSessionMessageType.ListLogins:
    case ExtensionSessionMessageType.ListAuthenticators:
    case ExtensionSessionMessageType.RegisterPasskey:
    case ExtensionSessionMessageType.AssertPasskey:
    case ExtensionSessionMessageType.BeginPasskeySetup:
    case ExtensionSessionMessageType.UnlockOptions:
    case ExtensionSessionMessageType.UnlockPasskey:
    case ExtensionSessionMessageType.UnlockPin:
      return SessionOperationPriority.Interactive
    case ExtensionSessionMessageType.Status:
    case ExtensionSessionMessageType.FinishPasskeySetup:
    case ExtensionSessionMessageType.RecoverPasskey:
    case ExtensionSessionMessageType.CreatePin:
    case ExtensionSessionMessageType.ImportVault:
    case ExtensionSessionMessageType.UpdateVault:
    case ExtensionSessionMessageType.ListPasskeys:
    case ExtensionSessionMessageType.AuthenticatorEnrollPreview:
    case ExtensionSessionMessageType.AuthenticatorEnrollCode:
    case ExtensionSessionMessageType.PendingLoginSave:
    case ExtensionSessionMessageType.DismissLoginSave:
    case ExtensionSessionMessageType.CancelPasskey:
    case ExtensionSessionMessageType.Lock:
      return SessionOperationPriority.Normal
  }
}

enum RequestedQueueExpiryKind {
  NotRequested = 'not-requested',
  Requested = 'requested',
}

type RequestedQueueExpiry =
  | { kind: RequestedQueueExpiryKind.NotRequested }
  | { kind: RequestedQueueExpiryKind.Requested; expiresAt: number }

function requestedQueueExpiry(
  request: ParsedExtensionSessionTransportRequest,
): RequestedQueueExpiry {
  const { queue } = request.payload
  if (queue.kind === ExtensionSessionQueueKind.MessageDefault) {
    return { kind: RequestedQueueExpiryKind.NotRequested }
  }
  return {
    kind: RequestedQueueExpiryKind.Requested,
    expiresAt: Math.min(
      queue.expiresAt,
      Date.now() + EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS,
    ),
  }
}

enum StagingOwnership {
  Queue = 'queue',
  Operation = 'operation',
  Cleared = 'cleared',
}

type ExtensionSessionMessageDispatcherenqueueSensitiveMessageArgs = {
  request: ExtensionSessionNonImportRequest
  priority: SessionOperationPriority
  expiresAt: number
}

type ExtensionSessionMessageDispatcherenqueueVaultImportArgs = {
  message: Extract<
    ParsedExtensionSessionTransportRequest,
    { type: ExtensionSessionMessageType.ImportVault }
  >
  priority: SessionOperationPriority
  requestedExpiry: RequestedQueueExpiry
}

export class ExtensionSessionMessageDispatcher<SessionResponse> {
  private operations = new SessionOperationQueue()
  private operationGeneration = 0

  constructor(
    private readonly context: SessionMessageDispatchContext<SessionResponse>,
  ) {}

  resetOperations(): void {
    this.operationGeneration += 1
    this.operations = new SessionOperationQueue()
  }

  replaceOperations(error: Error): void {
    const previous = this.operations
    this.operationGeneration += 1
    this.operations = new SessionOperationQueue()
    previous.close(error)
  }

  private enqueueSensitiveMessage({
    request,
    priority,
    expiresAt,
  }: ExtensionSessionMessageDispatcherenqueueSensitiveMessageArgs): Promise<SessionResponse> {
    let payloadResidency: SensitivePayloadResidency = {
      kind: SensitivePayloadResidencyKind.Resident,
      request,
    }
    const clearPending = () => {
      if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared)
        return
      clearExtensionSessionSensitiveRequest(payloadResidency.request)
      payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
    }
    const nookNamedArgs1_0: EnqueueSessionOperationArgs<SessionResponse> = {
      operation: async () => {
        if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared) {
          throw new Error('Extension session request expired.')
        }
        const operationRequest = payloadResidency.request
        payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
        try {
          return await this.context.handleMessage(operationRequest)
        } finally {
          clearExtensionSessionSensitiveRequest(operationRequest)
        }
      },
      options: {
        priority,
        expiry: {
          kind: SessionOperationExpiryKind.Deadline,
          expiresAt,
        },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: clearPending,
        },
      },
    }
    return this.operations.enqueue(nookNamedArgs1_0)
  }

  private async enqueueVaultImport({
    message,
    priority,
    requestedExpiry,
  }: ExtensionSessionMessageDispatcherenqueueVaultImportArgs): Promise<
    ExtensionSessionDispatchResponse<SessionResponse>
  > {
    const payload = message.payload
    const operationGeneration = this.operationGeneration
    if (!Array.isArray(payload.providers)) {
      payload.providers = []
      return { ok: false, error: 'invalid-provider-payload' }
    }
    const providerCandidate: SerializedExtensionStorageProviders =
      payload.providers
    const stagingArgs: Parameters<typeof stageProviderCredentials>[0] = {
      providers: providerCandidate,
      decode: this.context.decodeProviders,
    }
    const stagingOperation = stageProviderCredentials(stagingArgs)
    let stagingOwnership = StagingOwnership.Queue
    const clearQueuedStaging = () => {
      if (stagingOwnership !== StagingOwnership.Queue) return
      stagingOwnership = StagingOwnership.Cleared
      void stagingOperation.then((staging) => {
        if (staging.kind === ProviderCredentialStagingKind.Staged) {
          scrubProviderCredentials(staging.providers)
        }
      })
    }
    payload.providers = []
    scrubProviderCredentials(providerCandidate)
    // Reserve the queue position before cold WASM decoding can yield. Reset
    // must remain a terminal barrier after every import accepted before it.
    const nookNamedArgs1_1: EnqueueSessionOperationArgs<
      ExtensionSessionDispatchResponse<SessionResponse>
    > = {
      operation: async () => {
        stagingOwnership = StagingOwnership.Operation
        const staging = await stagingOperation
        if (operationGeneration !== this.operationGeneration) {
          if (staging.kind === ProviderCredentialStagingKind.Staged) {
            scrubProviderCredentials(staging.providers)
          }
          stagingOwnership = StagingOwnership.Cleared
          throw new Error('Extension session request expired.')
        }
        if (staging.kind === ProviderCredentialStagingKind.InvalidInput) {
          stagingOwnership = StagingOwnership.Cleared
          return {
            ok: false,
            error: 'invalid-provider-payload',
          }
        }
        if (staging.providers.length === 0) {
          stagingOwnership = StagingOwnership.Cleared
          const emptyProviderRequest: Parameters<
            typeof this.context.handleMessage
          >[0] = {
            ...message,
            payload: { ...payload, providers: staging.providers },
          }
          return this.context.handleMessage(emptyProviderRequest)
        }
        const stagedProviders = staging.providers
        try {
          const stagedProviderRequest: Parameters<
            typeof this.context.handleMessage
          >[0] = {
            ...message,
            payload: { ...payload, providers: stagedProviders },
          }
          return await this.context.handleMessage(stagedProviderRequest)
        } finally {
          scrubProviderCredentials(stagedProviders)
          payload.providers = []
          stagingOwnership = StagingOwnership.Cleared
        }
      },
      options: {
        priority,
        expiry:
          requestedExpiry.kind === RequestedQueueExpiryKind.Requested
            ? {
                kind: SessionOperationExpiryKind.Deadline,
                expiresAt: requestedExpiry.expiresAt,
              }
            : { kind: SessionOperationExpiryKind.None },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: clearQueuedStaging,
        },
      },
    }
    return this.operations.enqueue(nookNamedArgs1_1)
  }

  enqueue(
    message: ParsedExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionDispatchResponse<SessionResponse>> {
    const type = message.type
    const requestedExpiry = requestedQueueExpiry(message)
    const priority =
      requestedExpiry.kind === RequestedQueueExpiryKind.Requested
        ? message.payload.queue.kind === ExtensionSessionQueueKind.Deadline &&
          message.payload.queue.priority ===
            ExtensionSessionQueuePriority.Interactive
          ? SessionOperationPriority.Interactive
          : SessionOperationPriority.Probe
        : type === ExtensionSessionMessageType.ImportVault
          ? SessionOperationPriority.Interactive
          : sessionMessagePriority(type)
    if (type === ExtensionSessionMessageType.ImportVault) {
      const nookNamedArgs0_3: Parameters<typeof this.enqueueVaultImport>[0] = {
        message,
        priority,
        requestedExpiry,
      }
      return this.enqueueVaultImport(nookNamedArgs0_3)
    }
    const sensitiveStage = stageExtensionSessionSensitiveRequest(message)
    if (sensitiveStage.kind === ExtensionSessionSensitiveStageKind.Invalid) {
      const invalidSensitiveResponse: InvalidSensitivePayloadResponse = {
        ok: false,
        error: 'invalid-sensitive-payload',
      }
      return Promise.resolve(invalidSensitiveResponse)
    }
    if (sensitiveStage.kind === ExtensionSessionSensitiveStageKind.Staged) {
      const nookNamedArgs0_4: Parameters<
        typeof this.enqueueSensitiveMessage
      >[0] = {
        request: sensitiveStage.request,
        priority,
        expiresAt:
          requestedExpiry.kind === RequestedQueueExpiryKind.Requested
            ? requestedExpiry.expiresAt
            : Date.now() + EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS,
      }
      return this.enqueueSensitiveMessage(nookNamedArgs0_4)
    }

    const nookNamedArgs0_5: EnqueueSessionOperationArgs<SessionResponse> = {
      operation: () => this.context.handleMessage(message),
      options: {
        priority,
        expiry:
          requestedExpiry.kind === RequestedQueueExpiryKind.Requested
            ? {
                kind: SessionOperationExpiryKind.Deadline,
                expiresAt: requestedExpiry.expiresAt,
              }
            : priority === SessionOperationPriority.Interactive
              ? {
                  kind: SessionOperationExpiryKind.Deadline,
                  expiresAt:
                    Date.now() + EXTENSION_SESSION_INTERACTIVE_TIMEOUT_MS,
                }
              : { kind: SessionOperationExpiryKind.None },
        cleanup: { kind: SessionOperationCleanupKind.None },
      },
    }
    return this.operations.enqueue(nookNamedArgs0_5)
  }

  registerRuntimeListener(): void {
    // eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return false
      if (
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        typeof message.type !== 'string' ||
        !message.type.startsWith('nook:extension-session-') ||
        message.type === ExtensionSessionMessageType.Lock
      ) {
        return false
      }
      void parseExtensionSessionRequest(message).then((parsed) => {
        if (parsed.kind === ExtensionSessionRequestParseKind.Invalid) {
          const invalidResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
            error: 'Invalid extension session request.',
          }
          sendResponse(invalidResponse)
          return
        }
        const request = parsed.request
        const type = request.type
        const serviceWorkerOnly =
          type === ExtensionSessionMessageType.SealIdentityHandoff ||
          type === ExtensionSessionMessageType.CancelPasskey
        const serviceWorkerSender =
          !sender.tab &&
          (!sender.url ||
            sender.url ===
              chrome.runtime.getURL('background/service-worker.js'))
        if (
          (serviceWorkerOnly && !serviceWorkerSender) ||
          !type.startsWith('nook:extension-session-')
        ) {
          const forbiddenResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
            error: 'Forbidden extension session request.',
          }
          sendResponse(forbiddenResponse)
          return
        }
        const direct =
          type === ExtensionSessionMessageType.DismissLoginSave ||
          type === ExtensionSessionMessageType.CancelPasskey
        const response = direct
          ? this.context.handleMessage(request)
          : this.enqueue(request)
        void response
          .then((value) => sendResponse(value))
          .catch((error) => {
            const nookArrowArgs0: Parameters<typeof sendResponse>[0] = {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Extension session failed.',
            }
            return sendResponse(nookArrowArgs0)
          })
      })
      return true
    })
  }
}
