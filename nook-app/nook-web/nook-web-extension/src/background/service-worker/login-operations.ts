import {
  NookWebsiteLoginSaveDecision,
  type WebsiteLoginSaveActionResponse,
  type WebsiteLoginSaveOfferView,
  type WebsiteLoginSaveOfferResponse,
  type WebsiteLoginSavePendingResponse,
} from '../../lib/login-save-messages'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { type WebsiteLoginFillResponse } from '../../lib/login-fill-messages'
import { SessionOperationFailureKind } from '../../lib/session-operation-queue'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import { backgroundVaultRuntime } from '../vault-runtime'
import { extensionSessionGrantIdentity } from '../pairing-grants'
import {
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionRequest,
} from '../../offscreen/session-request-adapter'
import {
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import {
  ExtensionSessionLifecycle,
  extensionSessionLifecycle,
} from './session-lifecycle'
import {
  decodeLoginOperationResponse,
  decodeLoginSaveActionResponse,
  decodeWebsiteLoginFillResponse,
} from './login-session-response-adapter'
import { websiteLoginRevealSessionRequest } from './session-request-projections'
import { decode_website_login_save_pending_response } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type WebsiteLoginSaveSessionRequest = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.PlanLoginSave }
>

type WebsiteLoginSaveOfferArgs = {
  message: {
    payload: {
      origin: string
      username: string
      password: string
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginSaveOffer({
  message,
  sender,
}: WebsiteLoginSaveOfferArgs): Promise<WebsiteLoginSaveOfferResponse> {
  const pendingPassword = { value: message.payload.password }
  message.payload.password = ''
  try {
    const nookTypedArgs0_5: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_5)) {
      pendingPassword.value = ''
      return {
        kind: 'rejected',
        reason: 'login-save-forbidden-origin',
      }
    }
    const grants = await extensionPairingIdentity.passwordPairingGrants()
    const [grant] = grants
    if (!grant) {
      pendingPassword.value = ''
      return { kind: 'unavailable' }
    }

    // Dispatch the sensitive operation first. Offscreen ingress copies and
    // clears its credentials synchronously, so a document navigation cannot
    // strand the request behind a disposable sender-bound status round-trip.
    // Prefer the selected/ready vault, then the first password-filling grant.
    const nookTypedArgs0_7: WebsiteLoginSaveSessionRequest = {
      type: ExtensionSessionMessageType.PlanLoginSave,
      payload: {
        ...extensionSessionGrantIdentity(grant),
        origin: message.payload.origin,
        username: message.payload.username,
        password: pendingPassword.value,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const delivery0_7 = await extensionPairingIdentity

      .sendSessionMessage(nookTypedArgs0_7)
      .finally(() => {
        pendingPassword.value = ''
        nookTypedArgs0_7.payload.password = ''
      })
    if (delivery0_7.isErr()) {
      pendingPassword.value = ''
      return { kind: 'rejected', reason: delivery0_7.error.kind }
    }
    const response = delivery0_7.value
    pendingPassword.value = ''
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === false &&
      'error' in response &&
      response.error === SessionOperationFailureKind.Locked
    ) {
      const launcherRequest: Parameters<
        typeof extensionSessionLifecycle.openCompanionLauncherBestEffort
      >[0] = {
        intent: OpenCompanionLauncherIntent.PilotAuth,
        source: ExtensionSessionLifecycle.sourceFromSender(sender),
      }
      extensionSessionLifecycle.openCompanionLauncherBestEffort(launcherRequest)
      return { kind: 'locked' }
    }
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('decision' in response) ||
      typeof response.decision !== 'number'
    ) {
      return {
        kind: 'rejected',
        reason: 'login-save-plan-failed',
      }
    }
    if (response.decision === NookWebsiteLoginSaveDecision.AlreadySaved) {
      return { kind: 'not-required' }
    }
    if (
      (response.decision !== NookWebsiteLoginSaveDecision.Create &&
        response.decision !== NookWebsiteLoginSaveDecision.Update) ||
      !('offerId' in response) ||
      typeof response.offerId !== 'string'
    ) {
      return {
        kind: 'rejected',
        reason: 'login-save-plan-failed',
      }
    }
    const offer: WebsiteLoginSaveOfferView = {
      offerId: response.offerId,
      decision: response.decision,
      vaultStoreId: grant.vaultStoreId,
      vaultName: grant.vaultName,
    }
    return {
      kind: 'offer-available',
      offer,
    }
  } finally {
    pendingPassword.value = ''
  }
}

type WebsiteLoginSavePendingArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginSavePending({
  message,
  sender,
}: WebsiteLoginSavePendingArgs): Promise<WebsiteLoginSavePendingResponse> {
  const nookTypedArgs0_8: Parameters<
    typeof extensionPairingIdentity.isAuthorizedWebsiteSender
  >[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await extensionPairingIdentity.passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, state: 'unavailable' }
  }

  const nookTypedArgs0_9: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-pending-login-save',
    payload: {
      origin: message.payload.origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const delivery0_9 =
    await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_9)
  if (delivery0_9.isErr()) {
    return delivery0_9.error.response
  }
  const pending = delivery0_9.value
  if (
    !pending ||
    typeof pending !== 'object' ||
    !('state' in pending) ||
    pending.state !== 'available' ||
    !('offer' in pending) ||
    !pending.offer ||
    typeof pending.offer !== 'object' ||
    !('vaultStoreId' in pending.offer) ||
    typeof pending.offer.vaultStoreId !== 'string'
  ) {
    return decode_website_login_save_pending_response(pending)
  }
  const staged = pending.offer
  const grant = grants.find(
    (candidate) => candidate.vaultStoreId === staged.vaultStoreId,
  )
  if (
    !grant ||
    !('offerId' in staged) ||
    typeof staged.offerId !== 'string' ||
    !('decision' in staged) ||
    (staged.decision !== NookWebsiteLoginSaveDecision.Create &&
      staged.decision !== NookWebsiteLoginSaveDecision.Update)
  ) {
    return { ok: true, state: 'unavailable' }
  }
  const response: WebsiteLoginSavePendingResponse = {
    ok: true,
    state: 'available',
    offer: {
      offerId: staged.offerId,
      decision: staged.decision,
      vaultStoreId: grant.vaultStoreId,
      vaultName: grant.vaultName,
    },
  }
  return decode_website_login_save_pending_response(response)
}

type WebsiteLoginSaveCommitArgs = {
  message: {
    payload: {
      origin: string
      offerId: string
      evidence: {
        navigatedAwayFromAuthPath: boolean
        authFieldsPresent: boolean
        successMarkerPresent: boolean
        errorMarkerPresent: boolean
        sameDocumentMutation: boolean
        inIframe: boolean
        elapsedMs: number
      }
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginSaveCommit({
  message,
  sender,
}: WebsiteLoginSaveCommitArgs): Promise<WebsiteLoginSaveActionResponse> {
  const nookTypedArgs0_10: Parameters<
    typeof extensionPairingIdentity.isAuthorizedWebsiteSender
  >[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_10)) {
    return {
      kind: 'rejected',
      reason: 'login-save-forbidden-origin',
    }
  }
  const verdict =
    await backgroundVaultRuntime.classifyAuthenticationOutcomeWithDefaultTimeout(
      message.payload.evidence,
    )
  if (!verdict.allowsCredentialCommit) {
    return {
      kind: 'rejected',
      reason: 'login-save-evidence-insufficient',
    }
  }
  const grants = await extensionPairingIdentity.passwordPairingGrants()
  if (grants.length === 0) {
    return {
      kind: 'rejected',
      reason: 'login-save-unavailable',
    }
  }

  const nookTypedArgs0_11: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-pending-login-save',
    payload: {
      origin: message.payload.origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const delivery0_11 =
    await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_11)
  if (delivery0_11.isErr()) {
    return { kind: 'rejected', reason: delivery0_11.error.kind }
  }
  const pending = delivery0_11.value
  const firstGrant = grants[0]
  if (!firstGrant) {
    return { kind: 'rejected', reason: 'login-save-unavailable' }
  }
  let grant = firstGrant
  if (
    pending &&
    typeof pending === 'object' &&
    'state' in pending &&
    pending.state === 'available' &&
    'offer' in pending &&
    pending.offer &&
    typeof pending.offer === 'object' &&
    'vaultStoreId' in pending.offer &&
    typeof pending.offer.vaultStoreId === 'string'
  ) {
    const pendingVaultStoreId = pending.offer.vaultStoreId
    const matchingGrant = grants.find(
      (candidate) => candidate.vaultStoreId === pendingVaultStoreId,
    )
    if (matchingGrant) grant = matchingGrant
  }
  const nookTypedArgs0_12: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const delivery0_12 =
    await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_12)
  if (delivery0_12.isErr()) {
    return { kind: 'rejected', reason: delivery0_12.error.kind }
  }
  const status = delivery0_12.value
  if (
    !status ||
    typeof status !== 'object' ||
    !extensionSessionLifecycle.isUnlockedSessionStatus(status)
  ) {
    const launcherRequest: Parameters<
      typeof extensionSessionLifecycle.openCompanionLauncherBestEffort
    >[0] = {
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.sourceFromSender(sender),
    }
    extensionSessionLifecycle.openCompanionLauncherBestEffort(launcherRequest)
    return {
      kind: 'rejected',
      reason: 'login-save-locked',
    }
  }
  const nookTypedArgs0_13: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-commit-login-save',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      origin: message.payload.origin,
      offerId: message.payload.offerId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const delivery =
    await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_13)
  if (delivery.isErr()) return { kind: 'rejected', reason: delivery.error.kind }
  const action = decodeLoginSaveActionResponse(delivery.value)
  return action.ok
    ? { kind: 'completed' }
    : {
        kind: 'rejected',
        reason: action.reason,
      }
}

type WebsiteLoginSaveDismissArgs = {
  message: { payload: { origin: string; offerId: string } }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginSaveDismiss({
  message,
  sender,
}: WebsiteLoginSaveDismissArgs): Promise<WebsiteLoginSaveActionResponse> {
  const nookTypedArgs0_14: Parameters<
    typeof extensionPairingIdentity.isAuthorizedWebsiteSender
  >[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_14)) {
    return {
      kind: 'rejected',
      reason: 'login-save-forbidden-origin',
    }
  }

  const nookTypedArgs0_15: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-dismiss-login-save',
    payload: {
      origin: message.payload.origin,
      offerId: message.payload.offerId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const delivery =
    await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_15)
  if (delivery.isErr()) return { kind: 'rejected', reason: delivery.error.kind }
  const action = decodeLoginOperationResponse(delivery.value)
  return action.ok
    ? { kind: 'completed' }
    : {
        kind: 'rejected',
        reason: action.reason,
      }
}

type WebsiteLoginFillArgs = {
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      authorizationGeneration: string
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginFill({
  message,
  sender,
}: WebsiteLoginFillArgs): Promise<WebsiteLoginFillResponse> {
  const authorizationGeneration = message.payload.authorizationGeneration
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'login-locked' }
  }
  const nookTypedArgs0_16: Parameters<
    typeof accountPickerSessions.authorizedWebsiteGrant
  >[0]['reasons'] = {
    forbidden: 'login-forbidden-origin',
    missing: 'login-vault-not-granted',
    locked: 'login-locked',
  }
  const nookTypedArgs0_2: Parameters<
    typeof accountPickerSessions.authorizedWebsiteGrant
  >[0] = {
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    sender,
    reasons: nookTypedArgs0_16,
  }
  const access =
    await accountPickerSessions.authorizedWebsiteGrant(nookTypedArgs0_2)
  if ('response' in access) return access.response
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'login-locked' }
  }
  const nookTypedArgs0_17: Parameters<
    typeof websiteLoginRevealSessionRequest
  >[0] = {
    grant: access.grant,
    origin: message.payload.origin,
    secretId: message.payload.secretId,
  }
  const delivery = await extensionPairingIdentity.sendSessionMessage(
    websiteLoginRevealSessionRequest(nookTypedArgs0_17),
  )
  if (delivery.isErr()) return delivery.error.response
  const response = decodeWebsiteLoginFillResponse(delivery.value)
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    if (response.ok) {
      response.password = ''
      response.username = ''
    }
    return { ok: false, reason: 'login-locked' }
  }
  return response
}
