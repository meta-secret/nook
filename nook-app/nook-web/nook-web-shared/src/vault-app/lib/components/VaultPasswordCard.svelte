<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
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
  import { buildEnrollmentLink, getEnrollmentLinkBase } from '$lib/enrollment/code'
  import {
    is_vault_password_long_enough,
    peek_enrollment_issued_at,
    type NookPasswordEntrySummary,
    type PasswordEntryId,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ActivePasswordEntryKind,
    ResolvedPasswordEntryKind,
    VaultPasswordPanel,
    type ActivePasswordEntry,
    type ResolvedPasswordEntry,
  } from './vault-password-card-state'

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
    initialPanel = VaultPasswordPanel.Idle,
    showWarningBanner = true,
  }: {
    vault: VaultState
    passwordEntries: NookPasswordEntrySummary[]
    isBusy: boolean
    passwordError: string
    enrollmentCode: string
    onAddPassword: (args: { readonly label: string; readonly password: string }) => void | Promise<void>
    onUpdatePassword: (
      args: { readonly entryId: PasswordEntryId; readonly password: string },
    ) => void | Promise<void>
    onRemovePassword: (entryId: PasswordEntryId) => void | Promise<void>
    onIssueCode: (args: { readonly entryId: PasswordEntryId; readonly password: string }) => Promise<string>
    onClearCode: () => void
    embedded?: boolean
    allowIssueCode?: boolean
    initialPanel?: VaultPasswordPanel
    showWarningBanner?: boolean
  } = $props()

  function resolveInitialPanel() {
    return initialPanel
  }

  let panel = $state<VaultPasswordPanel>(resolveInitialPanel())
  let activeEntryId = $state<ActivePasswordEntry>({
    kind: ActivePasswordEntryKind.None,
  })

  let labelInput = $state('')
  let passwordInput = $state('')
  let confirmInput = $state('')
  let showPassword = $state(false)
  let localError = $state('')

  const hasPasswords = $derived(passwordEntries.length > 0)
  const activeEntry: ResolvedPasswordEntry = $derived.by(() => {
    if (activeEntryId.kind !== ActivePasswordEntryKind.Selected) {
      return { kind: ResolvedPasswordEntryKind.Unavailable } as const
    }
    const selectedEntryId = activeEntryId.entryId
    const entry = passwordEntries.find((candidate) => {
      return candidate.id === selectedEntryId
    })
    return entry
      ? { kind: ResolvedPasswordEntryKind.Available, entry }
      : { kind: ResolvedPasswordEntryKind.Unavailable }
  })

  const issuedAt = $derived.by(() => {
    if (!enrollmentCode) return ''
    return peek_enrollment_issued_at(enrollmentCode)
  })
  const enrollmentLink = $derived.by(() => {
    if (!enrollmentCode) return ''
    const enrollmentLinkRequest: Parameters<typeof buildEnrollmentLink>[0] = {
      code: enrollmentCode,
      baseUrl: getEnrollmentLinkBase(),
    }
    return buildEnrollmentLink(enrollmentLinkRequest)
  })
  const issuedAgo = $derived.by(() => {
    if (!issuedAt) return ''
    const ms = Date.parse(issuedAt)
    if (!Number.isFinite(ms)) return ''
    const delta = Date.now() - ms
    if (delta < 60_000) return vault.t(I18N_KEYS.VaultPasswordsIssuedJustNow)
    const minutes = Math.round(delta / 60_000)
    if (minutes < 60)
      return (() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsIssuedMinsAgo, replacements: {
        mins: String(minutes),
      } }; return vault.t(tArgs); })()
    const hours = Math.round(minutes / 60)
    const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsIssuedHoursAgo, replacements: {
      hours: String(hours),
    } };
    return vault.t(tArgs2)
  })

  function openPanel(
    { target, selection }: { readonly target: VaultPasswordPanel; readonly selection: ActivePasswordEntry },
  ) {
    panel = target
    activeEntryId = selection
    labelInput = ''
    passwordInput = ''
    confirmInput = ''
    localError = ''
    onClearCode()
  }

  function closePanel() {
    panel = VaultPasswordPanel.Idle
    activeEntryId = { kind: ActivePasswordEntryKind.None }
    labelInput = ''
    passwordInput = ''
    confirmInput = ''
    localError = ''
    showPassword = false
  }

  async function submitAddPassword() {
    localError = ''
    if (!labelInput.trim()) {
      localError = vault.t(I18N_KEYS.VaultPasswordsEnterLabelError)
      return
    }
    if (!is_vault_password_long_enough(passwordInput)) {
      localError = vault.t(I18N_KEYS.VaultPasswordsMinLengthError)
      return
    }
    if (passwordInput !== confirmInput) {
      localError = vault.t(I18N_KEYS.VaultPasswordsMismatchError)
      return
    }
    try {
      const onAddPasswordArgs: Parameters<typeof onAddPassword>[0] = { label: labelInput.trim(), password: passwordInput };
      await onAddPassword(onAddPasswordArgs)
      closePanel()
    } catch {
      // VaultState surfaces details via passwordError prop.
    }
  }

  async function submitRotatePassword() {
    localError = ''
    if (activeEntryId.kind !== ActivePasswordEntryKind.Selected) return
    if (!is_vault_password_long_enough(passwordInput)) {
      localError = vault.t(I18N_KEYS.VaultPasswordsMinLengthError)
      return
    }
    if (passwordInput !== confirmInput) {
      localError = vault.t(I18N_KEYS.VaultPasswordsMismatchError)
      return
    }
    try {
      const onUpdatePasswordArgs: Parameters<typeof onUpdatePassword>[0] = { entryId: activeEntryId.entryId, password: passwordInput };
      await onUpdatePassword(onUpdatePasswordArgs)
      closePanel()
    } catch {
      // surfaced via prop
    }
  }

  async function submitRemove() {
    localError = ''
    if (activeEntryId.kind !== ActivePasswordEntryKind.Selected) return
    try {
      await onRemovePassword(activeEntryId.entryId)
      closePanel()
    } catch {
      // surfaced via prop
    }
  }

  async function submitIssueCode() {
    localError = ''
    if (activeEntryId.kind !== ActivePasswordEntryKind.Selected) return
    if (!passwordInput) {
      localError = vault.t(I18N_KEYS.VaultPasswordsEnterPwError)
      return
    }
    try {
      const issueRequest: Parameters<typeof onIssueCode>[0] = {
        entryId: activeEntryId.entryId,
        password: passwordInput,
      }
      await onIssueCode(issueRequest)
      passwordInput = ''
      confirmInput = ''
    } catch (e) {
      localError =
        e instanceof Error
          ? e.message
          : vault.t(I18N_KEYS.VaultPasswordsFailedIssueError)
    }
  }
</script>

<svelte:element
  this={embedded ? 'div' : 'section'}
  class={embedded
    ? ''
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
          {vault.t(I18N_KEYS.VaultPasswordsTitle)}
        </h2>
        <p class="text-xs text-muted-foreground text-pretty max-w-prose">
          {vault.t(I18N_KEYS.VaultPasswordsDesc)}
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
            ? vault.t(I18N_KEYS.CommonItem)
            : vault.t(I18N_KEYS.CommonItems)}
        {:else}
          <Lock class="size-3" /> {vault.t(I18N_KEYS.CommonNone)}
        {/if}
      </span>
    </header>
  {/if}

  {#if !hasPasswords && showWarningBanner}
    <div
      class="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
    >
      <ShieldAlert class="size-4 mt-0.5 shrink-0" />
      <span class="text-pretty">
        {vault.t(I18N_KEYS.VaultPasswordsWarningBanner)}
      </span>
    </div>
  {:else}
    <p class="mb-4 text-xs text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.VaultPasswordsInfoDesc)}
    </p>
  {/if}

  {#if panel === VaultPasswordPanel.Idle}
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
                    {(() => { const tArgs3: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsAddedDate, replacements: {
                      date: entry.createdAt.slice(0, 10),
                    } }; return vault.t(tArgs3); })()}
                  </p>
                {/if}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                {...entry.id === passwordEntries[0]?.id
                  ? { 'data-testid': 'rotate-vault-password-btn' }
                  : {}}
                type="button"
                variant="ghost"
                size="sm"
                class="h-9 px-2.5"
                disabled={isBusy}
                onclick={() =>
                  (() => { const openPanelArgs: Parameters<typeof openPanel>[0] = { target: VaultPasswordPanel.Rotate, selection: {
                    kind: ActivePasswordEntryKind.Selected,
                    entryId: entry.id,
                  } }; return openPanel(openPanelArgs); })()}
              >
                <RefreshCw class="size-4" />
              </Button>
              {#if allowIssueCode}
                <Button
                  {...entry.id === passwordEntries[0]?.id
                    ? { 'data-testid': 'issue-enrollment-code-btn' }
                    : {}}
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-9 px-2.5"
                  disabled={isBusy}
                  onclick={() =>
                    (() => { const openPanelArgs2: Parameters<typeof openPanel>[0] = { target: VaultPasswordPanel.Issue, selection: {
                      kind: ActivePasswordEntryKind.Selected,
                      entryId: entry.id,
                    } }; return openPanel(openPanelArgs2); })()}
                >
                  <QrCode class="size-4" />
                  <span class="hidden sm:inline"
                    >{vault.t(I18N_KEYS.VaultPasswordsGenerateQr)}</span
                  >
                </Button>
              {/if}
              <Button
                {...entry.id === passwordEntries[0]?.id
                  ? { 'data-testid': 'remove-vault-password-btn' }
                  : {}}
                type="button"
                variant="ghost"
                size="sm"
                class="h-9 px-2.5 text-destructive hover:text-destructive"
                disabled={isBusy}
                onclick={() =>
                  (() => { const openPanelArgs3: Parameters<typeof openPanel>[0] = { target: VaultPasswordPanel.Remove, selection: {
                    kind: ActivePasswordEntryKind.Selected,
                    entryId: entry.id,
                  } }; return openPanel(openPanelArgs3); })()}
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
      onclick={() =>
        (() => { const openPanelArgs4: Parameters<typeof openPanel>[0] = { target: VaultPasswordPanel.Add, selection: {
          kind: ActivePasswordEntryKind.None,
        } }; return openPanel(openPanelArgs4); })()}
    >
      <Plus class="size-4" />
      {hasPasswords
        ? vault.t(I18N_KEYS.VaultPasswordsCreateAnother)
        : vault.t(I18N_KEYS.VaultPasswordsCreatePassword)}
    </Button>
  {/if}

  {#if panel === VaultPasswordPanel.Add || panel === VaultPasswordPanel.Rotate}
    <form
      class="space-y-4"
      onsubmit={(event) => {
        event.preventDefault()
        void (panel === VaultPasswordPanel.Add
          ? submitAddPassword()
          : submitRotatePassword())
      }}
    >
      {#if panel === VaultPasswordPanel.Add}
        <div class="space-y-1.5">
          <label
            for="vault-pw-label"
            class="text-sm font-medium text-muted-foreground"
          >
            {vault.t(I18N_KEYS.VaultPasswordsLabel)}
          </label>
          <input
            id="vault-pw-label"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={vault.t(I18N_KEYS.VaultPasswordsLabelPlaceholder)}
            bind:value={labelInput}
            data-testid="vault-password-label"
          />
        </div>
      {:else if activeEntry.kind === ResolvedPasswordEntryKind.Available}
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.VaultPasswordsRotatingForPrefix)}<span
            class="font-medium text-foreground">{activeEntry.entry.label}</span
          >.
        </p>
      {/if}
      <div class="space-y-1.5">
        <label for="vault-pw" class="text-sm font-medium text-muted-foreground">
          {panel === VaultPasswordPanel.Add
            ? vault.t(I18N_KEYS.VaultFieldsPassword)
            : vault.t(I18N_KEYS.VaultPasswordsNewPassword)}
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
          {vault.t(I18N_KEYS.VaultPasswordsConfirmPassword)}
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
          {vault.t(I18N_KEYS.VaultPasswordsShow)}
        </label>
        <span class="text-muted-foreground"
          >{vault.t(I18N_KEYS.VaultPasswordsMinChars)}</span
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
          {vault.t(I18N_KEYS.CommonCancel)}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isBusy}
          data-testid="submit-vault-password"
        >
          {#if isBusy}
            <RefreshCw class="size-3.5 animate-spin" />
            {vault.t(I18N_KEYS.VaultPasswordsWorking)}
          {:else}
            <ShieldCheck class="size-3.5" />
            {panel === VaultPasswordPanel.Add
              ? vault.t(I18N_KEYS.VaultPasswordsAddPassword)
              : vault.t(I18N_KEYS.VaultPasswordsRotate)}
          {/if}
        </Button>
      </div>
    </form>
  {/if}

  {#if panel === VaultPasswordPanel.Remove && activeEntry.kind === ResolvedPasswordEntryKind.Available}
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.VaultPasswordsRemoveBodyPrefix)}<span
          class="font-medium text-foreground">{activeEntry.entry.label}</span
        >{vault.t(I18N_KEYS.VaultPasswordsRemoveBodySuffix)}
      </p>
      <div class="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={closePanel}
          disabled={isBusy}
        >
          {vault.t(I18N_KEYS.CommonCancel)}
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
            {vault.t(I18N_KEYS.VaultPasswordsWorking)}
          {:else}
            <Trash2 class="size-3.5" /> {vault.t(I18N_KEYS.CommonRemove)}
          {/if}
        </Button>
      </div>
    </div>
  {/if}

  {#if panel === VaultPasswordPanel.Issue && activeEntry.kind === ResolvedPasswordEntryKind.Available}
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
            {vault.t(I18N_KEYS.VaultPasswordsIssueDescPrefix)}<span
              class="font-medium text-foreground"
              >{activeEntry.entry.label}</span
            >{vault.t(I18N_KEYS.VaultPasswordsIssueDescSuffix)}
          </p>
          <div class="space-y-1.5">
            <label
              for="issue-pw"
              class="text-sm font-medium text-muted-foreground"
            >
              {(() => { const tArgs4: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsPasswordFor, replacements: {
                label: activeEntry.entry.label,
              } }; return vault.t(tArgs4); })()}
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
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isBusy}
              data-testid="generate-enrollment-code-btn"
            >
              {#if isBusy}
                <RefreshCw class="size-3.5 animate-spin" />
                {vault.t(I18N_KEYS.OnboardDeviceGenerating)}
              {:else}
                <QrCode class="size-3.5" />
                {vault.t(I18N_KEYS.VaultPasswordsGenerateQr)}
              {/if}
            </Button>
          </div>
        </form>
      {:else}
        <EnrollmentOnboardResult
          {vault}
          {enrollmentLink}
          instruction={vault.t(I18N_KEYS.VaultPasswordsScanQrDesc)}
          issuedSuffix={issuedAgo ? `(${issuedAgo})` : ''}
          linkTitle={vault.t(I18N_KEYS.VaultPasswordsLinkTitle)}
          linkDescription={vault.t(I18N_KEYS.VaultPasswordsLinkDesc)}
          passwordReminder={vault.t(I18N_KEYS.VaultPasswordsSharePassword)}
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
            {vault.t(I18N_KEYS.CommonDone)}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</svelte:element>
