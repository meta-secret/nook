import type { VaultState } from "$lib/vault.svelte";
import {
  IdentityDirectoryLoadKind,
  IdentityDirectoryReader,
  type IdentityDirectoryLoadState,
} from "$lib/components/devices-access/identity-directory-view";

/**
 * Reads the identity directory for the identities hub. A re-read keeps the
 * current cards on screen so a refresh never blanks the page.
 */
export class IdentityDirectoryLoader {
  state = $state<IdentityDirectoryLoadState>({
    kind: IdentityDirectoryLoadKind.Loading,
  });
  private generation = 0;

  constructor(private readonly vault: VaultState) {}

  async reload(): Promise<void> {
    const generation = ++this.generation;
    const manager = this.vault.admitManager();
    // Before the vault engine is ready there is nothing to read yet; the
    // caller reloads once the manager is admitted.
    if (manager.isErr()) return;
    const loaded = await new IdentityDirectoryReader(manager.value).load();
    if (generation !== this.generation) return;
    if (loaded.isErr()) {
      if (this.state.kind !== IdentityDirectoryLoadKind.Ready) {
        this.state = { kind: IdentityDirectoryLoadKind.Failed };
      }
      return;
    }
    this.state = {
      kind: IdentityDirectoryLoadKind.Ready,
      view: loaded.value.directory,
    };
  }
}
