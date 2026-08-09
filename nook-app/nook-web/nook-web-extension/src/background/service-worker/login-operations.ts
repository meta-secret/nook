import {
  NookWebsiteLoginSaveDecision,
  WebsiteLoginSavePendingState,
  type WebsiteLoginSaveOfferView,
} from '../../lib/login-save-messages'
import { classifyAuthenticationOutcomeWithDefaultTimeout } from '../vault-runtime'
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

export async function openWebsiteLoginPicker({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_0: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'login-forbidden-origin',
  }
  const access = await availableWebsiteGrants(nookTypedArgs0_0)
  if ('response' in access) return access.response
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
  return { ok: true, status: 'ready', requestId, expiresAt: request.expiresAt }
}

export async function queryLoginPicker({
  message,
  sender,
}: {
  message: { payload: { requestId: string; query: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
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
}): Promise<unknown> {
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
    const response: unknown = await chrome.tabs.sendMessage(
      request.tabId,
      nookTypedArgs0_3,
    )
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true
    ) {
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
}): Promise<unknown> {
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
}): Promise<unknown> {
  const pendingPassword = { value: message.payload.password }
  message.payload.password = ''
  const nookTypedArgs0_5: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_5)) {
    pendingPassword.value = ''
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    pendingPassword.value = ''
    return { ok: true, status: 'unavailable' }
  }
  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const nookTypedArgs0_6: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt, queuePriority: 'interactive' },
  }
  const status = await sendSessionMessage(nookTypedArgs0_6)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    pendingPassword.value = ''
    openCompanionLauncherBestEffort()
    return { ok: true, status: 'locked' }
  }

  // Prefer the selected/ready vault, then the first password-filling grant.
  const grant = grants[0]
  const nookTypedArgs0_7: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-plan-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      username: message.payload.username,
      password: pendingPassword.value,
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
    return { ok: false, reason: 'login-save-plan-failed' }
  }
  if (
    response.decision === NookWebsiteLoginSaveDecision.AlreadySaved ||
    response.decision === NookWebsiteLoginSaveDecision.Invalid
  ) {
    return { ok: true, status: 'ready', decision: response.decision }
  }
  if (
    (response.decision !== NookWebsiteLoginSaveDecision.Create &&
      response.decision !== NookWebsiteLoginSaveDecision.Update) ||
    !('offerId' in response) ||
    typeof response.offerId !== 'string'
  ) {
    return { ok: false, reason: 'login-save-plan-failed' }
  }
  const offer: WebsiteLoginSaveOfferView = {
    offerId: response.offerId,
    decision: response.decision,
    vaultStoreId: grant.vaultStoreId,
    vaultName: grant.vaultName,
  }
  return { ok: true, status: 'ready', decision: response.decision, offer }
}

export async function websiteLoginSavePending({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
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
    payload: { origin: message.payload.origin },
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
    decision?: unknown
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
}): Promise<unknown> {
  const nookTypedArgs0_10: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_10)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const verdict = await classifyAuthenticationOutcomeWithDefaultTimeout(
    message.payload.evidence,
  )
  if (!verdict.allowsCredentialCommit) {
    return {
      ok: false,
      reason: 'login-save-evidence-insufficient',
      verdict: verdict.verdict,
    }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: false, reason: 'login-save-unavailable' }
  }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_11: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-pending-login-save',
    payload: { origin: message.payload.origin },
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
  }
  const status = await sendSessionMessage(nookTypedArgs0_12)
  if (
    !status ||
    typeof status !== 'object' ||
    !isUnlockedSessionStatus(status)
  ) {
    openCompanionLauncherBestEffort()
    return { ok: false, reason: 'login-save-locked' }
  }
  const nookTypedArgs0_13: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-commit-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  }
  return sendSessionMessage(nookTypedArgs0_13)
}

export async function websiteLoginSaveDismiss({
  message,
  sender,
}: {
  message: { payload: { origin: string; offerId: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_14: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_14)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  await ensureExtensionSessionDocument()
  const nookTypedArgs0_15: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-dismiss-login-save',
    payload: {
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  }
  return sendSessionMessage(nookTypedArgs0_15)
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
}): Promise<unknown> {
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
    },
  }
  return sendSessionMessage(nookTypedArgs0_17)
}
