<script lang="ts">
  import { onMount } from 'svelte'
  import { Cloud, HardDrive } from '@lucide/svelte'
  import type { StorageProviderType } from '$lib/auth-providers'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onSelect,
  }: {
    vault: VaultState
    onSelect: (type: StorageProviderType) => void
  } = $props()
</script>

<fieldset class="space-y-2">
  <legend class="sr-only">{vault.t('provider_picker.choose_provider')}</legend>
  <ul class="space-y-1.5" data-testid="provider-picker-list">
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-local"
        onclick={() => onSelect('local')}
      >
        <HardDrive class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('provider_picker.this_device')}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {vault.t('provider_picker.this_device_desc')}
          </span>
        </span>
      </button>
    </li>
    {#if vault.googleOAuthAvailable}
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
          data-testid="provider-option-oauth-file"
          onclick={() => onSelect('oauth-file')}
        >
          <svg
            class="size-4 shrink-0 text-foreground"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-foreground"
              >{vault.t('provider_picker.google_drive')}</span
            >
            <span class="block truncate text-xs text-muted-foreground">
              {vault.t('provider_picker.google_drive_desc')}
            </span>
          </span>
        </button>
      </li>
    {/if}
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-github"
        onclick={() => onSelect('github')}
      >
        <Cloud class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('provider_picker.github')}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {vault.t('provider_picker.github_desc')}
          </span>
        </span>
      </button>
    </li>
  </ul>
</fieldset>
