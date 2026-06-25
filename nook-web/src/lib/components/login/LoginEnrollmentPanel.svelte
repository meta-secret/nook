<script lang="ts">
  import { ChevronDown, QrCode, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  let {
    open = $bindable(false),
    isVerifying,
    initialCode = '',
    openFormInitially = false,
    onUseEnrollmentCode,
  }: {
    open?: boolean
    isVerifying: boolean
    initialCode?: string
    openFormInitially?: boolean
    onUseEnrollmentCode?: (
      code: string,
      password: string,
    ) => void | Promise<void>
  } = $props()

  let enrollmentCodeFormOpen = $state(false)
  let enrollmentCodeInput = $state('')
  let enrollmentPasswordInput = $state('')

  $effect(() => {
    if (!open) {
      enrollmentCodeFormOpen = false
      enrollmentCodeInput = ''
      enrollmentPasswordInput = ''
    }
  })

  $effect(() => {
    if (open && openFormInitially && initialCode) {
      enrollmentCodeFormOpen = true
      enrollmentCodeInput = initialCode
    }
  })
</script>

<div
  class="overflow-hidden rounded-xl border border-border/60 bg-card/60"
  data-testid="enrollment-login-panel"
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/30 {open
      ? 'bg-muted/20'
      : ''}"
    aria-expanded={open}
    data-testid="login-enrollment-toggle"
    disabled={isVerifying}
    onclick={() => {
      open = !open
    }}
  >
    <QrCode class="size-5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-semibold text-foreground">
        Join from another device
      </span>
      {#if !open}
        <span class="block truncate text-xs text-muted-foreground">
          QR or enrollment link
        </span>
      {/if}
    </span>
    <ChevronDown
      class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {open
        ? 'rotate-180'
        : ''}"
    />
  </button>

  {#if open}
    <div
      class="space-y-3 border-t border-border/40 bg-background/50 px-3.5 py-3"
      data-testid="login-enrollment-panel"
    >
      <p class="text-xs text-muted-foreground text-pretty">
        Scan a QR code or paste an enrollment link from a device that is already
        unlocked. The QR carries provider access and a vault password entry id —
        enter the password on this device to finish onboarding.
      </p>

      {#if !enrollmentCodeFormOpen}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          data-testid="open-enrollment-code-btn"
          onclick={() => {
            enrollmentCodeFormOpen = true
          }}
        >
          <QrCode class="size-4" />
          Enroll with QR or code
        </button>
        <p class="text-xs text-muted-foreground text-pretty">
          Adds this browser as a trusted device — no approval round-trip.
        </p>
      {:else if onUseEnrollmentCode}
        <form
          class="space-y-3"
          onsubmit={(e) => {
            e.preventDefault()
            const trimmed = enrollmentCodeInput.trim()
            if (!trimmed) return
            void onUseEnrollmentCode(trimmed, enrollmentPasswordInput)
          }}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <h3 class="text-sm font-semibold text-foreground">
                Paste enrollment link or code
              </h3>
              <p class="text-xs text-muted-foreground text-pretty">
                Enter the vault password for the entry referenced in the QR.
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              onclick={() => {
                enrollmentCodeFormOpen = false
                enrollmentCodeInput = ''
                enrollmentPasswordInput = ''
              }}
            >
              Back
            </button>
          </div>
          <textarea
            rows="4"
            class="w-full font-mono text-xs leading-relaxed rounded-md border border-border bg-background p-3 focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Paste enrollment link or code here…"
            bind:value={enrollmentCodeInput}
            data-testid="enrollment-code-input"></textarea>
          <div class="space-y-1.5">
            <label
              for="enrollment-password-input"
              class="text-sm font-medium text-muted-foreground"
            >
              Vault password
            </label>
            <input
              id="enrollment-password-input"
              type="password"
              class="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Vault password for this onboarding QR"
              bind:value={enrollmentPasswordInput}
              autocomplete="current-password"
              data-testid="enrollment-password-input"
            />
          </div>
          <div class="flex justify-end">
            <Button
              type="submit"
              disabled={isVerifying ||
                !enrollmentCodeInput.trim() ||
                !enrollmentPasswordInput.trim()}
              data-testid="submit-enrollment-code-btn"
            >
              {#if isVerifying}
                <RefreshCw class="size-4 animate-spin" /> Enrolling…
              {:else}
                <ShieldCheck class="size-4" /> Enroll this device
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</div>
