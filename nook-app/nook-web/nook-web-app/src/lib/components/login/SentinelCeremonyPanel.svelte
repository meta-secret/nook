<script lang="ts">
  import { Copy, KeyRound, RefreshCw, ShieldCheck, Users } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import SentinelUnlockParticipantHelper from '$lib/components/login/SentinelUnlockParticipantHelper.svelte'
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
  const awaitingShares = $derived(
    vault.sentinelUnlockStatus === 'awaiting_shares',
  )
  const session = $derived(vault.sentinelUnlockSession)

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
          : vault.t('architecture_modes.sentinel_unlock_failed')
    } finally {
      actionBusy = false
    }
  }

  async function startUnlock() {
    await runAction(() => vault.startSentinelUnlock())
  }

  async function addResponse() {
    const payload = responseInput.trim()
    if (!payload) return
    await runAction(async () => {
      await vault.addSentinelUnlockResponse(payload)
      responseInput = ''
    })
  }

  async function finalizeUnlock() {
    if (!session.ready) return
    await runAction(() => vault.finalizeSentinelUnlock())
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
      vault.errorMsg = vault.t(
        'architecture_modes.sentinel_ceremony_copy_failed',
      )
    }
  }
</script>

<section
  class="space-y-5 rounded-lg border border-border/60 bg-muted/10 p-4"
  data-testid="sentinel-ceremony-panel"
>
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <ShieldCheck class="size-5 text-primary" />
      <h3 class="text-base font-semibold text-foreground">
        {vault.t('architecture_modes.sentinel_unlock_title')}
      </h3>
    </div>
    <p class="text-sm leading-snug text-pretty text-muted-foreground">
      {#if awaitingShares}
        {vault.t('architecture_modes.sentinel_ceremony_awaiting_shares')}
      {:else}
        {vault.t('architecture_modes.sentinel_unlock_description')}
      {/if}
    </p>
    <p class="text-xs leading-snug text-pretty text-muted-foreground">
      {vault.t('architecture_modes.sentinel_password_forbidden')}
    </p>
  </div>

  {#if !session.active}
    <Button
      type="button"
      class="w-full sm:w-auto"
      data-testid="sentinel-unlock-start-btn"
      disabled={isBusy || awaitingShares}
      onclick={() => void startUnlock()}
    >
      {#if actionBusy}
        <RefreshCw class="size-4 animate-spin" />
      {:else}
        <KeyRound class="size-4" />
      {/if}
      {vault.t('architecture_modes.sentinel_unlock_start')}
    </Button>
  {:else}
    <div class="space-y-4" data-testid="sentinel-unlock-initiator">
      <div
        class="flex items-center justify-between gap-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2"
        role="status"
        data-testid="sentinel-unlock-progress"
      >
        <span
          class="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Users class="size-4 text-primary" />
          {vault.t('architecture_modes.sentinel_unlock_progress')}
        </span>
        <span class="font-mono text-sm font-semibold text-foreground">
          {session.collected}/{session.threshold}
        </span>
      </div>

      <div class="grid gap-4 md:grid-cols-[minmax(180px,240px)_1fr]">
        {#if vault.sentinelUnlockRequest}
          <EnrollmentQrCode
            enrollmentLink={vault.sentinelUnlockRequest}
            loadingLabel={vault.t(
              'architecture_modes.sentinel_unlock_qr_loading',
            )}
          />
        {/if}
        <div class="min-w-0 space-y-2">
          <label
            class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            for="sentinel-unlock-request"
          >
            {vault.t('architecture_modes.sentinel_unlock_request_label')}
          </label>
          <textarea
            id="sentinel-unlock-request"
            class="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            readonly
            data-testid="sentinel-unlock-request-output"
            value={vault.sentinelUnlockRequest}></textarea>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="sentinel-unlock-copy-request-btn"
            disabled={isBusy || !vault.sentinelUnlockRequest}
            onclick={() => void copyRequest(vault.sentinelUnlockRequest)}
          >
            <Copy class="size-4" />
            {copied
              ? vault.t('architecture_modes.sentinel_ceremony_copied')
              : vault.t('architecture_modes.sentinel_unlock_copy_request')}
          </Button>
        </div>
      </div>

      <div class="space-y-2">
        <label
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          for="sentinel-unlock-response-input"
        >
          {vault.t('architecture_modes.sentinel_unlock_response_label')}
        </label>
        <textarea
          id="sentinel-unlock-response-input"
          class="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="sentinel-unlock-response-input"
          placeholder={vault.t(
            'architecture_modes.sentinel_unlock_response_placeholder',
          )}
          disabled={isBusy || session.ready}
          bind:value={responseInput}></textarea>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="sentinel-unlock-add-response-btn"
          disabled={isBusy || session.ready || !responseInput.trim()}
          onclick={() => void addResponse()}
        >
          <Users class="size-4" />
          {vault.t('architecture_modes.sentinel_unlock_add_response')}
        </Button>
      </div>

      <Button
        type="button"
        class="w-full sm:w-auto sm:min-w-[180px]"
        data-testid="sentinel-unlock-finalize-btn"
        disabled={isBusy || !session.ready}
        onclick={() => void finalizeUnlock()}
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t('login.unlocking')}
        {:else}
          <ShieldCheck class="size-4" />
          {vault.t('architecture_modes.sentinel_unlock_finalize')}
        {/if}
      </Button>
    </div>
  {/if}

  <Separator />
  <SentinelUnlockParticipantHelper {vault} disabled={isBusy} showWhenEmpty />
</section>
