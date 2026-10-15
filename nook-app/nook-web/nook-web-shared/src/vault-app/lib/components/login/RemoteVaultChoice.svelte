<!--
A recovery provider that holds several vaults: the user picks the one to
recover here, then the import continues with it.
-->
<script lang="ts">
  import { ArrowRight, FolderKey } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    busy,
    onChoose,
  }: {
    vault: VaultState
    busy: boolean
    onChoose: (storeId: string) => void | Promise<void>
  } = $props()

  function label(storeId: string): string {
    const args: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: storeId },
    }
    return vault.t(args)
  }
</script>

<section class="grid gap-3" data-testid="remote-vault-choice">
  <div class="space-y-1">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVault)}
    </p>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVaultBody)}
    </p>
  </div>
  <ul class="grid gap-2">
    {#each vault.remoteVaultChoices as storeId (storeId)}
      <li>
        <button
          type="button"
          class="nk-identity-menu-item group w-full border border-border"
          data-testid="remote-vault-choice-item"
          disabled={busy}
          onclick={() => void onChoose(storeId)}
        >
          <span class="nk-vault-icon" aria-hidden="true">
            <FolderKey class="size-4" />
          </span>
          <span
            class="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            >{label(storeId)}</span
          >
          <ArrowRight
            class="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </li>
    {/each}
  </ul>
</section>
