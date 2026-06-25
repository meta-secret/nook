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

  let {
    code,
    isVerifying,
    onSubmit,
  }: {
    code: string
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
      Finish device onboarding
    </CardTitle>
    <CardDescription class="text-pretty">
      This device scanned an onboarding QR. Enter the vault password to decrypt
      provider access, generate this browser's device keys, and unlock the
      vault.
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
      <div class="space-y-1.5">
        <label
          for="enrollment-scan-password"
          class="text-sm font-medium text-muted-foreground inline-flex items-center gap-1.5"
        >
          <KeyRound class="size-3.5" />
          Vault password
        </label>
        <input
          id="enrollment-scan-password"
          bind:this={passwordField}
          type="password"
          class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Password from the device that showed the QR"
          bind:value={passwordInput}
          autocomplete="current-password"
          data-testid="enrollment-password-input"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          The same password used when the QR was generated. Provider credentials
          are applied automatically after decrypt.
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
            Onboarding…
          {:else}
            <ShieldCheck class="size-4" />
            Finish onboarding
          {/if}
        </Button>
      </div>
    </form>

    <span class="sr-only" data-testid="enrollment-code-input">{code}</span>
  </CardContent>
</Card>
