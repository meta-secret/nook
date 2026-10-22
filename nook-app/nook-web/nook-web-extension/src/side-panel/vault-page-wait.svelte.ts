import { VaultPageUnlockWait } from '../lib/vault-page-unlock-wait'

/** Where the panel reads a vault page's wait; the extension's session storage
 * in the panel, a stand-in in tests. */
export type VaultPageWaitSource = Pick<
  typeof VaultPageUnlockWait,
  'until' | 'end' | 'follow'
>

/**
 * Whether a paired vault page is waiting for this panel's Unlock. It shows
 * from the moment the page asks until the page stops waiting or the
 * extension unlocks, and follows a wait that begins while the panel is open.
 */
export class SidePanelVaultPageWait {
  private until = $state(0)
  private expiry: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly source: VaultPageWaitSource) {}

  get waiting(): boolean {
    return this.until > 0
  }

  /** Reads the current wait and follows the next ones; returns the teardown. */
  start(): () => void {
    void this.read()
    const stopFollowing = this.source.follow(() => void this.read())
    return () => {
      stopFollowing()
      clearTimeout(this.expiry)
    }
  }

  /** The extension unlocked here: the page has what it waited for. */
  unlocked(): void {
    this.show(0)
    void this.source.end()
  }

  private async read(): Promise<void> {
    this.show(await this.source.until())
  }

  private show(until: number): void {
    clearTimeout(this.expiry)
    const remaining = until - Date.now()
    if (remaining <= 0) {
      this.until = 0
      return
    }
    this.until = until
    this.expiry = setTimeout(() => {
      this.until = 0
    }, remaining)
  }
}
