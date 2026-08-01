<script lang="ts">
  import HelpPage from '$lib/components/HelpPage.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { ColorMode } from '$lib/app/theme'
  import { MermaidTheme } from '$lib/content/mermaid-diagram'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultStatusBarVariant } from '$lib/components/vault-status-bar-state'

  let {
    vault,
    colorMode,
    appVersion,
  }: {
    vault: VaultState
    colorMode: ColorMode
    appVersion: string
  } = $props()

  const helpTheme = $derived(
    colorMode === ColorMode.Dark ? MermaidTheme.Dark : MermaidTheme.Light,
  )
</script>

<div class="space-y-4">
  <HelpPage {vault} onClose={() => vault.closeHelp()} colorMode={helpTheme} />
  <VaultStatusBar
    {vault}
    storageMode={vault.storageMode}
    githubRepo={vault.githubRepo}
    lastSync={vault.lastSync}
    isSyncing={vault.isSyncActivityVisible}
    successMsg={vault.successMsg}
    errorMsg={vault.errorMsg}
    {appVersion}
    {...vault.isAuthenticated ? {} : { label: 'Nook' }}
    showSyncStatus={vault.isAuthenticated}
    showStorageIcon={vault.isAuthenticated}
    variant={vault.isAuthenticated
      ? VaultStatusBarVariant.Panel
      : VaultStatusBarVariant.Quiet}
    onDismissSuccess={() => vault.dismissSuccess()}
    onDismissError={() => vault.dismissError()}
  />
</div>
