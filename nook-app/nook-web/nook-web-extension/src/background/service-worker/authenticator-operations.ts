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
  AccountPickerPageTarget,
  AuthenticatorPickerLoadKind,
  type AccountPickerSurface,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import { AUTHENTICATOR_PICKER_TTL_MS } from './account-pickers'
import { extensionSessionLifecycle } from './session-lifecycle'
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
  dependencies?: WebsiteAuthenticatorOptionsDependencies
}

type WebsiteAuthenticatorOptionsDependencies = {
  accountPickerAuthorizationCleanupPending: typeof accountPickerAuthorizationCleanupPending
  accountPickerAuthorizationGeneration: typeof accountPickerAuthorizationGeneration
  accountPickerAuthorizationIsCurrent: typeof accountPickerAuthorizationIsCurrent
  authenticatorAccounts: typeof accountPickerSessions.authenticatorAccounts
  availableWebsiteGrants: typeof extensionPairingIdentity.availableWebsiteGrants
}

type OpenWebsiteAuthenticatorPickerArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}

type QueryAuthenticatorPickerArgs = {
  message: { payload: { requestId: string; query: string } }
  sender: chrome.runtime.MessageSender
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

type CancelAuthenticatorPickerArgs = {
  message: { payload: { requestId: string } }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorFillArgs = {
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      authorizationGeneration?: string
    }
  }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorEnrollPreviewArgs = {
  message: {
    payload: { origin: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}

type StagedAuthenticatorEnrollment = {
  stageId: string
  authorizationGeneration: string
  origin: string
  vaultStoreId: string
  otpauthUri: string
  expiresAt: number
}

const STAGED_ENROLLMENT_TTL_MS = 5 * 60 * 1000

type WebsiteAuthenticatorEnrollStageArgs = {
  message: {
    payload: { origin: string; vaultStoreId: string; otpauthUri: string }
  }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorEnrollCodeArgs = {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorEnrollConfirmArgs = {
  message: {
    payload: { origin: string; vaultStoreId: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorEnrollDismissArgs = {
  message: {
    payload: { origin: string; stageId: string }
  }
  sender: chrome.runtime.MessageSender
}

type WebsiteAuthenticatorEnrollPendingArgs = {
  message: {
    payload: { origin: string }
  }
  sender: chrome.runtime.MessageSender
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

/** Owns the browser runtime resources shared by these interactions. */
class AuthenticatorEnrollmentOperations {
  private get websiteAuthenticatorOptionsDependencies(): WebsiteAuthenticatorOptionsDependencies {
    return {
      accountPickerAuthorizationCleanupPending,
      accountPickerAuthorizationGeneration,
      accountPickerAuthorizationIsCurrent,
      authenticatorAccounts: accountPickerSessions.authenticatorAccounts.bind(
        accountPickerSessions,
      ),
      availableWebsiteGrants:
        extensionPairingIdentity.availableWebsiteGrants.bind(
          extensionPairingIdentity,
        ),
    }
  }

  private stagedAuthenticatorEnrollments = new Map<
    string,
    StagedAuthenticatorEnrollment
  >()
  async websiteAuthenticatorOptions({
    message,
    sender,
    dependencies,
  }: WebsiteAuthenticatorOptionsArgs): Promise<AuthenticatorOptionsResponse> {
    const resolvedDependencies = ((v) =>
      v ? v : this.websiteAuthenticatorOptionsDependencies)(dependencies)
    const authorizationGeneration =
      await resolvedDependencies.accountPickerAuthorizationGeneration()
    if (
      !resolvedDependencies.accountPickerAuthorizationIsCurrent(
        authorizationGeneration,
      ) ||
      (await resolvedDependencies.accountPickerAuthorizationCleanupPending())
    ) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    const nookTypedArgs0_0: Parameters<
      typeof extensionPairingIdentity.availableWebsiteGrants
    >[0] = {
      origin: message.payload.origin,
      sender,
      forbiddenReason: 'authenticator-forbidden-origin',
    }
    const access =
      await resolvedDependencies.availableWebsiteGrants(nookTypedArgs0_0)
    if ('response' in access) return access.response

    const authenticatorAccountsArgs: Parameters<
      typeof accountPickerSessions.authenticatorAccounts
    >[0] = {
      grants: access.grants,
      query: '',
    }
    const accounts = await resolvedDependencies.authenticatorAccounts(
      authenticatorAccountsArgs,
    )
    if (
      !resolvedDependencies.accountPickerAuthorizationIsCurrent(
        authorizationGeneration,
      ) ||
      (await resolvedDependencies.accountPickerAuthorizationCleanupPending())
    ) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    return {
      ok: true,
      status: WebsiteAuthenticatorResponseStatus.Ready,
      accounts,
    }
  }

  async openWebsiteAuthenticatorPicker({
    message,
    sender,
  }: OpenWebsiteAuthenticatorPickerArgs): Promise<AuthenticatorPickerOpenResponse> {
    const authorizationGeneration = await accountPickerAuthorizationGeneration()
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: true, status: WebsiteAuthenticatorResponseStatus.Locked }
    }
    const nookTypedArgs0_1: Parameters<
      typeof extensionPairingIdentity.availableWebsiteGrants
    >[0] = {
      origin: message.payload.origin,
      sender,
      forbiddenReason: 'authenticator-forbidden-origin',
    }
    const access =
      await extensionPairingIdentity.availableWebsiteGrants(nookTypedArgs0_1)
    if ('response' in access) return access.response
    if (
      !sender.tab ||
      !('id' in sender.tab) ||
      typeof sender.tab.id !== 'number'
    ) {
      return { ok: false, reason: 'authenticator-picker-tab-missing' }
    }

    const requestId = extensionPairingIdentity.randomNonce()
    const request: Parameters<
      typeof accountPickerSessions.storeAuthenticatorPicker
    >[0]['request'] = {
      requestId,
      origin: message.payload.origin,
      tabId: sender.tab.id,
      frameId: AccountPickerPageTarget.senderFrameId(sender),
      allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
      expiresAt: Date.now() + AUTHENTICATOR_PICKER_TTL_MS,
    }
    const storeArgs: Parameters<
      typeof accountPickerSessions.storeAuthenticatorPicker
    >[0] = {
      request,
      authorizationGeneration,
    }
    if (!(await accountPickerSessions.storeAuthenticatorPicker(storeArgs))) {
      return { ok: true, status: WebsiteAuthenticatorResponseStatus.Locked }
    }
    const pickerUrl = new URL(chrome.runtime.getURL('popup/index.html'))
    pickerUrl.searchParams.set('intent', 'authenticator-picker')
    pickerUrl.searchParams.set('request', requestId)
    let createdSurface: AccountPickerSurface =
      accountPickerSessions.emptyAccountPickerSurface()
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
      await accountPickerSessions.removeAuthenticatorPicker(requestId)
      return { ok: false, reason: 'authenticator-picker-open-failed' }
    }
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      await Promise.allSettled([
        accountPickerSessions.removeAuthenticatorPicker(requestId),
        accountPickerSessions.closeAccountPickerSurface(createdSurface),
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

  async queryAuthenticatorPicker({
    message,
    sender,
  }: QueryAuthenticatorPickerArgs): Promise<AuthenticatorPickerQueryResponse> {
    if (!accountPickerSessions.isAuthenticatorPickerSender(sender)) {
      return { ok: false, reason: 'authenticator-picker-forbidden' }
    }
    const loaded = await accountPickerSessions.loadAuthenticatorPicker(
      message.payload.requestId,
    )
    if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
      return { ok: false, reason: 'authenticator-picker-expired' }
    }
    const { request, authorizationGeneration } = loaded
    const grants = (
      await extensionPairingIdentity.passwordPairingGrants()
    ).filter((grant) =>
      request.allowedVaultStoreIds.includes(grant.vaultStoreId),
    )
    const nookTypedArgs0_1: Parameters<
      typeof accountPickerSessions.authenticatorAccounts
    >[0] = {
      grants,
      query: message.payload.query,
    }
    const accounts =
      await accountPickerSessions.authenticatorAccounts(nookTypedArgs0_1)
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'authenticator-picker-expired' }
    }
    return { ok: true, origin: request.origin, accounts }
  }

  async selectAuthenticatorPicker({
    message,
    sender,
  }: SelectAuthenticatorPickerArgs): Promise<
    AuthenticatorSuccessResponse | AuthenticatorFailureResponse
  > {
    if (!accountPickerSessions.isAuthenticatorPickerSender(sender)) {
      return { ok: false, reason: 'authenticator-picker-forbidden' }
    }
    const loaded = await accountPickerSessions.loadAuthenticatorPicker(
      message.payload.requestId,
    )
    if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
      return { ok: false, reason: 'authenticator-picker-expired' }
    }
    const { request, authorizationGeneration } = loaded
    const grants = (
      await extensionPairingIdentity.passwordPairingGrants()
    ).filter((grant) =>
      request.allowedVaultStoreIds.includes(grant.vaultStoreId),
    )
    const nookTypedArgs0_2: Parameters<
      typeof accountPickerSessions.authenticatorAccounts
    >[0] = {
      grants,
      query: '',
    }
    const accounts =
      await accountPickerSessions.authenticatorAccounts(nookTypedArgs0_2)
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
        frameId: request.frameId,
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
    await accountPickerSessions.removeAuthenticatorPicker(request.requestId)
    return { ok: true }
  }

  async cancelAuthenticatorPicker({
    message,
    sender,
  }: CancelAuthenticatorPickerArgs): Promise<
    AuthenticatorSuccessResponse | AuthenticatorFailureResponse
  > {
    const loaded = await accountPickerSessions.loadAuthenticatorPicker(
      message.payload.requestId,
    )
    if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) {
      return { ok: true }
    }
    const { request } = loaded
    const nookNamedArgs0_0: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: request.origin,
    }
    const websiteFrame: Parameters<
      typeof AccountPickerPageTarget.matchesSender
    >[0] = {
      tabId: request.tabId,
      frameId: request.frameId,
      sender,
    }
    if (
      !accountPickerSessions.isAuthenticatorPickerSender(sender) &&
      (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookNamedArgs0_0) ||
        !AccountPickerPageTarget.matchesSender(websiteFrame))
    ) {
      return { ok: false, reason: 'authenticator-picker-forbidden' }
    }
    await accountPickerSessions.removeAuthenticatorPicker(request.requestId)
    try {
      const nookTypedArgs0_5: Parameters<typeof chrome.tabs.sendMessage>[1] = {
        type: 'nook:website-authenticator-canceled',
        payload: {
          origin: request.origin,
          requestId: request.requestId,
        },
      }
      const delivery: Parameters<typeof AccountPickerPageTarget.send>[0] = {
        tabId: request.tabId,
        frameId: request.frameId,
        message: nookTypedArgs0_5,
      }
      await AccountPickerPageTarget.send(delivery)
    } catch {
      // The website may have navigated while its picker was open. The pending
      // request is still canceled and must not remain reusable.
    }
    return { ok: true }
  }

  async websiteAuthenticatorFill({
    message,
    sender,
  }: WebsiteAuthenticatorFillArgs): Promise<AuthenticatorCodeResponse> {
    const {
      authorizationGeneration = await accountPickerAuthorizationGeneration(),
    } = message.payload
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    const nookTypedArgs0_6: Parameters<
      typeof accountPickerSessions.authorizedWebsiteGrant
    >[0]['reasons'] = {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    }
    const nookTypedArgs0_3: Parameters<
      typeof accountPickerSessions.authorizedWebsiteGrant
    >[0] = {
      origin: message.payload.origin,
      vaultStoreId: message.payload.vaultStoreId,
      sender,
      reasons: nookTypedArgs0_6,
    }
    const access =
      await accountPickerSessions.authorizedWebsiteGrant(nookTypedArgs0_3)
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

  async websiteAuthenticatorEnrollPreview({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollPreviewArgs): Promise<AuthenticatorPreviewResponse> {
    const nookTypedArgs0_8: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    const grants = await extensionPairingIdentity.passwordPairingGrants()
    if (grants.length === 0) {
      return {
        ok: true,
        status: WebsiteAuthenticatorResponseStatus.Unavailable,
      }
    }
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
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

  authenticatorEnrollmentAuthorizationIsCurrent(
    authorizationGeneration: string,
  ): boolean {
    return accountPickerAuthorizationIsCurrent(authorizationGeneration)
  }

  private purgeExpiredStagedEnrollments(now = Date.now()): void {
    for (const [stageId, staged] of this.stagedAuthenticatorEnrollments) {
      if (staged.expiresAt <= now) {
        staged.otpauthUri = ''
        this.stagedAuthenticatorEnrollments.delete(stageId)
      }
    }
  }

  private clearStagedEnrollment(stageId: string): void {
    const staged = this.stagedAuthenticatorEnrollments.get(stageId)
    if (!staged) return
    staged.otpauthUri = ''
    this.stagedAuthenticatorEnrollments.delete(stageId)
  }

  clearStagedAuthenticatorEnrollments(): void {
    for (const staged of this.stagedAuthenticatorEnrollments.values()) {
      staged.otpauthUri = ''
    }
    this.stagedAuthenticatorEnrollments.clear()
  }

  rebindStagedAuthenticatorEnrollmentsAuthorization(
    authorizationGeneration: string,
  ): void {
    for (const staged of this.stagedAuthenticatorEnrollments.values()) {
      staged.authorizationGeneration = authorizationGeneration
    }
  }

  async websiteAuthenticatorEnrollStage({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollStageArgs): Promise<AuthenticatorStageResponse> {
    const authorizationGeneration = await accountPickerAuthorizationGeneration()
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    const nookTypedArgs0_10: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (
      !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_10)
    ) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    const grant = (await extensionPairingIdentity.passwordPairingGrants()).find(
      (candidate) => candidate.vaultStoreId === message.payload.vaultStoreId,
    )
    if (!grant) return { ok: false, reason: 'authenticator-vault-not-granted' }
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    this.purgeExpiredStagedEnrollments()
    for (const [stageId, staged] of this.stagedAuthenticatorEnrollments) {
      if (staged.origin === message.payload.origin) {
        this.clearStagedEnrollment(stageId)
      }
    }
    const stageId = crypto.randomUUID()
    const nookTypedArgs0_11: Parameters<
      typeof this.stagedAuthenticatorEnrollments.set
    >[1] = {
      stageId,
      authorizationGeneration,
      origin: message.payload.origin,
      vaultStoreId: message.payload.vaultStoreId,
      otpauthUri: message.payload.otpauthUri,
      expiresAt: Date.now() + STAGED_ENROLLMENT_TTL_MS,
    }
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      nookTypedArgs0_11.otpauthUri = ''
      return { ok: false, reason: 'authenticator-locked' }
    }
    this.stagedAuthenticatorEnrollments.set(stageId, nookTypedArgs0_11)
    return { ok: true, stageId }
  }

  async websiteAuthenticatorEnrollCode({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollCodeArgs): Promise<AuthenticatorCodeResponse> {
    const nookTypedArgs0_12: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (
      !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_12)
    ) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    this.purgeExpiredStagedEnrollments()
    const staged = this.stagedAuthenticatorEnrollments.get(
      message.payload.stageId,
    )
    if (!staged || staged.origin !== message.payload.origin) {
      return { ok: false, reason: 'authenticator-stage-missing' }
    }
    if (
      !this.authenticatorEnrollmentAuthorizationIsCurrent(
        staged.authorizationGeneration,
      )
    ) {
      this.clearStagedEnrollment(message.payload.stageId)
      return { ok: false, reason: 'authenticator-locked' }
    }
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
    try {
      const response = await stagedAuthenticatorCodeFromSession(
        staged.otpauthUri,
      )
      return this.authenticatorEnrollmentAuthorizationIsCurrent(
        staged.authorizationGeneration,
      )
        ? response
        : { ok: false, reason: 'authenticator-locked' }
    } catch {
      return { ok: false, reason: 'authenticator-code-failed' }
    }
  }

  async websiteAuthenticatorEnrollConfirm({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollConfirmArgs): Promise<AuthenticatorSecretResponse> {
    const nookTypedArgs0_14: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (
      !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_14)
    ) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    this.purgeExpiredStagedEnrollments()
    const staged = this.stagedAuthenticatorEnrollments.get(
      message.payload.stageId,
    )
    if (
      !staged ||
      staged.origin !== message.payload.origin ||
      staged.vaultStoreId !== message.payload.vaultStoreId
    ) {
      return { ok: false, reason: 'authenticator-stage-missing' }
    }
    if (
      !this.authenticatorEnrollmentAuthorizationIsCurrent(
        staged.authorizationGeneration,
      )
    ) {
      this.clearStagedEnrollment(message.payload.stageId)
      return { ok: false, reason: 'authenticator-locked' }
    }
    const nookTypedArgs0_15: Parameters<
      typeof accountPickerSessions.authorizedWebsiteGrant
    >[0]['reasons'] = {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    }
    const nookTypedArgs0_4: Parameters<
      typeof accountPickerSessions.authorizedWebsiteGrant
    >[0] = {
      origin: message.payload.origin,
      vaultStoreId: message.payload.vaultStoreId,
      sender,
      reasons: nookTypedArgs0_15,
    }
    const access =
      await accountPickerSessions.authorizedWebsiteGrant(nookTypedArgs0_4)
    if ('response' in access) return access.response
    if (
      !this.authenticatorEnrollmentAuthorizationIsCurrent(
        staged.authorizationGeneration,
      )
    ) {
      return { ok: false, reason: 'authenticator-locked' }
    }
    try {
      const confirmArgs: Parameters<typeof confirmAuthenticatorEnrollment>[0] =
        {
          grant: access.grant,
          otpauthUri: staged.otpauthUri,
          origin: message.payload.origin,
        }
      const response = await confirmAuthenticatorEnrollment(confirmArgs)
      return this.authenticatorEnrollmentAuthorizationIsCurrent(
        staged.authorizationGeneration,
      )
        ? response
        : { ok: false, reason: 'authenticator-locked' }
    } catch {
      return { ok: false, reason: 'authenticator-enroll-failed' }
    } finally {
      this.clearStagedEnrollment(message.payload.stageId)
    }
  }

  async websiteAuthenticatorEnrollDismiss({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollDismissArgs): Promise<
    AuthenticatorSuccessResponse | AuthenticatorFailureResponse
  > {
    const nookTypedArgs0_17: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (
      !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_17)
    ) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    const staged = this.stagedAuthenticatorEnrollments.get(
      message.payload.stageId,
    )
    if (staged && staged.origin === message.payload.origin) {
      this.clearStagedEnrollment(message.payload.stageId)
    }
    return { ok: true }
  }

  async websiteAuthenticatorEnrollPending({
    message,
    sender,
  }: WebsiteAuthenticatorEnrollPendingArgs): Promise<AuthenticatorPendingResponse> {
    const nookTypedArgs0_18: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (
      !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_18)
    ) {
      return { ok: false, reason: 'authenticator-forbidden-origin' }
    }
    this.purgeExpiredStagedEnrollments()
    for (const staged of this.stagedAuthenticatorEnrollments.values()) {
      if (staged.origin === message.payload.origin) {
        if (
          !this.authenticatorEnrollmentAuthorizationIsCurrent(
            staged.authorizationGeneration,
          )
        ) {
          this.clearStagedEnrollment(staged.stageId)
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

  async websiteAuthenticatorBackupAttach({
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
        typeof accountPickerSessions.authorizedWebsiteGrant
      >[0]['reasons'] = {
        forbidden: 'authenticator-forbidden-origin',
        missing: 'authenticator-vault-not-granted',
        locked: 'authenticator-locked',
      }
      const nookTypedArgs0_5: Parameters<
        typeof accountPickerSessions.authorizedWebsiteGrant
      >[0] = {
        origin: message.payload.origin,
        vaultStoreId: message.payload.vaultStoreId,
        sender,
        reasons: nookTypedArgs0_19,
      }
      const access =
        await accountPickerSessions.authorizedWebsiteGrant(nookTypedArgs0_5)
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
}

export const authenticatorEnrollmentOperations =
  new AuthenticatorEnrollmentOperations()
