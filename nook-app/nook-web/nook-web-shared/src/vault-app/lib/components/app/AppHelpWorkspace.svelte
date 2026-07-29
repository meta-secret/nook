<script lang="ts">
  import HelpPage from '$lib/components/HelpPage.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { ColorMode } from '$lib/app-lifecycle-state'
  import { MermaidTheme } from '$lib/mermaid-diagram'
  import type { VaultState } from '$lib/vault.svelte'

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
    lastSyncedAt={vault.lastSyncedAt}
    isSyncing={vault.isSyncActivityVisible}
    successMsg={vault.successMsg}
    errorMsg={vault.errorMsg}
    {appVersion}
    {...vault.isAuthenticated ? {} : { label: 'Nook' }}
    showSyncStatus={vault.isAuthenticated}
    showStorageIcon={vault.isAuthenticated}
    variant={vault.isAuthenticated ? 'panel' : 'quiet'}
    onDismissSuccess={() => vault.dismissSuccess()}
    onDismissError={() => vault.dismissError()}
  />
</div>
