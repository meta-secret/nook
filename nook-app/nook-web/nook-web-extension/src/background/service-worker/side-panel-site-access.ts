import { Effect, Schema, type Result } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import { SiteSecretListingCodec } from '../../lib/side-panel-site-listing'
import {
  present_site_secret_listing,
  type SitePageNeed,
  type SiteSecretListing,
  type SiteSecretMatches,
  type SiteSecretVault,
  type SiteSecretVaults,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
  extensionSessionInteractiveDeadline,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import type {
  SidePanelPageCodeFillMessage,
  SidePanelPageFillMessage,
} from '../../lib/side-panel-page-fill'
import {
  SidePanelPageNeedMessageType,
  SidePanelPageNeedMessages,
  type SidePanelPageNeedMessage,
  type SidePanelPageNeedReply,
} from '../../lib/side-panel-page-need'
import type { SidePanelLoginItemId } from '../../lib/side-panel-site'
import type { SidePanelWindowSelection } from '../../lib/side-panel-site'
import type { accountPickerSessions } from './account-pickers'
import type { ExtensionSessionTransportResult } from './session-document'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'
import type { SidePanelSenderAdmission } from './side-panel-sender'
import {
  SidePanelTabTargetKind,
  type SidePanelTabTarget,
  type SidePanelWebTabTarget,
} from './side-panel-tab-target'

type LoginAvailabilityRequest = Parameters<
  typeof accountPickerSessions.loginAccountAvailabilityForOrigin
>[0]
type LoginAvailability = Awaited<
  ReturnType<typeof accountPickerSessions.loginAccountAvailabilityForOrigin>
>

/** What the worker sends frame 0 of the tab it resolved: a Fill or Fill code
 * trigger without credentials, or the page-need query. */
export type SidePanelPageMessage =
  | SidePanelPageFillMessage
  | SidePanelPageCodeFillMessage
  | SidePanelPageNeedMessage

/** One page message for frame 0 of the tab the worker resolved. */
export interface SidePanelPageDelivery {
  readonly tabId: number
  readonly message: SidePanelPageMessage
}

export type SidePanelPairingGrants = readonly StoredExtensionPairingGrant[]

/** The worker capabilities the side-panel routes act through. */
export interface SidePanelSiteDependencies {
  readonly senderAdmission: (
    sender: chrome.runtime.MessageSender,
  ) => SidePanelSenderAdmission
  readonly tabTarget: (
    selection: SidePanelWindowSelection,
  ) => Promise<SidePanelTabTarget>
  readonly authorizationGeneration: () => Promise<string>
  readonly authorizationIsCurrent: (generation: string) => boolean
  readonly authorizationCleanupPending: () => Promise<boolean>
  readonly passwordPairingGrants: () => Promise<SidePanelPairingGrants>
  readonly sendSessionMessage: (
    message: ExtensionSessionTransportRequest,
  ) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  readonly loginAccountAvailabilityForOrigin: (
    request: LoginAvailabilityRequest,
  ) => Promise<LoginAvailability>
  readonly sendPageMessage: (
    delivery: SidePanelPageDelivery,
  ) => Promise<BrowserRuntimeMessageValue>
  readonly now: () => number
}

export enum SidePanelAuthorizationKind {
  Current = 'current',
  Revoked = 'revoked',
}

export type SidePanelAuthorization =
  | {
      readonly kind: SidePanelAuthorizationKind.Current
      readonly generation: string
    }
  | { readonly kind: SidePanelAuthorizationKind.Revoked }

export enum SidePanelSessionKind {
  Unlocked = 'unlocked',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export enum SidePanelLoginsKind {
  Listed = 'listed',
  Failed = 'failed',
}

export type SidePanelSiteAccounts = readonly WebsiteLoginAccountOption[]

export type SidePanelLogins =
  | {
      readonly kind: SidePanelLoginsKind.Listed
      readonly accounts: SidePanelSiteAccounts
    }
  | { readonly kind: SidePanelLoginsKind.Failed }

export interface SidePanelLoginsRequest {
  readonly grants: SidePanelPairingGrants
  readonly origin: string
}

/**
 * The gates both side-panel routes share: the account-picker authorization
 * generation, the password-filling grants, the session status probe and the
 * fail-closed Rust listing. None of them opens the companion launcher.
 */
export class SidePanelSiteAccess {
  private readonly revoked: SidePanelAuthorization = {
    kind: SidePanelAuthorizationKind.Revoked,
  }
  private readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private readonly unlistedVault: SidePanelVaultMatches = {
    kind: SidePanelVaultMatchesKind.Failed,
  }
  private readonly unlistedSite: SidePanelSiteSecrets = {
    kind: SidePanelSiteSecretsKind.Failed,
  }
  private readonly generatorContext: SidePanelSiteAccessGeneratorContext = {
    self: this,
  }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {}

  /** The current generation, or revoked while a lock cleanup is pending. */
  authorization = Effect.fn(this.generatorContext, function* () {
    const generation = yield* Effect.tryPromise(() =>
      this.dependencies.authorizationGeneration(),
    )
    return yield* this.stillCurrent(generation)
  })

  stillCurrent = Effect.fn(
    this.generatorContext,
    function* (generation: string) {
      const cleanupPending = yield* Effect.tryPromise(() =>
        this.dependencies.authorizationCleanupPending(),
      )
      const current =
        this.dependencies.authorizationIsCurrent(generation) && !cleanupPending
      switch (current) {
        case true: {
          const authorization: SidePanelAuthorization = {
            kind: SidePanelAuthorizationKind.Current,
            generation,
          }
          return authorization
        }
        case false:
          return this.revoked
      }
    },
  )

  grants = Effect.fn(this.generatorContext, function* () {
    return yield* Effect.tryPromise(() =>
      this.dependencies.passwordPairingGrants(),
    )
  })

  /** Probes the offscreen session; the panel renders its own unlock state. */
  session = Effect.fn(this.generatorContext, function* () {
    const request: ExtensionSessionTransportRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: this.interactiveQueue() },
    }
    const delivery = yield* Effect.tryPromise(() =>
      this.dependencies.sendSessionMessage(request),
    )
    return delivery.match(
      (status) => this.sessionState(status),
      () => SidePanelSessionKind.Unavailable,
    )
  })

  /** Rust's Login-only listing for the origin; any grant failure fails it all. */
  logins = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelLoginsRequest) {
      const listing: LoginAvailabilityRequest = {
        grants: [...request.grants],
        origin: request.origin,
        queue: this.interactiveQueue(),
        sendMessage: this.dependencies.sendSessionMessage,
      }
      const availability = yield* Effect.tryPromise(() =>
        this.dependencies.loginAccountAvailabilityForOrigin(listing),
      )
      switch (availability.ok) {
        case true: {
          const listed: SidePanelLogins = {
            kind: SidePanelLoginsKind.Listed,
            accounts: availability.accounts,
          }
          return listed
        }
        case false: {
          const failed: SidePanelLogins = { kind: SidePanelLoginsKind.Failed }
          return failed
        }
      }
    },
  )

  /**
   * Every grant's Rust-matched site secrets for the origin, in grant order.
   * Any grant whose session listing fails or answers without matches fails
   * the whole listing, so a failure never reads as nothing saved.
   */
  siteSecrets = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelLoginsRequest) {
      const vaults: SiteSecretVault[] = []
      for (const grant of request.grants) {
        const message: ExtensionSessionTransportRequest = {
          type: ExtensionSessionMessageType.ListSiteSecrets,
          payload: {
            ...extensionSessionGrantIdentity(grant),
            origin: request.origin,
            queue: this.interactiveQueue(),
          },
        }
        const delivery = yield* Effect.tryPromise(() =>
          this.dependencies.sendSessionMessage(message),
        )
        const listed = delivery.match(
          (response) => this.siteMatches(response),
          () => this.unlistedVault,
        )
        switch (listed.kind) {
          case SidePanelVaultMatchesKind.Failed:
            return this.unlistedSite
          case SidePanelVaultMatchesKind.Listed:
            break
        }
        const vault: SidePanelSiteVaultRequest = { grant, matches: listed.matches }
        vaults.push(this.siteVault(vault))
      }
      const listed: SidePanelSiteSecrets = {
        kind: SidePanelSiteSecretsKind.Listed,
        vaults: { vaults },
      }
      return listed
    },
  )

  /** Rust filters the vaults' matches by the page need and groups them by identity. */
  presentSiteSecrets = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelSiteSecretsPresentation) {
      yield* Effect.promise(() => companionWasmReady)
      return yield* Effect.try(() =>
        present_site_secret_listing(request.need, request.vaults),
      )
    },
  )

  private siteMatches(response: ExtensionSessionResponse): SidePanelVaultMatches {
    switch (true) {
      case typeof response === 'object' && 'matches' in response:
        return this.decodedMatches(
          Schema.decodeUnknownResult(
            SiteSecretListingCodec.matches,
            this.strict,
          )(response.matches),
        )
      case true:
      default:
        return this.unlistedVault
    }
  }

  private decodedMatches(
    decoded: SidePanelDecodedMatches,
  ): SidePanelVaultMatches {
    switch (decoded._tag) {
      case 'Failure':
        return this.unlistedVault
      case 'Success':
        return {
          kind: SidePanelVaultMatchesKind.Listed,
          matches: decoded.success,
        }
    }
  }

  /** The grant's labels Rust groups by; a grant paired before identities has no name. */
  private siteVault({
    grant,
    matches,
  }: SidePanelSiteVaultRequest): SiteSecretVault {
    return {
      vault_store_id: grant.vaultStoreId,
      vault_name: grant.vaultName,
      identity: {
        device_id: grant.deviceId,
        name: this.identityName(grant),
      },
      matches,
    }
  }

  private identityName(grant: StoredExtensionPairingGrant): string {
    switch (typeof grant.identityLabel) {
      case 'string':
        return grant.identityLabel
      default:
        return ''
    }
  }

  /**
   * Asks the tab's top document, once for this listing, which workflow Rust
   * classifies there. No receiver is a page no content script reaches.
   */
  pageNeed = Effect.fn(
    this.generatorContext,
    function* (target: SidePanelWebTabTarget) {
      const message: SidePanelPageNeedMessage = {
        type: SidePanelPageNeedMessageType.Query,
        payload: { origin: target.origin },
      }
      const delivery: SidePanelPageDelivery = { tabId: target.tabId, message }
      const sent = yield* Effect.result(
        Effect.tryPromise(() => this.dependencies.sendPageMessage(delivery)),
      )
      switch (sent._tag) {
        case 'Failure': {
          const unreached: SidePanelPageNeedReading = {
            kind: SidePanelPageNeedReadingKind.NoReceiver,
          }
          return unreached
        }
        case 'Success':
          break
      }
      const reply = yield* SidePanelPageNeedMessages.decodeReply(sent.success)
      const answered: SidePanelPageNeedReading = {
        kind: SidePanelPageNeedReadingKind.Answered,
        reply,
      }
      return answered
    },
  )

  /** Re-resolves the panel's window and compares it with the tab a Fill derived. */
  continuity = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelTargetContinuityRequest) {
      const current = yield* Effect.tryPromise(() =>
        this.dependencies.tabTarget(request.selection),
      )
      switch (current.kind) {
        case SidePanelTabTargetKind.Failed:
          return SidePanelTargetContinuity.Unreadable
        case SidePanelTabTargetKind.NonWeb:
        case SidePanelTabTargetKind.PageUnavailable:
          return SidePanelTargetContinuity.Changed
        case SidePanelTabTargetKind.Web:
          break
      }
      const same =
        current.tabId === request.derived.tabId &&
        current.origin === request.derived.origin
      switch (same) {
        case true:
          return SidePanelTargetContinuity.Same
        case false:
          return SidePanelTargetContinuity.Changed
      }
    },
  )

  /** The item's vault must hold a password-filling grant. */
  grantFor({ grants, itemId }: SidePanelGrantRequest): SidePanelGrantSelection {
    const grant = grants.find(
      (candidate) => candidate.vaultStoreId === itemId.vaultStoreId,
    )
    switch (true) {
      case !!grant:
        return { kind: SidePanelGrantSelectionKind.Granted, grant }
      case true:
      default:
        return { kind: SidePanelGrantSelectionKind.NotGranted }
    }
  }

  private interactiveQueue() {
    return extensionSessionInteractiveDeadline(
      this.dependencies.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
    )
  }

  private sessionState(status: ExtensionSessionResponse): SidePanelSessionKind {
    switch (extensionSessionLifecycle.isUnlockedSessionStatus(status)) {
      case true:
        return SidePanelSessionKind.Unlocked
      case false:
        return SidePanelSessionKind.Locked
    }
  }
}

enum SidePanelVaultMatchesKind {
  Listed = 'listed',
  Failed = 'failed',
}

/** One grant's session answer: its Rust matches, or a failed listing. */
type SidePanelVaultMatches =
  | {
      readonly kind: SidePanelVaultMatchesKind.Listed
      readonly matches: SiteSecretMatches
    }
  | { readonly kind: SidePanelVaultMatchesKind.Failed }

type SidePanelDecodedMatches = Result.Result<
  SiteSecretMatches,
  Schema.SchemaError
>

type SidePanelSiteVaultRequest = {
  readonly grant: StoredExtensionPairingGrant
  readonly matches: SiteSecretMatches
}

export enum SidePanelSiteSecretsKind {
  Listed = 'listed',
  Failed = 'failed',
}

/** Every grant's matches for Rust to present, or a failed listing. */
export type SidePanelSiteSecrets =
  | {
      readonly kind: SidePanelSiteSecretsKind.Listed
      readonly vaults: SiteSecretVaults
    }
  | { readonly kind: SidePanelSiteSecretsKind.Failed }

export interface SidePanelSiteSecretsPresentation {
  readonly need: SitePageNeed
  readonly vaults: SiteSecretVaults
}

export type { SiteSecretListing }

export enum SidePanelPageNeedReadingKind {
  Answered = 'answered',
  /** No content script answered in the tab's top frame. */
  NoReceiver = 'no-receiver',
}

/** The top document's page-need answer, or that no content script received the query. */
export type SidePanelPageNeedReading =
  | {
      readonly kind: SidePanelPageNeedReadingKind.Answered
      readonly reply: SidePanelPageNeedReply
    }
  | { readonly kind: SidePanelPageNeedReadingKind.NoReceiver }

/** Whether the tab a Fill derived is still the active tab of the window. */
export enum SidePanelTargetContinuity {
  Same = 'same',
  Changed = 'changed',
  Unreadable = 'unreadable',
}

export type SidePanelTargetContinuityRequest = {
  readonly selection: SidePanelWindowSelection
  readonly derived: SidePanelWebTabTarget
}

export type SidePanelGrantRequest = {
  readonly grants: SidePanelPairingGrants
  readonly itemId: SidePanelLoginItemId
}

export enum SidePanelGrantSelectionKind {
  Granted = 'granted',
  NotGranted = 'not-granted',
}

export type SidePanelGrantSelection =
  | {
      readonly kind: SidePanelGrantSelectionKind.Granted
      readonly grant: StoredExtensionPairingGrant
    }
  | { readonly kind: SidePanelGrantSelectionKind.NotGranted }

type SidePanelSiteAccessGeneratorContext = {
  readonly self: SidePanelSiteAccess
}
