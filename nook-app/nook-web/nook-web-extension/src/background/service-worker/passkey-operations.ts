import {
  isWebsitePasskeyCancelMessage,
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
  websitePasskeyRequestJson,
  type WebsitePasskeyCredentialSelection,
  WebsitePasskeyCredentialSelectionKind,
  WebsitePasskeyCeremony,
  type WebsitePasskeyRequestJsonArgs,
  type WebsitePasskeyOptionsResponse,
  type WebsitePasskeyPerformResponse,
  type WebsitePasskeyVaultOption,
} from '../../lib/webauthn-messages'
import {
  passkeyAccountsFromSession,
  passkeyCeremonyResponseFromSession,
} from './passkey-session-adapter'
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

function passkeyRequestKey({
  sender,
  requestId,
}: {
  sender: chrome.runtime.MessageSender
  requestId: string
}): string {
  return `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${requestId}`
}

const PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS = 1500

async function matchingPasskeyAccountCountForOrigin({
  origin,
  queueExpiresAt,
}: {
  origin: string
  queueExpiresAt: number
}): Promise<number> {
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
  const nookTypedArgs0_0: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt },
  }
  const status = await sendSessionMessage(nookTypedArgs0_0)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    return 0
  }
  let count = 0
  for (const grant of grants) {
    const nookTypedArgs0_1: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-passkeys',
      payload: { ...grant, rpId: hostname, origin, queueExpiresAt },
    }
    const response = await sendSessionMessage(nookTypedArgs0_1)
    count += passkeyAccountsFromSession(response).length
  }
  return Math.min(count, 100)
}

export /** Never fail a workflow snapshot on passkey lookup; slow/failed → 0. */
async function matchingPasskeyAccountCountForOriginSafe(
  origin: string,
): Promise<number> {
  const queueExpiresAt = Date.now() + PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS
  try {
    const nookTypedArgs0_0: Parameters<
      typeof matchingPasskeyAccountCountForOrigin
    >[0] = { origin, queueExpiresAt }
    return await Promise.race([
      matchingPasskeyAccountCountForOrigin(nookTypedArgs0_0),
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS)
      }),
    ])
  } catch {
    return 0
  }
}

export async function websitePasskeyOptions({
  message,
  sender,
}: {
  message: Parameters<typeof isWebsitePasskeyOptionsMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      expiresAt: number
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<WebsitePasskeyOptionsResponse> {
  const nookTypedArgs0_2: Parameters<typeof requestOriginAndRpId>[0] = {
    ceremony: message.payload.ceremony,
    requestJson: message.payload.requestJson,
  }
  const context = requestOriginAndRpId(nookTypedArgs0_2)
  if (context.kind === WebsitePasskeyRequestContextKind.Rejected) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const nookNamedArgs0_0: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: context.origin,
  }
  if (!isAuthorizedWebsiteSender(nookNamedArgs0_0)) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const grants = await passkeyPairingGrants()
  if (grants.length === 0)
    return { ok: true, status: 'unavailable', options: [] }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_3: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt: message.payload.expiresAt },
  }
  const status = await sendSessionMessage(nookTypedArgs0_3)
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
  const options: WebsitePasskeyVaultOption[] = []
  for (const grant of grants) {
    const nookTypedArgs0_4: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-passkeys',
      payload: {
        ...grant,
        rpId: context.rpId,
        origin: context.origin,
        queueExpiresAt: message.payload.expiresAt,
      },
    }
    const response = await sendSessionMessage(nookTypedArgs0_4)
    const accounts = passkeyAccountsFromSession(response)
    if (accounts.length > 0) {
      for (const account of accounts) {
        const nookTypedArgs0_5: Parameters<typeof options.push>[0] = {
          vaultStoreId: grant.vaultStoreId,
          vaultName: grant.vaultName,
          account,
        }
        options.push(nookTypedArgs0_5)
      }
    }
  }
  return { ok: true, status: 'ready', options }
}

export async function performWebsitePasskey({
  message,
  sender,
}: {
  message: Parameters<typeof isWebsitePasskeyPerformMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      expiresAt: number
      vaultStoreId: string
      credentialId?: string
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<WebsitePasskeyPerformResponse> {
  const nookTypedArgs0_6: Parameters<typeof requestOriginAndRpId>[0] = {
    ceremony: message.payload.ceremony,
    requestJson: message.payload.requestJson,
  }
  const context = requestOriginAndRpId(nookTypedArgs0_6)
  if (context.kind === WebsitePasskeyRequestContextKind.Rejected) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const nookNamedArgs0_1: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: context.origin,
  }
  if (!isAuthorizedWebsiteSender(nookNamedArgs0_1)) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const nookTypedArgs0_1: Parameters<typeof passkeyRequestKey>[0] = {
    sender,
    requestId: message.payload.requestId,
  }
  const key = passkeyRequestKey(nookTypedArgs0_1)
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
    const nookTypedArgs0_7: Parameters<typeof sendSessionMessage>[0] = {
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
    }
    return passkeyCeremonyResponseFromSession(
      await sendSessionMessage(nookTypedArgs0_7),
    )
  } finally {
    pendingWebsitePasskeyRequests.delete(key)
  }
}

export async function cancelWebsitePasskey({
  message,
  sender,
}: {
  message: Parameters<typeof isWebsitePasskeyCancelMessage>[0] & {
    payload: { requestId: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<{ ok: true }> {
  const nookTypedArgs0_2: Parameters<typeof passkeyRequestKey>[0] = {
    sender,
    requestId: message.payload.requestId,
  }
  const key = passkeyRequestKey(nookTypedArgs0_2)
  if (!pendingWebsitePasskeyRequests.has(key)) return { ok: true }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_8: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-cancel-passkey',
    payload: { requestId: message.payload.requestId },
  }
  await sendSessionMessage(nookTypedArgs0_8)
  return { ok: true }
}
