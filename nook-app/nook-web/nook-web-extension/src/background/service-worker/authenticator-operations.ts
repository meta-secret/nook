import type {
  OtpauthEnrollmentPreview,
  WebsiteAuthenticatorBackupAttachMessageMode,
} from '../../lib/enrollment-messages'
import {
  type WebsiteAuthenticatorOption,
  WebsiteAuthenticatorResponseStatus,
} from '../../lib/login-fill-messages'
import {
  AccountPickerSurfaceKind,
  AuthenticatorPickerLoadKind,
  type AccountPickerSurface,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  authenticatorAccounts,
  authorizedWebsiteGrant,
  closeAccountPickerSurface,
  emptyAccountPickerSurface,
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
} from './pairing-identity'
import { AUTHENTICATOR_PICKER_TTL_MS } from './account-pickers'
import { ensureExtensionSessionDocument } from './session-lifecycle'
import {
  attachAuthenticatorBackupCodesFromSession,
  authenticatorCodeFromSession,
  authenticatorPreviewFromSession,
  confirmAuthenticatorEnrollment,
  selectedAuthenticatorPageAcknowledged,
  stagedAuthenticatorCodeFromSession,
} from './authenticator-session-adapter'

type AuthenticatorFailureResponse = { ok: false; reason: string }
type AuthenticatorSuccessResponse = { ok: true }
type AuthenticatorUnavailableResponse = {
  ok: true
  status:
    | WebsiteAuthenticatorResponseStatus.Unavailable
    | WebsiteAuthenticatorResponseStatus.Locked
}
type AuthenticatorOptionsResponse =
  | AuthenticatorFailureResponse
  | AuthenticatorUnavailableResponse
  | {
      ok: true
      status: WebsiteAuthenticatorResponseStatus.Ready
      accounts: WebsiteAuthenticatorOption[]
    }
type AuthenticatorPickerOpenResponse =
  | AuthenticatorFailureResponse
  | AuthenticatorUnavailableResponse
  | {
      ok: true
      status: WebsiteAuthenticatorResponseStatus.Ready
      requestId: string
      expiresAt: number
    }
type AuthenticatorPickerQueryResponse =
  | AuthenticatorFailureResponse
  | { ok: true; origin: string; accounts: WebsiteAuthenticatorOption[] }
type AuthenticatorCodeResponse =
  AuthenticatorFailureResponse | { ok: true; code: string }
type AuthenticatorPreviewResponse =
  | AuthenticatorFailureResponse
  | { ok: true; status: WebsiteAuthenticatorResponseStatus.Unavailable }
  | {
      ok: true
      status: WebsiteAuthenticatorResponseStatus.Ready
      preview: OtpauthEnrollmentPreview
      vaultStoreId: string
      vaultName: string
    }
type AuthenticatorStageResponse =
  AuthenticatorFailureResponse | { ok: true; stageId: string }
type AuthenticatorSecretResponse =
  AuthenticatorFailureResponse | { ok: true; secretId: string }
type AuthenticatorPendingResponse =
  | AuthenticatorFailureResponse
  | { ok: true; stageId: string; vaultStoreId: string }
  | AuthenticatorSuccessResponse

type WebsiteAuthenticatorOptionsArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorOptions({
  message,
  sender,
}: WebsiteAuthenticatorOptionsArgs): Promise<AuthenticatorOptionsResponse> {
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
  return {
    ok: true,
    status: WebsiteAuthenticatorResponseStatus.Ready,
    accounts,
  }
}

type OpenWebsiteAuthenticatorPickerArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}

export async function openWebsiteAuthenticatorPicker({
  message,
  sender,
}: OpenWebsiteAuthenticatorPickerArgs): Promise<AuthenticatorPickerOpenResponse> {
  const authorizationGeneration = accountPickerAuthorizationGeneration()
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: true, status: WebsiteAuthenticatorResponseStatus.Locked }
  }
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
  const request: Parameters<typeof storeAuthenticatorPicker>[0]['request'] = {
    requestId,
    origin: message.payload.origin,
    tabId: sender.tab.id,
    allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
    expiresAt: Date.now() + AUTHENTICATOR_PICKER_TTL_MS,
  }
  const storeArgs: Parameters<typeof storeAuthenticatorPicker>[0] = {
    request,
    authorizationGeneration,
  }
  if (!(await storeAuthenticatorPicker(storeArgs))) {
    return { ok: true, status: WebsiteAuthenticatorResponseStatus.Locked }
  }
  const pickerUrl = new URL(chrome.runtime.getURL('popup/index.html'))
  pickerUrl.searchParams.set('intent', 'authenticator-picker')
  pickerUrl.searchParams.set('request', requestId)
  let createdSurface: AccountPickerSurface = emptyAccountPickerSurface()
  try {
    if (chrome.windows?.create) {
      const nookTypedArgs0_2: Parameters<typeof chrome.windows.create>[0] = {
        url: pickerUrl.toString(),
        type: 'popup',
        width: 460,
        height: 620,
        focused: true,
      }
      const createdWindow = await chrome.windows.create(nookTypedArgs0_2)
      if (
        createdWindow &&
        typeof createdWindow === 'object' &&
        'id' in createdWindow &&
        typeof createdWindow.id === 'number'
      ) {
        createdSurface = {
          kind: AccountPickerSurfaceKind.Window,
          id: createdWindow.id,
        }
      }
    } else {
      const nookTypedArgs0_3: Parameters<typeof chrome.tabs.create>[0] = {
        url: pickerUrl.toString(),
      }
      const createdTab = await chrome.tabs.create(nookTypedArgs0_3)
      if ('id' in createdTab && typeof createdTab.id === 'number') {
        createdSurface = {
          kind: AccountPickerSurfaceKind.Tab,
          id: createdTab.id,
        }
      }
    }
  } catch {
    await removeAuthenticatorPicker(requestId)
    return { ok: false, reason: 'authenticator-picker-open-failed' }
  }
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    await Promise.allSettled([
      removeAuthenticatorPicker(requestId),
      closeAccountPickerSurface(createdSurface),
    ])
    return { ok: true, status: WebsiteAuthenticatorResponseStatus.Locked }
  }
  return {
    ok: true,
    status: WebsiteAuthenticatorResponseStatus.Ready,
    requestId,
    expiresAt: request.expiresAt,
  }
}

type QueryAuthenticatorPickerArgs = {
  message: { payload: { requestId: string; query: string } }
  sender: chrome.runtime.MessageSender
}

export async function queryAuthenticatorPicker({
  message,
  sender,
}: QueryAuthenticatorPickerArgs): Promise<AuthenticatorPickerQueryResponse> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const loaded = await loadAuthenticatorPicker(message.payload.requestId)
  if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const { request, authorizationGeneration } = loaded
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const nookTypedArgs0_1: Parameters<typeof authenticatorAccounts>[0] = {
    grants,
    query: message.payload.query,
  }
  const accounts = await authenticatorAccounts(nookTypedArgs0_1)
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  return { ok: true, origin: request.origin, accounts }
}

type SelectAuthenticatorPickerArgs = {
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function selectAuthenticatorPicker({
  message,
  sender,
}: SelectAuthenticatorPickerArgs): Promise<
  AuthenticatorSuccessResponse | AuthenticatorFailureResponse
> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const loaded = await loadAuthenticatorPicker(message.payload.requestId)
  if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const { request, authorizationGeneration } = loaded
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
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  try {
    const acknowledgeArgs: Parameters<
      typeof selectedAuthenticatorPageAcknowledged
    >[0] = {
      tabId: request.tabId,
      origin: request.origin,
      requestId: request.requestId,
      vaultStoreId: selected.vaultStoreId,
      secretId: selected.secretId,
      authorizationGeneration,
    }
    if (!(await selectedAuthenticatorPageAcknowledged(acknowledgeArgs))) {
      return { ok: false, reason: 'authenticator-picker-page-unavailable' }
    }
  } catch {
    return { ok: false, reason: 'authenticator-picker-page-unavailable' }
  }
  await removeAuthenticatorPicker(request.requestId)
  return { ok: true }
}

type CancelAuthenticatorPickerArgs = {
  message: { payload: { requestId: string } }
  sender: chrome.runtime.MessageSender
}

export async function cancelAuthenticatorPicker({
  message,
  sender,
}: CancelAuthenticatorPickerArgs): Promise<
  AuthenticatorSuccessResponse | AuthenticatorFailureResponse
> {
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

type WebsiteAuthenticatorFillArgs = {
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      authorizationGeneration?: number
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorFill({
  message,
  sender,
}: WebsiteAuthenticatorFillArgs): Promise<AuthenticatorCodeResponse> {
  const authorizationGeneration =
    message.payload.authorizationGeneration ??
    accountPickerAuthorizationGeneration()
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'authenticator-locked' }
  }
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
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    return { ok: false, reason: 'authenticator-locked' }
  }
  const sessionArgs: Parameters<typeof authenticatorCodeFromSession>[0] = {
    grant: access.grant,
    secretId: message.payload.secretId,
  }
  const response = await authenticatorCodeFromSession(sessionArgs)
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    if (response.ok) response.code = ''
    return { ok: false, reason: 'authenticator-locked' }
  }
  return response
}

type WebsiteAuthenticatorEnrollPreviewArgs = {
  message: {
    payload: { origin: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollPreview({
  message,
  sender,
}: WebsiteAuthenticatorEnrollPreviewArgs): Promise<AuthenticatorPreviewResponse> {
  const nookTypedArgs0_8: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin: message.payload.origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return {
      ok: true,
      status: WebsiteAuthenticatorResponseStatus.Unavailable,
    }
  }
  await ensureExtensionSessionDocument()
  try {
    const response = await authenticatorPreviewFromSession(
      message.payload.otpauthUri,
    )
    const firstGrant = grants[0]!
    return {
      ok: true,
      status: WebsiteAuthenticatorResponseStatus.Ready,
      preview: response.preview,
      vaultStoreId: firstGrant.vaultStoreId,
      vaultName: firstGrant.vaultName,
    }
  } catch {
    return { ok: false, reason: 'authenticator-preview-invalid' }
  }
}

type StagedAuthenticatorEnrollment = {
  stageId: string
  authorizationGeneration: number
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

export function authenticatorEnrollmentAuthorizationIsCurrent(
  authorizationGeneration: number,
): boolean {
  return accountPickerAuthorizationIsCurrent(authorizationGeneration)
}

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

export function clearStagedAuthenticatorEnrollments(): void {
  for (const staged of stagedAuthenticatorEnrollments.values()) {
    staged.otpauthUri = ''
  }
  stagedAuthenticatorEnrollments.clear()
}

export function rebindStagedAuthenticatorEnrollmentsAuthorization(
  authorizationGeneration: number,
): void {
  for (const staged of stagedAuthenticatorEnrollments.values()) {
    staged.authorizationGeneration = authorizationGeneration
  }
}

type WebsiteAuthenticatorEnrollStageArgs = {
  message: {
    payload: { origin: string; vaultStoreId: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollStage({
  message,
  sender,
}: WebsiteAuthenticatorEnrollStageArgs): Promise<AuthenticatorStageResponse> {
  const authorizationGeneration = accountPickerAuthorizationGeneration()
  const otpauthUri = { value: message.payload.otpauthUri }
  message.payload.otpauthUri = ''
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    otpauthUri.value = ''
    return { ok: false, reason: 'authenticator-locked' }
  }
  const nookTypedArgs0_10: Parameters<
    typeof authorizedWebsiteGrant
  >[0]['reasons'] = {
    forbidden: 'authenticator-forbidden-origin',
    missing: 'authenticator-vault-not-granted',
    locked: 'authenticator-locked',
  }
  const accessArgs: Parameters<typeof authorizedWebsiteGrant>[0] = {
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    sender,
    reasons: nookTypedArgs0_10,
  }
  const access = await authorizedWebsiteGrant(accessArgs)
  if ('response' in access) {
    otpauthUri.value = ''
    return access.response
  }
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    otpauthUri.value = ''
    return { ok: false, reason: 'authenticator-locked' }
  }
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
    authorizationGeneration,
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    otpauthUri: otpauthUri.value,
    expiresAt: Date.now() + STAGED_ENROLLMENT_TTL_MS,
  }
  if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
    nookTypedArgs0_11.otpauthUri = ''
    return { ok: false, reason: 'authenticator-locked' }
  }
  stagedAuthenticatorEnrollments.set(stageId, nookTypedArgs0_11)
  otpauthUri.value = ''
  return { ok: true, stageId }
}

type WebsiteAuthenticatorEnrollCodeArgs = {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollCode({
  message,
  sender,
}: WebsiteAuthenticatorEnrollCodeArgs): Promise<AuthenticatorCodeResponse> {
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
  if (
    !authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
  ) {
    clearStagedEnrollment(message.payload.stageId)
    return { ok: false, reason: 'authenticator-locked' }
  }
  await ensureExtensionSessionDocument()
  if (
    !authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
  ) {
    clearStagedEnrollment(message.payload.stageId)
    return { ok: false, reason: 'authenticator-locked' }
  }
  try {
    const response = await stagedAuthenticatorCodeFromSession(staged.otpauthUri)
    return authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
      ? response
      : { ok: false, reason: 'authenticator-locked' }
  } catch {
    return { ok: false, reason: 'authenticator-code-failed' }
  }
}

type WebsiteAuthenticatorEnrollConfirmArgs = {
  message: {
    payload: { origin: string; vaultStoreId: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollConfirm({
  message,
  sender,
}: WebsiteAuthenticatorEnrollConfirmArgs): Promise<AuthenticatorSecretResponse> {
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
  if (
    !authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
  ) {
    clearStagedEnrollment(message.payload.stageId)
    return { ok: false, reason: 'authenticator-locked' }
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
  if (
    !authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
  ) {
    return { ok: false, reason: 'authenticator-locked' }
  }
  try {
    const confirmArgs: Parameters<typeof confirmAuthenticatorEnrollment>[0] = {
      grant: access.grant,
      otpauthUri: staged.otpauthUri,
      origin: message.payload.origin,
    }
    const response = await confirmAuthenticatorEnrollment(confirmArgs)
    return authenticatorEnrollmentAuthorizationIsCurrent(
      staged.authorizationGeneration,
    )
      ? response
      : { ok: false, reason: 'authenticator-locked' }
  } catch {
    return { ok: false, reason: 'authenticator-enroll-failed' }
  } finally {
    clearStagedEnrollment(message.payload.stageId)
  }
}

type WebsiteAuthenticatorEnrollDismissArgs = {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollDismiss({
  message,
  sender,
}: WebsiteAuthenticatorEnrollDismissArgs): Promise<
  AuthenticatorSuccessResponse | AuthenticatorFailureResponse
> {
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

type WebsiteAuthenticatorEnrollPendingArgs = {
  message: {
    payload: { origin: string }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteAuthenticatorEnrollPending({
  message,
  sender,
}: WebsiteAuthenticatorEnrollPendingArgs): Promise<AuthenticatorPendingResponse> {
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
      if (
        !authenticatorEnrollmentAuthorizationIsCurrent(
          staged.authorizationGeneration,
        )
      ) {
        clearStagedEnrollment(staged.stageId)
        continue
      }
      return {
        ok: true,
        stageId: staged.stageId,
        vaultStoreId: staged.vaultStoreId,
      }
    }
  }
  return { ok: true }
}

type WebsiteAuthenticatorBackupAttachArgs = {
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
}

export async function websiteAuthenticatorBackupAttach({
  message,
  sender,
}: WebsiteAuthenticatorBackupAttachArgs): Promise<
  AuthenticatorFailureResponse | AuthenticatorSuccessResponse
> {
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
    const attachArgs: Parameters<
      typeof attachAuthenticatorBackupCodesFromSession
    >[0] = {
      grant: access.grant,
      secretId: message.payload.secretId,
      codes,
      mode: message.payload.mode,
    }
    const pending = attachAuthenticatorBackupCodesFromSession(attachArgs)
    codes.fill('')
    const response = await pending
    if (!response.ok) return response
    return { ok: true }
  } finally {
    codes.fill('')
  }
}
