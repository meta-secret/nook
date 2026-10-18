import { Effect } from 'effect'
import type { SiteSecretVaults } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SidePanelPageCodeFillReplyKind,
  SidePanelPageFillMessageType,
  SidePanelPageFillMessages,
  type SidePanelPageCodeFillMessage,
} from '../../lib/side-panel-page-fill'
import {
  SidePanelCodeFillKind,
  SidePanelSiteMessages,
  type SidePanelCodeFillOutcome,
  type SidePanelLoginItemId,
} from '../../lib/side-panel-site'
import {
  SidePanelAuthorizationKind,
  SidePanelGrantSelectionKind,
  SidePanelSessionKind,
  SidePanelSiteAccess,
  SidePanelSiteSecretsKind,
  SidePanelTargetContinuity,
  type SidePanelGrantRequest,
  type SidePanelLoginsRequest,
  type SidePanelPageDelivery,
  type SidePanelSiteDependencies,
  type SidePanelTargetContinuityRequest,
} from './side-panel-site-access'
import type { SidePanelSiteOperationRequest } from './side-panel-site-operations'
import { SidePanelSenderAdmission } from './side-panel-sender'
import { SidePanelTabTargetKind } from './side-panel-tab-target'

/** Whether Rust's fresh listing still holds the item as an authenticator for the site. */
enum SidePanelAuthenticatorPresence {
  Present = 'present',
  Absent = 'absent',
}

type SidePanelAuthenticatorPresenceRequest = {
  readonly vaults: SiteSecretVaults
  readonly itemId: SidePanelLoginItemId
}

/**
 * Fills the current code of one listed authenticator into the active tab of
 * the panel's window. The code session request is not bound to a site, so
 * the worker re-resolves the tab, re-runs the gates and requires the exact
 * item as an Authenticator in Rust's fresh site listing for the item's vault
 * before frame 0 receives a trigger without the code. The content script
 * obtains the code for that same item through its sender-bound route, fills
 * Rust's one-time-code field and never submits.
 */
export class SidePanelCodeFillOperation {
  private readonly access: SidePanelSiteAccess
  private readonly generatorContext: SidePanelCodeFillGeneratorContext = {
    self: this,
  }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {
    this.access = new SidePanelSiteAccess(dependencies)
  }

  run(request: SidePanelSiteOperationRequest): Promise<SidePanelCodeFillOutcome> {
    return Effect.runPromise(
      this.fill(request).pipe(
        Effect.catch(() =>
          Effect.succeed(this.outcome(SidePanelCodeFillKind.FillFailed)),
        ),
      ),
    )
  }

  private outcome(kind: SidePanelCodeFillKind): SidePanelCodeFillOutcome {
    return { kind }
  }

  private fill = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelSiteOperationRequest) {
      switch (this.dependencies.senderAdmission(request.sender)) {
        case SidePanelSenderAdmission.Forbidden:
          return this.outcome(SidePanelCodeFillKind.Forbidden)
        case SidePanelSenderAdmission.Admitted:
          break
      }
      const decoded = yield* Effect.result(
        SidePanelSiteMessages.decodeFillCode(request.message),
      )
      switch (decoded._tag) {
        case 'Failure':
          return this.outcome(SidePanelCodeFillKind.Forbidden)
        case 'Success':
          break
      }
      const { itemId } = decoded.success.payload
      const target = yield* Effect.tryPromise(() =>
        this.dependencies.tabTarget(decoded.success.payload),
      )
      switch (target.kind) {
        case SidePanelTabTargetKind.NonWeb:
          return this.outcome(SidePanelCodeFillKind.NonWeb)
        case SidePanelTabTargetKind.PageUnavailable:
          return this.outcome(SidePanelCodeFillKind.PageUnavailable)
        case SidePanelTabTargetKind.Failed:
          return this.outcome(SidePanelCodeFillKind.FillFailed)
        case SidePanelTabTargetKind.Web:
          break
      }
      const authorization = yield* this.access.authorization()
      switch (authorization.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.outcome(SidePanelCodeFillKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      const grants = yield* this.access.grants()
      switch (grants.length) {
        case 0:
          return this.outcome(SidePanelCodeFillKind.Unpaired)
        default:
          break
      }
      const grantRequest: SidePanelGrantRequest = { grants, itemId }
      const granted = this.access.grantFor(grantRequest)
      switch (granted.kind) {
        case SidePanelGrantSelectionKind.NotGranted:
          return this.outcome(SidePanelCodeFillKind.ItemNotFound)
        case SidePanelGrantSelectionKind.Granted:
          break
      }
      switch (yield* this.access.session()) {
        case SidePanelSessionKind.Locked:
          return this.outcome(SidePanelCodeFillKind.Locked)
        case SidePanelSessionKind.Unavailable:
          return this.outcome(SidePanelCodeFillKind.FillFailed)
        case SidePanelSessionKind.Unlocked:
          break
      }
      const secretsRequest: SidePanelLoginsRequest = {
        grants: [granted.grant],
        origin: target.origin,
      }
      const secrets = yield* this.access.siteSecrets(secretsRequest)
      switch (secrets.kind) {
        case SidePanelSiteSecretsKind.Failed:
          return this.outcome(SidePanelCodeFillKind.FillFailed)
        case SidePanelSiteSecretsKind.Listed:
          break
      }
      const presence: SidePanelAuthenticatorPresenceRequest = {
        vaults: secrets.vaults,
        itemId,
      }
      switch (this.presence(presence)) {
        case SidePanelAuthenticatorPresence.Absent:
          return this.outcome(SidePanelCodeFillKind.ItemNotFound)
        case SidePanelAuthenticatorPresence.Present:
          break
      }
      const settled = yield* this.access.stillCurrent(authorization.generation)
      switch (settled.kind) {
        case SidePanelAuthorizationKind.Revoked:
          return this.outcome(SidePanelCodeFillKind.Locked)
        case SidePanelAuthorizationKind.Current:
          break
      }
      // The listing and status calls above take time; deliver only to the
      // same tab still showing the same Rust-classified origin.
      const continuity: SidePanelTargetContinuityRequest = {
        selection: decoded.success.payload,
        derived: target,
      }
      switch (yield* this.access.continuity(continuity)) {
        case SidePanelTargetContinuity.Changed:
          return this.outcome(SidePanelCodeFillKind.TabChanged)
        case SidePanelTargetContinuity.Unreadable:
          return this.outcome(SidePanelCodeFillKind.FillFailed)
        case SidePanelTargetContinuity.Same:
          break
      }
      const message: SidePanelPageCodeFillMessage = {
        type: SidePanelPageFillMessageType.FillCode,
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
          return this.outcome(SidePanelCodeFillKind.PageUnavailable)
        case 'Success':
          break
      }
      const reply = yield* SidePanelPageFillMessages.decodeCodeReply(
        delivery.success,
      )
      return this.outcome(this.replyKind(reply.kind))
    },
  )

  /** Rust's listing for the derived origin must hold the exact item as an authenticator. */
  private presence({
    vaults,
    itemId,
  }: SidePanelAuthenticatorPresenceRequest): SidePanelAuthenticatorPresence {
    const present = vaults.vaults.some(
      (vault) =>
        vault.vault_store_id === itemId.vaultStoreId &&
        vault.matches.items.some(
          (item) =>
            item.kind === 'Authenticator' && item.secret_id === itemId.secretId,
        ),
    )
    switch (present) {
      case true:
        return SidePanelAuthenticatorPresence.Present
      case false:
        return SidePanelAuthenticatorPresence.Absent
    }
  }

  private replyKind(
    kind: SidePanelPageCodeFillReplyKind,
  ): SidePanelCodeFillKind {
    switch (kind) {
      case SidePanelPageCodeFillReplyKind.Filled:
        return SidePanelCodeFillKind.Filled
      case SidePanelPageCodeFillReplyKind.TabChanged:
        return SidePanelCodeFillKind.TabChanged
      case SidePanelPageCodeFillReplyKind.NoCodeField:
        return SidePanelCodeFillKind.NoCodeField
      case SidePanelPageCodeFillReplyKind.FillFailed:
        return SidePanelCodeFillKind.FillFailed
      case SidePanelPageCodeFillReplyKind.Locked:
        return SidePanelCodeFillKind.Locked
    }
  }
}

type SidePanelCodeFillGeneratorContext = {
  readonly self: SidePanelCodeFillOperation
}
