import {
  WebsiteAuthenticatorResponseStatus,
  type WebsiteLoginAccountOption,
} from '../../lib/login-fill-messages'
import {
  LoginPickerFrameBindingKind,
  LoginPickerPageVerificationType,
  type LoginPickerPageVerification,
} from '../../lib/inline-login-picker'
import {
  WebsiteLoginCanceledMessageType,
  WebsiteLoginSelectedMessageType,
} from '../../lib/login-picker-messages'
import {
  LoginPickerFrameAdmission,
  LoginPickerFrameTarget,
} from './login-picker-frame-target'
import {
  AccountPickerPageTarget,
  LoginPickerLoadKind,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
  LOGIN_PICKER_TTL_MS,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import type { AccountPickerPageMessage } from './account-picker-page-target'
import {
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
type OpenWebsiteLoginPickerArgs = {
  message: { payload: { origin: string } }
  sender: chrome.runtime.MessageSender
}

type QueryLoginPickerArgs = {
  message: {
    payload: { requestId: string; query: string; parentOrigin: string }
  }
  sender: chrome.runtime.MessageSender
}

type SelectLoginPickerArgs = {
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  }
  sender: chrome.runtime.MessageSender
}

type CancelLoginPickerArgs = {
  message: { payload: { requestId: string } }
  sender: chrome.runtime.MessageSender
}

class LoginPickerOperations {
  async openWebsiteLoginPicker({
    message,
    sender,
  }: OpenWebsiteLoginPickerArgs): Promise<LoginPickerOpenResponse> {
    const authorizationGeneration = await accountPickerAuthorizationGeneration()
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: true, status: LoginPickerOpenStatus.Locked }
    }
    const nookTypedArgs0_0: Parameters<
      typeof extensionPairingIdentity.availableWebsiteGrants
    >[0] = {
      origin: message.payload.origin,
      sender,
      forbiddenReason: 'login-forbidden-origin',
    }
    const access =
      await extensionPairingIdentity.availableWebsiteGrants(nookTypedArgs0_0)
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
      typeof sender.tab.id !== 'number' ||
      typeof sender.documentId !== 'string'
    ) {
      return { ok: false, reason: 'login-picker-tab-missing' }
    }

    const requestId = extensionPairingIdentity.randomNonce()
    const request: Parameters<
      typeof accountPickerSessions.storeLoginPicker
    >[0]['request'] = {
      requestId,
      origin: message.payload.origin,
      tabId: sender.tab.id,
      frameId: AccountPickerPageTarget.senderFrameId(sender),
      parentDocumentId: sender.documentId,
      allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
      expiresAt: Date.now() + LOGIN_PICKER_TTL_MS,
      pickerDocument: { kind: LoginPickerFrameBindingKind.AwaitingDocument },
    }
    const storeArgs: Parameters<
      typeof accountPickerSessions.storeLoginPicker
    >[0] = {
      request,
      authorizationGeneration,
    }
    if (!(await accountPickerSessions.storeLoginPicker(storeArgs))) {
      return { ok: true, status: LoginPickerOpenStatus.Locked }
    }
    return {
      ok: true,
      status: LoginPickerOpenStatus.Ready,
      requestId,
      expiresAt: request.expiresAt,
    }
  }

  async queryLoginPicker({
    message,
    sender,
  }: QueryLoginPickerArgs): Promise<LoginPickerQueryResponse> {
    const loaded = await accountPickerSessions.loadLoginPicker(
      message.payload.requestId,
    )
    if (loaded.kind === LoginPickerLoadKind.Unavailable) {
      return { ok: false, reason: 'login-picker-expired' }
    }
    const { request, authorizationGeneration } = loaded
    const frameRequest: ConstructorParameters<
      typeof LoginPickerFrameTarget
    >[0] = { request, sender }
    const target = new LoginPickerFrameTarget(frameRequest)
    const queryRequest: Parameters<typeof target.queryAdmission>[0] = {
      request,
      sender,
      parentOrigin: message.payload.parentOrigin,
    }
    switch (target.queryAdmission(queryRequest)) {
      case LoginPickerFrameAdmission.Forbidden:
        return { ok: false, reason: 'login-picker-forbidden' }
      case LoginPickerFrameAdmission.Accepted:
        break
    }
    const storeRequest: Parameters<
      typeof accountPickerSessions.storeLoginPicker
    >[0] = { request, authorizationGeneration }
    switch (await accountPickerSessions.storeLoginPicker(storeRequest)) {
      case false:
        return { ok: false, reason: 'login-picker-expired' }
      case true:
        break
    }
    const verification: LoginPickerPageVerification = {
      type: LoginPickerPageVerificationType.Verify,
      requestId: request.requestId,
      origin: request.origin,
    }
    const targetOptions: chrome.tabs.MessageSendOptions = {
      frameId: request.frameId,
      documentId: request.parentDocumentId,
    }
    try {
      const parentResponse: BrowserRuntimeMessageValue =
        await chrome.tabs.sendMessage(
          request.tabId,
          verification,
          targetOptions,
        )
      switch (isLoginPickerPageAcknowledgement(parentResponse)) {
        case false:
          return { ok: false, reason: 'login-picker-page-unavailable' }
        case true:
          break
      }
    } catch {
      return { ok: false, reason: 'login-picker-page-unavailable' }
    }
    const grants = (
      await extensionPairingIdentity.passwordPairingGrants()
    ).filter((grant) =>
      request.allowedVaultStoreIds.includes(grant.vaultStoreId),
    )
    const nookTypedArgs0_0: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: request.origin,
      query: message.payload.query,
    }
    const accounts =
      await accountPickerSessions.loginAccountsForOrigin(nookTypedArgs0_0)
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'login-picker-expired' }
    }
    return { ok: true, origin: request.origin, accounts }
  }

  async selectLoginPicker({
    message,
    sender,
  }: SelectLoginPickerArgs): Promise<
    LoginOperationSuccess | LoginOperationFailure
  > {
    const loaded = await accountPickerSessions.loadLoginPicker(
      message.payload.requestId,
    )
    if (loaded.kind === LoginPickerLoadKind.Unavailable) {
      return { ok: false, reason: 'login-picker-expired' }
    }
    const { request, authorizationGeneration } = loaded
    const frameRequest: ConstructorParameters<
      typeof LoginPickerFrameTarget
    >[0] = { request, sender }
    switch (new LoginPickerFrameTarget(frameRequest).boundAdmission()) {
      case LoginPickerFrameAdmission.Forbidden:
        return { ok: false, reason: 'login-picker-forbidden' }
      case LoginPickerFrameAdmission.Accepted:
        break
    }
    const grants = (
      await extensionPairingIdentity.passwordPairingGrants()
    ).filter((grant) =>
      request.allowedVaultStoreIds.includes(grant.vaultStoreId),
    )
    const nookTypedArgs0_1: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: request.origin,
    }
    const accounts =
      await accountPickerSessions.loginAccountsForOrigin(nookTypedArgs0_1)
    const selected = accounts.find(
      (account) =>
        account.vaultStoreId === message.payload.vaultStoreId &&
        account.secretId === message.payload.secretId,
    )
    if (!selected) {
      return { ok: false, reason: 'login-picker-selection-invalid' }
    }
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { ok: false, reason: 'login-picker-expired' }
    }
    try {
      const nookTypedArgs0_3: AccountPickerPageMessage = {
        type: WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected,
        payload: {
          origin: request.origin,
          requestId: request.requestId,
          account: {
            vaultStoreId: selected.vaultStoreId,
            secretId: selected.secretId,
            authorizationGeneration,
          },
        },
      }
      const delivery: Parameters<typeof AccountPickerPageTarget.send>[0] = {
        tabId: request.tabId,
        frameId: request.frameId,
        message: nookTypedArgs0_3,
      }
      const response = await AccountPickerPageTarget.send(delivery)
      if (!isLoginPickerPageAcknowledgement(response)) {
        return { ok: false, reason: 'login-picker-page-unavailable' }
      }
    } catch {
      return { ok: false, reason: 'login-picker-page-unavailable' }
    }
    await accountPickerSessions.removeLoginPicker(request.requestId)
    return { ok: true }
  }

  async cancelLoginPicker({
    message,
    sender,
  }: CancelLoginPickerArgs): Promise<
    LoginOperationSuccess | LoginOperationFailure
  > {
    const loaded = await accountPickerSessions.loadLoginPicker(
      message.payload.requestId,
    )
    if (loaded.kind === LoginPickerLoadKind.Unavailable) {
      return { ok: true }
    }
    const { request } = loaded
    const pickerFrameRequest: ConstructorParameters<
      typeof LoginPickerFrameTarget
    >[0] = { request, sender }
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
      new LoginPickerFrameTarget(pickerFrameRequest).boundAdmission() !==
        LoginPickerFrameAdmission.Accepted &&
      (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookNamedArgs0_0) ||
        !AccountPickerPageTarget.matchesSender(websiteFrame))
    ) {
      return { ok: false, reason: 'login-picker-forbidden' }
    }
    await accountPickerSessions.removeLoginPicker(request.requestId)
    try {
      const nookTypedArgs0_4: AccountPickerPageMessage = {
        type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
        payload: {
          origin: request.origin,
          requestId: request.requestId,
        },
      }
      const delivery: Parameters<typeof AccountPickerPageTarget.send>[0] = {
        tabId: request.tabId,
        frameId: request.frameId,
        message: nookTypedArgs0_4,
      }
      await AccountPickerPageTarget.send(delivery)
    } catch {
      // The website may have navigated while its picker was open.
    }
    return { ok: true }
  }
}
export const loginPickerOperations = new LoginPickerOperations()
