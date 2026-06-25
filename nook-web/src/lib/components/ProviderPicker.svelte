<script lang="ts">
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
