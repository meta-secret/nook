<script lang="ts">
  import {
    Search,
    Eye,
    EyeOff,
    Copy,
    Check,
    Trash2,
    KeyRound,
    Plus,
    RefreshCw,
    ChevronDown,
    Globe,
    Braces,
    Sprout,
    ArrowLeft,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import {
    createVaultItemRecord,
    parseVaultItem,
    vaultItemSecret,
    vaultItemTitle,
    type SecretRecord,
    type VaultItem,
    type VaultItemInput,
    type VaultItemType,
  } from '$lib/nook'

  let {
    isSaving,
    secrets = [] as SecretRecord[],
    onAddSecret,
    onDeleteSecret,
    onGeneratePassword,
  }: {
    isSaving: boolean
    secrets?: SecretRecord[]
    onAddSecret: (
      id: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>
    onDeleteSecret: (id: string) => Promise<void>
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string
  } = $props()

  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)
  let addSecretOpen = $state(false)
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

  let genLength = $state(20)
  let genUppercase = $state(true)
  let genLowercase = $state(true)
  let genNumbers = $state(true)
  let genSymbols = $state(true)

  const items = $derived(secrets.map(parseVaultItem))
  const filteredItems = $derived.by(() => {
    const needle = searchPattern.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => searchableText(item).includes(needle))
  })
  const groups = $derived([
    {
      type: 'login' as const,
      label: 'Logins',
      items: itemsForType('login'),
    },
    {
      type: 'api-key' as const,
      label: 'Tokens & API keys',
      items: itemsForType('api-key'),
    },
    {
      type: 'seed-phrase' as const,
      label: 'Seed phrases',
      items: itemsForType('seed-phrase'),
    },
  ])

  function searchableText(item: VaultItem): string {
    if (item.type === 'login') {
      return `${item.websiteUrl} ${item.username} ${item.notes}`.toLowerCase()
    }
    if (item.type === 'api-key') {
      return `${item.websiteUrl} ${item.expiresAt}`.toLowerCase()
    }
    return item.name.toLowerCase()
  }

  function itemsForType(type: VaultItemType): VaultItem[] {
    return filteredItems
      .filter((item) => item.type === type)
      .sort((a, b) => vaultItemTitle(a).localeCompare(vaultItemTitle(b)))
  }

  function resetAddForm() {
    selectedType = null
    websiteUrl = ''
    username = ''
    password = ''
    notes = ''
    apiKey = ''
    expiresAt = ''
    accountName = ''
    seedPhrase = ''
    showPasswordOptions = false
  }

  function openAddSecret() {
    resetAddForm()
    addSecretOpen = true
  }

  function closeAddSecret() {
    addSecretOpen = false
    resetAddForm()
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
    } else {
      item = {
        type: 'seed-phrase',
        name: accountName.trim(),
        seed: seedPhrase.trim(),
      }
    }

    const record = createVaultItemRecord(item)
    await onAddSecret(record.id, record.type, record.data)
    closeAddSecret()
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

  async function copyToClipboard(item: VaultItem) {
    await navigator.clipboard.writeText(vaultItemSecret(item))
    copiedKey = item.id
    setTimeout(() => {
      if (copiedKey === item.id) copiedKey = null
    }, 2000)
  }

  function toggleReveal(id: string) {
    revealSecrets = { ...revealSecrets, [id]: !revealSecrets[id] }
  }

  function itemSubtitle(item: VaultItem): string {
    if (item.type === 'login') return item.username || 'No username'
    if (item.type === 'api-key') {
      return item.expiresAt ? `Expires ${item.expiresAt}` : 'No expiration'
    }
    return 'BIP39 recovery phrase'
  }
</script>

<div class="animate-in fade-in duration-200" data-testid="vault-panel">
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-foreground">Vault</h2>
        <p class="text-xs text-muted-foreground">
          {items.length}
          {items.length === 1 ? 'item' : 'items'}
        </p>
      </div>
      {#if addSecretOpen}
        <Button
          size="sm"
          variant="outline"
          data-testid="add-secret-cancel-btn"
          onclick={closeAddSecret}
        >
          Cancel
        </Button>
      {:else}
        <Button size="sm" data-testid="add-secret-btn" onclick={openAddSecret}>
          <Plus class="size-3.5" />
          Add item
        </Button>
      {/if}
    </div>

    {#if addSecretOpen}
      <Card
        class="border-border bg-card animate-in fade-in slide-in-from-top-2 duration-200"
        data-testid="add-secret-panel"
      >
        <CardContent class="p-4">
          {#if selectedType === null}
            <div class="space-y-3">
              <div>
                <h3 class="text-sm font-semibold text-foreground">
                  What are you saving?
                </h3>
                <p class="text-xs text-muted-foreground">
                  Choose a type to see only the fields you need.
                </p>
              </div>
              <div
                class="grid gap-2 sm:grid-cols-3"
                data-testid="item-type-picker"
              >
                <button
                  type="button"
                  class="rounded-lg border border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  data-testid="item-type-login"
                  onclick={() => (selectedType = 'login')}
                >
                  <Globe class="mb-3 size-5 text-primary" />
                  <span class="block text-sm font-medium">Login</span>
                  <span class="mt-1 block text-[11px] text-muted-foreground"
                    >Website account</span
                  >
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  data-testid="item-type-api-key"
                  onclick={() => (selectedType = 'api-key')}
                >
                  <Braces class="mb-3 size-5 text-primary" />
                  <span class="block text-sm font-medium">API key</span>
                  <span class="mt-1 block text-[11px] text-muted-foreground"
                    >Token or auth key</span
                  >
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  data-testid="item-type-seed-phrase"
                  onclick={() => (selectedType = 'seed-phrase')}
                >
                  <Sprout class="mb-3 size-5 text-primary" />
                  <span class="block text-sm font-medium">Seed phrase</span>
                  <span class="mt-1 block text-[11px] text-muted-foreground"
                    >BIP39 recovery</span
                  >
                </button>
              </div>
            </div>
          {:else}
            <form onsubmit={handleSubmit} class="space-y-4">
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                onclick={() => (selectedType = null)}
              >
                <ArrowLeft class="size-3.5" />
                Change type
              </button>

              <div>
                <h3 class="text-sm font-semibold text-foreground">
                  {selectedType === 'login'
                    ? 'New login'
                    : selectedType === 'api-key'
                      ? 'New API key'
                      : 'New seed phrase'}
                </h3>
              </div>

              {#if selectedType === 'login' || selectedType === 'api-key'}
                <div class="space-y-1.5">
                  <label class="text-xs font-medium" for="secret-label"
                    >Website URL</label
                  >
                  <input
                    id="secret-label"
                    type="text"
                    data-testid="secret-label"
                    bind:value={websiteUrl}
                    placeholder="https://example.com"
                    required
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                </div>
              {/if}

              {#if selectedType === 'login'}
                <div class="grid gap-3 sm:grid-cols-2">
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
                      class="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div class="space-y-1.5">
                    <label class="text-xs font-medium" for="secret-value"
                      >Password</label
                    >
                    <input
                      id="secret-value"
                      type="password"
                      data-testid="secret-value"
                      bind:value={password}
                      autocomplete="new-password"
                      required
                      class="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-medium" for="login-notes"
                    >Notes <span class="text-muted-foreground">(optional)</span
                    ></label
                  >
                  <textarea
                    id="login-notes"
                    data-testid="login-notes"
                    bind:value={notes}
                    rows="2"
                    class="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  ></textarea>
                </div>

                <div class="rounded-lg border border-border bg-muted/20">
                  <button
                    type="button"
                    class="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    data-testid="password-generator-toggle"
                    aria-expanded={showPasswordOptions}
                    onclick={() => (showPasswordOptions = !showPasswordOptions)}
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <KeyRound class="size-3.5" /> Generate password
                    </span>
                    <ChevronDown
                      class="size-3.5 transition-transform {showPasswordOptions
                        ? 'rotate-180'
                        : ''}"
                    />
                  </button>
                  {#if showPasswordOptions}
                    <div class="space-y-3 border-t border-border p-3">
                      <div class="flex items-center gap-3">
                        <label
                          class="text-xs text-muted-foreground"
                          for="password-length">Length</label
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
                  <label class="text-xs font-medium" for="secret-value"
                    >Key</label
                  >
                  <textarea
                    id="secret-value"
                    data-testid="secret-value"
                    bind:value={apiKey}
                    rows="3"
                    required
                    spellcheck="false"
                    class="flex w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  ></textarea>
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-medium" for="api-key-expiration"
                    >Expiration <span class="text-muted-foreground"
                      >(optional)</span
                    ></label
                  >
                  <input
                    id="api-key-expiration"
                    type="date"
                    data-testid="api-key-expiration"
                    bind:value={expiresAt}
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                </div>
              {:else}
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
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-medium" for="secret-value"
                    >Seed phrase</label
                  >
                  <textarea
                    id="secret-value"
                    data-testid="secret-value"
                    bind:value={seedPhrase}
                    rows="4"
                    required
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Enter 12 or 24 words"
                    class="flex w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  ></textarea>
                </div>
              {/if}

              <div class="flex justify-end">
                <Button
                  type="submit"
                  disabled={isSaving}
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
        </CardContent>
      </Card>
    {/if}

    <div class="relative">
      <Search class="absolute left-3 top-3 size-4 text-muted-foreground/60" />
      <input
        type="search"
        bind:value={searchPattern}
        data-testid="search-secrets"
        placeholder="Search vault…"
        class="flex h-10 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
      />
    </div>

    {#if filteredItems.length === 0}
      <Card class="border-border bg-card">
        <CardContent
          class="space-y-2 p-10 text-center text-muted-foreground"
          data-testid="vault-empty-search"
        >
          <p>
            {items.length === 0 ? 'Your vault is empty.' : 'No items matched.'}
          </p>
          <p class="text-xs">
            {items.length === 0
              ? 'Add a login, API key, or seed phrase to get started.'
              : 'Try a different search term.'}
          </p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-5">
        {#each groups as group (group.type)}
          {#if group.items.length > 0}
            <section class="space-y-2" data-testid="vault-group-{group.type}">
              <div class="flex items-center gap-2 px-1">
                <h3
                  class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {group.label}
                </h3>
                <span class="text-[11px] text-muted-foreground/60"
                  >{group.items.length}</span
                >
              </div>
              <Card class="overflow-hidden border-border bg-card">
                <CardContent class="divide-y divide-border/60 p-0">
                  {#each group.items as item (item.id)}
                    <div
                      class="flex items-center gap-3 p-3 transition-colors hover:bg-accent/40 sm:p-4"
                      role="listitem"
                      data-testid="secret-row"
                    >
                      <div
                        class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
                      >
                        {#if item.type === 'login'}
                          <Globe class="size-4" />
                        {:else if item.type === 'api-key'}
                          <Braces class="size-4" />
                        {:else}
                          <Sprout class="size-4" />
                        {/if}
                      </div>
                      <div class="min-w-0 flex-1">
                        <h4
                          class="truncate text-sm font-semibold text-foreground"
                        >
                          {vaultItemTitle(item)}
                        </h4>
                        <p class="truncate text-xs text-muted-foreground">
                          {itemSubtitle(item)}
                        </p>
                        {#if revealSecrets[item.id]}
                          <code
                            class="mt-1 block break-all text-xs text-primary"
                            data-testid="revealed-secret"
                          >
                            {vaultItemSecret(item)}
                          </code>
                          {#if item.type === 'login' && item.notes}
                            <p
                              class="mt-2 whitespace-pre-wrap text-xs text-muted-foreground"
                            >
                              {item.notes}
                            </p>
                          {/if}
                        {:else}
                          <span
                            class="mt-1 block font-mono text-xs tracking-wider text-muted-foreground/40"
                          >
                            ••••••••••••••••
                          </span>
                        {/if}
                      </div>
                      <div class="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onclick={() => toggleReveal(item.id)}
                          aria-label={revealSecrets[item.id]
                            ? 'Hide secret'
                            : 'Show secret'}
                          class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {#if revealSecrets[item.id]}<EyeOff
                              class="size-4"
                            />{:else}<Eye class="size-4" />{/if}
                        </button>
                        <button
                          type="button"
                          onclick={() => void copyToClipboard(item)}
                          aria-label="Copy secret"
                          class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {#if copiedKey === item.id}<Check
                              class="size-4 text-emerald-500"
                            />{:else}<Copy class="size-4" />{/if}
                        </button>
                        <button
                          type="button"
                          onclick={() => void onDeleteSecret(item.id)}
                          aria-label="Delete item"
                          class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 class="size-4" />
                        </button>
                      </div>
                    </div>
                  {/each}
                </CardContent>
              </Card>
            </section>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
