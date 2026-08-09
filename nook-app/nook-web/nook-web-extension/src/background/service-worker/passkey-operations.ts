import {
  isWebsitePasskeyCancelMessage,
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
  websitePasskeyRequestJson,
  type WebsitePasskeyCredentialSelection,
  WebsitePasskeyCredentialSelectionKind,
  WebsitePasskeyCeremony,
  type WebsitePasskeyRequestJsonArgs,
} from '../../lib/webauthn-messages'
import {
  isAuthorizedWebsiteSender,
  passkeyPairingGrants,
  requestOriginAndRpId,
  sendSessionMessage,
  WebsitePasskeyRequestContextKind,
} from './pairing-identity'
import {
  ensureExtensionSessionDocument,
  isUnlockedSessionStatus,
} from './session-lifecycle'

const pendingWebsitePasskeyRequests = new Set<string>()

function passkeyRequestKey(
  sender: chrome.runtime.MessageSender,
  requestId: string,
): string {
  return `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${requestId}`
}

const PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS = 1500

async function matchingPasskeyAccountCountForOrigin(
  origin: string,
  queueExpiresAt: number,
): Promise<number> {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return 0
  }
  if (!hostname) return 0
  const grants = await passkeyPairingGrants()
  if (grants.length === 0) return 0
  try {
    await ensureExtensionSessionDocument()
  } catch {
    return 0
  }
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt },
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    return 0
  }
  let count = 0
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-passkeys',
      payload: { ...grant, rpId: hostname, origin, queueExpiresAt },
    })
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'accounts' in response &&
      Array.isArray(response.accounts)
    ) {
      count += response.accounts.length
    }
  }
  return Math.min(count, 100)
}

export /** Never fail a workflow snapshot on passkey lookup; slow/failed → 0. */
async function matchingPasskeyAccountCountForOriginSafe(
  origin: string,
): Promise<number> {
  const queueExpiresAt = Date.now() + PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS
  try {
    return await Promise.race([
      matchingPasskeyAccountCountForOrigin(origin, queueExpiresAt),
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS)
      }),
    ])
  } catch {
    return 0
  }
}

export async function websitePasskeyOptions(
  message: Parameters<typeof isWebsitePasskeyOptionsMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      expiresAt: number
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const context = requestOriginAndRpId(
    message.payload.ceremony,
    message.payload.requestJson,
  )
  if (
    context.kind === WebsitePasskeyRequestContextKind.Rejected ||
    !isAuthorizedWebsiteSender(sender, context.origin)
  ) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const grants = await passkeyPairingGrants()
  if (grants.length === 0)
    return { ok: true, status: 'unavailable', options: [] }
  await ensureExtensionSessionDocument()
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt: message.payload.expiresAt },
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    return { ok: true, status: 'locked', options: [] }
  }
  if (message.payload.ceremony === WebsitePasskeyCeremony.Create) {
    return {
      ok: true,
      status: 'ready',
      options: grants.map((grant) => ({
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
      })),
    }
  }
  const options: unknown[] = []
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-passkeys',
      payload: {
        ...grant,
        rpId: context.rpId,
        origin: context.origin,
        queueExpiresAt: message.payload.expiresAt,
      },
    })
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'accounts' in response &&
      Array.isArray(response.accounts)
    ) {
      for (const account of response.accounts) {
        options.push({
          vaultStoreId: grant.vaultStoreId,
          vaultName: grant.vaultName,
          account,
        })
      }
    }
  }
  return { ok: true, status: 'ready', options }
}

export async function performWebsitePasskey(
  message: Parameters<typeof isWebsitePasskeyPerformMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      expiresAt: number
      vaultStoreId: string
      credentialId?: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const context = requestOriginAndRpId(
    message.payload.ceremony,
    message.payload.requestJson,
  )
  if (
    context.kind === WebsitePasskeyRequestContextKind.Rejected ||
    !isAuthorizedWebsiteSender(sender, context.origin)
  ) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const key = passkeyRequestKey(sender, message.payload.requestId)
  if (pendingWebsitePasskeyRequests.has(key)) {
    return { ok: false, reason: 'passkey-request-already-pending' }
  }
  pendingWebsitePasskeyRequests.add(key)
  try {
    const grant = (await passkeyPairingGrants()).find(
      (candidate) => candidate.vaultStoreId === message.payload.vaultStoreId,
    )
    if (!grant) return { ok: false, reason: 'passkey-vault-not-granted' }
    const credentialSelection: WebsitePasskeyCredentialSelection = message
      .payload.credentialId
      ? {
          kind: WebsitePasskeyCredentialSelectionKind.Selected,
          credentialId: message.payload.credentialId,
        }
      : { kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults }
    const requestJsonArgs: WebsitePasskeyRequestJsonArgs = {
      request: context.request,
      credentialSelection,
    }
    await ensureExtensionSessionDocument()
    return sendSessionMessage({
      type:
        message.payload.ceremony === WebsitePasskeyCeremony.Create
          ? 'nook:extension-session-register-passkey'
          : 'nook:extension-session-assert-passkey',
      payload: {
        ...grant,
        requestId: message.payload.requestId,
        requestJson: websitePasskeyRequestJson(requestJsonArgs),
        queueExpiresAt: message.payload.expiresAt,
        queuePriority: 'interactive',
      },
    })
  } finally {
    pendingWebsitePasskeyRequests.delete(key)
  }
}

export async function cancelWebsitePasskey(
  message: Parameters<typeof isWebsitePasskeyCancelMessage>[0] & {
    payload: { requestId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: true }> {
  const key = passkeyRequestKey(sender, message.payload.requestId)
  if (!pendingWebsitePasskeyRequests.has(key)) return { ok: true }
  await ensureExtensionSessionDocument()
  await sendSessionMessage({
    type: 'nook:extension-session-cancel-passkey',
    payload: { requestId: message.payload.requestId },
  })
  return { ok: true }
}
