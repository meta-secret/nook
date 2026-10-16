<!--
Whether the browser extension that asked to pair holds this vault, and which
vault it holds instead. Shown on vault rows and in the unlock panel.
-->
<script lang="ts">
  import { Puzzle } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    LoginVaultExtensionPairingStatusKind,
    type LoginVaultExtensionPairingStatus,
    type LoginVaultNotPairedExtensionPairingStatus,
  } from '$lib/components/login/login-vault-extension-pairing-status'

  let {
    vault,
    status,
  }: {
    vault: VaultState
    status: LoginVaultExtensionPairingStatus
  } = $props()

  const label = $derived.by(() => {
    switch (status.kind) {
      case LoginVaultExtensionPairingStatusKind.Checking:
        return vault.t(I18N_KEYS.LoginVaultPickerExtensionPairingChecking)
      case LoginVaultExtensionPairingStatusKind.Paired:
        return vault.t(I18N_KEYS.LoginVaultPickerExtensionPaired)
      case LoginVaultExtensionPairingStatusKind.NotPaired:
        return vault.t(I18N_KEYS.LoginVaultPickerExtensionNotPaired)
      // An extension that cannot answer says nothing about this vault.
      case LoginVaultExtensionPairingStatusKind.Unavailable:
      case LoginVaultExtensionPairingStatusKind.NotShown:
        return ''
    }
  })

  function connectedVaultDescription(
    pairingStatus: LoginVaultNotPairedExtensionPairingStatus,
  ): string {
    const tArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ExtensionSetupConnectedVault,
      replacements: {
        vault: pairingStatus.connectedVault.name,
        store: pairingStatus.connectedVault.storeId,
      },
    }
    return vault.t(tArgs)
  }
</script>

{#if label}
  <span class="flex min-w-0 flex-col gap-0.5">
    <span
      class="nk-tag {status.kind === LoginVaultExtensionPairingStatusKind.Paired
        ? 'nk-tag-success'
        : ''}"
    >
      <Puzzle class="size-3" aria-hidden="true" />
      <span data-testid="login-vault-extension-pairing-status">{label}</span>
    </span>
    {#if status.kind === LoginVaultExtensionPairingStatusKind.NotPaired}
      <span
        class="text-xs text-pretty text-muted-foreground"
        data-testid="login-vault-extension-connected-vault"
      >
        {connectedVaultDescription(status)}
      </span>
    {/if}
  </span>
{/if}
