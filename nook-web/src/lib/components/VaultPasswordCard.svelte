<script lang="ts">
  import {
    KeyRound,
    Lock,
    QrCode,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    Copy,
    Check,
    Plus,
    UserRound,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import QRCode from 'qrcode'
  import {
    buildEnrollmentLink,
    decodeEnrollmentPayload,
  } from '$lib/enrollment-code'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'

  let {
    passwordEntries,
    isBusy,
    passwordError,
    enrollmentCode,
    onAddPassword,
    onUpdatePassword,
    onRemovePassword,
    onIssueCode,
    onClearCode,
    embedded = false,
  }: {
    passwordEntries: VaultPasswordEntrySummary[]
    isBusy: boolean
    passwordError: string
    enrollmentCode: string
    onAddPassword: (label: string, password: string) => void | Promise<void>
    onUpdatePassword: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onRemovePassword: (entryId: string) => void | Promise<void>
    onIssueCode: (entryId: string, password: string) => Promise<string | void>
    onClearCode: () => void
    embedded?: boolean
  } = $props()

  type Panel = 'idle' | 'add' | 'rotate' | 'remove' | 'issue'
  let panel = $state<Panel>('idle')
  let activeEntryId = $state<string | null>(null)

  let labelInput = $state('')
  let passwordInput = $state('')
  let confirmInput = $state('')
  let showPassword = $state(false)
  let localError = $state('')
  let copied = $state(false)
  let qrDataUrl = $state('')

  const hasPasswords = $derived(passwordEntries.length > 0)
  const activeEntry = $derived(
    passwordEntries.find((entry) => entry.id === activeEntryId) ?? null,
  )

  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return null
    try {
      return decodeEnrollmentPayload(enrollmentCode).issued_at
    } catch {
      return null
    }
  })
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )

  const issuedAgo = $derived.by(() => {
    if (!issuedAt) return ''
    const ms = Date.parse(issuedAt)
    if (!Number.isFinite(ms)) return ''
    const delta = Date.now() - ms
    if (delta < 60_000) return 'issued just now'
    const minutes = Math.round(delta / 60_000)
    if (minutes < 60) return `issued ${minutes}m ago`
    const hours = Math.round(minutes / 60)
    return `issued ${hours}h ago`
  })

  $effect(() => {
    void enrollmentCode
    if (!enrollmentCode) {
      qrDataUrl = ''
      return
    }
    QRCode.toDataURL(enrollmentLink, {
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

  function openPanel(target: Panel, entryId: string | null = null) {
    panel = target
    activeEntryId = entryId
    labelInput = ''
    passwordInput = ''
    confirmInput = ''
    localError = ''
    onClearCode()
  }

  function closePanel() {
    panel = 'idle'
    activeEntryId = null
    labelInput = ''
    passwordInput = ''
    confirmInput = ''
    localError = ''
    showPassword = false
  }

  async function submitAddPassword() {
    localError = ''
    if (!labelInput.trim()) {
      localError = 'Enter a label, like "John\'s MacBook".'
      return
    }
    if (passwordInput.length < 5) {
      localError = 'Password must be at least 5 characters.'
      return
    }
    if (passwordInput !== confirmInput) {
      localError = 'Passwords do not match.'
      return
    }
    try {
      await onAddPassword(labelInput.trim(), passwordInput)
      closePanel()
    } catch {
      // VaultState surfaces details via passwordError prop.
    }
  }

  async function submitRotatePassword() {
    localError = ''
    if (!activeEntryId) return
    if (passwordInput.length < 5) {
      localError = 'Password must be at least 5 characters.'
      return
    }
    if (passwordInput !== confirmInput) {
      localError = 'Passwords do not match.'
      return
    }
    try {
      await onUpdatePassword(activeEntryId, passwordInput)
      closePanel()
    } catch {
      // surfaced via prop
    }
  }

  async function submitRemove() {
    localError = ''
    if (!activeEntryId) return
    try {
      await onRemovePassword(activeEntryId)
      closePanel()
    } catch {
      // surfaced via prop
    }
  }

  async function submitIssueCode() {
    localError = ''
    if (!activeEntryId) return
    if (!passwordInput) {
      localError = 'Enter the password for this entry to issue a code.'
      return
    }
    try {
      await onIssueCode(activeEntryId, passwordInput)
      passwordInput = ''
      confirmInput = ''
    } catch (e: unknown) {
      localError = e instanceof Error ? e.message : 'Failed to issue code.'
    }
  }

  async function copyCode() {
    if (!enrollmentLink) return
    try {
      await navigator.clipboard.writeText(enrollmentLink)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // best-effort
    }
  }
</script>

<svelte:element
  this={embedded ? 'div' : 'section'}
  class={embedded
    ? undefined
    : 'rounded-xl border border-dashed border-border/70 bg-muted/15 p-4 sm:p-5'}
  data-testid="vault-password-card"
>
  {#if !embedded}
    <header class="flex items-start justify-between gap-3 mb-3">
      <div class="space-y-0.5">
        <h2
          class="inline-flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <KeyRound class="size-4 text-primary" />
          Onboard another device
        </h2>
        <p class="text-xs text-muted-foreground text-pretty max-w-prose">
          Generate a QR/link that carries provider access and a vault password
          so another browser can join this vault.
        </p>
      </div>
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasPasswords
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground'}"
        data-testid="vault-password-status"
      >
        {#if hasPasswords}
          <ShieldCheck class="size-3" />
          {passwordEntries.length}
          {passwordEntries.length === 1 ? 'password' : 'passwords'}
        {:else}
          <Lock class="size-3" /> None
        {/if}
      </span>
    </header>
  {/if}

  {#if !hasPasswords}
    <div
      class="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
    >
      <ShieldAlert class="size-4 mt-0.5 shrink-0" />
      <span class="text-pretty">
        Create a vault password before onboarding another device. The QR link
        will include your storage provider access and this password, so use a
        long, unique value.
      </span>
    </div>
  {:else}
    <p class="mb-4 text-xs text-muted-foreground text-pretty">
      Choose an existing vault password to generate a QR/link for the new
      device, or create a new password just for this onboarding flow.
    </p>
  {/if}

  {#if panel === 'idle'}
    {#if passwordEntries.length > 0}
      <ul class="mb-4 space-y-3" data-testid="vault-password-list">
        {#each passwordEntries as entry (entry.id)}
          <li
            class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-4 py-3"
            data-testid="vault-password-entry-{entry.id}"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <UserRound class="size-4 shrink-0 text-primary" />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-foreground">
                  {entry.label}
                </p>
                {#if entry.created_at}
                  <p class="text-xs text-muted-foreground">
                    Added {entry.created_at.slice(0, 10)}
                  </p>
                {/if}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-9 px-2.5"
                disabled={isBusy}
                data-testid={entry.id === passwordEntries[0]?.id
                  ? 'rotate-vault-password-btn'
                  : undefined}
                onclick={() => openPanel('rotate', entry.id)}
              >
                <RefreshCw class="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-9 px-2.5"
                disabled={isBusy}
                data-testid={entry.id === passwordEntries[0]?.id
                  ? 'issue-enrollment-code-btn'
                  : undefined}
                onclick={() => openPanel('issue', entry.id)}
              >
                <QrCode class="size-4" />
                <span class="hidden sm:inline">Generate QR</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-9 px-2.5 text-destructive hover:text-destructive"
                disabled={isBusy}
                data-testid={entry.id === passwordEntries[0]?.id
                  ? 'remove-vault-password-btn'
                  : undefined}
                onclick={() => openPanel('remove', entry.id)}
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <Button
      type="button"
      size="sm"
      disabled={isBusy}
      data-testid="set-vault-password-btn"
      onclick={() => openPanel('add')}
    >
      <Plus class="size-4" />
      {hasPasswords ? 'Create another password' : 'Create onboarding password'}
    </Button>
  {/if}

  {#if panel === 'add' || panel === 'rotate'}
    <form
      class="space-y-4"
      onsubmit={(event) => {
        event.preventDefault()
        void (panel === 'add' ? submitAddPassword() : submitRotatePassword())
      }}
    >
      {#if panel === 'add'}
        <div class="space-y-1.5">
          <label
            for="vault-pw-label"
            class="text-sm font-medium text-muted-foreground"
          >
            Label
          </label>
          <input
            id="vault-pw-label"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="John's MacBook"
            bind:value={labelInput}
            data-testid="vault-password-label"
          />
        </div>
      {:else if activeEntry}
        <p class="text-xs text-muted-foreground">
          Rotating password for <span class="font-medium text-foreground"
            >{activeEntry.label}</span
          >.
        </p>
      {/if}
      <div class="space-y-1.5">
        <label for="vault-pw" class="text-sm font-medium text-muted-foreground">
          {panel === 'add' ? 'Password' : 'New password'}
        </label>
        <input
          id="vault-pw"
          type={showPassword ? 'text' : 'password'}
          class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={passwordInput}
          autocomplete="new-password"
          data-testid="vault-password-input"
        />
      </div>
      <div class="space-y-1.5">
        <label
          for="vault-pw-confirm"
          class="text-sm font-medium text-muted-foreground"
        >
          Confirm password
        </label>
        <input
          id="vault-pw-confirm"
          type={showPassword ? 'text' : 'password'}
          class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          bind:value={confirmInput}
          autocomplete="new-password"
          data-testid="vault-password-confirm"
        />
      </div>
      <div class="flex items-center justify-between text-xs">
        <label class="inline-flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" bind:checked={showPassword} />
          Show
        </label>
        <span class="text-muted-foreground">Minimum 5 characters.</span>
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
            {panel === 'add' ? 'Add password' : 'Rotate'}
          {/if}
        </Button>
      </div>
    </form>
  {/if}

  {#if panel === 'remove' && activeEntry}
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        Remove <span class="font-medium text-foreground"
          >{activeEntry.label}</span
        >? Other passwords stay active. If this is the last password, the vault
        returns to device-key unlock for this browser.
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
            <Trash2 class="size-3.5" /> Remove
          {/if}
        </Button>
      </div>
    </div>
  {/if}

  {#if panel === 'issue' && activeEntry}
    <div class="space-y-4">
      {#if !enrollmentCode}
        <form
          class="space-y-4"
          onsubmit={(event) => {
            event.preventDefault()
            void submitIssueCode()
          }}
        >
          <p class="text-xs text-muted-foreground text-pretty">
            Re-type the password for <span class="font-medium text-foreground"
              >{activeEntry.label}</span
            > to generate a QR/link for the new device.
          </p>
          <div class="space-y-1.5">
            <label
              for="issue-pw"
              class="text-sm font-medium text-muted-foreground"
            >
              Password for {activeEntry.label}
            </label>
            <input
              id="issue-pw"
              type="password"
              class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              bind:value={passwordInput}
              autocomplete="current-password"
              data-testid="issue-code-password-input"
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
              <QrCode class="size-3.5" /> Generate QR/link
            </Button>
          </div>
        </form>
      {:else}
        <div
          class="rounded-lg border border-border/60 bg-background p-3 space-y-3"
        >
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs text-muted-foreground text-pretty">
              Scan this QR with the new device to open Nook, or copy the link.
              {#if issuedAgo}
                <span
                  class="ml-1 text-muted-foreground/80"
                  data-testid="enrollment-code-issued-ago"
                >
                  ({issuedAgo})
                </span>
              {/if}
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

          <span class="sr-only" data-testid="enrollment-code-link"
            >{enrollmentLink}</span
          >
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
</svelte:element>
