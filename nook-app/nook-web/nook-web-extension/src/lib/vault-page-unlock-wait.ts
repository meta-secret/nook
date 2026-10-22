const VAULT_PAGE_UNLOCK_WAIT_KEY = 'nook:vault-page-unlock-wait'

/** The stored wait: when it ends, in epoch milliseconds. */
type StoredVaultPageUnlockWait = {
  readonly [VAULT_PAGE_UNLOCK_WAIT_KEY]?: number
}

type SessionStorageChanges = Record<string, chrome.storage.StorageChange>

/** How long a paired vault page waits for this extension to unlock after its
 * Unlock asked (the page's own paired-unlock timeout). */
export const VAULT_PAGE_UNLOCK_WAIT_MS = 30_000

/**
 * A paired vault page asked this locked extension to unlock and is waiting
 * for it. The service worker marks the wait in session storage; the side
 * panel shows "unlock here" while it lasts, whether it opened for that click
 * or was already open. Only the time the wait ends is kept.
 */
export class VaultPageUnlockWait {
  static async begin(now: number): Promise<void> {
    const items: Record<string, number> = {
      [VAULT_PAGE_UNLOCK_WAIT_KEY]: now + VAULT_PAGE_UNLOCK_WAIT_MS,
    }
    await chrome.storage.session.set(items)
  }

  /** The extension unlocked: the page has what it waited for. */
  static async end(): Promise<void> {
    await chrome.storage.session.remove(VAULT_PAGE_UNLOCK_WAIT_KEY)
  }

  /** When the current wait ends; 0 when no page is waiting. */
  static async until(): Promise<number> {
    const items = await chrome.storage.session.get<StoredVaultPageUnlockWait>(
      VAULT_PAGE_UNLOCK_WAIT_KEY,
    )
    const until = items[VAULT_PAGE_UNLOCK_WAIT_KEY]
    return typeof until === 'number' ? until : 0
  }

  /** Calls `onchange` whenever a wait begins or ends; returns the teardown. */
  static follow(onchange: () => void): () => void {
    const listener = (changes: SessionStorageChanges): void => {
      if (VAULT_PAGE_UNLOCK_WAIT_KEY in changes) onchange()
    }
    chrome.storage.session.onChanged.addListener(listener)
    return () => chrome.storage.session.onChanged.removeListener(listener)
  }
}
