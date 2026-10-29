import { err } from "neverthrow";
import { NookIdentityLocalAccessKind } from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import {
  IdentityDirectoryLoadKind,
  IdentityDirectoryReader,
  type IdentityDirectoryLoadState,
} from "$lib/components/devices-access/identity-directory-view";

/** A busy vault engine can refuse a read; retry before showing a failure. */
export const IDENTITY_DIRECTORY_RETRY_DELAYS_MS: readonly number[] = [
  0, 300, 1000, 3000,
];

/**
 * Reads the identity directory for the identities hub. A re-read keeps the
 * current cards on screen so a refresh never blanks the page; the last read
 * lives on the vault state, so a hub mounted later starts from it too.
 */
export class IdentityDirectoryLoader {
  private generation = 0;

  constructor(private readonly vault: VaultState) {}

  get state(): IdentityDirectoryLoadState {
    return this.vault.identityDirectory;
  }

  private set state(state: IdentityDirectoryLoadState) {
    this.vault.identityDirectory = state;
  }

  /** The name of the identity this browser uses; empty until the directory
   * is read, or while it has none. */
  get currentLabel(): string {
    const state = this.state;
    if (state.kind !== IdentityDirectoryLoadKind.Ready) return "";
    const current = state.view.identities.find(
      (identity) =>
        identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser,
    );
    return current ? current.label : "";
  }

  async reload(): Promise<void> {
    const generation = ++this.generation;
    for (const delay of IDENTITY_DIRECTORY_RETRY_DELAYS_MS) {
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      if (generation !== this.generation) return;
      // Before the vault engine is ready there is nothing to read yet; the
      // caller reloads once the manager is admitted.
      if (this.vault.admitManager().isErr()) return;
      // Read through the storage queue: a read that overlaps a lock or a
      // sync would borrow the engine twice and fail that operation.
      const loaded = await this.vault.enqueueStorage(() => {
        const manager = this.vault.admitManager();
        return manager.isErr()
          ? err(manager.error)
          : new IdentityDirectoryReader(manager.value).load();
      });
      if (generation !== this.generation) return;
      if (loaded.isOk()) {
        this.state = {
          kind: IdentityDirectoryLoadKind.Ready,
          view: loaded.value.directory,
        };
        return;
      }
      if (this.state.kind !== IdentityDirectoryLoadKind.Ready) {
        this.state = { kind: IdentityDirectoryLoadKind.Failed };
      }
    }
  }
}
