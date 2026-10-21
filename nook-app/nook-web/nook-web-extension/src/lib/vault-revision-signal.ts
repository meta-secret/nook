/**
 * The service worker announces on one dedicated broadcast channel whenever
 * what the extension holds changes: a vault update or pairing imported from
 * Simple Vault, or a session unlocked. Only documents of the extension's own
 * origin share the channel, and the announcement carries nothing but its
 * kind, so an extension page that shows this state (the side panel) can
 * listen here and re-read. Runtime broadcasts and session storage are
 * avoided on purpose: both can carry other documents' data to a listener.
 */
export const VAULT_REVISION_CHANNEL = 'nook:vault-revision'

export enum VaultRevisionAnnouncement {
  Changed = 'changed',
}

/** The part of `BroadcastChannel` the announcement uses. */
export type VaultRevisionChannel = {
  postMessage(message: VaultRevisionAnnouncement): void
}

/** The service worker's side: one long-lived channel to announce on. */
export class VaultRevisionSignal {
  constructor(private readonly channel: VaultRevisionChannel) {}

  raise(): void {
    this.channel.postMessage(VaultRevisionAnnouncement.Changed)
  }
}
