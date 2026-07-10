<script lang="ts">
  import { Copy, KeyRound, RefreshCw, ShieldCheck, Users } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import NexusUnlockParticipantHelper from '$lib/components/login/NexusUnlockParticipantHelper.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Separator } from '$lib/components/ui/separator'
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

  let actionBusy = $state(false)
  let responseInput = $state('')
  let copied = $state(false)

  const isBusy = $derived(isVerifying || isInitializing || actionBusy)
  const awaitingShares = $derived(vault.nexusUnlockStatus === 'awaiting_shares')
  const session = $derived(vault.nexusUnlockSession)

  async function runAction(action: () => void | Promise<void>) {
    if (actionBusy) return
    actionBusy = true
    vault.errorMsg = ''
    try {
      await action()
    } catch (error: unknown) {
      vault.errorMsg =
        error instanceof Error
          ? vault.resolveErrorMessage(error.message)
          : vault.t('architecture_modes.nexus_unlock_failed')
    } finally {
      actionBusy = false
    }
  }

  async function startUnlock() {
    await runAction(() => vault.startNexusUnlock())
  }

  async function addResponse() {
    const payload = responseInput.trim()
    if (!payload) return
    await runAction(async () => {
      await vault.addNexusUnlockResponse(payload)
      responseInput = ''
    })
  }

  async function finalizeUnlock() {
    if (!session.ready) return
    await runAction(() => vault.finalizeNexusUnlock())
  }

  async function copyRequest(value: string) {
    if (!value.trim()) return
    try {
      await navigator.clipboard.writeText(value)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('architecture_modes.nexus_ceremony_copy_failed')
    }
  }
</script>

<section
  class="space-y-5 rounded-lg border border-border/60 bg-muted/10 p-4"
  data-testid="nexus-ceremony-panel"
>
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <ShieldCheck class="size-5 text-primary" />
      <h3 class="text-base font-semibold text-foreground">
        {vault.t('architecture_modes.nexus_unlock_title')}
      </h3>
    </div>
    <p class="text-sm leading-snug text-pretty text-muted-foreground">
      {#if awaitingShares}
        {vault.t('architecture_modes.nexus_ceremony_awaiting_shares')}
      {:else}
        {vault.t('architecture_modes.nexus_unlock_description')}
      {/if}
    </p>
    <p class="text-xs leading-snug text-pretty text-muted-foreground">
      {vault.t('architecture_modes.nexus_password_forbidden')}
    </p>
  </div>

  {#if !session.active}
    <Button
      type="button"
      class="w-full sm:w-auto"
      data-testid="nexus-unlock-start-btn"
      disabled={isBusy || awaitingShares}
      onclick={() => void startUnlock()}
    >
      {#if actionBusy}
        <RefreshCw class="size-4 animate-spin" />
      {:else}
        <KeyRound class="size-4" />
      {/if}
      {vault.t('architecture_modes.nexus_unlock_start')}
    </Button>
  {:else}
    <div class="space-y-4" data-testid="nexus-unlock-initiator">
      <div
        class="flex items-center justify-between gap-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2"
        role="status"
        data-testid="nexus-unlock-progress"
      >
        <span
          class="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Users class="size-4 text-primary" />
          {vault.t('architecture_modes.nexus_unlock_progress')}
        </span>
        <span class="font-mono text-sm font-semibold text-foreground">
          {session.collected}/{session.threshold}
        </span>
      </div>

      <div class="grid gap-4 md:grid-cols-[minmax(180px,240px)_1fr]">
        {#if vault.nexusUnlockRequest}
          <EnrollmentQrCode
            enrollmentLink={vault.nexusUnlockRequest}
            loadingLabel={vault.t('architecture_modes.nexus_unlock_qr_loading')}
          />
        {/if}
        <div class="min-w-0 space-y-2">
          <label
            class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            for="nexus-unlock-request"
          >
            {vault.t('architecture_modes.nexus_unlock_request_label')}
          </label>
          <textarea
            id="nexus-unlock-request"
            class="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            readonly
            data-testid="nexus-unlock-request-output"
            value={vault.nexusUnlockRequest}></textarea>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="nexus-unlock-copy-request-btn"
            disabled={isBusy || !vault.nexusUnlockRequest}
            onclick={() => void copyRequest(vault.nexusUnlockRequest)}
          >
            <Copy class="size-4" />
            {copied
              ? vault.t('architecture_modes.nexus_ceremony_copied')
              : vault.t('architecture_modes.nexus_unlock_copy_request')}
          </Button>
        </div>
      </div>

      <div class="space-y-2">
        <label
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          for="nexus-unlock-response-input"
        >
          {vault.t('architecture_modes.nexus_unlock_response_label')}
        </label>
        <textarea
          id="nexus-unlock-response-input"
          class="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="nexus-unlock-response-input"
          placeholder={vault.t(
            'architecture_modes.nexus_unlock_response_placeholder',
          )}
          disabled={isBusy || session.ready}
          bind:value={responseInput}></textarea>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="nexus-unlock-add-response-btn"
          disabled={isBusy || session.ready || !responseInput.trim()}
          onclick={() => void addResponse()}
        >
          <Users class="size-4" />
          {vault.t('architecture_modes.nexus_unlock_add_response')}
        </Button>
      </div>

      <Button
        type="button"
        class="w-full sm:w-auto sm:min-w-[180px]"
        data-testid="nexus-unlock-finalize-btn"
        disabled={isBusy || !session.ready}
        onclick={() => void finalizeUnlock()}
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t('login.unlocking')}
        {:else}
          <ShieldCheck class="size-4" />
          {vault.t('architecture_modes.nexus_unlock_finalize')}
        {/if}
      </Button>
    </div>
  {/if}

  <Separator />
  <NexusUnlockParticipantHelper {vault} disabled={isBusy} showWhenEmpty />
</section>
