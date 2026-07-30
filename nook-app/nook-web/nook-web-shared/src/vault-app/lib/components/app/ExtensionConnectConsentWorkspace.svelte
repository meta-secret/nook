<script lang="ts">
  import ExtensionConnectConsent from '$lib/components/ExtensionConnectConsent.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import type { ExtensionConnectRequest } from '$lib/extension-connect'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    request,
    appVersion,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    appVersion: string
    onClose: (approved?: boolean) => unknown
  } = $props()
</script>

<div class="mx-auto w-full max-w-2xl space-y-4">
  <ExtensionConnectConsent {vault} {request} {onClose} />
  <VaultStatusBar
    {vault}
    storageMode={vault.storageMode}
    githubRepo={vault.githubRepo}
    lastSync={vault.lastSync}
    isSyncing={vault.isSyncActivityVisible}
    successMsg={vault.successMsg}
    errorMsg={vault.errorMsg}
    {appVersion}
    onRefresh={() => vault.manualSync()}
    onDismissSuccess={() => vault.dismissSuccess()}
    onDismissError={() => vault.dismissError()}
  />
</div>
