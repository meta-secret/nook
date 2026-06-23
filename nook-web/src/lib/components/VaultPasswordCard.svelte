<script lang="ts">
  import { onMount } from 'svelte'
  import {
    KeyRound,
    Lock,
    LockOpen,
    QrCode,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    Copy,
    Check,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import QRCode from 'qrcode'

  let {
    hasPasswordEnvelope,
    isBusy,
    passwordError,
    enrollmentCode,
    enrollmentCodeExpiresAt,
    onSetPassword,
    onRemovePassword,
    onIssueCode,
    onClearCode,
  }: {
    hasPasswordEnvelope: boolean
    isBusy: boolean
    passwordError: string
    enrollmentCode: string
    enrollmentCodeExpiresAt: string | null
    onSetPassword: (password: string) => void | Promise<void>
    onRemovePassword: () => void | Promise<void>
    onIssueCode: (password: string) => string | void
    onClearCode: () => void
  } = $props()

  type Panel = 'idle' | 'set' | 'remove' | 'issue'
  let panel = $state<Panel>('idle')

  let passwordInput = $state('')
  let confirmInput = $state('')
  let showPassword = $state(false)
  let localError = $state('')
  let copied = $state(false)
  let qrDataUrl = $state('')

  const formattedExpiry = $derived(formatExpiry(enrollmentCodeExpiresAt))

  $effect(() => {
    void enrollmentCode
    if (!enrollmentCode) {
      qrDataUrl = ''
      return
    }
    QRCode.toDataURL(enrollmentCode, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#111317', light: '#ffffff' },
    })
      .then((url: string) => {
        qrDataUrl = url
      })
      .catch(() => {
        qrDataUrl = ''
      })
  })

  function openPanel(target: Panel) {
    panel = target
    passwordInput = ''
    confirmInput = ''
    localError = ''
    onClearCode()
  }

  function closePanel() {
    panel = 'idle'
    passwordInput = ''
    confirmInput = ''
    localError = ''
    showPassword = false
  }

  async function submitSetPassword() {
    localError = ''
    if (passwordInput.length < 12) {
      localError = 'Password must be at least 12 characters.'
      return
    }
    if (passwordInput !== confirmInput) {
      localError = 'Passwords do not match.'
      return
    }
    try {
      await onSetPassword(passwordInput)
      closePanel()
    } catch {
      // VaultState surfaces details via passwordError prop.
    }
  }

  async function submitRemove() {
    localError = ''
    try {
      await onRemovePassword()
      closePanel()
    } catch {
      // surfaced via prop
    }
  }

  function submitIssueCode() {
    localError = ''
    if (!passwordInput) {
      localError = 'Enter the vault password to issue a code.'
      return
    }
    try {
      onIssueCode(passwordInput)
      passwordInput = ''
      confirmInput = ''
    } catch (e: unknown) {
      localError = e instanceof Error ? e.message : 'Failed to issue code.'
    }
  }

  async function copyCode() {
    if (!enrollmentCode) return
    try {
      await navigator.clipboard.writeText(enrollmentCode)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // best-effort
    }
  }

  function formatExpiry(iso: string | null): string {
    if (!iso) return ''
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return ''
    const delta = ms - Date.now()
    if (delta <= 0) return 'expired'
    const minutes = Math.max(1, Math.round(delta / 60_000))
    return `expires in ~${minutes}m`
  }

  let tick = $state(0)
  onMount(() => {
    const t = setInterval(() => {
      tick++
    }, 30_000)
    return () => clearInterval(t)
  })
  $effect(() => {
    void tick
    // recompute formattedExpiry by touching the input deps
  })
</script>

<section
  class="rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5"
  data-testid="vault-password-card"
>
  <header class="flex items-start justify-between gap-3 mb-3">
    <div class="space-y-0.5">
      <h3
        class="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <KeyRound class="size-4 text-primary" />
        Vault password
      </h3>
      <p class="text-xs text-muted-foreground text-pretty max-w-prose">
        Optional alternate unlock path. With a password set, another device can
        enrol with a single scan — no approval round-trip.
      </p>
    </div>
    <span
      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasPasswordEnvelope
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'border-border bg-muted/40 text-muted-foreground'}"
      data-testid="vault-password-status"
    >
      {#if hasPasswordEnvelope}
        <ShieldCheck class="size-3" /> Enabled
      {:else}
        <Lock class="size-3" /> Disabled
      {/if}
    </span>
  </header>

  {#if !hasPasswordEnvelope}
    <div
      class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 mb-3 flex items-start gap-2"
    >
      <ShieldAlert class="size-4 mt-0.5 shrink-0" />
      <span class="text-pretty">
        Anyone who knows the password and your storage credentials can read the
        entire vault. Use a long, unique password — preferably one Nook
        generates for you.
      </span>
    </div>
  {/if}

  {#if panel === 'idle'}
    <div class="flex flex-wrap items-center gap-2">
      {#if hasPasswordEnvelope}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          data-testid="rotate-vault-password-btn"
          onclick={() => openPanel('set')}
        >
          <RefreshCw class="size-3.5" /> Rotate password
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          data-testid="issue-enrollment-code-btn"
          onclick={() => openPanel('issue')}
        >
          <QrCode class="size-3.5" /> Enrollment code
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-destructive hover:text-destructive"
          disabled={isBusy}
          data-testid="remove-vault-password-btn"
          onclick={() => openPanel('remove')}
        >
          <Trash2 class="size-3.5" /> Remove
        </Button>
      {:else}
        <Button
          type="button"
          size="sm"
          disabled={isBusy}
          data-testid="set-vault-password-btn"
          onclick={() => openPanel('set')}
        >
          <LockOpen class="size-3.5" /> Set password
        </Button>
      {/if}
    </div>
  {/if}

  {#if panel === 'set'}
    <form
      class="space-y-3"
      onsubmit={(event) => {
        event.preventDefault()
        void submitSetPassword()
      }}
    >
      <div class="space-y-1.5">
        <label for="vault-pw" class="text-xs font-medium text-muted-foreground">
          {hasPasswordEnvelope ? 'New password' : 'Password'}
        </label>
        <input
          id="vault-pw"
          type={showPassword ? 'text' : 'password'}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={passwordInput}
          minlength="12"
          autocomplete="new-password"
          data-testid="vault-password-input"
          required
        />
      </div>
      <div class="space-y-1.5">
        <label
          for="vault-pw-confirm"
          class="text-xs font-medium text-muted-foreground"
        >
          Confirm password
        </label>
        <input
          id="vault-pw-confirm"
          type={showPassword ? 'text' : 'password'}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={confirmInput}
          autocomplete="new-password"
          data-testid="vault-password-confirm"
          required
        />
      </div>
      <div class="flex items-center justify-between text-xs">
        <label class="inline-flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" bind:checked={showPassword} />
          Show
        </label>
        <span class="text-muted-foreground">Minimum 12 characters.</span>
      </div>
      {#if localError || passwordError}
        <p class="text-xs text-destructive" data-testid="vault-password-error">
          {localError || passwordError}
        </p>
      {/if}
      <div class="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={closePanel}
          disabled={isBusy}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isBusy}
          data-testid="submit-vault-password"
        >
          {#if isBusy}
            <RefreshCw class="size-3.5 animate-spin" /> Working…
          {:else}
            <ShieldCheck class="size-3.5" />
            {hasPasswordEnvelope ? 'Rotate' : 'Enable'}
          {/if}
        </Button>
      </div>
    </form>
  {/if}

  {#if panel === 'remove'}
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        Removing the password disables the QR enrollment path. New devices will
        again need an approval from an enrolled device. This does not delete any
        secrets.
      </p>
      <div class="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={closePanel}
          disabled={isBusy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onclick={submitRemove}
          disabled={isBusy}
          data-testid="confirm-remove-vault-password"
        >
          {#if isBusy}
            <RefreshCw class="size-3.5 animate-spin" /> Removing…
          {:else}
            <Trash2 class="size-3.5" /> Remove password
          {/if}
        </Button>
      </div>
    </div>
  {/if}

  {#if panel === 'issue'}
    <div class="space-y-3">
      {#if !enrollmentCode}
        <form
          class="space-y-3"
          onsubmit={(event) => {
            event.preventDefault()
            submitIssueCode()
          }}
        >
          <p class="text-xs text-muted-foreground text-pretty">
            Re-type the vault password to issue a one-time enrollment code. The
            code includes your storage credentials and the password — treat it
            like a high-value secret.
          </p>
          <div class="space-y-1.5">
            <label
              for="issue-pw"
              class="text-xs font-medium text-muted-foreground"
            >
              Vault password
            </label>
            <input
              id="issue-pw"
              type="password"
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              bind:value={passwordInput}
              autocomplete="current-password"
              data-testid="issue-code-password-input"
              required
            />
          </div>
          {#if localError}
            <p class="text-xs text-destructive" data-testid="issue-code-error">
              {localError}
            </p>
          {/if}
          <div class="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={closePanel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="generate-enrollment-code-btn"
            >
              <QrCode class="size-3.5" /> Generate code
            </Button>
          </div>
        </form>
      {:else}
        <div
          class="rounded-lg border border-border/60 bg-background p-3 space-y-3"
        >
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs text-muted-foreground text-pretty">
              Scan with the joining device, or copy the code and paste it into
              its login screen. {formattedExpiry}.
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onclick={copyCode}
              data-testid="copy-enrollment-code-btn"
            >
              {#if copied}
                <Check class="size-3" /> Copied
              {:else}
                <Copy class="size-3" /> Copy
              {/if}
            </button>
          </div>

          {#if qrDataUrl}
            <div class="flex justify-center">
              <img
                src={qrDataUrl}
                alt="Enrollment code QR"
                class="rounded-md border border-border"
                width="240"
                height="240"
              />
            </div>
          {/if}

          <textarea
            readonly
            rows="3"
            class="w-full font-mono text-[10px] leading-relaxed rounded-md border border-border bg-muted/30 p-2 text-muted-foreground break-all"
            data-testid="enrollment-code-text">{enrollmentCode}</textarea
          >

          <div class="flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => {
                onClearCode()
                closePanel()
              }}
            >
              Done
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>
