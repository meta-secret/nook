import { type OtpauthEnrollmentPreview } from '../../lib/enrollment-messages'
import {
  authenticatorAccounts,
  authorizedWebsiteGrant,
  isAuthenticatorPickerSender,
  loadAuthenticatorPicker,
  removeAuthenticatorPicker,
  storeAuthenticatorPicker,
} from './account-pickers'
import {
  availableWebsiteGrants,
  isAuthorizedWebsiteSender,
  passwordPairingGrants,
  randomNonce,
  sendSessionMessage,
} from './pairing-identity'
import { AUTHENTICATOR_PICKER_TTL_MS } from './account-pickers'
import { ensureExtensionSessionDocument } from './session-lifecycle'

export async function websiteAuthenticatorOptions(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'authenticator-forbidden-origin',
  )
  if ('response' in access) return access.response

  const accounts = await authenticatorAccounts(access.grants, '')
  return { ok: true, status: 'ready', accounts }
}

export async function openWebsiteAuthenticatorPicker(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'authenticator-forbidden-origin',
  )
  if ('response' in access) return access.response
  if (typeof sender.tab?.id === 'undefined') {
    return { ok: false, reason: 'authenticator-picker-tab-missing' }
  }

  const requestId = randomNonce()
  const request = {
    requestId,
    origin: message.payload.origin,
    tabId: sender.tab.id,
    allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
    expiresAt: Date.now() + AUTHENTICATOR_PICKER_TTL_MS,
  }
  await storeAuthenticatorPicker(request)
  const pickerUrl = new URL(chrome.runtime.getURL('popup/index.html'))
  pickerUrl.searchParams.set('intent', 'authenticator-picker')
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
    await removeAuthenticatorPicker(requestId)
    return { ok: false, reason: 'authenticator-picker-open-failed' }
  }
  return { ok: true, status: 'ready', requestId, expiresAt: request.expiresAt }
}

export async function queryAuthenticatorPicker(
  message: { payload: { requestId: string; query: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const accounts = await authenticatorAccounts(grants, message.payload.query)
  return { ok: true, origin: request.origin, accounts }
}

export async function selectAuthenticatorPicker(
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const accounts = await authenticatorAccounts(grants, '')
  const selected = accounts.find(
    (account) =>
      account.vaultStoreId === message.payload.vaultStoreId &&
      account.secretId === message.payload.secretId,
  )
  if (!selected) {
    return { ok: false, reason: 'authenticator-picker-selection-invalid' }
  }
  try {
    const response: unknown = await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-authenticator-selected',
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
      return { ok: false, reason: 'authenticator-picker-page-unavailable' }
    }
  } catch {
    return { ok: false, reason: 'authenticator-picker-page-unavailable' }
  }
  await removeAuthenticatorPicker(request.requestId)
  return { ok: true }
}

export async function cancelAuthenticatorPicker(
  message: { payload: { requestId: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: true }
  }
  if (
    !isAuthenticatorPickerSender(sender) &&
    !isAuthorizedWebsiteSender(sender, request.origin)
  ) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  await removeAuthenticatorPicker(request.requestId)
  try {
    await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-authenticator-canceled',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
      },
    })
  } catch {
    // The website may have navigated while its picker was open. The pending
    // request is still canceled and must not remain reusable.
  }
  return { ok: true }
}

export async function websiteAuthenticatorFill(
  message: {
    payload: { origin: string; vaultStoreId: string; secretId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    },
  )
  if ('response' in access) return access.response
  return sendSessionMessage({
    type: 'nook:extension-session-authenticator-code',
    payload: { ...access.grant, secretId: message.payload.secretId },
  })
}

export async function websiteAuthenticatorEnrollPreview(
  message: {
    payload: { origin: string; otpauthUri: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, status: 'unavailable' }
  }
  await ensureExtensionSessionDocument()
  try {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-preview',
      payload: { otpauthUri: message.payload.otpauthUri },
    })
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('preview' in response) ||
      !response.preview ||
      typeof response.preview !== 'object'
    ) {
      return { ok: false, reason: 'authenticator-preview-failed' }
    }
    const preview = response.preview as OtpauthEnrollmentPreview
    return {
      ok: true,
      status: 'ready',
      preview,
      vaultStoreId: grants[0]?.vaultStoreId,
      vaultName: grants[0]?.vaultName,
    }
  } catch {
    return { ok: false, reason: 'authenticator-preview-invalid' }
  }
}

type StagedAuthenticatorEnrollment = {
  stageId: string
  origin: string
  vaultStoreId: string
  otpauthUri: string
  expiresAt: number
}

const STAGED_ENROLLMENT_TTL_MS = 5 * 60 * 1000

const stagedAuthenticatorEnrollments = new Map<
  string,
  StagedAuthenticatorEnrollment
>()

function purgeExpiredStagedEnrollments(now = Date.now()): void {
  for (const [stageId, staged] of stagedAuthenticatorEnrollments) {
    if (staged.expiresAt <= now) {
      staged.otpauthUri = ''
      stagedAuthenticatorEnrollments.delete(stageId)
    }
  }
}

function clearStagedEnrollment(stageId: string): void {
  const staged = stagedAuthenticatorEnrollments.get(stageId)
  if (!staged) return
  staged.otpauthUri = ''
  stagedAuthenticatorEnrollments.delete(stageId)
}

export async function websiteAuthenticatorEnrollStage(
  message: {
    payload: { origin: string; vaultStoreId: string; otpauthUri: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grant = (await passwordPairingGrants()).find(
    (candidate) => candidate.vaultStoreId === message.payload.vaultStoreId,
  )
  if (!grant) return { ok: false, reason: 'authenticator-vault-not-granted' }
  purgeExpiredStagedEnrollments()
  for (const [stageId, staged] of stagedAuthenticatorEnrollments) {
    if (staged.origin === message.payload.origin) {
      clearStagedEnrollment(stageId)
    }
  }
  const stageId = crypto.randomUUID()
  stagedAuthenticatorEnrollments.set(stageId, {
    stageId,
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    otpauthUri: message.payload.otpauthUri,
    expiresAt: Date.now() + STAGED_ENROLLMENT_TTL_MS,
  })
  return { ok: true, stageId }
}

export async function websiteAuthenticatorEnrollCode(
  message: {
    payload: { origin: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (!staged || staged.origin !== message.payload.origin) {
    return { ok: false, reason: 'authenticator-stage-missing' }
  }
  await ensureExtensionSessionDocument()
  try {
    return await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-code',
      payload: { otpauthUri: staged.otpauthUri },
    })
  } catch {
    return { ok: false, reason: 'authenticator-code-failed' }
  }
}

export async function websiteAuthenticatorEnrollConfirm(
  message: {
    payload: { origin: string; vaultStoreId: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (
    !staged ||
    staged.origin !== message.payload.origin ||
    staged.vaultStoreId !== message.payload.vaultStoreId
  ) {
    return { ok: false, reason: 'authenticator-stage-missing' }
  }
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    },
  )
  if ('response' in access) return access.response
  try {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-confirm',
      payload: {
        ...access.grant,
        otpauthUri: staged.otpauthUri,
        origin: message.payload.origin,
      },
    })
    clearStagedEnrollment(message.payload.stageId)
    return response
  } catch {
    return { ok: false, reason: 'authenticator-enroll-failed' }
  }
}

export async function websiteAuthenticatorEnrollDismiss(
  message: {
    payload: { origin: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (staged && staged.origin === message.payload.origin) {
    clearStagedEnrollment(message.payload.stageId)
  }
  return { ok: true }
}

export async function websiteAuthenticatorEnrollPending(
  message: {
    payload: { origin: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  for (const staged of stagedAuthenticatorEnrollments.values()) {
    if (staged.origin === message.payload.origin) {
      return {
        ok: true,
        stageId: staged.stageId,
        vaultStoreId: staged.vaultStoreId,
      }
    }
  }
  return { ok: true }
}

export async function websiteAuthenticatorBackupAttach(
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      codes: string[]
      mode: 'replace' | 'merge'
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const codes = [...message.payload.codes]
  message.payload.codes.fill('')
  message.payload.codes = []
  try {
    const access = await authorizedWebsiteGrant(
      message.payload.origin,
      message.payload.vaultStoreId,
      sender,
      {
        forbidden: 'authenticator-forbidden-origin',
        missing: 'authenticator-vault-not-granted',
        locked: 'authenticator-locked',
      },
    )
    if ('response' in access) return access.response
    const pending = sendSessionMessage({
      type: 'nook:extension-session-authenticator-backup-attach',
      payload: {
        ...access.grant,
        secretId: message.payload.secretId,
        codes,
        mode: message.payload.mode,
      },
    })
    codes.fill('')
    return await pending
  } finally {
    codes.fill('')
  }
}
