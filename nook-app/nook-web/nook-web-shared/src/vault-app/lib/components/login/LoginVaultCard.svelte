<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { FolderKey } from '@lucide/svelte'
  import type { NookLocalVaultEntry } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { LoginVaultExtensionPairingStatusKind } from '$lib/components/login/login-vault-extension-pairing-status'

  let {
    vault,
    entry,
    active = false,
    interactive = false,
    extensionPairingStatus = LoginVaultExtensionPairingStatusKind.NotShown,
    connectedVaultStoreId,
    connectedVaultName,
  }: {
    vault: VaultState
    entry: NookLocalVaultEntry
    active?: boolean
    interactive?: boolean
    extensionPairingStatus?: LoginVaultExtensionPairingStatusKind
    connectedVaultStoreId?: string
    connectedVaultName?: string
  } = $props()

  function connectedVaultDescription(): string {
    if (!connectedVaultName || !connectedVaultStoreId) return ''
    const tArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ExtensionSetupConnectedVault,
      replacements: {
        vault: connectedVaultName,
        store: connectedVaultStoreId,
      },
    }
    return vault.t(tArgs)
  }
</script>

<div
  class="flex items-start gap-3 rounded-lg border px-4 py-3 {active
    ? 'border-primary/40 bg-primary/5'
    : interactive
      ? 'border-border/60 bg-muted/20 transition-colors hover:border-primary/40 hover:bg-muted/40'
      : 'border-border/60 bg-muted/20'}"
  data-testid="login-vault-card"
  data-store-id={entry.storeId}
>
  <FolderKey
    class="mt-0.5 size-5 shrink-0 {active
      ? 'text-primary'
      : 'text-muted-foreground'}"
  />
  <span class="min-w-0 space-y-0.5">
    <span class="block text-sm font-semibold text-foreground">
      {entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))}
    </span>
    <span class="block truncate font-mono text-xs text-muted-foreground">
      {entry.storeId}
    </span>
    {#if extensionPairingStatus === LoginVaultExtensionPairingStatusKind.Checking}
      <span
        class="block text-xs text-muted-foreground"
        data-testid="login-vault-extension-pairing-status"
      >
        {vault.t(I18N_KEYS.LoginVaultPickerExtensionPairingChecking)}
      </span>
    {:else if extensionPairingStatus === LoginVaultExtensionPairingStatusKind.Paired}
      <span
        class="block text-xs text-muted-foreground"
        data-testid="login-vault-extension-pairing-status"
      >
        {vault.t(I18N_KEYS.LoginVaultPickerExtensionPaired)}
      </span>
    {:else if extensionPairingStatus === LoginVaultExtensionPairingStatusKind.NotPaired}
      <span
        class="block text-xs text-muted-foreground"
        data-testid="login-vault-extension-pairing-status"
      >
        {vault.t(I18N_KEYS.LoginVaultPickerExtensionNotPaired)}
      </span>
    {:else if extensionPairingStatus === LoginVaultExtensionPairingStatusKind.Unavailable}
      <span
        class="block text-xs text-muted-foreground"
        data-testid="login-vault-extension-pairing-status"
      >
        {vault.t(I18N_KEYS.LoginVaultPickerExtensionPairingUnavailable)}
      </span>
    {/if}
    {#if extensionPairingStatus === LoginVaultExtensionPairingStatusKind.NotPaired && connectedVaultName && connectedVaultStoreId}
      <span
        class="block text-xs text-muted-foreground"
        data-testid="login-vault-extension-connected-vault"
      >
        {connectedVaultDescription()}
      </span>
    {/if}
  </span>
</div>
