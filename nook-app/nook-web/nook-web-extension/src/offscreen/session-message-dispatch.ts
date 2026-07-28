import {
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../lib/provider-credential-staging'
import {
  SessionOperationQueue,
  type SessionOperationPriority,
} from '../lib/session-operation-queue'

const INTERACTIVE_QUEUE_TIMEOUT_MS = 5_000

type SessionMessageDispatchContext = {
  handleMessage: (message: unknown) => Promise<unknown>
  messagePayload: (message: unknown) => Record<string, unknown>
  messageType: (message: unknown) => string | undefined
}

function sessionMessagePriority(type: string): SessionOperationPriority {
  switch (type) {
    case 'nook:extension-session-reset':
      return 'expiry'
    case 'nook:extension-session-migrate-auth-providers':
    case 'nook:extension-session-seal-identity-handoff':
    case 'nook:extension-session-plan-login-save':
    case 'nook:extension-session-commit-login-save':
    case 'nook:extension-session-reveal-login':
    case 'nook:extension-session-authenticator-code':
    case 'nook:extension-session-authenticator-enroll-confirm':
    case 'nook:extension-session-authenticator-backup-attach':
    case 'nook:extension-session-list-logins':
    case 'nook:extension-session-list-authenticators':
    case 'nook:extension-session-register-passkey':
    case 'nook:extension-session-assert-passkey':
    case 'nook:extension-session-begin-passkey-setup':
    case 'nook:extension-session-unlock-options':
    case 'nook:extension-session-unlock-passkey':
    case 'nook:extension-session-unlock-pin':
      return 'interactive'
    default:
      return 'normal'
  }
}

function requestedQueueExpiry(
  payload: Record<string, unknown>,
): number | undefined {
  const value = payload.queueExpiresAt
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(value, Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS)
}

const sensitiveSessionFields: Readonly<
  Record<string, readonly string[] | undefined>
> = {
  'nook:extension-session-finish-passkey-setup': [
    'credentialId',
    'userHandle',
    'prfInput',
    'prfOutput',
  ],
  'nook:extension-session-recover-passkey': [
    'credentialId',
    'userHandle',
    'prfOutput',
  ],
  'nook:extension-session-unlock-passkey': ['prfOutput'],
  'nook:extension-session-create-pin': ['pin'],
  'nook:extension-session-unlock-pin': ['pin'],
  'nook:extension-session-plan-login-save': ['password'],
  'nook:extension-session-authenticator-enroll-preview': ['otpauthUri'],
  'nook:extension-session-authenticator-enroll-code': ['otpauthUri'],
  'nook:extension-session-authenticator-enroll-confirm': ['otpauthUri'],
  'nook:extension-session-authenticator-backup-attach': ['codes'],
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
    let pendingPayload: Record<string, unknown> | undefined = { ...payload }
    for (const field of fields) {
      pendingPayload[field] = copySensitiveValue(payload[field])
      clearSensitiveValue(payload[field])
      payload[field] = typeof payload[field] === 'string' ? '' : []
    }
    const clearPending = () => {
      if (!pendingPayload) return
      for (const field of fields) {
        clearSensitiveValue(pendingPayload[field])
        pendingPayload[field] = undefined
      }
      pendingPayload = undefined
    }
    return this.operations.enqueue(
      async () => {
        const operationPayload = pendingPayload
        pendingPayload = undefined
        if (!operationPayload) {
          throw new Error('Extension session request expired.')
        }
        try {
          return await this.context.handleMessage({
            ...message,
            payload: operationPayload,
          })
        } finally {
          for (const field of fields) {
            clearSensitiveValue(operationPayload[field])
            operationPayload[field] = undefined
          }
        }
      },
      {
        priority: 'interactive',
        expiresAt: Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS,
        onExpire: clearPending,
      },
    )
  }

  private enqueueVaultImport(
    message: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const stagedProviders = stageProviderCredentials(payload.providers)
    // Pairing imports are one-shot and may run against a cold offscreen WASM
    // runtime. Never expire them with the short interactive probe budget.
    if (!stagedProviders || stagedProviders.length === 0) {
      return this.operations.enqueue(
        () =>
          this.context.handleMessage({
            ...message,
            payload: {
              ...payload,
              providers: stagedProviders ?? payload.providers ?? [],
            },
          }),
        { priority: 'interactive' },
      )
    }
    payload.providers = []
    let pendingPayload: Record<string, unknown> | undefined = {
      ...payload,
      providers: stagedProviders,
    }
    const clearPending = () => {
      if (!pendingPayload) return
      scrubProviderCredentials(pendingPayload.providers)
      pendingPayload = undefined
    }
    return this.operations.enqueue(
      async () => {
        const operationPayload = pendingPayload
        pendingPayload = undefined
        if (!operationPayload) {
          throw new Error('Extension session request expired.')
        }
        try {
          return await this.context.handleMessage({
            ...message,
            payload: operationPayload,
          })
        } finally {
          scrubProviderCredentials(operationPayload.providers)
          operationPayload.providers = []
        }
      },
      {
        priority: 'interactive',
        onExpire: clearPending,
      },
    )
  }

  enqueue(message: unknown): Promise<unknown> {
    const type = this.context.messageType(message)
    if (!type) return Promise.resolve(undefined)
    const payload = this.context.messagePayload(message)
    if (type === 'nook:extension-session-import-vault') {
      return this.enqueueVaultImport(
        message as Record<string, unknown>,
        payload,
      )
    }
    const requestedExpiry = requestedQueueExpiry(payload)
    const priority = requestedExpiry
      ? payload.queuePriority === 'interactive'
        ? 'interactive'
        : 'probe'
      : sessionMessagePriority(type)
    const sensitiveFields = sensitiveSessionFields[type]
    if (sensitiveFields) {
      return this.enqueueSensitiveMessage(
        message as Record<string, unknown>,
        payload,
        sensitiveFields,
      )
    }

    const expiresAt =
      requestedExpiry ??
      (priority === 'interactive'
        ? Date.now() + INTERACTIVE_QUEUE_TIMEOUT_MS
        : undefined)
    return this.operations.enqueue(() => this.context.handleMessage(message), {
      priority,
      expiresAt,
    })
  }

  registerRuntimeListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = this.context.messageType(message)
      if (type === 'nook:extension-session-lock') return false
      const serviceWorkerOnly =
        type === 'nook:extension-session-seal-identity-handoff' ||
        type === 'nook:extension-session-cancel-passkey'
      const serviceWorkerSender =
        sender.tab === undefined &&
        (sender.url === undefined ||
          sender.url === chrome.runtime.getURL('background/service-worker.js'))
      if (
        sender.id !== chrome.runtime.id ||
        (serviceWorkerOnly && !serviceWorkerSender) ||
        !type?.startsWith('nook:extension-session-')
      ) {
        return false
      }
      const direct =
        type === 'nook:extension-session-dismiss-login-save' ||
        type === 'nook:extension-session-cancel-passkey'
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
