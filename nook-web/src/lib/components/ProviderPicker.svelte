<script lang="ts">
  import { Cloud, HardDrive } from '@lucide/svelte'
  import type { StorageProviderType } from '$lib/auth-providers'

  let { onSelect }: { onSelect: (type: StorageProviderType) => void } = $props()
</script>

<fieldset class="space-y-2">
  <legend class="sr-only">Choose a storage provider</legend>
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
          <span class="block text-sm font-medium text-foreground"
            >This device</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            Encrypted vault in browser storage — no provider login
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
          <span class="block text-sm font-medium text-foreground">GitHub</span>
          <span class="block truncate text-xs text-muted-foreground">
            Sign in to GitHub — sync encrypted vault to your repo
          </span>
        </span>
      </button>
    </li>
  </ul>
</fieldset>
