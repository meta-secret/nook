import {
  NookWebsiteLoginSaveDecision,
  WebsiteLoginSavePendingState,
  type WebsiteLoginSaveOfferView,
} from '../../lib/login-save-messages'
import { classifyAuthenticationOutcome } from '../vault-runtime'
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
  openCompanionLauncher,
} from './session-lifecycle'

export async function openWebsiteLoginPicker(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'login-forbidden-origin',
  )
  if ('response' in access) return access.response
  if (
    !sender.tab ||
    !('id' in sender.tab) ||
    typeof sender.tab.id !== 'number'
  ) {
    return { ok: false, reason: 'login-picker-tab-missing' }
  }

  const requestId = randomNonce()
  const request = {
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
      await chrome.windows.create({
        url: pickerUrl.toString(),
        type: 'popup',
        width: 460,
        height: 620,
        focused: true,
      })
    } else {
      await chrome.tabs.create({ url: pickerUrl.toString() })
    }
  } catch {
    await removeLoginPicker(requestId)
    return { ok: false, reason: 'login-picker-open-failed' }
  }
  return { ok: true, status: 'ready', requestId, expiresAt: request.expiresAt }
}

export async function queryLoginPicker(
  message: { payload: { requestId: string; query: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
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
  const accounts = await loginAccountsForOrigin(
    grants,
    request.origin,
    message.payload.query,
  )
  return { ok: true, origin: request.origin, accounts }
}

export async function selectLoginPicker(
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
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
  const accounts = await loginAccountsForOrigin(grants, request.origin)
  const selected = accounts.find(
    (account) =>
      account.vaultStoreId === message.payload.vaultStoreId &&
      account.secretId === message.payload.secretId,
  )
  if (!selected) {
    return { ok: false, reason: 'login-picker-selection-invalid' }
  }
  try {
    const response: unknown = await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-login-selected',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
        account: {
          vaultStoreId: selected.vaultStoreId,
          secretId: selected.secretId,
        },
      },
    })
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

export async function cancelLoginPicker(
  message: { payload: { requestId: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const loaded = await loadLoginPicker(message.payload.requestId)
  if (loaded.kind === LoginPickerLoadKind.Unavailable) {
    return { ok: true }
  }
  const { request } = loaded
  if (
    !isLoginPickerSender(sender) &&
    !isAuthorizedWebsiteSender(sender, request.origin)
  ) {
    return { ok: false, reason: 'login-picker-forbidden' }
  }
  await removeLoginPicker(request.requestId)
  try {
    await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-login-canceled',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
      },
    })
  } catch {
    // The website may have navigated while its picker was open.
  }
  return { ok: true }
}

export async function websiteLoginSaveOffer(
  message: {
    payload: {
      origin: string
      username: string
      password: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const pendingPassword = { value: message.payload.password }
  message.payload.password = ''
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
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
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt, queuePriority: 'interactive' },
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    pendingPassword.value = ''
    openCompanionLauncher()
    return { ok: true, status: 'locked' }
  }

  // Prefer the selected/ready vault, then the first password-filling grant.
  const grant = grants[0]
  const response = await sendSessionMessage({
    type: 'nook:extension-session-plan-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      username: message.payload.username,
      password: pendingPassword.value,
    },
  })
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

export async function websiteLoginSavePending(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, state: WebsiteLoginSavePendingState.Unavailable }
  }
  await ensureExtensionSessionDocument()
  const response = await sendSessionMessage({
    type: 'nook:extension-session-pending-login-save',
    payload: { origin: message.payload.origin },
  })
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

export async function websiteLoginSaveCommit(
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
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const verdict = await classifyAuthenticationOutcome(message.payload.evidence)
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
  const pending = await sendSessionMessage({
    type: 'nook:extension-session-pending-login-save',
    payload: { origin: message.payload.origin },
  })
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
    const matchingGrant = grants.find(
      (candidate) => candidate.vaultStoreId === pending.offer.vaultStoreId,
    )
    if (matchingGrant) grant = matchingGrant
  }
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    openCompanionLauncher()
    return { ok: false, reason: 'login-save-locked' }
  }
  return sendSessionMessage({
    type: 'nook:extension-session-commit-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  })
}

export async function websiteLoginSaveDismiss(
  message: { payload: { origin: string; offerId: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  await ensureExtensionSessionDocument()
  return sendSessionMessage({
    type: 'nook:extension-session-dismiss-login-save',
    payload: {
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  })
}

export async function websiteLoginFill(
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'login-forbidden-origin',
      missing: 'login-vault-not-granted',
      locked: 'login-locked',
    },
  )
  if ('response' in access) return access.response
  return sendSessionMessage({
    type: 'nook:extension-session-reveal-login',
    payload: {
      ...access.grant,
      origin: message.payload.origin,
      secretId: message.payload.secretId,
    },
  })
}
