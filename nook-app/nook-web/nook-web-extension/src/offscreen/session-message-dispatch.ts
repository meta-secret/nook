import type { ExternalValue } from '../lib/external-value'
import {
  ProviderCredentialStagingKind,
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../lib/provider-credential-staging'
import {
  SessionOperationPriority,
  SessionOperationQueue,
} from '../lib/session-operation-queue'

const INTERACTIVE_QUEUE_TIMEOUT_MS = 5_000

enum SensitivePayloadResidencyKind {
  Resident = 'resident',
  Cleared = 'cleared',
}

type SensitivePayloadResidency =
  | {
      kind: SensitivePayloadResidencyKind.Resident
      payload: Record<string, unknown>
    }
  | { kind: SensitivePayloadResidencyKind.Cleared }

type SessionMessageDispatchContext = {
  handleMessage: (message: unknown) => Promise<unknown>
  messagePayload: (message: unknown) => Record<string, unknown>
}

export enum ExtensionSessionMessageType {
  Reset = 'nook:extension-session-reset',
  MigrateAuthProviders = 'nook:extension-session-migrate-auth-providers',
  Status = 'nook:extension-session-status',
  BeginPasskeySetup = 'nook:extension-session-begin-passkey-setup',
  FinishPasskeySetup = 'nook:extension-session-finish-passkey-setup',
  RecoverPasskey = 'nook:extension-session-recover-passkey',
  UnlockOptions = 'nook:extension-session-unlock-options',
  UnlockPasskey = 'nook:extension-session-unlock-passkey',
  CreatePin = 'nook:extension-session-create-pin',
  UnlockPin = 'nook:extension-session-unlock-pin',
  SealIdentityHandoff = 'nook:extension-session-seal-identity-handoff',
  ImportVault = 'nook:extension-session-import-vault',
  UpdateVault = 'nook:extension-session-update-vault',
  ListPasskeys = 'nook:extension-session-list-passkeys',
  ListLogins = 'nook:extension-session-list-logins',
  RevealLogin = 'nook:extension-session-reveal-login',
  ListAuthenticators = 'nook:extension-session-list-authenticators',
  AuthenticatorCode = 'nook:extension-session-authenticator-code',
  AuthenticatorEnrollPreview = 'nook:extension-session-authenticator-enroll-preview',
  AuthenticatorEnrollCode = 'nook:extension-session-authenticator-enroll-code',
  AuthenticatorEnrollConfirm = 'nook:extension-session-authenticator-enroll-confirm',
  AuthenticatorBackupAttach = 'nook:extension-session-authenticator-backup-attach',
  PlanLoginSave = 'nook:extension-session-plan-login-save',
  PendingLoginSave = 'nook:extension-session-pending-login-save',
  CommitLoginSave = 'nook:extension-session-commit-login-save',
  DismissLoginSave = 'nook:extension-session-dismiss-login-save',
  CancelPasskey = 'nook:extension-session-cancel-passkey',
  RegisterPasskey = 'nook:extension-session-register-passkey',
  AssertPasskey = 'nook:extension-session-assert-passkey',
  Lock = 'nook:extension-session-lock',
}

export enum SessionMessageTypeParseKind {
  Invalid = 'invalid',
  Parsed = 'parsed',
}

export type SessionMessageTypeParse =
  | { kind: SessionMessageTypeParseKind.Invalid }
  | {
      kind: SessionMessageTypeParseKind.Parsed
      messageType: ExtensionSessionMessageType
    }

const extensionSessionMessageTypes = new Set<string>(
  Object.values(ExtensionSessionMessageType),
)

export function parseExtensionSessionMessageType(
  message: unknown,
): SessionMessageTypeParse {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return { kind: SessionMessageTypeParseKind.Invalid }
  }
  if (
    typeof message.type !== 'string' ||
    !extensionSessionMessageTypes.has(message.type)
  ) {
    return { kind: SessionMessageTypeParseKind.Invalid }
  }
  return {
    kind: SessionMessageTypeParseKind.Parsed,
    messageType: message.type as ExtensionSessionMessageType,
  }
}

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
  payload: Record<string, unknown>,
): RequestedQueueExpiry {
  const value = payload.queueExpiresAt
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { kind: RequestedQueueExpiryKind.NotRequested }
  }
  return {
    kind: RequestedQueueExpiryKind.Requested,
    expiresAt: Math.min(value, Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS),
  }
}

const sensitiveSessionFields: Readonly<
  Partial<Record<ExtensionSessionMessageType, readonly string[]>>
> = {
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
  [ExtensionSessionMessageType.UnlockPasskey]: ['prfOutput'],
  [ExtensionSessionMessageType.CreatePin]: ['pin'],
  [ExtensionSessionMessageType.UnlockPin]: ['pin'],
  [ExtensionSessionMessageType.PlanLoginSave]: ['password'],
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]: ['codes'],
}

function copySensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return value
}

function clearSensitiveValue(value: unknown): void {
  if (Array.isArray(value) || value instanceof Uint8Array) value.fill(0)
}

export class ExtensionSessionMessageDispatcher {
  private operations = new SessionOperationQueue()

  constructor(private readonly context: SessionMessageDispatchContext) {}

  resetOperations(): void {
    this.operations = new SessionOperationQueue()
  }

  replaceOperations(error: Error): void {
    const previous = this.operations
    this.operations = new SessionOperationQueue()
    previous.close(error)
  }

  private enqueueSensitiveMessage(
    message: Record<string, unknown>,
    payload: Record<string, unknown>,
    fields: readonly string[],
  ): Promise<unknown> {
    let payloadResidency: SensitivePayloadResidency = {
      kind: SensitivePayloadResidencyKind.Resident,
      payload: { ...payload },
    }
    for (const field of fields) {
      if (payloadResidency.kind === SensitivePayloadResidencyKind.Resident) {
        payloadResidency.payload[field] = copySensitiveValue(payload[field])
      }
      clearSensitiveValue(payload[field])
      payload[field] = typeof payload[field] === 'string' ? '' : []
    }
    const clearPending = () => {
      if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared)
        return
      for (const field of fields) {
        clearSensitiveValue(payloadResidency.payload[field])
        delete payloadResidency.payload[field]
      }
      payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
    }
    return this.operations.enqueue({
      operation: async () => {
        if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared) {
          throw new Error('Extension session request expired.')
        }
        const operationPayload = payloadResidency.payload
        payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
        try {
          return await this.context.handleMessage({
            ...message,
            payload: operationPayload,
          })
        } finally {
          for (const field of fields) {
            clearSensitiveValue(operationPayload[field])
            delete operationPayload[field]
          }
        }
      },
      options: {
        priority: SessionOperationPriority.Interactive,
        expiresAt: Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS,
        onExpire: clearPending,
      },
    })
  }

  private enqueueVaultImport(
    message: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const staging = stageProviderCredentials(payload.providers as ExternalValue)
    // Pairing imports are one-shot and may run against a cold offscreen WASM
    // runtime. Never expire them with the short interactive probe budget.
    if (
      staging.kind === ProviderCredentialStagingKind.InvalidInput ||
      staging.providers.length === 0
    ) {
      return this.operations.enqueue({
        operation: () =>
          this.context.handleMessage({
            ...message,
            payload: {
              ...payload,
              providers:
                staging.kind === ProviderCredentialStagingKind.Staged
                  ? staging.providers
                  : Array.isArray(payload.providers)
                    ? payload.providers
                    : [],
            },
          }),
        options: { priority: SessionOperationPriority.Interactive },
      })
    }
    const stagedProviders = staging.providers
    payload.providers = []
    let payloadResidency: SensitivePayloadResidency = {
      kind: SensitivePayloadResidencyKind.Resident,
      payload: { ...payload, providers: stagedProviders },
    }
    const clearPending = () => {
      if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared)
        return
      scrubProviderCredentials(
        payloadResidency.payload.providers as ExternalValue,
      )
      payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
    }
    return this.operations.enqueue({
      operation: async () => {
        if (payloadResidency.kind === SensitivePayloadResidencyKind.Cleared) {
          throw new Error('Extension session request expired.')
        }
        const operationPayload = payloadResidency.payload
        payloadResidency = { kind: SensitivePayloadResidencyKind.Cleared }
        try {
          return await this.context.handleMessage({
            ...message,
            payload: operationPayload,
          })
        } finally {
          scrubProviderCredentials(operationPayload.providers as ExternalValue)
          operationPayload.providers = []
        }
      },
      options: {
        priority: SessionOperationPriority.Interactive,
        onExpire: clearPending,
      },
    })
  }

  enqueue(message: unknown): Promise<unknown> {
    const parsedType = parseExtensionSessionMessageType(message)
    if (parsedType.kind === SessionMessageTypeParseKind.Invalid) {
      return Promise.resolve()
    }
    const type = parsedType.messageType
    const payload = this.context.messagePayload(message)
    if (type === ExtensionSessionMessageType.ImportVault) {
      return this.enqueueVaultImport(
        message as Record<string, unknown>,
        payload,
      )
    }
    const requestedExpiry = requestedQueueExpiry(payload)
    const priority =
      requestedExpiry.kind === RequestedQueueExpiryKind.Requested
        ? payload.queuePriority === 'interactive'
          ? SessionOperationPriority.Interactive
          : SessionOperationPriority.Probe
        : sessionMessagePriority(type)
    const sensitiveFields = sensitiveSessionFields[type]
    if (sensitiveFields) {
      return this.enqueueSensitiveMessage(
        message as Record<string, unknown>,
        payload,
        sensitiveFields,
      )
    }

    return this.operations.enqueue({
      operation: () => this.context.handleMessage(message),
      options: {
        priority,
        ...(requestedExpiry.kind === RequestedQueueExpiryKind.Requested
          ? { expiresAt: requestedExpiry.expiresAt }
          : priority === SessionOperationPriority.Interactive
            ? { expiresAt: Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS }
            : {}),
      },
    })
  }

  registerRuntimeListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const parsedType = parseExtensionSessionMessageType(message)
      if (parsedType.kind === SessionMessageTypeParseKind.Invalid) return false
      const type = parsedType.messageType
      if (type === ExtensionSessionMessageType.Lock) return false
      const serviceWorkerOnly =
        type === ExtensionSessionMessageType.SealIdentityHandoff ||
        type === ExtensionSessionMessageType.CancelPasskey
      const serviceWorkerSender =
        !sender.tab &&
        (!sender.url ||
          sender.url === chrome.runtime.getURL('background/service-worker.js'))
      if (
        sender.id !== chrome.runtime.id ||
        (serviceWorkerOnly && !serviceWorkerSender) ||
        !type.startsWith('nook:extension-session-')
      ) {
        return false
      }
      const direct =
        type === ExtensionSessionMessageType.DismissLoginSave ||
        type === ExtensionSessionMessageType.CancelPasskey
      const response = direct
        ? this.context.handleMessage(message)
        : this.enqueue(message)
      void response
        .then((value) => sendResponse(value))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Extension session failed.',
          }),
        )
      return true
    })
  }
}
