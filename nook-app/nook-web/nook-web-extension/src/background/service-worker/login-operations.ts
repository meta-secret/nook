import {
  NookWebsiteLoginSaveDecision,
  WebsiteLoginSaveActionResponseKind,
  WebsiteLoginSaveOfferResponseKind,
  WebsiteLoginSavePendingState,
  type WebsiteLoginSaveActionResponse,
  type WebsiteLoginSaveOfferView,
  type WebsiteLoginSaveOfferResponse,
  type WebsiteLoginSavePendingResponse,
} from '../../lib/login-save-messages'
import {
  WebsiteAuthenticatorResponseStatus,
  type WebsiteLoginAccountOption,
  type WebsiteLoginFillResponse,
} from '../../lib/login-fill-messages'
import { classifyAuthenticationOutcomeWithDefaultTimeout } from '../vault-runtime'
import { extensionSessionGrantIdentity } from '../pairing-grants'
import {
  extensionSessionInteractiveDeadline,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import {
  LoginPickerLoadKind,
  authorizedWebsiteGrant,
  isLoginPickerSender,
  loadLoginPicker,
  loginAccountsForOrigin,
  removeLoginPicker,
  storeLoginPicker,
} from './account-pickers'
import {
  availableWebsiteGrants,
  isAuthorizedWebsiteSender,
  passwordPairingGrants,
  randomNonce,
  sendSessionMessage,
} from './pairing-identity'
import { LOGIN_PICKER_TTL_MS } from './account-pickers'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  ensureExtensionSessionDocument,
  isUnlockedSessionStatus,
  openCompanionLauncherBestEffort,
} from './session-lifecycle'
import {
  decodeLoginOperationResponse,
  decodeLoginSaveActionResponse,
  decodeWebsiteLoginFillResponse,
  isLoginPickerPageAcknowledgement,
  type LoginOperationFailure,
  type LoginOperationSuccess,
} from './login-session-response-adapter'

enum LoginPickerOpenStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}
type LoginPickerOpenResponse =
  | LoginOperationFailure
  | {
      ok: true
      status: LoginPickerOpenStatus.Ready
      requestId: string
      expiresAt: number
    }
  | {
      ok: true
      status: LoginPickerOpenStatus.Locked | LoginPickerOpenStatus.Unavailable
    }
type LoginPickerQueryResponse =
  | LoginOperationFailure
  | { ok: true; origin: string; accounts: WebsiteLoginAccountOption[] }
export async function openWebsiteLoginPicker({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<LoginPickerOpenResponse> {
  const nookTypedArgs0_0: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'login-forbidden-origin',
  }
  const access = await availableWebsiteGrants(nookTypedArgs0_0)
  if ('response' in access) {
    if (!access.response.ok) return access.response
    return {
      ok: true,
      status:
        access.response.status === WebsiteAuthenticatorResponseStatus.Locked
          ? LoginPickerOpenStatus.Locked
          : LoginPickerOpenStatus.Unavailable,
    }
  }
  if (
    !sender.tab ||
    !('id' in sender.tab) ||
    typeof sender.tab.id !== 'number'
  ) {
    return { ok: false, reason: 'login-picker-tab-missing' }
  }

  const requestId = randomNonce()
  const request: Parameters<typeof storeLoginPicker>[0] = {
    requestId,
    origin: message.payload.origin,
    tabId: sender.tab.id,
    allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
    expiresAt: Date.now() + LOGIN_PICKER_TTL_MS,
  }
  await storeLoginPicker(request)
  const pickerUrl = new URL(chrome.runtime.getURL('popup/index.html'))
  pickerUrl.searchParams.set('intent', 'login-picker')
  pickerUrl.searchParams.set('request', requestId)
  try {
    if (chrome.windows?.create) {
      const nookTypedArgs0_1: Parameters<typeof chrome.windows.create>[0] = {
        url: pickerUrl.toString(),
        type: 'popup',
        width: 460,
        height: 620,
        focused: true,
      }
      await chrome.windows.create(nookTypedArgs0_1)
    } else {
      const nookTypedArgs0_2: Parameters<typeof chrome.tabs.create>[0] = {
        url: pickerUrl.toString(),
      }
      await chrome.tabs.create(nookTypedArgs0_2)
    }
  } catch {
    await removeLoginPicker(requestId)
    return { ok: false, reason: 'login-picker-open-failed' }
  }
  return {
    ok: true,
    status: LoginPickerOpenStatus.Ready,
    requestId,
    expiresAt: request.expiresAt,
  }
}

export async function queryLoginPicker({
  message,
  sender,
}: {
  message: { payload: { requestId: string; query: string } }
  sender: chrome.runtime.MessageSender
}): Promise<LoginPickerQueryResponse> {
  if (!isLoginPickerSender(sender)) {
    return { ok: false, reason: 'login-picker-forbidden' }
  }
  const loaded = await loadLoginPicker(message.payload.requestId)
  if (loaded.kind === LoginPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'login-picker-expired' }
  }
  const { request } = loaded
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const nookTypedArgs0_0: Parameters<typeof loginAccountsForOrigin>[0] = {
    grants,
    origin: request.origin,
    query: message.payload.query,
  }
  const accounts = await loginAccountsForOrigin(nookTypedArgs0_0)
  return { ok: true, origin: request.origin, accounts }
}

export async function selectLoginPicker({
  message,
  sender,
}: {
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<LoginOperationSuccess | LoginOperationFailure> {
  if (!isLoginPickerSender(sender)) {
    return { ok: false, reason: 'login-picker-forbidden' }
  }
  const loaded = await loadLoginPicker(message.payload.requestId)
  if (loaded.kind === LoginPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'login-picker-expired' }
  }
  const { request } = loaded
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const nookTypedArgs0_1: Parameters<typeof loginAccountsForOrigin>[0] = {
    grants,
    origin: request.origin,
  }
  const accounts = await loginAccountsForOrigin(nookTypedArgs0_1)
  const selected = accounts.find(
    (account) =>
      account.vaultStoreId === message.payload.vaultStoreId &&
      account.secretId === message.payload.secretId,
  )
  if (!selected) {
    return { ok: false, reason: 'login-picker-selection-invalid' }
  }
  try {
    const nookTypedArgs0_3: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: 'nook:website-login-selected',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
        account: {
          vaultStoreId: selected.vaultStoreId,
          secretId: selected.secretId,
        },
      },
    }
    const response = await chrome.tabs.sendMessage(
      request.tabId,
      nookTypedArgs0_3,
    )
    if (!isLoginPickerPageAcknowledgement(response)) {
      return { ok: false, reason: 'login-picker-page-unavailable' }
    }
  } catch {
    return { ok: false, reason: 'login-picker-page-unavailable' }
  }
  await removeLoginPicker(request.requestId)
  return { ok: true }
}

export async function cancelLoginPicker({
  message,
  sender,
}: {
  message: { payload: { requestId: string } }
  sender: chrome.runtime.MessageSender
}): Promise<LoginOperationSuccess | LoginOperationFailure> {
  const loaded = await loadLoginPicker(message.payload.requestId)
  if (loaded.kind === LoginPickerLoadKind.Unavailable) {
    return { ok: true }
  }
  const { request } = loaded
  const nookNamedArgs0_0: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: request.origin,
  }
  if (
    !isLoginPickerSender(sender) &&
    !isAuthorizedWebsiteSender(nookNamedArgs0_0)
  ) {
    return { ok: false, reason: 'login-picker-forbidden' }
  }
  await removeLoginPicker(request.requestId)
  try {
    const nookTypedArgs0_4: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: 'nook:website-login-canceled',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
      },
    }
    await chrome.tabs.sendMessage(request.tabId, nookTypedArgs0_4)
  } catch {
    // The website may have navigated while its picker was open.
  }
  return { ok: true }
}

export async function websiteLoginSaveOffer({
  message,
  sender,
}: {
  message: {
    payload: {
      origin: string
      username: string
      password: string
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<WebsiteLoginSaveOfferResponse> {
  const pendingPassword = { value: message.payload.password }
  message.payload.password = ''
  const nookTypedArgs0_5: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_5)) {
    pendingPassword.value = ''
    return {
      kind: WebsiteLoginSaveOfferResponseKind.Rejected,
      reason: 'login-save-forbidden-origin',
    }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    pendingPassword.value = ''
    return { kind: WebsiteLoginSaveOfferResponseKind.Unavailable }
  }
  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const nookTypedArgs0_6: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
  }
  const status = await sendSessionMessage(nookTypedArgs0_6)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    pendingPassword.value = ''
    openCompanionLauncherBestEffort()
    return { kind: WebsiteLoginSaveOfferResponseKind.Locked }
  }

  // Prefer the selected/ready vault, then the first password-filling grant.
  const grant = grants[0]
  const nookTypedArgs0_7: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-plan-login-save',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      origin: message.payload.origin,
      username: message.payload.username,
      password: pendingPassword.value,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sendSessionMessage(nookTypedArgs0_7)
  pendingPassword.value = ''
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('decision' in response) ||
    typeof response.decision !== 'number'
  ) {
    return {
      kind: WebsiteLoginSaveOfferResponseKind.Rejected,
      reason: 'login-save-plan-failed',
    }
  }
  if (response.decision === NookWebsiteLoginSaveDecision.AlreadySaved) {
    return { kind: WebsiteLoginSaveOfferResponseKind.NotRequired }
  }
  if (
    (response.decision !== NookWebsiteLoginSaveDecision.Create &&
      response.decision !== NookWebsiteLoginSaveDecision.Update) ||
    !('offerId' in response) ||
    typeof response.offerId !== 'string'
  ) {
    return {
      kind: WebsiteLoginSaveOfferResponseKind.Rejected,
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
    kind: WebsiteLoginSaveOfferResponseKind.OfferAvailable,
    offer,
  }
}

export async function websiteLoginSavePending({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<WebsiteLoginSavePendingResponse> {
  const nookTypedArgs0_8: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, state: WebsiteLoginSavePendingState.Unavailable }
  }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_9: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-pending-login-save',
    payload: {
      origin: message.payload.origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sendSessionMessage(nookTypedArgs0_9)
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true
  ) {
    return { ok: false, reason: 'login-save-pending-failed' }
  }
  if (
    !('state' in response) ||
    response.state !== WebsiteLoginSavePendingState.Available ||
    !('offer' in response) ||
    typeof response.offer !== 'object'
  ) {
    return { ok: true, state: WebsiteLoginSavePendingState.Unavailable }
  }
  const staged = response.offer as {
    offerId?: string
    decision?: number
    vaultStoreId?: string
  }
  const grant = grants.find(
    (candidate) => candidate.vaultStoreId === staged.vaultStoreId,
  )
  if (
    !grant ||
    typeof staged.offerId !== 'string' ||
    (staged.decision !== NookWebsiteLoginSaveDecision.Create &&
      staged.decision !== NookWebsiteLoginSaveDecision.Update)
  ) {
    return { ok: true, state: WebsiteLoginSavePendingState.Unavailable }
  }
  const offer: WebsiteLoginSaveOfferView = {
    offerId: staged.offerId,
    decision: staged.decision,
    vaultStoreId: grant.vaultStoreId,
    vaultName: grant.vaultName,
  }
  return { ok: true, state: WebsiteLoginSavePendingState.Available, offer }
}

export async function websiteLoginSaveCommit({
  message,
  sender,
}: {
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
}): Promise<WebsiteLoginSaveActionResponse> {
  const nookTypedArgs0_10: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_10)) {
    return {
      kind: WebsiteLoginSaveActionResponseKind.Rejected,
      reason: 'login-save-forbidden-origin',
    }
  }
  const verdict = await classifyAuthenticationOutcomeWithDefaultTimeout(
    message.payload.evidence,
  )
  if (!verdict.allowsCredentialCommit) {
    return {
      kind: WebsiteLoginSaveActionResponseKind.Rejected,
      reason: 'login-save-evidence-insufficient',
    }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return {
      kind: WebsiteLoginSaveActionResponseKind.Rejected,
      reason: 'login-save-unavailable',
    }
  }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_11: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-pending-login-save',
    payload: {
      origin: message.payload.origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const pending = await sendSessionMessage(nookTypedArgs0_11)
  let grant = grants[0]!
  if (
    pending &&
    typeof pending === 'object' &&
    'state' in pending &&
    pending.state === WebsiteLoginSavePendingState.Available &&
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
  const nookTypedArgs0_12: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const status = await sendSessionMessage(nookTypedArgs0_12)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    openCompanionLauncherBestEffort()
    return {
      kind: WebsiteLoginSaveActionResponseKind.Rejected,
      reason: 'login-save-locked',
    }
  }
  const nookTypedArgs0_13: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-commit-login-save',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      origin: message.payload.origin,
      offerId: message.payload.offerId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const action = decodeLoginSaveActionResponse(
    await sendSessionMessage(nookTypedArgs0_13),
  )
  return action.ok
    ? { kind: WebsiteLoginSaveActionResponseKind.Completed }
    : {
        kind: WebsiteLoginSaveActionResponseKind.Rejected,
        reason: action.reason,
      }
}

export async function websiteLoginSaveDismiss({
  message,
  sender,
}: {
  message: { payload: { origin: string; offerId: string } }
  sender: chrome.runtime.MessageSender
}): Promise<WebsiteLoginSaveActionResponse> {
  const nookTypedArgs0_14: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_14)) {
    return {
      kind: WebsiteLoginSaveActionResponseKind.Rejected,
      reason: 'login-save-forbidden-origin',
    }
  }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_15: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-dismiss-login-save',
    payload: {
      origin: message.payload.origin,
      offerId: message.payload.offerId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const action = decodeLoginOperationResponse(
    await sendSessionMessage(nookTypedArgs0_15),
  )
  return action.ok
    ? { kind: WebsiteLoginSaveActionResponseKind.Completed }
    : {
        kind: WebsiteLoginSaveActionResponseKind.Rejected,
        reason: action.reason,
      }
}

export async function websiteLoginFill({
  message,
  sender,
}: {
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<WebsiteLoginFillResponse> {
  const nookTypedArgs0_16: Parameters<
    typeof authorizedWebsiteGrant
  >[0]['reasons'] = {
    forbidden: 'login-forbidden-origin',
    missing: 'login-vault-not-granted',
    locked: 'login-locked',
  }
  const nookTypedArgs0_2: Parameters<typeof authorizedWebsiteGrant>[0] = {
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    sender,
    reasons: nookTypedArgs0_16,
  }
  const access = await authorizedWebsiteGrant(nookTypedArgs0_2)
  if ('response' in access) return access.response
  const nookTypedArgs0_17: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-reveal-login',
    payload: {
      ...access.grant,
      origin: message.payload.origin,
      secretId: message.payload.secretId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sendSessionMessage(nookTypedArgs0_17)
  return decodeWebsiteLoginFillResponse(response)
}
