<script lang="ts">
  import { KeyRound, QrCode, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    code,
    passwordEntryId = undefined,
    passwordEntryLabel = undefined,
    isVerifying,
    onSubmit,
  }: {
    vault: VaultState
    code: string
    passwordEntryId?: string | undefined
    passwordEntryLabel?: string | undefined
    isVerifying: boolean
    onSubmit: (password: string) => void | Promise<void>
  } = $props()

  let passwordInput = $state('')
  let passwordField: HTMLInputElement | undefined = $state()

  $effect(() => {
    void code
    passwordInput = ''
    queueMicrotask(() => passwordField?.focus())
  })
</script>

<Card
  class="gap-0 border-primary/30 bg-card/90 py-0 shadow-lg shadow-primary/10 backdrop-blur-sm overflow-hidden"
  data-testid="enrollment-scan-panel"
>
  <CardHeader class="border-b border-border/60 px-5 pb-3 pt-4 sm:px-6">
    <CardTitle
      class="text-lg font-semibold tracking-tight text-foreground inline-flex items-center gap-2"
    >
      <QrCode class="size-5 shrink-0 text-primary" />
      {vault.t('login.finish_device_onboarding')}
    </CardTitle>
    <CardDescription class="text-pretty">
      {vault.t('login.onboarding_card_desc')}
    </CardDescription>
  </CardHeader>

  <CardContent class="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
    <form
      class="space-y-4"
      onsubmit={(event) => {
        event.preventDefault()
        if (!passwordInput.trim()) return
        void onSubmit(passwordInput)
      }}
    >
      {#if passwordEntryLabel || passwordEntryId}
        <p
          class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          data-testid="enrollment-password-entry-hint"
        >
          {vault.t('onboard_device.vault_password')}
          {#if passwordEntryLabel}
            <span class="font-medium text-foreground">{passwordEntryLabel}</span
            >
          {:else if passwordEntryId}
            <span class="font-mono text-foreground">{passwordEntryId}</span>
          {/if}
        </p>
      {/if}

      <div class="space-y-1.5">
        <label
          for="enrollment-scan-password"
          class="text-sm font-medium text-muted-foreground inline-flex items-center gap-1.5"
        >
          <KeyRound class="size-3.5" />
          {vault.t('onboard_device.vault_password')}
        </label>
        <input
          id="enrollment-scan-password"
          bind:this={passwordField}
          type="password"
          class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={vault.t('login.password_entry_placeholder')}
          bind:value={passwordInput}
          autocomplete="current-password"
          data-testid="enrollment-password-input"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('login.password_help_text')}
        </p>
      </div>

      <div class="flex justify-end">
        <Button
          type="submit"
          class="w-full sm:w-auto sm:min-w-[180px]"
          disabled={isVerifying || !passwordInput.trim()}
          data-testid="submit-enrollment-code-btn"
        >
          {#if isVerifying}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t('login.onboarding_progress')}
          {:else}
            <ShieldCheck class="size-4" />
            {vault.t('login.finish_onboarding')}
          {/if}
        </Button>
      </div>
    </form>

    <span class="sr-only" data-testid="enrollment-code-input">{code}</span>
  </CardContent>
</Card>
