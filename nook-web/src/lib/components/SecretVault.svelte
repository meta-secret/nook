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
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import type { SecretRecord } from '$lib/nook'

  let {
    isSaving,
    secretsCount,
    storageMode,
    onAddSecret,
    onDeleteSecret,
    onFilterSecrets,
    onGeneratePassword,
  }: {
    isSaving: boolean
    secretsCount: number
    storageMode: 'local' | 'github'
    onAddSecret: (key: string, value: string) => Promise<void>
    onDeleteSecret: (key: string) => Promise<void>
    onFilterSecrets: (query: string) => SecretRecord[]
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string
  } = $props()

  let newKey = $state('')
  let newValue = $state('')
  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)
  let addSecretOpen = $state(false)
  let showPasswordOptions = $state(false)

  let genLength = $state(16)
  let genUppercase = $state(true)
  let genLowercase = $state(true)
  let genNumbers = $state(true)
  let genSymbols = $state(true)

  function resetAddForm() {
    newKey = ''
    newValue = ''
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
    await onAddSecret(newKey, newValue)
    closeAddSecret()
  }

  function generatePassword() {
    try {
      newValue = onGeneratePassword(
        genLength,
        genLowercase,
        genUppercase,
        genNumbers,
        genSymbols,
      )
    } catch (err) {
      console.error('Password generation failed:', err)
    }
  }

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = key
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null
      }, 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  function toggleReveal(key: string) {
    revealSecrets = {
      ...revealSecrets,
      [key]: !revealSecrets[key],
    }
  }

  let filteredSecrets = $derived.by(() => {
    void secretsCount
    return onFilterSecrets(searchPattern)
  })
</script>

<div class="animate-in fade-in duration-200" data-testid="vault-panel">
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">
        Syncing via
        <span class="font-medium text-foreground"
          >{storageMode === 'github' ? 'GitHub' : 'local storage'}</span
        >
      </p>
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
          <Plus class="size-3.5 mr-1.5" />
          Add secret
        </Button>
      {/if}
    </div>

    {#if addSecretOpen}
      <Card
        class="border-border bg-card animate-in fade-in slide-in-from-top-2 duration-200"
        data-testid="add-secret-panel"
      >
        <form onsubmit={handleSubmit}>
          <CardContent class="space-y-4 p-4">
            <div class="space-y-2">
              <label
                class="text-xs font-medium text-muted-foreground"
                for="secret-label">Label</label
              >
              <input
                id="secret-label"
                type="text"
                data-testid="secret-label"
                bind:value={newKey}
                placeholder="e.g. github.com (personal)"
                required
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            <div class="space-y-2">
              <label
                class="text-xs font-medium text-muted-foreground"
                for="secret-value">Value</label
              >
              <input
                id="secret-value"
                type="text"
                data-testid="secret-value"
                bind:value={newValue}
                placeholder="Enter secret text"
                required
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            <div class="rounded-lg border border-border bg-muted/20">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                data-testid="password-generator-toggle"
                aria-expanded={showPasswordOptions}
                onclick={() => (showPasswordOptions = !showPasswordOptions)}
              >
                <span class="inline-flex items-center gap-1.5">
                  <KeyRound class="size-3.5" />
                  Generate password
                </span>
                <ChevronDown
                  class="size-3.5 shrink-0 transition-transform {showPasswordOptions
                    ? 'rotate-180'
                    : ''}"
                />
              </button>

              {#if showPasswordOptions}
                <div
                  class="space-y-3 border-t border-border px-3 py-3 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <div class="space-y-1.5">
                    <div
                      class="flex items-center justify-between text-xs font-medium text-muted-foreground"
                    >
                      <span>Length</span>
                      <span class="text-primary">{genLength}</span>
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="64"
                      bind:value={genLength}
                      class="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <label
                      class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genLowercase}
                        class="rounded-sm border-border text-primary bg-background focus:ring-0"
                      />
                      a-z
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genUppercase}
                        class="rounded-sm border-border text-primary bg-background focus:ring-0"
                      />
                      A-Z
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genNumbers}
                        class="rounded-sm border-border text-primary bg-background focus:ring-0"
                      />
                      0-9
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genSymbols}
                        class="rounded-sm border-border text-primary bg-background focus:ring-0"
                      />
                      symbols
                    </label>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onclick={generatePassword}
                    class="w-full border-border"
                    data-testid="generate-password-btn"
                  >
                    <RefreshCw class="size-3.5 mr-1.5" />
                    Generate
                  </Button>
                </div>
              {/if}
            </div>

            <div class="flex justify-end pt-1">
              <Button
                type="submit"
                disabled={isSaving}
                data-testid="save-secret-btn"
              >
                {#if isSaving}
                  <RefreshCw class="size-4 animate-spin mr-2" />
                  Saving...
                {:else}
                  Save secret
                {/if}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>
    {/if}

    <div class="relative">
      <Search class="absolute left-3 top-3 size-4 text-muted-foreground/60" />
      <input
        type="text"
        bind:value={searchPattern}
        data-testid="search-secrets"
        placeholder="Search labels..."
        class="flex h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
      />
    </div>

    <Card class="bg-card text-card-foreground border-border">
      <CardContent class="p-0">
        {#if filteredSecrets.length === 0}
          <div
            class="p-10 text-center text-muted-foreground space-y-2"
            data-testid="vault-empty-search"
          >
            <p>No secrets matched your search.</p>
            <p class="text-xs">
              {#if secretsCount === 0}
                Use <span class="text-foreground">Add secret</span> to store your
                first credential.
              {:else}
                Try a different search term.
              {/if}
            </p>
          </div>
        {:else}
          <div class="divide-y divide-border/60" role="list">
            {#each filteredSecrets as secret (secret.key)}
              <div
                class="flex items-center justify-between p-4 hover:bg-accent/40 transition-colors"
                role="listitem"
                data-testid="secret-row"
              >
                <div class="space-y-1 pr-4 min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-foreground truncate">
                    {secret.key}
                  </h3>
                  <div class="flex items-center gap-2">
                    {#if revealSecrets[secret.key]}
                      <code
                        class="text-xs font-mono text-primary break-all select-all"
                        >{secret.value}</code
                      >
                    {:else}
                      <span
                        class="text-xs font-mono text-muted-foreground/40 tracking-wider"
                        >••••••••••••••••</span
                      >
                    {/if}
                  </div>
                </div>

                <div class="flex items-center gap-1.5">
                  <button
                    onclick={() => toggleReveal(secret.key)}
                    aria-label={revealSecrets[secret.key]
                      ? 'Hide password'
                      : 'Show password'}
                    class="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                  >
                    {#if revealSecrets[secret.key]}
                      <EyeOff class="size-4" />
                    {:else}
                      <Eye class="size-4" />
                    {/if}
                  </button>

                  <button
                    onclick={() => copyToClipboard(secret.value, secret.key)}
                    aria-label="Copy password to clipboard"
                    class="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors relative"
                  >
                    {#if copiedKey === secret.key}
                      <Check
                        class="size-4 text-emerald-500 animate-in zoom-in duration-200"
                      />
                    {:else}
                      <Copy class="size-4" />
                    {/if}
                  </button>

                  <button
                    onclick={() => onDeleteSecret(secret.key)}
                    aria-label="Delete secret"
                    class="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <Trash2 class="size-4" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
  </div>
</div>
