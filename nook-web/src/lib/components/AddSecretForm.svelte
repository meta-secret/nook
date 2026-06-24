<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ArrowLeft,
    KeyRound,
    RefreshCw,
    ChevronDown,
    ChevronRight,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    createVaultItemRecord,
    type VaultItemInput,
    type VaultItemType,
  } from '$lib/nook'
  import MarkdownEditor from './MarkdownEditor.svelte'

  let {
    isSaving,
    onAddSecret,
    onGeneratePassword,
    onCancel,
  }: {
    isSaving: boolean
    onAddSecret: (
      id: string,
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
  } = $props()

  let selectedType = $state<VaultItemType | null>(null)
  let showPasswordOptions = $state(false)

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
    selectedType === 'login'
      ? 'New login'
      : selectedType === 'api-key'
        ? 'New API key'
        : selectedType === 'seed-phrase'
          ? 'New seed phrase'
          : selectedType === 'secure-note'
            ? 'New secure note'
            : 'Add item',
  )

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
  }

  function handleCancel() {
    resetForm()
    onCancel()
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!selectedType) return

    let item: VaultItemInput
    if (selectedType === 'login') {
      item = {
        type: 'login',
        websiteUrl: websiteUrl.trim(),
        username: username.trim(),
        password,
        notes: notes.trim(),
      }
    } else if (selectedType === 'api-key') {
      item = {
        type: 'api-key',
        websiteUrl: websiteUrl.trim(),
        key: apiKey,
        expiresAt,
      }
    } else if (selectedType === 'seed-phrase') {
      item = {
        type: 'seed-phrase',
        name: accountName.trim(),
        seed: seedPhrase.trim(),
      }
    } else {
      if (!noteBody.trim()) return
      item = {
        type: 'secure-note',
        title: noteTitle.trim(),
        note: noteBody,
      }
    }

    const record = createVaultItemRecord(item)
    await onAddSecret(record.id, record.type, record.data)
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

{#if selectedType === null}
  <div class="space-y-5">
    <div class="space-y-1">
      <h3 class="text-base font-semibold text-foreground">
        What are you saving?
      </h3>
      <p class="text-sm text-muted-foreground text-pretty">
        Choose a type — the form shows only the fields you need.
      </p>
    </div>
    <div class="space-y-2" data-testid="item-type-picker">
      <button
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border border-border bg-muted/15 p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
        data-testid="item-type-login"
        onclick={() => (selectedType = 'login')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-primary"
        >
          <Globe class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground">Login</span>
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >Website account</span
          >
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border border-border bg-muted/15 p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
        data-testid="item-type-api-key"
        onclick={() => (selectedType = 'api-key')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-primary"
        >
          <Braces class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >API key</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >Token or auth key</span
          >
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border border-border bg-muted/15 p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
        data-testid="item-type-seed-phrase"
        onclick={() => (selectedType = 'seed-phrase')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-primary"
        >
          <Sprout class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >Seed phrase</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >BIP39 recovery</span
          >
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border border-border bg-muted/15 p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
        data-testid="item-type-secure-note"
        onclick={() => (selectedType = 'secure-note')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-primary"
        >
          <StickyNote class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >Secure note</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >Private text (Markdown)</span
          >
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  </div>
{:else}
  <form onsubmit={handleSubmit} class="space-y-5">
    <div class="space-y-3">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => (selectedType = null)}
      >
        <ArrowLeft class="size-4" />
        Change type
      </button>
      <h3 class="text-base font-semibold text-foreground">{typeTitle}</h3>
    </div>

    {#if selectedType === 'login' || selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label">Website URL</label
        >
        <input
          id="secret-label"
          type="text"
          data-testid="secret-label"
          bind:value={websiteUrl}
          placeholder="https://example.com"
          required
          class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>
    {/if}

    {#if selectedType === 'login'}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="login-username"
            >Username</label
          >
          <input
            id="login-username"
            data-testid="login-username"
            bind:value={username}
            autocomplete="username"
            required
            class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium" for="secret-value">Password</label>
          <input
            id="secret-value"
            type="password"
            data-testid="secret-value"
            bind:value={password}
            autocomplete="new-password"
            required
            class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="login-notes"
          >Notes <span class="text-muted-foreground">(optional)</span></label
        >
        <textarea
          id="login-notes"
          data-testid="login-notes"
          bind:value={notes}
          rows="3"
          class="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>

      <div class="rounded-xl border border-border bg-muted/15">
        <button
          type="button"
          class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="password-generator-toggle"
          aria-expanded={showPasswordOptions}
          onclick={() => (showPasswordOptions = !showPasswordOptions)}
        >
          <span class="inline-flex items-center gap-2">
            <KeyRound class="size-4" /> Generate password
          </span>
          <ChevronDown
            class="size-4 transition-transform {showPasswordOptions
              ? 'rotate-180'
              : ''}"
          />
        </button>
        {#if showPasswordOptions}
          <div class="space-y-3 border-t border-border px-4 py-3">
            <div class="flex items-center gap-3">
              <label class="text-xs text-muted-foreground" for="password-length"
                >Length</label
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
                ><input type="checkbox" bind:checked={genSymbols} /> symbols</label
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
              <RefreshCw class="size-3.5" /> Generate
            </Button>
          </div>
        {/if}
      </div>
    {:else if selectedType === 'api-key'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-value">Key</label>
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={apiKey}
          rows="4"
          required
          spellcheck="false"
          class="flex w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="api-key-expiration"
          >Expiration <span class="text-muted-foreground">(optional)</span
          ></label
        >
        <input
          id="api-key-expiration"
          type="date"
          data-testid="api-key-expiration"
          bind:value={expiresAt}
          class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>
    {:else if selectedType === 'seed-phrase'}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label"
          >Account name</label
        >
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={accountName}
          placeholder="Main wallet"
          required
          class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-value">Seed phrase</label
        >
        <textarea
          id="secret-value"
          data-testid="secret-value"
          bind:value={seedPhrase}
          rows="5"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="Enter 12 or 24 words"
          class="flex w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>
    {:else}
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="secret-label">Title</label>
        <input
          id="secret-label"
          data-testid="secret-label"
          bind:value={noteTitle}
          placeholder="Recovery instructions"
          required
          class="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>
      <div class="space-y-1.5">
        <span class="text-xs font-medium"
          >Note <span class="text-muted-foreground">(Markdown)</span></span
        >
        <MarkdownEditor
          bind:value={noteBody}
          placeholder="Write anything — headings, lists, and code blocks are supported."
        />
      </div>
    {/if}

    <div
      class="flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end"
    >
      <Button
        type="button"
        variant="outline"
        class="sm:min-w-[7rem]"
        data-testid="add-secret-cancel-btn"
        onclick={handleCancel}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={isSaving}
        class="sm:min-w-[7rem]"
        data-testid="save-secret-btn"
      >
        {#if isSaving}
          <RefreshCw class="size-4 animate-spin" /> Saving…
        {:else}
          Save item
        {/if}
      </Button>
    </div>
  </form>
{/if}
