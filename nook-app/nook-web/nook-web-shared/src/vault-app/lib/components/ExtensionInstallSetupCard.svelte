<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Puzzle } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    ExtensionSetupStatus,
    type ExtensionSetupState,
  } from '$lib/extension/install'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    state,
    installBusy = false,
    onInstall,
    onConnect,
    connectError = false,
  }: {
    vault: VaultState
    state: ExtensionSetupState
    installBusy?: boolean
    onInstall: () => void
    onConnect: () => void
    connectError?: boolean
  } = $props()

  const isNotInstalled = $derived(
    state.status === ExtensionSetupStatus.NotInstalled,
  )
  const isInstalledUnpaired = $derived(
    state.status === ExtensionSetupStatus.InstalledUnpaired ||
      state.status === ExtensionSetupStatus.PairedElsewhere,
  )
  const isPairedElsewhere = $derived(
    state.status === ExtensionSetupStatus.PairedElsewhere,
  )
</script>

<aside
  class="px-4 py-3 animate-in fade-in md:px-6"
  data-testid="extension-install-setup"
  data-status={state.status}
>
  <div class="flex items-start gap-3">
    <Puzzle class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div
      class="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-semibold text-foreground">
          {vault.t(
            isNotInstalled
              ? I18N_KEYS.ExtensionSetupTitle
              : isPairedElsewhere
                ? I18N_KEYS.ExtensionSetupSwitchTitle
                : I18N_KEYS.ExtensionSetupPairTitle,
          )}
        </p>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {vault.t(
            isNotInstalled
              ? I18N_KEYS.ExtensionSetupBody
              : isPairedElsewhere
                ? I18N_KEYS.ExtensionSetupSwitchBody
                : I18N_KEYS.ExtensionSetupPairBody,
          )}
        </p>
        {#if state.status === ExtensionSetupStatus.PairedElsewhere}
          <p
            class="font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
            data-testid="extension-connected-vault"
          >
            {(() => {
              const translationRequest: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.ExtensionSetupConnectedVault,
                replacements: {
                  vault: ((v) => (v ? v : ''))(state.connectedVaultName),
                  store: ((v) => (v ? v : ''))(state.connectedVaultStoreId),
                },
              }
              return vault.t(translationRequest)
            })()}
          </p>
        {/if}
        {#if isInstalledUnpaired}
          <p class="text-[11px] leading-relaxed text-muted-foreground/80">
            {vault.t(I18N_KEYS.ExtensionSetupPairHint)}
          </p>
          {#if connectError}
            <p class="text-xs text-destructive" role="alert">
              {vault.t(I18N_KEYS.ExtensionSetupConnectFailed)}
            </p>
          {/if}
        {/if}
      </div>
      {#if isNotInstalled}
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0 self-start border-border sm:self-center"
          disabled={installBusy}
          data-testid="extension-install-setup-cta"
          onclick={onInstall}
        >
          {installBusy
            ? vault.t(I18N_KEYS.ExtensionSetupLoadingInstall)
            : vault.t(I18N_KEYS.ExtensionSetupInstallCta)}
        </Button>
      {:else if isInstalledUnpaired}
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0 self-start border-border sm:self-center"
          disabled={installBusy}
          data-testid="extension-install-setup-connect"
          onclick={onConnect}
        >
          {installBusy
            ? vault.t(I18N_KEYS.ExtensionSetupOpeningExtension)
            : vault.t(
                isPairedElsewhere
                  ? I18N_KEYS.ExtensionSetupSwitchCta
                  : I18N_KEYS.ExtensionSetupConnectCta,
              )}
        </Button>
      {/if}
    </div>
  </div>
</aside>
