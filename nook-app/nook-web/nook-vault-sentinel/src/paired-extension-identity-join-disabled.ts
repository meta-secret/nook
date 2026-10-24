import { ok, type Result } from "neverthrow";
import type { I18nKey } from "../../nook-web-shared/src/generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";

export enum PairedExtensionIdentityJoinOutcome {
  Unchanged = "unchanged",
}

/**
 * Sentinel's facade for the paired extension's identity join: the extension
 * is a Simple Vault capability, so no extension is paired here and nothing
 * is invited. The approval protocol never enters this bundle.
 */
export class PairedExtensionIdentityJoin {
  static forPage(vault: VaultState): PairedExtensionIdentityJoin {
    void vault;
    return new PairedExtensionIdentityJoin();
  }

  async run(): Promise<Result<PairedExtensionIdentityJoinOutcome, I18nKey>> {
    return ok(PairedExtensionIdentityJoinOutcome.Unchanged);
  }
}
