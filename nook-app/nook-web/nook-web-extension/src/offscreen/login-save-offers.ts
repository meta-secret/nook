import { compare_login_save_sender_scope, type LoginSaveSenderScopeComparison, type WebsiteLoginSaveOffer, type LoginSaveCaptureBaseline } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { NookWebsiteLoginSaveDecision } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export const LOGIN_SAVE_OFFER_TTL_MS = 2 * 60 * 1000

/** Browser-owned sender routing; document identity may change during navigation. */
export type PendingLoginSaveOfferScope = {
  origin: string
  tabId: number
  frameId: number
}

export type PendingLoginSaveOfferLookup = {
  offerId: string
  scope: PendingLoginSaveOfferScope
}

enum PendingLoginSaveScopeMatch {
  Matching = 'matching',
  Foreign = 'foreign',
}

export type PendingLoginSaveOffer = PendingLoginSaveOfferScope & {
  baseline: LoginSaveCaptureBaseline
  selection: WebsiteLoginSaveOffer['selection']
  offerId: string
  username: string
  password: string
  vaultStoreId: string
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
} & (
  | { decision: NookWebsiteLoginSaveDecision.Create }
  | {
      decision: NookWebsiteLoginSaveDecision.Update
      replaceSecretId: string
    }
)

export enum PendingLoginSaveLookupState {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type PendingLoginSaveLookup =
  | { state: PendingLoginSaveLookupState.Unavailable }
  | {
      state: PendingLoginSaveLookupState.Available
      offer: PendingLoginSaveOffer
    }

class PendingLoginSaveOfferStore {
  private readonly offers = new Map<string, PendingLoginSaveOffer>()

  clearOffer(offer: PendingLoginSaveOffer): void {
    offer.username = ''
    offer.password = ''
    clearTimeout(offer.expiryTimer)
    this.offers.delete(offer.offerId)
  }

  clearAll(): void {
    for (const offer of this.offers.values()) this.clearOffer(offer)
    this.offers.clear()
  }

  clearForScope(scope: PendingLoginSaveOfferScope): void {
    this.purgeExpired()
    for (const offer of this.offers.values()) {
      const request: PendingLoginSaveScopeComparison = { offer, scope }
      switch (this.matchScope(request)) {
        case PendingLoginSaveScopeMatch.Matching:
          this.clearOffer(offer)
          break
        case PendingLoginSaveScopeMatch.Foreign:
          break
      }
    }
  }

  clearById(request: PendingLoginSaveOfferLookup): void {
    const lookup = this.findById(request)
    switch (lookup.state) {
      case PendingLoginSaveLookupState.Available:
        this.clearOffer(lookup.offer)
        break
      case PendingLoginSaveLookupState.Unavailable:
        break
    }
  }

  /** The store owns expiry; page requests always use the scoped lookup. */
  expireById(offerId: string): void {
    const offer = this.offers.get(offerId)
    // Map absence is decoded at this browser-memory boundary.
    switch (true) {
      case typeof offer === 'object':
        this.clearOffer(offer)
        break
      case true: default: break
    }
  }

  findByScope(scope: PendingLoginSaveOfferScope): PendingLoginSaveLookup {
    this.purgeExpired()
    for (const offer of this.offers.values()) {
      const request: PendingLoginSaveScopeComparison = { offer, scope }
      switch (this.matchScope(request)) {
        case PendingLoginSaveScopeMatch.Matching:
          return { state: PendingLoginSaveLookupState.Available, offer }
        case PendingLoginSaveScopeMatch.Foreign:
          break
      }
    }
    return { state: PendingLoginSaveLookupState.Unavailable }
  }

  findById({ offerId, scope }: PendingLoginSaveOfferLookup): PendingLoginSaveLookup {
    this.purgeExpired()
    const offer = this.offers.get(offerId)
    switch (true) {
      case typeof offer === 'object':
        break
      case true: default:
        return { state: PendingLoginSaveLookupState.Unavailable }
    }
    const request: PendingLoginSaveScopeComparison = { offer, scope }
    switch (this.matchScope(request)) {
      case PendingLoginSaveScopeMatch.Matching:
        return { state: PendingLoginSaveLookupState.Available, offer }
      case PendingLoginSaveScopeMatch.Foreign:
        return { state: PendingLoginSaveLookupState.Unavailable }
    }
  }

  store(offer: PendingLoginSaveOffer): void {
    this.offers.set(offer.offerId, offer)
  }

  removeForCommit(offer: PendingLoginSaveOffer): void {
    clearTimeout(offer.expiryTimer)
    this.offers.delete(offer.offerId)
  }

  private purgeExpired(now = Date.now()): void {
    for (const offer of this.offers.values()) {
      switch (offer.expiresAt <= now) {
        case true:
          this.clearOffer(offer)
          break
        case false:
          break
      }
    }
  }

  private matchScope({ offer, scope }: PendingLoginSaveScopeComparison): PendingLoginSaveScopeMatch {
    const comparison: LoginSaveSenderScopeComparison = { expected: {tab_id: offer.tabId, frame_id: offer.frameId}, current: {tab_id: scope.tabId, frame_id: scope.frameId} }
    const verdict = compare_login_save_sender_scope(comparison)
    switch (offer.origin === scope.origin && verdict === 'SameScope') {

      case true:
        return PendingLoginSaveScopeMatch.Matching
      case false:
        return PendingLoginSaveScopeMatch.Foreign
    }
  }
}

export const pendingLoginSaveOfferStore = new PendingLoginSaveOfferStore()

type PendingLoginSaveScopeComparison = {
  offer: PendingLoginSaveOffer
  scope: PendingLoginSaveOfferScope
}
