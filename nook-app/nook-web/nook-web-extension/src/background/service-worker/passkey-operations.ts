import {
  type WebsitePasskeyCredentialSelection,
  WebsitePasskeyCredentialSelectionKind,
  WebsitePasskeyCeremony,
  type WebsitePasskeyRequestJsonArgs,
  type WebsitePasskeyOptionsResponse,
  WebsitePasskeyOptionsStatus,
  type WebsitePasskeyPerformResponse,
  type WebsitePasskeyVaultOption,
  WebsitePasskeyCancelMessage as WebsitePasskeyCancelMessageSchema,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
  WebsitePasskeyPerformMessage as WebsitePasskeyPerformMessageSchema,
} from '../../lib/webauthn-messages'
import {
  extensionSessionPasskeyCeremonyDeadline,
  extensionSessionProbeDeadline,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import {
  decode_website_passkey_account_list,
  SessionPasskeyResponse,
  WebsitePasskeyAccountListKind,
} from './passkey-session-adapter'
import {
  WebsitePasskeyRequestContextKind,
  extensionPairingIdentity,
} from './pairing-identity'
import { extensionSessionLifecycle } from './session-lifecycle'
import { extensionSessionGrantIdentity } from '../pairing-grants'
import {
  type MatchingPasskeyAvailability,
  MatchingPasskeyAvailabilityKind,
} from './passkey-availability'

export {
  type MatchingPasskeyAvailability,
  MatchingPasskeyAvailabilityKind,
  passkeyAccountCountForClassification,
} from './passkey-availability'

type PasskeyRequestKeyArgs = {
  sender: chrome.runtime.MessageSender
  requestId: string
}

const PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS = 1500

type MatchingPasskeyAvailabilityForOriginArgs = {
  origin: string
  queueExpiresAt: number
}

type WebsitePasskeyOptionsArgs = {
  message: Parameters<typeof WebsitePasskeyOptionsMessageSchema.is>[0] & {
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
  ensureExtensionSessionDocument: typeof extensionSessionLifecycle.ensureExtensionSessionDocument
  isAuthorizedWebsiteSender: typeof extensionPairingIdentity.isAuthorizedWebsiteSender
  isUnlockedSessionStatus: typeof extensionSessionLifecycle.isUnlockedSessionStatus
  passkeyPairingGrants: typeof extensionPairingIdentity.passkeyPairingGrants
  requestOriginAndRpId: typeof extensionPairingIdentity.requestOriginAndRpId
  sendSessionMessage: typeof extensionPairingIdentity.sendSessionMessage
}

type PerformWebsitePasskeyArgs = {
  message: Parameters<typeof WebsitePasskeyPerformMessageSchema.is>[0] & {
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

type CancelWebsitePasskeyArgs = {
  message: Parameters<typeof WebsitePasskeyCancelMessageSchema.is>[0] & {
    payload: { requestId: string }
  }
  sender: chrome.runtime.MessageSender
}

/** Owns the browser runtime resources shared by these interactions. */
type WebsitePasskeyCancellation =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

class WebsitePasskeyRequests {
  private get websitePasskeyOptionsDependencies(): WebsitePasskeyOptionsDependencies {
    return {
      ensureExtensionSessionDocument:
        extensionSessionLifecycle.ensureExtensionSessionDocument.bind(
          extensionSessionLifecycle,
        ),
      isAuthorizedWebsiteSender:
        extensionPairingIdentity.isAuthorizedWebsiteSender.bind(
          extensionPairingIdentity,
        ),
      isUnlockedSessionStatus:
        extensionSessionLifecycle.isUnlockedSessionStatus.bind(
          extensionSessionLifecycle,
        ),
      passkeyPairingGrants: extensionPairingIdentity.passkeyPairingGrants.bind(
        extensionPairingIdentity,
      ),
      requestOriginAndRpId: extensionPairingIdentity.requestOriginAndRpId.bind(
        extensionPairingIdentity,
      ),
      sendSessionMessage: extensionPairingIdentity.sendSessionMessage.bind(
        extensionPairingIdentity,
      ),
    }
  }

  private pendingWebsitePasskeyRequests = new Set<string>()
  private passkeyRequestKey({
    sender,
    requestId,
  }: PasskeyRequestKeyArgs): string {
    return `${((...[v = -1]) => v)(sender.tab?.id)}:${((v) => (v ? v : 0))(sender.frameId)}:${requestId}`
  }

  private async matchingPasskeyAvailabilityForOrigin({
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
    const grants = await extensionPairingIdentity.passkeyPairingGrants()
    if (grants.length === 0) {
      return { kind: MatchingPasskeyAvailabilityKind.Ready, accountCount: 0 }
    }
    const nookTypedArgs0_0: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: 'nook:extension-session-status',
      payload: { queue: extensionSessionProbeDeadline(queueExpiresAt) },
    }
    const delivery =
      await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_0)
    if (delivery.isErr()) return unavailable
    const status = delivery.value
    if (
      !status ||
      typeof status !== 'object' ||
      !extensionSessionLifecycle.isUnlockedSessionStatus(status)
    ) {
      return unavailable
    }
    let count = 0
    for (const grant of grants) {
      const nookTypedArgs0_1: Parameters<
        typeof extensionPairingIdentity.sendSessionMessage
      >[0] = {
        type: 'nook:extension-session-list-passkeys',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          rpId: hostname,
          origin,
          queue: extensionSessionProbeDeadline(queueExpiresAt),
        },
      }
      const delivery =
        await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_1)
      if (delivery.isErr()) return unavailable
      const response = delivery.value
      const accountList = decode_website_passkey_account_list(response)
      if (
        accountList.kind !== WebsitePasskeyAccountListKind.Ready ||
        !('accounts' in accountList)
      )
        return unavailable
      count += accountList.accounts.length
    }
    return {
      kind: MatchingPasskeyAvailabilityKind.Ready,
      accountCount: count,
    }
  }

  async matchingPasskeyAvailabilityForOriginSafe(
    origin: string,
  ): Promise<MatchingPasskeyAvailability> {
    const queueExpiresAt = Date.now() + PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS
    const unavailable: MatchingPasskeyAvailability = {
      kind: MatchingPasskeyAvailabilityKind.Unavailable,
    }
    try {
      const nookTypedArgs0_0: Parameters<
        typeof this.matchingPasskeyAvailabilityForOrigin
      >[0] = { origin, queueExpiresAt }
      return await Promise.race([
        this.matchingPasskeyAvailabilityForOrigin(nookTypedArgs0_0),
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

  async websitePasskeyOptions({
    message,
    sender,
    dependencies,
  }: WebsitePasskeyOptionsArgs): Promise<WebsitePasskeyOptionsResponse> {
    const resolvedDependencies = ((v) =>
      v ? v : this.websitePasskeyOptionsDependencies)(dependencies)
    const nookTypedArgs0_2: Parameters<
      typeof extensionPairingIdentity.requestOriginAndRpId
    >[0] = {
      ceremony: message.payload.ceremony,
      requestJson: message.payload.requestJson,
    }
    const context =
      await resolvedDependencies.requestOriginAndRpId(nookTypedArgs0_2)
    if (context.kind === WebsitePasskeyRequestContextKind.Rejected) {
      return { ok: false, reason: 'passkey-forbidden-origin' }
    }
    const nookNamedArgs0_0: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
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
    const session = await resolvedDependencies.ensureExtensionSessionDocument()
    if (session.isErr()) return session.error.response
    const nookTypedArgs0_3: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: 'nook:extension-session-status',
      payload: {
        queue: extensionSessionProbeDeadline(message.payload.expiresAt),
      },
    }
    const delivery =
      await resolvedDependencies.sendSessionMessage(nookTypedArgs0_3)
    if (delivery.isErr()) return delivery.error.response
    const status = delivery.value
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
      const nookTypedArgs0_4: Parameters<
        typeof extensionPairingIdentity.sendSessionMessage
      >[0] = {
        type: 'nook:extension-session-list-passkeys',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          rpId: context.rpId,
          origin: context.origin,
          queue: extensionSessionProbeDeadline(message.payload.expiresAt),
        },
      }
      const delivery =
        await resolvedDependencies.sendSessionMessage(nookTypedArgs0_4)
      if (delivery.isErr()) return delivery.error.response
      const response = delivery.value
      const accountList = decode_website_passkey_account_list(response)
      if (
        accountList.kind !== WebsitePasskeyAccountListKind.Ready ||
        !('accounts' in accountList)
      ) {
        return {
          ok: true,
          status: WebsitePasskeyOptionsStatus.Invalid,
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

  async performWebsitePasskey({
    message,
    sender,
  }: PerformWebsitePasskeyArgs): Promise<WebsitePasskeyPerformResponse> {
    const nookTypedArgs0_6: Parameters<
      typeof extensionPairingIdentity.requestOriginAndRpId
    >[0] = {
      ceremony: message.payload.ceremony,
      requestJson: message.payload.requestJson,
    }
    const context =
      await extensionPairingIdentity.requestOriginAndRpId(nookTypedArgs0_6)
    if (context.kind === WebsitePasskeyRequestContextKind.Rejected) {
      return { ok: false, reason: 'passkey-forbidden-origin' }
    }
    const nookNamedArgs0_1: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: context.origin,
    }
    if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookNamedArgs0_1)) {
      return { ok: false, reason: 'passkey-forbidden-origin' }
    }
    const nookTypedArgs0_1: Parameters<typeof this.passkeyRequestKey>[0] = {
      sender,
      requestId: message.payload.requestId,
    }
    const key = this.passkeyRequestKey(nookTypedArgs0_1)
    if (this.pendingWebsitePasskeyRequests.has(key)) {
      return { ok: false, reason: 'passkey-request-already-pending' }
    }
    this.pendingWebsitePasskeyRequests.add(key)
    try {
      const grant = (
        await extensionPairingIdentity.passkeyPairingGrants()
      ).find(
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

      const nookTypedArgs0_7: Parameters<
        typeof extensionPairingIdentity.sendSessionMessage
      >[0] = {
        type:
          message.payload.ceremony === WebsitePasskeyCeremony.Create
            ? 'nook:extension-session-register-passkey'
            : 'nook:extension-session-assert-passkey',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          requestId: message.payload.requestId,
          requestJson:
            WebsitePasskeyOptionsMessageSchema.websitePasskeyRequestJson(
              requestJsonArgs,
            ),
          queue: extensionSessionPasskeyCeremonyDeadline(
            message.payload.expiresAt,
          ),
        },
      }
      const delivery =
        await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_7)
      if (delivery.isErr()) return delivery.error.response
      const response = new SessionPasskeyResponse(delivery.value).decode()
      return response.isOk()
        ? response.value
        : { ok: false, reason: response.error }
    } finally {
      this.pendingWebsitePasskeyRequests.delete(key)
    }
  }

  async cancelWebsitePasskey({
    message,
    sender,
  }: CancelWebsitePasskeyArgs): Promise<WebsitePasskeyCancellation> {
    const nookTypedArgs0_2: Parameters<typeof this.passkeyRequestKey>[0] = {
      sender,
      requestId: message.payload.requestId,
    }
    const key = this.passkeyRequestKey(nookTypedArgs0_2)
    if (!this.pendingWebsitePasskeyRequests.has(key)) return { ok: true }

    const nookTypedArgs0_8: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: 'nook:extension-session-cancel-passkey',
      payload: {
        requestId: message.payload.requestId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const delivery =
      await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_8)
    if (delivery.isErr()) return delivery.error.response
    return { ok: true }
  }
}

export const websitePasskeyRequests = new WebsitePasskeyRequests()
