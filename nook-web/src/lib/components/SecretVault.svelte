<script lang="ts">
  import {
    Search,
    Lock,
    Unlock,
    Eye,
    EyeOff,
    Copy,
    Check,
    Trash2,
    KeyRound,
    Plus,
    RefreshCw,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { SecretRecord } from '$lib/nook'

  let {
    secrets,
    isAuthenticated,
    isSaving,
    onAddSecret,
    onDeleteSecret,
    onGoToAuth,
  }: {
    secrets: SecretRecord[]
    isAuthenticated: boolean
    isSaving: boolean
    onAddSecret: (key: string, value: string) => Promise<void>
    onDeleteSecret: (key: string) => Promise<void>
    onGoToAuth: () => void
  } = $props()

  // Svelte 5 Local states
  let newKey = $state('')
  let newValue = $state('')
  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)

  // Password Generator states
  let genLength = $state(16)
  let genUppercase = $state(true)
  let genLowercase = $state(true)
  let genNumbers = $state(true)
  let genSymbols = $state(true)

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!newKey || !newValue) return
    await onAddSecret(newKey, newValue)
    newKey = ''
    newValue = ''
  }

  function generatePassword() {
    let chars = ''
    if (genLowercase) chars += 'abcdefghijklmnopqrstuvwxyz'
    if (genUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if (genNumbers) chars += '0123456789'
    if (genSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'

    if (!chars) return

    let result = ''
    const array = new Uint32Array(genLength)
    window.crypto.getRandomValues(array)
    for (let i = 0; i < genLength; i++) {
      result += chars[array[i] % chars.length]
    }
    newValue = result
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

  // Derived filtered secrets
  let filteredSecrets = $derived(
    secrets.filter((s) =>
      s.key.toLowerCase().includes(searchPattern.toLowerCase()),
    ),
  )
</script>

<div class="animate-in fade-in duration-200">
  {#if !isAuthenticated}
    <!-- Unauthenticated Vault Lock View -->
    <div
      class="flex flex-col items-center justify-center border border-border bg-card rounded-xl p-16 text-center max-w-2xl mx-auto space-y-6"
      data-testid="vault-locked"
    >
      <div
        class="p-4 bg-accent text-accent-foreground rounded-full border border-border"
      >
        <Lock class="size-12" />
      </div>
      <div class="space-y-2">
        <h2 class="text-2xl font-bold text-foreground">Vault is Locked</h2>
        <p class="text-muted-foreground max-w-md">
          Select a storage provider and connect your vault under the Auth &
          Storage tab to unlock.
        </p>
      </div>
      <Button
        onclick={onGoToAuth}
        class="bg-primary hover:bg-primary/90 text-primary-foreground"
        data-testid="go-to-setup-btn"
      >
        Configure Storage Provider
      </Button>
    </div>
  {:else}
    <!-- Authenticated Vault Interface -->
    <div class="grid gap-6 lg:grid-cols-3" data-testid="vault-panel">
      <!-- Left panel: Add Secret & Generator -->
      <div class="space-y-6">
        <!-- Add Secret Form -->
        <Card class="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle class="text-foreground text-base"
              >Add New Secret</CardTitle
            >
            <CardDescription class="text-muted-foreground"
              >Insert or update a key/value pair in your encrypted database.</CardDescription
            >
          </CardHeader>
          <CardContent>
            <form onsubmit={handleSubmit} class="space-y-4">
              <div class="space-y-2">
                <label
                  class="text-xs font-semibold text-muted-foreground"
                  for="secret-label">Label / Identifier</label
                >
                <input
                  id="secret-label"
                  type="text"
                  data-testid="secret-label"
                  bind:value={newKey}
                  placeholder="e.g. github.com (personal)"
                  required
                  class="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
              </div>

              <div class="space-y-2">
                <label
                  class="text-xs font-semibold text-muted-foreground"
                  for="secret-value">Secret Value / Password</label
                >
                <input
                  id="secret-value"
                  type="text"
                  data-testid="secret-value"
                  bind:value={newValue}
                  placeholder="Enter secret text"
                  required
                  class="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button
                type="submit"
                class="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={isSaving}
                data-testid="save-secret-btn"
              >
                {#if isSaving}
                  <RefreshCw class="size-4 animate-spin mr-2" />
                  Saving...
                {:else}
                  <Plus class="size-4 mr-2" />
                  Save Secret
                {/if}
              </Button>
            </form>
          </CardContent>
        </Card>

        <!-- Password Generator -->
        <Card class="bg-card text-card-foreground border-border">
          <CardHeader class="pb-3">
            <CardTitle
              class="text-foreground text-base flex items-center gap-2"
            >
              <KeyRound class="size-4 text-primary" />
              Password Generator
            </CardTitle>
            <CardDescription class="text-muted-foreground"
              >Generate a cryptographically secure random password.</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-1.5">
              <div
                class="flex items-center justify-between text-xs font-semibold text-muted-foreground"
              >
                <span>Length</span>
                <span class="text-primary font-bold">{genLength} chars</span>
              </div>
              <input
                type="range"
                min="8"
                max="64"
                bind:value={genLength}
                class="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              <label
                class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  bind:checked={genLowercase}
                  class="rounded-sm border-border text-primary bg-background focus:ring-0"
                />
                a-z (lowercase)
              </label>
              <label
                class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  bind:checked={genUppercase}
                  class="rounded-sm border-border text-primary bg-background focus:ring-0"
                />
                A-Z (uppercase)
              </label>
              <label
                class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  bind:checked={genNumbers}
                  class="rounded-sm border-border text-primary bg-background focus:ring-0"
                />
                0-9 (numbers)
              </label>
              <label
                class="flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  bind:checked={genSymbols}
                  class="rounded-sm border-border text-primary bg-background focus:ring-0"
                />
                !@#$ (symbols)
              </label>
            </div>

            <Button
              variant="outline"
              onclick={generatePassword}
              class="w-full border-border text-foreground hover:bg-accent mt-2"
              data-testid="generate-password-btn"
            >
              <RefreshCw class="size-3.5 mr-2" />
              Generate & Populate
            </Button>
          </CardContent>
        </Card>
      </div>

      <!-- Right panel: Vault Secrets List -->
      <div class="lg:col-span-2 space-y-4">
        <!-- Search Bar -->
        <div class="relative">
          <Search
            class="absolute left-3 top-3 size-4 text-muted-foreground/60"
          />
          <input
            type="text"
            bind:value={searchPattern}
            data-testid="search-secrets"
            placeholder="Search labels..."
            class="flex h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>

        <!-- List Card -->
        <Card class="bg-card text-card-foreground border-border">
          <CardContent class="p-0">
            {#if filteredSecrets.length === 0}
              <div
                class="p-12 text-center text-muted-foreground space-y-2"
                data-testid="vault-empty-search"
              >
                <Unlock class="size-8 mx-auto text-muted-foreground/40" />
                <p>No secrets matched your search.</p>
                <p class="text-xs">
                  Add new secrets on the left to fill your secure vault.
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
                      <h3
                        class="text-sm font-semibold text-foreground truncate"
                      >
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
                      <!-- Toggle reveal -->
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

                      <!-- Copy to clipboard -->
                      <button
                        onclick={() =>
                          copyToClipboard(secret.value, secret.key)}
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

                      <!-- Delete -->
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
  {/if}
</div>
