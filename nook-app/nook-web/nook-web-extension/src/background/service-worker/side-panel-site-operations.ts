import { Effect } from 'effect'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'
import {
  SidePanelPageFillMessageType,
  SidePanelPageFillMessages,
  SidePanelPageFillReplyKind,
  type SidePanelPageFillMessage,
} from '../../lib/side-panel-page-fill'
import {
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessages,
  type SidePanelLoginFillOutcome,
  type SidePanelLoginItemId,
  type SidePanelSiteListing,
  type SidePanelSiteListingFailureKind,
} from '../../lib/side-panel-site'
import {
  SidePanelAuthorizationKind,
  SidePanelGrantSelectionKind,
  SidePanelLoginsKind,
  SidePanelPageNeedReadingKind,
  SidePanelSessionKind,
  SidePanelSiteAccess,
  SidePanelSiteSecretsKind,
  SidePanelTargetContinuity,
  type SidePanelGrantRequest,
  type SidePanelLoginsRequest,
  type SidePanelPageDelivery,
  type SidePanelSiteAccounts,
  type SidePanelSiteDependencies,
  type SidePanelSiteSecretsPresentation,
  type SidePanelTargetContinuityRequest,
} from './side-panel-site-access'
import { SidePanelPageNeedReplyKind } from '../../lib/side-panel-page-need'
import { SidePanelSenderAdmission } from './side-panel-sender'
import { SidePanelTabTargetKind } from './side-panel-tab-target'

/** One admitted runtime delivery of a side-panel request. */
export interface SidePanelSiteOperationRequest {
  readonly message: BrowserRuntimeMessage
  readonly sender: chrome.runtime.MessageSender
}

/**
 * Lists the site-bound secrets for the active tab of the panel's window:
 * sender, Rust tab target, authorization generation, password grants,
 * unlocked session, the tab's Rust page need, then every grant's fail-closed
 * Rust match listing, which Rust filters by that need and presents as one
 * identity:vault section per vault. The reply carries only the display host
 * and Rust's sections of display rows.
 */
export class SidePanelSiteListingOperation {
  private readonly access: SidePanelSiteAccess
  private readonly generatorContext: SidePanelSiteListingGeneratorContext = {
    self: this,
  }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {
    this.access = new SidePanelSiteAccess(dependencies)
  }

  run(request: SidePanelSiteOperationRequest): Promise<SidePanelSiteListing> {
    return Effect.runPromise(
      this.listing(request).pipe(
        Effect.catch(() =>
          Effect.succeed(this.failure(SidePanelSiteListingKind.ListFailed)),
        ),
      ),
    )
  }

  private failure(kind: SidePanelSiteListingFailureKind): SidePanelSiteListing {
    return { kind }
  }

  private listing = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelSiteOperationRequest) {
      switch (this.dependencies.senderAdmission(request.sender)) {
        case SidePanelSenderAdmission.Forbidden:
          return this.failure(SidePanelSiteListingKind.Forbidden)
        case SidePanelSenderAdmission.Admitted:
          break
      }
      const decoded = yield* Effect.result(
        SidePanelSiteMessages.decodeListLogins(request.message),
      )
      switch (decoded._tag) {
        case 'Failure':
          return this.failure(SidePanelSiteListingKind.Forbidden)
        case 'Success':
          break
      }
      const target = yield* Effect.tryPromise(() =>
        this.dependencies.tabTarget(decoded.success.payload),
      )
      switch (target.kind) {
        case SidePanelTabTargetKind.NonWeb:
          return this.failure(SidePanelSiteListingKind.NonWeb)
        case SidePanelTabTargetKind.PageUnavailable:
          return this.failure(SidePanelSiteListingKind.PageUnavailable)
        case SidePanelTabTargetKind.Failed:
          return this.failure(SidePanelSiteListingKind.ListFailed)
        case SidePanelTabTargetKind.Web:
          break
      }
      const authorization = yield* this.access.authorization()
      switch (authorization.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.failure(SidePanelSiteListingKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      const grants = yield* this.access.grants()
      switch (grants.length) {
        case 0:
          return this.failure(SidePanelSiteListingKind.Unpaired)
        default:
          break
      }
      switch (yield* this.access.session()) {
        case SidePanelSessionKind.Locked:
          return this.failure(SidePanelSiteListingKind.Locked)
        case SidePanelSessionKind.Unavailable:
          return this.failure(SidePanelSiteListingKind.ListFailed)
        case SidePanelSessionKind.Unlocked:
          break
      }
      // Once per listing, the tab's top document says what its page needs.
      const reading = yield* this.access.pageNeed(target)
      switch (reading.kind) {
        case SidePanelPageNeedReadingKind.NoReceiver:
          return this.failure(SidePanelSiteListingKind.PageUnavailable)
        case SidePanelPageNeedReadingKind.Answered:
          break
      }
      const reply = reading.reply
      switch (reply.kind) {
        case SidePanelPageNeedReplyKind.TabChanged:
        case SidePanelPageNeedReplyKind.Unavailable:
          return this.failure(SidePanelSiteListingKind.ListFailed)
        case SidePanelPageNeedReplyKind.Needed:
          break
      }
      const secretsRequest: SidePanelLoginsRequest = {
        grants,
        origin: target.origin,
      }
      const secrets = yield* this.access.siteSecrets(secretsRequest)
      switch (secrets.kind) {
        case SidePanelSiteSecretsKind.Failed:
          return this.failure(SidePanelSiteListingKind.ListFailed)
        case SidePanelSiteSecretsKind.Listed:
          break
      }
      const presentation: SidePanelSiteSecretsPresentation = {
        need: reply.need,
        vaults: secrets.vaults,
      }
      const listing = yield* this.access.presentSiteSecrets(presentation)
      const settled = yield* this.access.stillCurrent(authorization.generation)
      switch (settled.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.failure(SidePanelSiteListingKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      const ready: SidePanelSiteListing = {
        kind: SidePanelSiteListingKind.Ready,
        display_host: target.display_host,
        listing,
      }
      return ready
    },
  )
}

enum SidePanelItemPresence {
  Present = 'present',
  Absent = 'absent',
}

/**
 * Fills one saved login into the active tab of the panel's window. The worker
 * re-resolves and re-classifies the tab, re-runs the gates and Rust's listing
 * for that origin, then sends frame 0 a trigger without credentials. The
 * content script reveals through its own sender-bound route and never submits.
 */
export class SidePanelLoginFillOperation {
  private readonly access: SidePanelSiteAccess
  private readonly generatorContext: SidePanelLoginFillGeneratorContext = {
    self: this,
  }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {
    this.access = new SidePanelSiteAccess(dependencies)
  }

  run(
    request: SidePanelSiteOperationRequest,
  ): Promise<SidePanelLoginFillOutcome> {
    return Effect.runPromise(
      this.fill(request).pipe(
        Effect.catch(() =>
          Effect.succeed(this.outcome(SidePanelLoginFillKind.FillFailed)),
        ),
      ),
    )
  }

  private outcome(kind: SidePanelLoginFillKind): SidePanelLoginFillOutcome {
    return { kind }
  }

  private fill = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelSiteOperationRequest) {
      switch (this.dependencies.senderAdmission(request.sender)) {
        case SidePanelSenderAdmission.Forbidden:
          return this.outcome(SidePanelLoginFillKind.Forbidden)
        case SidePanelSenderAdmission.Admitted:
          break
      }
      const decoded = yield* Effect.result(
        SidePanelSiteMessages.decodeFillLogin(request.message),
      )
      switch (decoded._tag) {
        case 'Failure':
          return this.outcome(SidePanelLoginFillKind.Forbidden)
        case 'Success':
          break
      }
      const { itemId } = decoded.success.payload
      const target = yield* Effect.tryPromise(() =>
        this.dependencies.tabTarget(decoded.success.payload),
      )
      switch (target.kind) {
        case SidePanelTabTargetKind.NonWeb:
          return this.outcome(SidePanelLoginFillKind.NonWeb)
        case SidePanelTabTargetKind.PageUnavailable:
          return this.outcome(SidePanelLoginFillKind.PageUnavailable)
        case SidePanelTabTargetKind.Failed:
          return this.outcome(SidePanelLoginFillKind.FillFailed)
        case SidePanelTabTargetKind.Web:
          break
      }
      const authorization = yield* this.access.authorization()
      switch (authorization.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.outcome(SidePanelLoginFillKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      const grants = yield* this.access.grants()
      switch (grants.length) {
        case 0:
          return this.outcome(SidePanelLoginFillKind.Unpaired)
        default:
          break
      }
      const grantRequest: SidePanelGrantRequest = { grants, itemId }
      const granted = this.access.grantFor(grantRequest)
      switch (granted.kind) {
        case SidePanelGrantSelectionKind.NotGranted:
          return this.outcome(SidePanelLoginFillKind.ItemNotFound)
        case SidePanelGrantSelectionKind.Granted:
          break
      }
      switch (yield* this.access.session()) {
        case SidePanelSessionKind.Locked:
          return this.outcome(SidePanelLoginFillKind.Locked)
        case SidePanelSessionKind.Unavailable:
          return this.outcome(SidePanelLoginFillKind.FillFailed)
        case SidePanelSessionKind.Unlocked:
          break
      }
      const loginsRequest: SidePanelLoginsRequest = {
        grants: [granted.grant],
        origin: target.origin,
      }
      const logins = yield* this.access.logins(loginsRequest)
      switch (logins.kind) {
        case SidePanelLoginsKind.Failed:
          return this.outcome(SidePanelLoginFillKind.FillFailed)
        case SidePanelLoginsKind.Listed:
          break
      }
      const presence: SidePanelItemPresenceRequest = {
        accounts: logins.accounts,
        itemId,
      }
      switch (this.presence(presence)) {
        case SidePanelItemPresence.Absent:
          return this.outcome(SidePanelLoginFillKind.ItemNotFound)
        case SidePanelItemPresence.Present:
          break
      }
      const settled = yield* this.access.stillCurrent(authorization.generation)
      switch (settled.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.outcome(SidePanelLoginFillKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      // The listing and status calls above take time; the person may have
      // switched tabs or navigated meanwhile. Deliver only to the same tab
      // still showing the same Rust-classified origin.
      const continuity: SidePanelTargetContinuityRequest = {
        selection: decoded.success.payload,
        derived: target,
      }
      switch (yield* this.access.continuity(continuity)) {
        case SidePanelTargetContinuity.Changed:
          return this.outcome(SidePanelLoginFillKind.TabChanged)
        case SidePanelTargetContinuity.Unreadable:
          return this.outcome(SidePanelLoginFillKind.FillFailed)
        case SidePanelTargetContinuity.Same:
          break
      }
      const message: SidePanelPageFillMessage = {
        type: SidePanelPageFillMessageType.Fill,
        payload: {
          origin: target.origin,
          account: {
            vaultStoreId: itemId.vaultStoreId,
            secretId: itemId.secretId,
            authorizationGeneration: authorization.generation,
          },
        },
      }
      const pageDelivery: SidePanelPageDelivery = {
        tabId: target.tabId,
        message,
      }
      const delivery = yield* Effect.result(
        Effect.tryPromise(() =>
          this.dependencies.sendPageMessage(pageDelivery),
        ),
      )
      switch (delivery._tag) {
        case 'Failure':
          return this.outcome(SidePanelLoginFillKind.PageUnavailable)
        case 'Success':
          break
      }
      const reply = yield* SidePanelPageFillMessages.decodeReply(
        delivery.success,
      )
      return this.outcome(this.replyKind(reply.kind))
    },
  )

  /** Rust's listing for the derived origin must still contain the exact item. */
  private presence({
    accounts,
    itemId,
  }: SidePanelItemPresenceRequest): SidePanelItemPresence {
    const present = accounts.some(
      (account) =>
        account.vaultStoreId === itemId.vaultStoreId &&
        account.secretId === itemId.secretId,
    )
    switch (present) {
      case true:
        return SidePanelItemPresence.Present
      case false:
        return SidePanelItemPresence.Absent
    }
  }

  private replyKind(kind: SidePanelPageFillReplyKind): SidePanelLoginFillKind {
    switch (kind) {
      case SidePanelPageFillReplyKind.Filled:
        return SidePanelLoginFillKind.Filled
      case SidePanelPageFillReplyKind.TabChanged:
        return SidePanelLoginFillKind.TabChanged
      case SidePanelPageFillReplyKind.NoLoginForm:
        return SidePanelLoginFillKind.NoLoginForm
      case SidePanelPageFillReplyKind.FillFailed:
        return SidePanelLoginFillKind.FillFailed
      case SidePanelPageFillReplyKind.Locked:
        return SidePanelLoginFillKind.Locked
    }
  }
}

type SidePanelItemPresenceRequest = {
  readonly accounts: SidePanelSiteAccounts
  readonly itemId: SidePanelLoginItemId
}

type SidePanelSiteListingGeneratorContext = {
  readonly self: SidePanelSiteListingOperation
}

type SidePanelLoginFillGeneratorContext = {
  readonly self: SidePanelLoginFillOperation
}
