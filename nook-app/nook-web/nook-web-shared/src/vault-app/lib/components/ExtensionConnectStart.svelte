<script lang="ts">
  import { KeyRound, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    extensionRuntimeId,
    onClose,
  }: {
    vault: VaultState
    extensionRuntimeId: string
    onClose: () => void
  } = $props()

  type StartState = 'idle' | 'starting' | 'opened' | 'failed'
  let state = $state<StartState>('idle')
  let error = $state('')

  function requestDeviceProtection() {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: {
            sendMessage?: (
              extensionId: string,
              message: unknown,
              callback: (response?: unknown) => void,
            ) => void
            lastError?: { message?: string }
          }
        }
      }
    ).chrome?.runtime

    if (!runtime?.sendMessage) {
      state = 'failed'
      error = vault.t('extension.connect.messaging_unavailable')
      return
    }

    state = 'starting'
    error = ''
    runtime.sendMessage(
      extensionRuntimeId,
      { type: 'nook:start-extension-pairing' },
      (response) => {
        const runtimeError = runtime.lastError?.message
        if (runtimeError) {
          state = 'failed'
          error = runtimeError
          return
        }
        if (
          !!response &&
          typeof response === 'object' &&
          'ok' in response &&
          (response as { ok?: unknown }).ok === true
        ) {
          state = 'opened'
          return
        }
        state = 'failed'
        error = vault.t('extension.connect.start_failed')
      },
    )
  }
</script>

<section
  class="mx-auto max-w-2xl rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5"
  data-testid="extension-connect-start"
>
  <div class="flex items-start gap-3">
    <div
      class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
    >
      <ShieldCheck class="size-5" />
    </div>
    <div class="min-w-0 space-y-1">
      <h1 class="text-lg font-semibold text-foreground">
        {vault.t('extension.connect.title')}
      </h1>
      <p class="text-sm leading-relaxed text-muted-foreground">
        {vault.t('extension.connect.description')}
      </p>
    </div>
  </div>

  <div
    class="mt-4 flex items-start gap-3 rounded-lg border border-border/50 bg-background/60 p-3"
  >
    <KeyRound class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <p class="text-sm leading-relaxed text-muted-foreground">
      {vault.t('extension.connect.device_protection')}
    </p>
  </div>

  {#if state === 'opened'}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-protection-opened"
    >
      {vault.t('extension.connect.protection_opened')}
    </p>
  {:else if state === 'failed'}
    <p
      class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {error}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <Button type="button" variant="outline" onclick={onClose}>
      {vault.t('common.cancel')}
    </Button>
    <Button
      type="button"
      disabled={state === 'starting' || state === 'opened'}
      data-testid="start-extension-pairing-btn"
      onclick={requestDeviceProtection}
    >
      {state === 'starting'
        ? vault.t('extension.connect.starting')
        : vault.t('extension.connect.continue')}
    </Button>
  </div>
</section>
