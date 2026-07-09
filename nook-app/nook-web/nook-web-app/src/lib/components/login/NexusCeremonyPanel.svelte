<script lang="ts">
  import { Copy, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
  } = $props()

  let copyDone = $state(false)
  let openingShare = $state(false)
  let unlockBusy = $state(false)

  const isBusy = $derived(
    isVerifying || isInitializing || openingShare || unlockBusy,
  )
  const awaitingShares = $derived(vault.nexusUnlockStatus === 'awaiting_shares')
  const canUnlock = $derived(
    Boolean(vault.nexusLocalShareContribution.trim()) &&
      Boolean(vault.nexusPeerShareContributions.trim()) &&
      !awaitingShares,
  )

  async function openLocalShare() {
    if (openingShare) return
    openingShare = true
    vault.errorMsg = ''
    try {
      await vault.openLocalNexusShare()
    } catch (e: unknown) {
      vault.errorMsg =
        e instanceof Error
          ? vault.resolveErrorMessage(e.message)
          : vault.t('architecture_modes.nexus_ceremony_open_failed')
    } finally {
      openingShare = false
    }
  }

  async function copyLocalShare() {
    const value = vault.nexusLocalShareContribution.trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      copyDone = true
      setTimeout(() => {
        copyDone = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('architecture_modes.nexus_ceremony_copy_failed')
    }
  }

  function peerContributions(): string[] {
    return vault.nexusPeerShareContributions
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  async function unlockCeremony() {
    if (!canUnlock || unlockBusy) return
    unlockBusy = true
    try {
      await vault.unlockWithNexusShares([
        vault.nexusLocalShareContribution.trim(),
        ...peerContributions(),
      ])
    } finally {
      unlockBusy = false
    }
  }
</script>

<section
  class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
  data-testid="nexus-ceremony-panel"
>
  <div class="space-y-1">
    <h3 class="text-sm font-semibold text-foreground">
      {vault.t('architecture_modes.nexus_ceremony_title')}
    </h3>
    <p class="text-sm text-pretty text-muted-foreground">
      {#if awaitingShares}
        {vault.t('architecture_modes.nexus_ceremony_awaiting_shares')}
      {:else}
        {vault.t('architecture_modes.nexus_ceremony_instructions')}
      {/if}
    </p>
    <p class="text-xs text-pretty text-muted-foreground">
      {vault.t('architecture_modes.nexus_password_forbidden')}
    </p>
  </div>

  <div class="space-y-2">
    <Button
      type="button"
      variant="outline"
      class="w-full sm:w-auto"
      data-testid="nexus-open-local-share-btn"
      disabled={isBusy || awaitingShares}
      onclick={() => void openLocalShare()}
    >
      {#if openingShare}
        <RefreshCw class="size-4 animate-spin" />
      {:else}
        <ShieldCheck class="size-4" />
      {/if}
      {vault.t('architecture_modes.nexus_ceremony_open_local')}
    </Button>

    {#if vault.nexusLocalShareContribution}
      <div class="space-y-2">
        <label
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          for="nexus-local-share"
        >
          {vault.t('architecture_modes.nexus_ceremony_local_share')}
        </label>
        <textarea
          id="nexus-local-share"
          class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          readonly
          data-testid="nexus-local-share-output"
          value={vault.nexusLocalShareContribution}></textarea>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="nexus-copy-local-share-btn"
          disabled={isBusy}
          onclick={() => void copyLocalShare()}
        >
          <Copy class="size-4" />
          {copyDone
            ? vault.t('architecture_modes.nexus_ceremony_copied')
            : vault.t('architecture_modes.nexus_ceremony_copy_share')}
        </Button>
      </div>
    {/if}
  </div>

  <div class="space-y-2">
    <label
      class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      for="nexus-peer-shares"
    >
      {vault.t('architecture_modes.nexus_ceremony_paste_peer')}
    </label>
    <textarea
      id="nexus-peer-shares"
      class="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      data-testid="nexus-peer-shares-input"
      placeholder={vault.t(
        'architecture_modes.nexus_ceremony_paste_peer_placeholder',
      )}
      disabled={isBusy || awaitingShares}
      bind:value={vault.nexusPeerShareContributions}></textarea>
  </div>

  <Button
    type="button"
    variant="outline"
    class="w-full border-primary/30 bg-primary/5 font-medium text-foreground hover:bg-primary/10 hover:text-foreground sm:w-auto sm:min-w-[160px]"
    data-testid="nexus-ceremony-unlock-btn"
    disabled={isBusy || !canUnlock}
    onclick={() => void unlockCeremony()}
  >
    {#if unlockBusy || isVerifying}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('login.unlocking')}
    {:else}
      <ShieldCheck class="size-4" />
      {vault.t('architecture_modes.nexus_ceremony_unlock')}
    {/if}
  </Button>
</section>
