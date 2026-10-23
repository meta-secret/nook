import type {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageValue,
} from '../../lib/browser-runtime-message'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessages,
  type SidePanelCodeFillOutcome,
  type SidePanelLoginFillOutcome,
  type SidePanelSiteListing,
} from '../../lib/side-panel-site'
import {
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import { SidePanelAddAuthenticatorOperation } from './side-panel-add-authenticator-operation'
import { SidePanelCodeFillOperation } from './side-panel-code-fill-operation'
import {
  SidePanelAddAuthenticatorKind,
  SidePanelAuthenticatorSetupMessages,
  type SidePanelAddAuthenticatorOutcome,
} from '../../lib/side-panel-authenticator-setup'
import {
  VAULT_REVISION_CHANNEL,
  VaultRevisionSignal,
} from '../../lib/vault-revision-signal'
import {
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoute,
  type RuntimeMessageSchema,
} from './schema-runtime-message-route'
import { SidePanelSender } from './side-panel-sender'
import type {
  SidePanelPageDelivery,
  SidePanelSiteDependencies,
} from './side-panel-site-access'
import {
  SidePanelLoginFillOperation,
  SidePanelSiteListingOperation,
} from './side-panel-site-operations'
import {
  CompanionSidePanelTabClassifier,
  SidePanelTabTargetResolver,
} from './side-panel-tab-target'

/** Whether the worker relayed a page's change notice to the panel. */
type SidePanelPageChangedRelay = { readonly ok: boolean }

/** The tab's top frame received the message, but no content script there
 * answered it. */
export class SidePanelPageUnanswered extends Error {
  constructor() {
    super('No content script answered in the top frame.')
  }
}

/** Delivers the Fill trigger to the top frame of the resolved tab only. */
export class SidePanelTopFrame {
  private readonly options: chrome.tabs.MessageSendOptions = { frameId: 0 }

  /**
   * Fails when no content script answers, as when none is there. A frame
   * whose listeners all leave the message alone (the vault bridge hears only
   * the extension's lock notice) resolves with no reply: nothing answered.
   */
  async send(
    delivery: SidePanelPageDelivery,
  ): Promise<BrowserRuntimeMessageValue> {
    const reply = await chrome.tabs.sendMessage<
      SidePanelPageDelivery['message'],
      BrowserRuntimeMessageValue
    >(delivery.tabId, delivery.message, this.options)
    if (!SidePanelTopFrame.answered(reply)) throw new SidePanelPageUnanswered()
    return reply
  }

  /** Chrome resolves with nothing, whatever the declared reply type, when no
   * listener answered. */
  private static answered(reply: BrowserRuntimeMessageValue): boolean {
    const kind = typeof reply
    return (
      kind === 'string' ||
      kind === 'number' ||
      kind === 'boolean' ||
      kind === 'object'
    )
  }
}

type SidePanelTabTargetResolverConfiguration = ConstructorParameters<
  typeof SidePanelTabTargetResolver
>[0]

/** The service worker's side-panel This-site routes and their capabilities. */
export class SidePanelSiteRoutes {
  private constructor() {}

  private static readonly tabTargetConfiguration: SidePanelTabTargetResolverConfiguration =
    { classifier: new CompanionSidePanelTabClassifier() }
  private static readonly tabTargets = new SidePanelTabTargetResolver(
    SidePanelSiteRoutes.tabTargetConfiguration,
  )
  private static readonly topFrame = new SidePanelTopFrame()

  static readonly dependencies: SidePanelSiteDependencies = {
    senderAdmission: (sender) => new SidePanelSender(sender).admission(),
    tabTarget: SidePanelSiteRoutes.tabTargets.resolve.bind(
      SidePanelSiteRoutes.tabTargets,
    ),
    authorizationGeneration: accountPickerAuthorizationGeneration,
    authorizationIsCurrent: accountPickerAuthorizationIsCurrent,
    authorizationCleanupPending: accountPickerAuthorizationCleanupPending,
    passwordPairingGrants: extensionPairingIdentity.passwordPairingGrants.bind(
      extensionPairingIdentity,
    ),
    sendSessionMessage: extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
    loginAccountAvailabilityForOrigin:
      accountPickerSessions.loginAccountAvailabilityForOrigin.bind(
        accountPickerSessions,
      ),
    sendPageMessage: SidePanelSiteRoutes.topFrame.send.bind(
      SidePanelSiteRoutes.topFrame,
    ),
    now: () => Date.now(),
  }

  private static readonly listFailed: SidePanelSiteListing = {
    kind: SidePanelSiteListingKind.ListFailed,
  }
  private static readonly fillFailed: SidePanelLoginFillOutcome = {
    kind: SidePanelLoginFillKind.FillFailed,
  }
  private static readonly listLogins: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesListLogins }
  private static readonly codeFillFailed: SidePanelCodeFillOutcome = {
    kind: SidePanelCodeFillKind.FillFailed,
  }
  private static readonly fillLogin: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesFillLogin }
  private static readonly fillCode: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesFillCode }
  private static readonly addAuthenticatorFailed: SidePanelAddAuthenticatorOutcome =
    { kind: SidePanelAddAuthenticatorKind.Failed }
  private static readonly addAuthenticatorRequest: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelAuthenticatorSetupMessages.matchesAdd }
  private static readonly pageChangedNotice: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelAuthenticatorSetupMessages.matchesPageChanged }
  private static readonly pageChangedRelayed: SidePanelPageChangedRelay = {
    ok: true,
  }
  private static readonly pageChangedRefused: SidePanelPageChangedRelay = {
    ok: false,
  }

  /** The listing route; its operation decodes the request strictly. */
  static listing(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelSiteListingOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.listLogins)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.listFailed)
  }

  /** The Fill route; its operation decodes the request strictly. */
  static fill(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelLoginFillOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.fillLogin)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.fillFailed)
  }

  /** The Fill code route; its operation decodes the request strictly. */
  static codeFill(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelCodeFillOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.fillCode)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.codeFillFailed)
  }

  /**
   * A site tab's top document says it started or stopped showing an
   * authenticator setup. The worker tells an open side panel, on the
   * panel's one broadcast channel, to list the site again; the notice and
   * the announcement carry nothing else.
   */
  static pageChanged(): BackgroundRuntimeMessageRoute {
    const signal = new VaultRevisionSignal(
      new BroadcastChannel(VAULT_REVISION_CHANNEL),
    )
    return SchemaRuntimeMessageRoute.matching(
      SidePanelSiteRoutes.pageChangedNotice,
    )
      .respondWith(async ({ sender }) => {
        const topDocument =
          sender.id === chrome.runtime.id &&
          typeof sender.tab?.id === 'number' &&
          sender.frameId === 0
        switch (topDocument) {
          case true:
            signal.raisePageChanged()
            return SidePanelSiteRoutes.pageChangedRelayed
          case false:
            return SidePanelSiteRoutes.pageChangedRefused
        }
      })
      .onRejected(() => SidePanelSiteRoutes.pageChangedRefused)
  }

  /** The Add 2FA from this page route; its operation decodes the request strictly. */
  static addAuthenticator(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelAddAuthenticatorOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(
      SidePanelSiteRoutes.addAuthenticatorRequest,
    )
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.addAuthenticatorFailed)
  }
}
