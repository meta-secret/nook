<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    ArrowLeft,
    KeyRound,
    RefreshCw,
    Eye,
    EyeOff,
    ChevronDown,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    buildSecretYaml,
    generateSecretId,
    type NookSecretRecord,
    type VaultItemType,
  } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import MarkdownEditor from './MarkdownEditor.svelte'
  import SeedPhraseGrid from './SeedPhraseGrid.svelte'
  import { defaultPasswordGenerationOptions } from '$web-shared/password/generator'

  let {
    vault,
    isSaving,
    onAddSecret,
    onReplaceSecret,
    onGeneratePassword,
    onCancel,
    initialItem = undefined,
    selectedType = $bindable<VaultItemType | undefined>(undefined),
  }: {
    vault: VaultState
    isSaving: boolean
    onAddSecret: (
      id: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>
    onReplaceSecret?: (
      oldId: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string
    onCancel: () => void
    initialItem?: NookSecretRecord | undefined
    selectedType?: VaultItemType | undefined
  } = $props()

  const isEditMode = $derived(initialItem !== undefined)

  let showPasswordOptions = $state(false)
  let showPasswordValue = $state(false)

  let websiteUrl = $state('')
  let username = $state('')
  let password = $state('')
  let notes = $state('')
  let apiKey = $state('')
  let expiresAt = $state('')
  let accountName = $state('')
  let seedPhrase = $state('')
  let seedPhraseValid = $state(false)
  let noteTitle = $state('')
  let noteBody = $state('')
  let authenticatorIssuer = $state('')
  let authenticatorAccount = $state('')
  let authenticatorSecret = $state('')
  let authenticatorAlgorithm = $state('SHA1')
  let authenticatorDigits = $state('6')
  let authenticatorPeriod = $state('30')
  let authenticatorBackupCodes = $state('')
  let submitError = $state('')

  let genLength = $state(defaultPasswordGenerationOptions.length)
  let genUppercase = $state(defaultPasswordGenerationOptions.uppercase)
  let genLowercase = $state(defaultPasswordGenerationOptions.lowercase)
  let genNumbers = $state(defaultPasswordGenerationOptions.numbers)
  let genSymbols = $state(defaultPasswordGenerationOptions.symbols)

  const typeTitle = $derived(
    isEditMode
      ? selectedType === 'login'
        ? vault.t('add_secret.title_edit_login')
        : selectedType === 'api-key'
          ? vault.t('add_secret.title_edit_api_key')
          : selectedType === 'seed-phrase'
            ? vault.t('add_secret.title_edit_seed_phrase')
            : selectedType === 'secure-note'
              ? vault.t('add_secret.title_edit_secure_note')
              : selectedType === 'authenticator'
                ? vault.t('add_secret.title_edit_authenticator')
              : vault.t('add_secret.title_edit_item')
      : selectedType === 'login'
        ? vault.t('add_secret.title_new_login')
        : selectedType === 'api-key'
          ? vault.t('add_secret.title_new_api_key')
          : selectedType === 'seed-phrase'
            ? vault.t('add_secret.title_new_seed_phrase')
            : selectedType === 'secure-note'
              ? vault.t('add_secret.title_new_secure_note')
              : selectedType === 'authenticator'
                ? vault.t('add_secret.title_new_authenticator')
              : vault.t('add_secret.title_add_item'),
  )

  $effect(() => {
    const item = initialItem
    if (!item) return
    selectedType = item.type as VaultItemType
    if (item.type === 'login') {
      websiteUrl = item.websiteUrl
      username = item.username
      password = item.password
      notes = item.notes ?? ''
    } else if (item.type === 'api-key') {
      websiteUrl = item.websiteUrl
      apiKey = item.primaryCredential || item.key
      expiresAt = item.expiresAt ?? ''
    } else if (item.type === 'seed-phrase') {
      accountName = item.name
      seedPhrase = item.seed
    } else if (item.type === 'secure-note') {
      noteTitle = item.title
      noteBody = item.note
    } else if (item.type === 'authenticator') {
      authenticatorIssuer = item.issuer
      authenticatorAccount = item.account
      authenticatorSecret = item.totpSecret
      authenticatorAlgorithm = item.algorithm
      authenticatorDigits = String(item.digits)
      authenticatorPeriod = String(item.period)
      authenticatorBackupCodes = item.backupCodes.join('\n')
    }
  })

  function secretFields(): Record<string, string> {
    if (selectedType === 'login') {
      return {
        websiteUrl: websiteUrl.trim(),
        username: username.trim(),
        password,
        notes: notes.trim(),
      }
    }
    if (selectedType === 'api-key') {
      return {
        websiteUrl: websiteUrl.trim(),
        key: apiKey,
        expiresAt,
      }
    }
    if (selectedType === 'seed-phrase') {
      return {
        name: accountName.trim(),
        seed: seedPhrase.trim(),
      }
    }
    if (selectedType === 'authenticator') {
      const setupKeyChanged =
        initialItem?.type === 'authenticator' &&
        authenticatorSecret.trim() !== initialItem.totpSecret
      return {
        issuer: authenticatorIssuer.trim(),
        account: authenticatorAccount.trim(),
        totpSecret: authenticatorSecret.trim(),
        algorithm: setupKeyChanged ? 'SHA1' : authenticatorAlgorithm,
        digits: setupKeyChanged ? '6' : authenticatorDigits,
        period: setupKeyChanged ? '30' : authenticatorPeriod,
        backupCodes: setupKeyChanged ? '' : authenticatorBackupCodes,
      }
    }
    return {
      title: noteTitle.trim(),
      note: noteBody,
    }
  }

  function resetForm() {
    selectedType = undefined
    websiteUrl = ''
    username = ''
    password = ''
    notes = ''
    apiKey = ''
    expiresAt = ''
    accountName = ''
    seedPhrase = ''
    noteTitle = ''
    noteBody = ''
    authenticatorIssuer = ''
    authenticatorAccount = ''
    authenticatorSecret = ''
    authenticatorAlgorithm = 'SHA1'
    authenticatorDigits = '6'
    authenticatorPeriod = '30'
    authenticatorBackupCodes = ''
    submitError = ''
    showPasswordOptions = false
    showPasswordValue = false
  }

  function handleCancel() {
    resetForm()
    onCancel()
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!selectedType) return
    submitError = ''

    if (selectedType === 'secure-note' && !noteBody.trim()) return
    if (selectedType === 'seed-phrase' && !seedPhraseValid) return

    let dataYaml: string
    try {
      dataYaml = buildSecretYaml(selectedType, secretFields())
    } catch (error) {
      submitError = vault.resolveErrorMessage(
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    if (isEditMode && initialItem && onReplaceSecret) {
      await onReplaceSecret(initialItem.id, selectedType, dataYaml)
    } else {
      const id = generateSecretId()
      await onAddSecret(id, selectedType, dataYaml)
    }
    resetForm()
    onCancel()
  }

  function generatePassword() {
    password = onGeneratePassword(
      genLength,
      genLowercase,
      genUppercase,
      genNumbers,
      genSymbols,
    )
  }

  const isSecureNoteForm = $derived(selectedType === 'secure-note')

  const canSubmit = $derived.by(() => {
    if (isSaving || !selectedType) return false
    if (selectedType === 'seed-phrase') return seedPhraseValid
    if (selectedType === 'secure-note') return noteBody.trim().length > 0
    if (selectedType === 'api-key') return apiKey.trim().length > 0
    if (selectedType === 'authenticator') {
      return (
        authenticatorSecret.trim().length > 0 &&
        (authenticatorIssuer.trim().length > 0 ||
          authenticatorSecret.trim().startsWith('otpauth://'))
      )
    }
    if (selectedType === 'login') {
      return (
        websiteUrl.trim().length > 0 &&
        username.trim().length > 0 &&
        password.length > 0
      )
    }
    return false
  })

  const saveLabel = $derived(
    isSaving
      ? vault.t('add_secret.working')
      : isEditMode
        ? vault.t('add_secret.save_changes')
        : vault.t('common.save'),
  )
</script>

{#if selectedType === undefined && !isEditMode}
  <div class="space-y-5">
    <div class="space-y-1">
      <h3 class="text-base font-semibold text-foreground">
        {vault.t('add_secret.what_saving')}
      </h3>
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t('add_secret.choose_type_desc')}
      </p>
    </div>
    <div class="grid grid-cols-2 gap-3 sm:gap-4" data-testid="item-type-picker">
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-login"
        onclick={() => (selectedType = 'login')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <Globe class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.login')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.website_account_desc')}</span
        >
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-authenticator"
        onclick={() => (selectedType = 'authenticator')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <ShieldCheck class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.authenticator')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.authenticator_desc')}</span
        >
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-api-key"
        onclick={() => (selectedType = 'api-key')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <Braces class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.api_key')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.token_desc')}</span
        >
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-seed-phrase"
        onclick={() => (selectedType = 'seed-phrase')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <Sprout class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.seed_phrase')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.bip39_desc')}</span
        >
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-secure-note"
        onclick={() => (selectedType = 'secure-note')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <StickyNote class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.secure_note')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.private_text_desc')}</span
        >
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center p-5 text-center rounded-xl border border-border/40 bg-muted/15 transition-colors hover:border-primary/35 hover:bg-primary/5 sm:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="item-type-passkey"
        onclick={() => (selectedType = 'passkey')}
      >
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/35 bg-background/80 text-primary mb-3 sm:border-border/60 sm:bg-background"
        >
          <KeyRound class="size-6" />
        </div>
        <span class="block text-sm font-semibold text-foreground"
          >{vault.t('vault.types.passkey')}</span
        >
        <span class="mt-1 block text-xs text-muted-foreground"
          >{vault.t('add_secret.passkey_desc')}</span
        >
      </button>
    </div>
  </div>
{:else if selectedType === 'passkey' && !isEditMode}
  <div class="space-y-4" data-testid="passkey-creation-guidance">
    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/40 pb-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onclick={() => (selectedType = undefined)}
        >
          <ArrowLeft class="size-3.5" />
          {vault.t('add_secret.change_type')}
        </button>
        <span class="text-muted-foreground/50" aria-hidden="true">·</span>
        <h3 class="truncate text-sm font-semibold text-foreground">
          {vault.t('add_secret.title_new_passkey')}
        </h3>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="sm:min-w-[5rem]"
        data-testid="add-secret-cancel-btn"
        onclick={handleCancel}
      >
        {vault.t('common.done')}
      </Button>
    </div>

    <div
      class="rounded-xl border border-border/40 bg-muted/15 p-5 sm:border-border"
    >
      <div
        class="mb-4 flex size-12 items-center justify-center rounded-xl border border-border/60 bg-background text-primary"
      >
        <KeyRound class="size-6" />
      </div>
      <h4 class="text-base font-semibold text-foreground">
        {vault.t('add_secret.passkey_creation_title')}
      </h4>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        {vault.t('add_secret.passkey_creation_description')}
      </p>
      <p class="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
        {vault.t('add_secret.passkey_creation_hint')}
      </p>
    </div>
  </div>
{:else}
  <form
    onsubmit={handleSubmit}
    class={isSecureNoteForm
      ? 'flex min-h-0 flex-1 flex-col gap-4'
      : 'space-y-4'}
    data-testid={isEditMode ? 'edit-secret-form' : undefined}
  >
    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/40 pb-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        {#if !isEditMode}
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onclick={() => (selectedType = undefined)}
          >
            <ArrowLeft class="size-3.5" />
            {vault.t('add_secret.change_type')}
          </button>
          <span class="text-muted-foreground/50" aria-hidden="true">·</span>
        {/if}
        <h3 class="truncate text-sm font-semibold text-foreground">
          {typeTitle}
        </h3>
      </div>
      <div
        class="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="sm:min-w-[5rem]"
          data-testid="add-secret-cancel-btn"
          onclick={handleCancel}
        >
          {vault.t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          class="sm:min-w-[5rem]"
          data-testid="save-secret-btn"
        >
          {#if isSaving}
            <RefreshCw class="size-4 animate-spin" />
          {/if}
          {saveLabel}
        </Button>
      </div>
    </div>

    {#if submitError}
      <p
        class="text-sm text-destructive"
        role="alert"
        data-testid="secret-form-error"
      >
        {submitError}
      </p>
    {/if}

    {#if selectedType === 'login'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('add_secret.website_label')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={websiteUrl}
          placeholder={vault.t('add_secret.placeholder_website')}
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('add_secret.website_label')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={websiteUrl}
          placeholder={vault.t('add_secret.placeholder_website')}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.api_key_website_hint')}
        </p>
      </div>
    {/if}

    {#if selectedType === 'login'}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="login-username"
            >{vault.t('vault.fields.username')}</label
          >
          <input
            id="login-username"
            data-testid="login-username"
            bind:value={username}
            autocomplete="username"
            required
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="secret-value"
            >{vault.t('vault.fields.password')}</label
          >
          <div class="relative">
            <input
              id="secret-value"
              type={showPasswordValue ? 'text' : 'password'}
              data-testid="secret-value"
              bind:value={password}
              autocomplete="new-password"
              required
              class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 py-2 pl-3 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={showPasswordValue
                ? vault.t('vault.hide_value')
                : vault.t('vault.show_value')}
              data-testid="toggle-password-visibility"
              onclick={() => (showPasswordValue = !showPasswordValue)}
            >
              {#if showPasswordValue}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="login-notes"
          >{vault.t('add_secret.notes_label')}</label
        >
        <textarea
          id="login-notes"
          data-testid="login-notes"
          bind:value={notes}
          rows="3"
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>

      <div
        class="rounded-xl border border-border/40 bg-muted/15 sm:border-border"
      >
        <button
          type="button"
          class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="password-generator-toggle"
          aria-expanded={showPasswordOptions}
          onclick={() => (showPasswordOptions = !showPasswordOptions)}
        >
          <span class="inline-flex items-center gap-2">
            <KeyRound class="size-4" />
            {vault.t('add_secret.generate_password')}
          </span>
          <ChevronDown
            class="size-4 transition-transform {showPasswordOptions
              ? 'rotate-180'
              : ''}"
          />
        </button>
        {#if showPasswordOptions}
          <div
            class="space-y-3 border-t border-border/35 px-4 py-3 sm:border-border"
          >
            <div class="flex items-center gap-3">
              <label class="text-xs text-muted-foreground" for="password-length"
                >{vault.t('add_secret.length')}</label
              >
              <input
                id="password-length"
                type="range"
                min="8"
                max="64"
                bind:value={genLength}
                class="h-1 flex-1 accent-primary"
              />
              <span class="w-6 text-right text-xs">{genLength}</span>
            </div>
            <div class="grid grid-cols-4 gap-2 text-xs">
              <label
                ><input type="checkbox" bind:checked={genLowercase} /> a-z</label
              >
              <label
                ><input type="checkbox" bind:checked={genUppercase} /> A-Z</label
              >
              <label
                ><input type="checkbox" bind:checked={genNumbers} /> 0-9</label
              >
              <label
                ><input type="checkbox" bind:checked={genSymbols} />
                {vault.t('add_secret.symbols')}</label
              >
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="w-full"
              data-testid="generate-password-btn"
              onclick={generatePassword}
            >
              <RefreshCw class="size-3.5" />
              {vault.t('add_secret.generate_btn')}
            </Button>
          </div>
        {/if}
      </div>
    {:else if selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-value"
          >{vault.t('vault.fields.key')}</label
        >
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={apiKey}
          rows="4"
          placeholder={vault.t('add_secret.placeholder_key')}
          required
          spellcheck="false"
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="api-key-expiration"
          >{vault.t('vault.fields.expires')}</label
        >
        <input
          id="api-key-expiration"
          type="date"
          data-testid="api-key-expiration"
          bind:value={expiresAt}
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
    {:else if selectedType === 'seed-phrase'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('vault.fields.account')}</label
        >
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={accountName}
          placeholder="Main wallet"
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="space-y-1.5">
        <span class="text-xs font-medium"
          >{vault.t('vault.types.seed_phrase')}</span
        >
        <SeedPhraseGrid
          {vault}
          bind:value={seedPhrase}
          bind:valid={seedPhraseValid}
        />
      </div>
    {:else if selectedType === 'authenticator'}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-issuer"
            >{vault.t('vault.fields.issuer')}</label
          >
          <input
            id="authenticator-issuer"
            data-testid="authenticator-issuer"
            bind:value={authenticatorIssuer}
            placeholder={vault.t('add_secret.placeholder_issuer')}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="authenticator-account"
            >{vault.t('vault.fields.account')}</label
          >
          <input
            id="authenticator-account"
            data-testid="authenticator-account"
            bind:value={authenticatorAccount}
            placeholder={vault.t('add_secret.placeholder_authenticator_account')}
            class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
          />
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="authenticator-secret"
          >{vault.t('vault.fields.authenticator_secret')}</label
        >
        <textarea
          id="authenticator-secret"
          data-testid="authenticator-secret"
          bind:value={authenticatorSecret}
          rows="3"
          required
          spellcheck="false"
          placeholder={vault.t('add_secret.placeholder_authenticator_secret')}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
        <p class="text-xs text-muted-foreground text-pretty">
          {vault.t('add_secret.authenticator_secret_hint')}
        </p>
      </div>
    {:else}
      <div class="shrink-0 space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('vault.fields.title')}</label
        >
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={noteTitle}
          placeholder="Recovery instructions"
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-1.5">
        <span class="shrink-0 text-xs font-medium"
          >{vault.t('vault.fields.note')}
          <span class="text-muted-foreground">(Markdown)</span></span
        >
        <MarkdownEditor
          bind:value={noteBody}
          placeholder={vault.t('add_secret.placeholder_note')}
          fill
        />
      </div>
    {/if}
  </form>
{/if}
