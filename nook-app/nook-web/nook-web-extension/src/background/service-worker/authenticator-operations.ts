import { type OtpauthEnrollmentPreview } from '../../lib/enrollment-messages'
import {
  AuthenticatorPickerLoadKind,
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

export async function websiteAuthenticatorOptions({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_0: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'authenticator-forbidden-origin',
  }
  const access = await availableWebsiteGrants(nookTypedArgs0_0)
  if ('response' in access) return access.response

  const authenticatorAccountsArgs: Parameters<typeof authenticatorAccounts>[0] =
    {
      grants: access.grants,
      query: '',
    }
  const accounts = await authenticatorAccounts(authenticatorAccountsArgs)
  return { ok: true, status: 'ready', accounts }
}

export async function openWebsiteAuthenticatorPicker({
  message,
  sender,
}: {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_1: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'authenticator-forbidden-origin',
  }
  const access = await availableWebsiteGrants(nookTypedArgs0_1)
  if ('response' in access) return access.response
  if (
    !sender.tab ||
    !('id' in sender.tab) ||
    typeof sender.tab.id !== 'number'
  ) {
    return { ok: false, reason: 'authenticator-picker-tab-missing' }
  }

  const requestId = randomNonce()
  const request: Parameters<typeof storeAuthenticatorPicker>[0] = {
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
      const nookTypedArgs0_2: Parameters<typeof chrome.windows.create>[0] = {
        url: pickerUrl.toString(),
        type: 'popup',
        width: 460,
        height: 620,
        focused: true,
      }
      await chrome.windows.create(nookTypedArgs0_2)
    } else {
      const nookTypedArgs0_3: Parameters<typeof chrome.tabs.create>[0] = {
        url: pickerUrl.toString(),
      }
      await chrome.tabs.create(nookTypedArgs0_3)
    }
  } catch {
    await removeAuthenticatorPicker(requestId)
    return { ok: false, reason: 'authenticator-picker-open-failed' }
  }
  return { ok: true, status: 'ready', requestId, expiresAt: request.expiresAt }
}

export async function queryAuthenticatorPicker({
  message,
  sender,
}: {
  message: { payload: { requestId: string; query: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const loaded = await loadAuthenticatorPicker(message.payload.requestId)
  if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const { request } = loaded
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const nookTypedArgs0_1: Parameters<typeof authenticatorAccounts>[0] = {
    grants,
    query: message.payload.query,
  }
  const accounts = await authenticatorAccounts(nookTypedArgs0_1)
  return { ok: true, origin: request.origin, accounts }
}

export async function selectAuthenticatorPicker({
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
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const loaded = await loadAuthenticatorPicker(message.payload.requestId)
  if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const { request } = loaded
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const nookTypedArgs0_2: Parameters<typeof authenticatorAccounts>[0] = {
    grants,
    query: '',
  }
  const accounts = await authenticatorAccounts(nookTypedArgs0_2)
  const selected = accounts.find(
    (account) =>
      account.vaultStoreId === message.payload.vaultStoreId &&
      account.secretId === message.payload.secretId,
  )
  if (!selected) {
    return { ok: false, reason: 'authenticator-picker-selection-invalid' }
  }
  try {
    const nookTypedArgs0_4: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: 'nook:website-authenticator-selected',
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
      nookTypedArgs0_4,
    )
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

export async function cancelAuthenticatorPicker({
  message,
  sender,
}: {
  message: { payload: { requestId: string } }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const loaded = await loadAuthenticatorPicker(message.payload.requestId)
  if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
    return { ok: true }
  }
  const { request } = loaded
  const nookNamedArgs0_0: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: request.origin,
  }
  if (
    !isAuthenticatorPickerSender(sender) &&
    !isAuthorizedWebsiteSender(nookNamedArgs0_0)
  ) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  await removeAuthenticatorPicker(request.requestId)
  try {
    const nookTypedArgs0_5: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: 'nook:website-authenticator-canceled',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
      },
    }
    await chrome.tabs.sendMessage(request.tabId, nookTypedArgs0_5)
  } catch {
    // The website may have navigated while its picker was open. The pending
    // request is still canceled and must not remain reusable.
  }
  return { ok: true }
}

export async function websiteAuthenticatorFill({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; vaultStoreId: string; secretId: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_6: Parameters<
    typeof authorizedWebsiteGrant
  >[0]['reasons'] = {
    forbidden: 'authenticator-forbidden-origin',
    missing: 'authenticator-vault-not-granted',
    locked: 'authenticator-locked',
  }
  const nookTypedArgs0_3: Parameters<typeof authorizedWebsiteGrant>[0] = {
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    sender,
    reasons: nookTypedArgs0_6,
  }
  const access = await authorizedWebsiteGrant(nookTypedArgs0_3)
  if ('response' in access) return access.response
  const nookTypedArgs0_7: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-code',
    payload: { ...access.grant, secretId: message.payload.secretId },
  }
  return sendSessionMessage(nookTypedArgs0_7)
}

export async function websiteAuthenticatorEnrollPreview({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_8: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, status: 'unavailable' }
  }
  await ensureExtensionSessionDocument()
  try {
    const nookTypedArgs0_9: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-preview',
      payload: { otpauthUri: message.payload.otpauthUri },
    }
    const response = await sendSessionMessage(nookTypedArgs0_9)
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

export async function websiteAuthenticatorEnrollStage({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; vaultStoreId: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_10: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_10)) {
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
  const nookTypedArgs0_11: Parameters<
    typeof stagedAuthenticatorEnrollments.set
  >[1] = {
    stageId,
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    otpauthUri: message.payload.otpauthUri,
    expiresAt: Date.now() + STAGED_ENROLLMENT_TTL_MS,
  }
  stagedAuthenticatorEnrollments.set(stageId, nookTypedArgs0_11)
  return { ok: true, stageId }
}

export async function websiteAuthenticatorEnrollCode({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_12: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_12)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (!staged || staged.origin !== message.payload.origin) {
    return { ok: false, reason: 'authenticator-stage-missing' }
  }
  await ensureExtensionSessionDocument()
  try {
    const nookTypedArgs0_13: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-code',
      payload: { otpauthUri: staged.otpauthUri },
    }
    return await sendSessionMessage(nookTypedArgs0_13)
  } catch {
    return { ok: false, reason: 'authenticator-code-failed' }
  }
}

export async function websiteAuthenticatorEnrollConfirm({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; vaultStoreId: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_14: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_14)) {
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
  const nookTypedArgs0_15: Parameters<
    typeof authorizedWebsiteGrant
  >[0]['reasons'] = {
    forbidden: 'authenticator-forbidden-origin',
    missing: 'authenticator-vault-not-granted',
    locked: 'authenticator-locked',
  }
  const nookTypedArgs0_4: Parameters<typeof authorizedWebsiteGrant>[0] = {
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    sender,
    reasons: nookTypedArgs0_15,
  }
  const access = await authorizedWebsiteGrant(nookTypedArgs0_4)
  if ('response' in access) return access.response
  try {
    const nookTypedArgs0_16: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-confirm',
      payload: {
        ...access.grant,
        otpauthUri: staged.otpauthUri,
        origin: message.payload.origin,
      },
    }
    const response = await sendSessionMessage(nookTypedArgs0_16)
    clearStagedEnrollment(message.payload.stageId)
    return response
  } catch {
    return { ok: false, reason: 'authenticator-enroll-failed' }
  }
}

export async function websiteAuthenticatorEnrollDismiss({
  message,
  sender,
}: {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_17: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_17)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (staged && staged.origin === message.payload.origin) {
    clearStagedEnrollment(message.payload.stageId)
  }
  return { ok: true }
}

export async function websiteAuthenticatorEnrollPending({
  message,
  sender,
}: {
  message: {
    payload: { origin: string }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const nookTypedArgs0_18: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_18)) {
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

export enum WebsiteAuthenticatorBackupAttachMessageMode {
  Replace = 'replace',
  Merge = 'merge',
}

export async function websiteAuthenticatorBackupAttach({
  message,
  sender,
}: {
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      codes: string[]
      mode:
        | WebsiteAuthenticatorBackupAttachMessageMode.Replace
        | WebsiteAuthenticatorBackupAttachMessageMode.Merge
    }
  }
  sender: chrome.runtime.MessageSender
}): Promise<unknown> {
  const codes = [...message.payload.codes]
  message.payload.codes.fill('')
  message.payload.codes = []
  try {
    const nookTypedArgs0_19: Parameters<
      typeof authorizedWebsiteGrant
    >[0]['reasons'] = {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    }
    const nookTypedArgs0_5: Parameters<typeof authorizedWebsiteGrant>[0] = {
      origin: message.payload.origin,
      vaultStoreId: message.payload.vaultStoreId,
      sender,
      reasons: nookTypedArgs0_19,
    }
    const access = await authorizedWebsiteGrant(nookTypedArgs0_5)
    if ('response' in access) return access.response
    const nookTypedArgs0_20: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-backup-attach',
      payload: {
        ...access.grant,
        secretId: message.payload.secretId,
        codes,
        mode: message.payload.mode,
      },
    }
    const pending = sendSessionMessage(nookTypedArgs0_20)
    codes.fill('')
    return await pending
  } finally {
    codes.fill('')
  }
}
