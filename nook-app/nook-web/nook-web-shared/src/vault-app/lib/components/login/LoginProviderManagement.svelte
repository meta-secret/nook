<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import ProviderPicker from '$lib/components/ProviderPicker.svelte'
  import BackButton from '$lib/components/workspace/BackButton.svelte'
  import FirstRunDiagram from '$lib/components/login/FirstRunDiagram.svelte'
  import { firstRunRecoveryDiagram } from '$lib/components/login/first-run-diagram'
  import type { ProviderKind } from '$lib/auth/providers'
  import { SentinelGenesisPhase } from '$app-wasm'

  import type { VaultState } from '$lib/vault.svelte'
  import { LocalFolderPickerRow } from './login-provider-management-state'

  let {
    vault,
    addingProvider = false,
    onBeginSetup,
    onCancelAddProvider,
  }: {
    vault: VaultState
    addingProvider?: boolean
    onBeginSetup: (kind: ProviderKind) => void
    onCancelAddProvider?: () => void
  } = $props()

  /** A Sentinel vault delivering its shares cannot use a local folder. */
  const localFolderRow = $derived(
    LocalFolderPickerRow.of(
      vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares,
    ),
  )
</script>

<div class="space-y-4" data-testid="login-provider-setup">
  {#if addingProvider && onCancelAddProvider}
    <BackButton
      label={vault.t(I18N_KEYS.LoginWizardBackToUnlock)}
      testId="cancel-add-provider-btn"
      onBack={() => onCancelAddProvider()}
    />
  {/if}

  <div class="space-y-1">
    <h2 class="text-sm font-semibold text-foreground">
      {#if addingProvider}
        {vault.t(I18N_KEYS.OnboardingAddProvider)}
      {:else if vault.loginRequiresExistingVault}
        {vault.t(I18N_KEYS.FirstRunRestorePick)}
      {:else}
        {vault.t(I18N_KEYS.LoginWizardChooseStoreVault)}
      {/if}
    </h2>
    <p class="text-xs text-muted-foreground text-pretty">
      {#if addingProvider}
        {vault.t(I18N_KEYS.LoginWizardAddProviderDesc)}
      {:else if vault.loginRequiresExistingVault}
        {vault.t(I18N_KEYS.FirstRunRestoreBody)}
      {:else}
        {vault.t(I18N_KEYS.LoginWizardBeforeConnectDesc)}
      {/if}
    </p>
  </div>

  {#if !addingProvider && vault.loginRequiresExistingVault}
    <FirstRunDiagram diagram={firstRunRecoveryDiagram(vault)} />
  {/if}

  <ProviderPicker
    {vault}
    onSelect={onBeginSetup}
    localFolder={localFolderRow}
  />
</div>
