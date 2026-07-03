<script lang="ts">
  import {
    KeyRound,
    Lock,
    QrCode,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    Plus,
    UserRound,
  } from '@lucide/svelte'
  import EnrollmentOnboardResult from '$lib/components/EnrollmentOnboardResult.svelte'
  import { Button } from '$lib/components/ui/button'
  import QRCode from 'qrcode'
  import {
    buildEnrollmentLink,
    peekEnrollmentIssuedAt,
  } from '$lib/enrollment-code'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
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
    allowIssueCode = true,
  }: {
    vault: VaultState
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
    allowIssueCode?: boolean
  } = $props()

  type Panel = 'idle' | 'add' | 'rotate' | 'remove' | 'issue'
  let panel = $state<Panel>('idle')
  let activeEntryId = $state<string | null>(null)

  let labelInput = $state('')
  let passwordInput = $state('')
  let confirmInput = $state('')
  let showPassword = $state(false)
  let localError = $state('')

  const hasPasswords = $derived(passwordEntries.length > 0)
  const activeEntry = $derived(
    passwordEntries.find((entry) => entry.id === activeEntryId) ?? null,
  )

  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return null
    return peekEnrollmentIssuedAt(enrollmentCode)
  })
  const enrollmentLink = $derived.by(() =>
    enrollmentCode ? buildEnrollmentLink(enrollmentCode) : '',
  )
  const qrDataUrlPromise = $derived.by(() => {
    if (!enrollmentCode || typeof window === 'undefined') {
      return Promise.resolve('')
    }
    return QRCode.toDataURL(enrollmentLink, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 240,
      color: { dark: '#111317', light: '#ffffff' },
    }).catch(() => '')
  })

  const issuedAgo = $derived.by(() => {
    if (!issuedAt) return ''
    const ms = Date.parse(issuedAt)
    if (!Number.isFinite(ms)) return ''
    const delta = Date.now() - ms
    if (delta < 60_000) return vault.t('vault_passwords.issued_just_now')
    const minutes = Math.round(delta / 60_000)
    if (minutes < 60)
      return vault.t('vault_passwords.issued_mins_ago', {
        mins: String(minutes),
      })
    const hours = Math.round(minutes / 60)
    return vault.t('vault_passwords.issued_hours_ago', { hours: String(hours) })
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
      localError = vault.t('vault_passwords.enter_label_error')
      return
    }
    if (passwordInput.length < 5) {
      localError = vault.t('vault_passwords.min_length_error')
      return
    }
    if (passwordInput !== confirmInput) {
      localError = vault.t('vault_passwords.mismatch_error')
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
      localError = vault.t('vault_passwords.min_length_error')
      return
    }
    if (passwordInput !== confirmInput) {
      localError = vault.t('vault_passwords.mismatch_error')
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
      localError = vault.t('vault_passwords.enter_pw_error')
      return
    }
    try {
      await onIssueCode(activeEntryId, passwordInput)
      passwordInput = ''
      confirmInput = ''
    } catch (e: unknown) {
      localError =
        e instanceof Error
          ? e.message
          : vault.t('vault_passwords.failed_issue_error')
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
          {vault.t('vault_passwords.title')}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty max-w-prose">
          {vault.t('vault_passwords.desc')}
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
          {passwordEntries.length === 1
            ? vault.t('common.item')
            : vault.t('common.items')}
        {:else}
          <Lock class="size-3" /> {vault.t('common.none')}
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
        {vault.t('vault_passwords.warning_banner')}
      </span>
    </div>
  {:else}
    <p class="mb-4 text-xs text-muted-foreground text-pretty">
      {vault.t('vault_passwords.info_desc')}
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
                {#if entry.createdAt}
                  <p class="text-xs text-muted-foreground">
                    {vault.t('vault_passwords.added_date', {
                      date: entry.createdAt.slice(0, 10),
                    })}
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
              {#if allowIssueCode}
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
                  <span class="hidden sm:inline"
                    >{vault.t('vault_passwords.generate_qr')}</span
                  >
                </Button>
              {/if}
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
      {hasPasswords
        ? vault.t('vault_passwords.create_another')
        : vault.t('vault_passwords.create_password')}
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
            {vault.t('vault_passwords.label')}
          </label>
          <input
            id="vault-pw-label"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={vault.t('vault_passwords.label_placeholder')}
            bind:value={labelInput}
            data-testid="vault-password-label"
          />
        </div>
      {:else if activeEntry}
        <p class="text-xs text-muted-foreground">
          {vault.t('vault_passwords.rotating_for_prefix')}<span
            class="font-medium text-foreground">{activeEntry.label}</span
          >.
        </p>
      {/if}
      <div class="space-y-1.5">
        <label for="vault-pw" class="text-sm font-medium text-muted-foreground">
          {panel === 'add'
            ? vault.t('vault.fields.password')
            : vault.t('vault_passwords.new_password')}
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
          {vault.t('vault_passwords.confirm_password')}
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
          {vault.t('vault_passwords.show')}
        </label>
        <span class="text-muted-foreground"
          >{vault.t('vault_passwords.min_chars')}</span
        >
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
          {vault.t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isBusy}
          data-testid="submit-vault-password"
        >
          {#if isBusy}
            <RefreshCw class="size-3.5 animate-spin" />
            {vault.t('vault_passwords.working')}
          {:else}
            <ShieldCheck class="size-3.5" />
            {panel === 'add'
              ? vault.t('vault_passwords.add_password')
              : vault.t('vault_passwords.rotate')}
          {/if}
        </Button>
      </div>
    </form>
  {/if}

  {#if panel === 'remove' && activeEntry}
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t('vault_passwords.remove_body_prefix')}<span
          class="font-medium text-foreground">{activeEntry.label}</span
        >{vault.t('vault_passwords.remove_body_suffix')}
      </p>
      <div class="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={closePanel}
          disabled={isBusy}
        >
          {vault.t('common.cancel')}
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
            <RefreshCw class="size-3.5 animate-spin" />
            {vault.t('vault_passwords.working')}
          {:else}
            <Trash2 class="size-3.5" /> {vault.t('common.remove')}
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
            {vault.t('vault_passwords.issue_desc_prefix')}<span
              class="font-medium text-foreground">{activeEntry.label}</span
            >{vault.t('vault_passwords.issue_desc_suffix')}
          </p>
          <div class="space-y-1.5">
            <label
              for="issue-pw"
              class="text-sm font-medium text-muted-foreground"
            >
              {vault.t('vault_passwords.password_for', {
                label: activeEntry.label,
              })}
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
              {vault.t('common.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isBusy}
              data-testid="generate-enrollment-code-btn"
            >
              {#if isBusy}
                <RefreshCw class="size-3.5 animate-spin" />
                {vault.t('onboard_device.generating')}
              {:else}
                <QrCode class="size-3.5" />
                {vault.t('vault_passwords.generate_qr')}
              {/if}
            </Button>
          </div>
        </form>
      {:else}
        <EnrollmentOnboardResult
          {vault}
          {enrollmentLink}
          {qrDataUrlPromise}
          instruction={vault.t('vault_passwords.scan_qr_desc')}
          issuedSuffix={issuedAgo ? `(${issuedAgo})` : ''}
          linkTitle={vault.t('vault_passwords.link_title')}
          linkDescription={vault.t('vault_passwords.link_desc')}
          passwordReminder={vault.t('vault_passwords.share_password')}
          copyBtnTestId="copy-enrollment-code-btn"
          linkInputTestId="enrollment-link-url"
          linkSrOnlyTestId="enrollment-code-link"
          resultTestId="vault-password-enrollment-result"
        />

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
            {vault.t('common.done')}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</svelte:element>
