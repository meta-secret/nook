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
  WebsitePasskeyOptionsStatus,
  type WebsitePasskeyPerformResponse,
  type WebsitePasskeyVaultOption,
} from '../../lib/webauthn-messages'
import {
  extensionSessionPasskeyCeremonyDeadline,
  extensionSessionProbeDeadline,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import {
  PasskeyAccountListKind,
  passkeyAccountListFromSession,
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
import { extensionSessionGrantIdentity } from '../pairing-grants'

const pendingWebsitePasskeyRequests = new Set<string>()

type PasskeyRequestKeyArgs = {
  sender: chrome.runtime.MessageSender
  requestId: string
}

function passkeyRequestKey({
  sender,
  requestId,
}: PasskeyRequestKeyArgs): string {
  return `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${requestId}`
}

const PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS = 1500

export enum MatchingPasskeyAvailabilityKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type MatchingPasskeyAvailability =
  | { kind: MatchingPasskeyAvailabilityKind.Ready; accountCount: number }
  | { kind: MatchingPasskeyAvailabilityKind.Unavailable }

type PasskeyAccountCountForClassificationArgs = {
  needsPasskeyLookup: boolean
  availability: MatchingPasskeyAvailability
}

export function passkeyAccountCountForClassification({
  needsPasskeyLookup,
  availability,
}: PasskeyAccountCountForClassificationArgs): number {
  if (!needsPasskeyLookup) return 0
  if (availability.kind === MatchingPasskeyAvailabilityKind.Unavailable) {
    return 0
  }
  return availability.accountCount
}

type MatchingPasskeyAvailabilityForOriginArgs = {
  origin: string
  queueExpiresAt: number
}

async function matchingPasskeyAvailabilityForOrigin({
  origin,
  queueExpiresAt,
}: MatchingPasskeyAvailabilityForOriginArgs): Promise<MatchingPasskeyAvailability> {
  const unavailable: MatchingPasskeyAvailability = {
    kind: MatchingPasskeyAvailabilityKind.Unavailable,
  }
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return unavailable
  }
  if (!hostname) return unavailable
  const grants = await passkeyPairingGrants()
  if (grants.length === 0) {
    return { kind: MatchingPasskeyAvailabilityKind.Ready, accountCount: 0 }
  }
  try {
    await ensureExtensionSessionDocument()
  } catch {
    return unavailable
  }
  const nookTypedArgs0_0: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionProbeDeadline(queueExpiresAt) },
  }
  const status = await sendSessionMessage(nookTypedArgs0_0)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    return unavailable
  }
  let count = 0
  for (const grant of grants) {
    const nookTypedArgs0_1: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-passkeys',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        rpId: hostname,
        origin,
        queue: extensionSessionProbeDeadline(queueExpiresAt),
      },
    }
    const response = await sendSessionMessage(nookTypedArgs0_1)
    const accountList = passkeyAccountListFromSession(response)
    if (accountList.kind === PasskeyAccountListKind.Invalid) return unavailable
    count += accountList.accounts.length
  }
  return {
    kind: MatchingPasskeyAvailabilityKind.Ready,
    accountCount: count,
  }
}

export /** Never fail a workflow snapshot; slow, locked, or failed stays unavailable. */
async function matchingPasskeyAvailabilityForOriginSafe(
  origin: string,
): Promise<MatchingPasskeyAvailability> {
  const queueExpiresAt = Date.now() + PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS
  const unavailable: MatchingPasskeyAvailability = {
    kind: MatchingPasskeyAvailabilityKind.Unavailable,
  }
  try {
    const nookTypedArgs0_0: Parameters<
      typeof matchingPasskeyAvailabilityForOrigin
    >[0] = { origin, queueExpiresAt }
    return await Promise.race([
      matchingPasskeyAvailabilityForOrigin(nookTypedArgs0_0),
      new Promise<MatchingPasskeyAvailability>((resolve) => {
        setTimeout(
          () => resolve(unavailable),
          PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS,
        )
      }),
    ])
  } catch {
    return unavailable
  }
}

type WebsitePasskeyOptionsArgs = {
  message: Parameters<typeof isWebsitePasskeyOptionsMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      expiresAt: number
    }
  }
  sender: chrome.runtime.MessageSender
  dependencies?: WebsitePasskeyOptionsDependencies
}

export type WebsitePasskeyOptionsDependencies = {
  ensureExtensionSessionDocument: typeof ensureExtensionSessionDocument
  isAuthorizedWebsiteSender: typeof isAuthorizedWebsiteSender
  isUnlockedSessionStatus: typeof isUnlockedSessionStatus
  passkeyPairingGrants: typeof passkeyPairingGrants
  requestOriginAndRpId: typeof requestOriginAndRpId
  sendSessionMessage: typeof sendSessionMessage
}

const websitePasskeyOptionsDependencies: WebsitePasskeyOptionsDependencies = {
  ensureExtensionSessionDocument,
  isAuthorizedWebsiteSender,
  isUnlockedSessionStatus,
  passkeyPairingGrants,
  requestOriginAndRpId,
  sendSessionMessage,
}

export async function websitePasskeyOptions({
  message,
  sender,
  dependencies,
}: WebsitePasskeyOptionsArgs): Promise<WebsitePasskeyOptionsResponse> {
  const resolvedDependencies = dependencies ?? websitePasskeyOptionsDependencies
  const nookTypedArgs0_2: Parameters<typeof requestOriginAndRpId>[0] = {
    ceremony: message.payload.ceremony,
    requestJson: message.payload.requestJson,
  }
  const context = resolvedDependencies.requestOriginAndRpId(nookTypedArgs0_2)
  if (context.kind === WebsitePasskeyRequestContextKind.Rejected) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const nookNamedArgs0_0: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: context.origin,
  }
  if (!resolvedDependencies.isAuthorizedWebsiteSender(nookNamedArgs0_0)) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const grants = await resolvedDependencies.passkeyPairingGrants()
  if (grants.length === 0)
    return {
      ok: true,
      status: WebsitePasskeyOptionsStatus.Unavailable,
      options: [],
    }
  await resolvedDependencies.ensureExtensionSessionDocument()
  const nookTypedArgs0_3: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: {
      queue: extensionSessionProbeDeadline(message.payload.expiresAt),
    },
  }
  const status = await resolvedDependencies.sendSessionMessage(nookTypedArgs0_3)
  if (
    !status ||
    typeof status !== 'object' ||
    !resolvedDependencies.isUnlockedSessionStatus(status)
  ) {
    return {
      ok: true,
      status: WebsitePasskeyOptionsStatus.Locked,
      options: [],
    }
  }
  if (message.payload.ceremony === WebsitePasskeyCeremony.Create) {
    return {
      ok: true,
      status: WebsitePasskeyOptionsStatus.Ready,
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
        ...extensionSessionGrantIdentity(grant),
        rpId: context.rpId,
        origin: context.origin,
        queue: extensionSessionProbeDeadline(message.payload.expiresAt),
      },
    }
    const response =
      await resolvedDependencies.sendSessionMessage(nookTypedArgs0_4)
    const accountList = passkeyAccountListFromSession(response)
    if (accountList.kind === PasskeyAccountListKind.Invalid) {
      return {
        ok: true,
        status: WebsitePasskeyOptionsStatus.Unavailable,
        options: [],
      }
    }
    const { accounts } = accountList
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
  return { ok: true, status: WebsitePasskeyOptionsStatus.Ready, options }
}

type PerformWebsitePasskeyArgs = {
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
}

export async function performWebsitePasskey({
  message,
  sender,
}: PerformWebsitePasskeyArgs): Promise<WebsitePasskeyPerformResponse> {
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
        ...extensionSessionGrantIdentity(grant),
        requestId: message.payload.requestId,
        requestJson: websitePasskeyRequestJson(requestJsonArgs),
        queue: extensionSessionPasskeyCeremonyDeadline(
          message.payload.expiresAt,
        ),
      },
    }
    return passkeyCeremonyResponseFromSession(
      await sendSessionMessage(nookTypedArgs0_7),
    )
  } finally {
    pendingWebsitePasskeyRequests.delete(key)
  }
}

type CancelWebsitePasskeyArgs = {
  message: Parameters<typeof isWebsitePasskeyCancelMessage>[0] & {
    payload: { requestId: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function cancelWebsitePasskey({
  message,
  sender,
}: CancelWebsitePasskeyArgs): Promise<{ ok: true }> {
  const nookTypedArgs0_2: Parameters<typeof passkeyRequestKey>[0] = {
    sender,
    requestId: message.payload.requestId,
  }
  const key = passkeyRequestKey(nookTypedArgs0_2)
  if (!pendingWebsitePasskeyRequests.has(key)) return { ok: true }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_8: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-cancel-passkey',
    payload: {
      requestId: message.payload.requestId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  await sendSessionMessage(nookTypedArgs0_8)
  return { ok: true }
}
