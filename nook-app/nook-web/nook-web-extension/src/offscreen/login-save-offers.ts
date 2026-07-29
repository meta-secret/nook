import { NookWebsiteLoginSaveDecision } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export const LOGIN_SAVE_OFFER_TTL_MS = 2 * 60 * 1000

export type PendingLoginSaveOffer = {
  offerId: string
  origin: string
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

  clearForOrigin(origin: string): void {
    this.purgeExpired()
    for (const offer of this.offers.values()) {
      if (offer.origin === origin) this.clearOffer(offer)
    }
  }

  clearById(offerId: string): void {
    const lookup = this.findById(offerId)
    if (lookup.state === PendingLoginSaveLookupState.Available) {
      this.clearOffer(lookup.offer)
    }
  }

  findByOrigin(origin: string): PendingLoginSaveLookup {
    this.purgeExpired()
    for (const offer of this.offers.values()) {
      if (offer.origin === origin) {
        return { state: PendingLoginSaveLookupState.Available, offer }
      }
    }
    return { state: PendingLoginSaveLookupState.Unavailable }
  }

  findById(offerId: string): PendingLoginSaveLookup {
    this.purgeExpired()
    const offer = this.offers.get(offerId)
    return offer
      ? { state: PendingLoginSaveLookupState.Available, offer }
      : { state: PendingLoginSaveLookupState.Unavailable }
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
      if (offer.expiresAt <= now) this.clearOffer(offer)
    }
  }
}

export const pendingLoginSaveOfferStore = new PendingLoginSaveOfferStore()
