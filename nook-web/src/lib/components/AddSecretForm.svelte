<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ArrowLeft,
    KeyRound,
    RefreshCw,
    Eye,
    EyeOff,
    ChevronDown,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    createVaultItemRecord,
    vaultItemDataYaml,
    type VaultItem,
    type VaultItemInput,
    type VaultItemType,
  } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import MarkdownEditor from './MarkdownEditor.svelte'

  let {
    vault,
    isSaving,
    onAddSecret,
    onReplaceSecret,
    onGeneratePassword,
    onCancel,
    initialItem = null,
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
    initialItem?: VaultItem | null
  } = $props()

  const isEditMode = $derived(initialItem !== null)

  let selectedType = $state<VaultItemType | null>(null)
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
  let noteTitle = $state('')
  let noteBody = $state('')

  let genLength = $state(20)
  let genUppercase = $state(true)
  let genLowercase = $state(true)
  let genNumbers = $state(true)
  let genSymbols = $state(true)

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
              : vault.t('add_secret.title_edit_item')
      : selectedType === 'login'
        ? vault.t('add_secret.title_new_login')
        : selectedType === 'api-key'
          ? vault.t('add_secret.title_new_api_key')
          : selectedType === 'seed-phrase'
            ? vault.t('add_secret.title_new_seed_phrase')
            : selectedType === 'secure-note'
              ? vault.t('add_secret.title_new_secure_note')
              : vault.t('add_secret.title_add_item'),
  )

  $effect(() => {
    const item = initialItem
    if (!item) return
    selectedType = item.type
    if (item.type === 'login') {
      websiteUrl = item.websiteUrl
      username = item.username
      password = item.password
      notes = item.notes ?? ''
    } else if (item.type === 'api-key') {
      websiteUrl = item.websiteUrl
      apiKey = item.key
      expiresAt = item.expiresAt ?? ''
    } else if (item.type === 'seed-phrase') {
      accountName = item.name
      seedPhrase = item.seed
    } else {
      noteTitle = item.title
      noteBody = item.note
    }
  })

  function buildItem(): VaultItemInput {
    if (selectedType === 'login') {
      return {
        type: 'login',
        websiteUrl: websiteUrl.trim(),
        username: username.trim(),
        password,
        notes: notes.trim(),
      }
    }
    if (selectedType === 'api-key') {
      return {
        type: 'api-key',
        websiteUrl: websiteUrl.trim(),
        key: apiKey,
        expiresAt,
      }
    }
    if (selectedType === 'seed-phrase') {
      return {
        type: 'seed-phrase',
        name: accountName.trim(),
        seed: seedPhrase.trim(),
      }
    }
    return {
      type: 'secure-note',
      title: noteTitle.trim(),
      note: noteBody,
    }
  }

  function resetForm() {
    selectedType = null
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

    const item = buildItem()
    if (selectedType === 'secure-note' && !noteBody.trim()) return

    if (isEditMode && initialItem && onReplaceSecret) {
      await onReplaceSecret(
        initialItem.id,
        selectedType,
        vaultItemDataYaml(item),
      )
    } else {
      const record = createVaultItemRecord(item)
      await onAddSecret(record.id, record.type, record.data)
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
</script>

{#if selectedType === null && !isEditMode}
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
    </div>
  </div>
{:else}
  <form
    onsubmit={handleSubmit}
    class="space-y-5"
    data-testid={isEditMode ? 'edit-secret-form' : undefined}
  >
    <div class="space-y-3">
      {#if !isEditMode}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          onclick={() => (selectedType = null)}
        >
          <ArrowLeft class="size-4" />
          {vault.t('add_secret.change_type')}
        </button>
      {/if}
      <h3 class="text-base font-semibold text-foreground">{typeTitle}</h3>
    </div>

    {#if selectedType === 'login' || selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >{vault.t('add_secret.website_label')}</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={websiteUrl}
          placeholder="https://example.com"
          required
          class="flex h-10 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
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
        <label class="text-xs font-medium" for="secret-value"
          >{vault.t('vault.types.seed_phrase')}</label
        >
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={seedPhrase}
          rows="5"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder={vault.t('add_secret.placeholder_seed')}
          class="flex w-full rounded-md border border-border/45 bg-background/80 px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        ></textarea>
      </div>
    {:else}
      <div class="space-y-1.5">
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
      <div class="space-y-1.5">
        <span class="text-xs font-medium"
          >{vault.t('vault.fields.note')}
          <span class="text-muted-foreground">(Markdown)</span></span
        >
        <MarkdownEditor
          bind:value={noteBody}
          placeholder={vault.t('add_secret.placeholder_note')}
        />
      </div>
    {/if}

    <div
      class="flex flex-col-reverse gap-2 border-t border-border/35 pt-4 sm:flex-row sm:justify-end sm:border-border/60"
    >
      <Button
        type="button"
        variant="outline"
        class="sm:min-w-[7rem]"
        data-testid="add-secret-cancel-btn"
        onclick={handleCancel}
      >
        {vault.t('common.cancel')}
      </Button>
      <Button
        type="submit"
        disabled={isSaving}
        class="sm:min-w-[7rem]"
        data-testid="save-secret-btn"
      >
        {#if isSaving}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t('add_secret.working')}
        {:else}
          {isEditMode
            ? vault.t('add_secret.save_changes')
            : vault.t('add_secret.save_item')}
        {/if}
      </Button>
    </div>
  </form>
{/if}
