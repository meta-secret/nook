<script lang="ts">
  import {
    AppWindow,
    ArrowRight,
    ChevronDown,
    ChevronRight,
    Folder,
    LockKeyhole,
    Server,
    Vault,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()
</script>

<div class="grid gap-2">
  <figure
    class="m-0"
    aria-label={vault.t(I18N_KEYS.FirstRunLocalFirstDiagramDescription)}
  >
    <div
      aria-hidden="true"
      class="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] items-center"
    >
      <div
        class="overflow-hidden rounded-md border border-foreground/40 bg-card"
        data-testid="local-vault-browser"
      >
        <div
          class="flex items-center gap-1.5 border-b border-border bg-muted px-2 py-1.5"
        >
          <AppWindow class="size-3 shrink-0 text-muted-foreground" />
          <span class="text-xs font-medium text-foreground">
            {vault.t(I18N_KEYS.FirstRunLocalFirstBrowser)}
          </span>
        </div>
        <div
          class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 py-3"
        >
          <Vault class="size-7 shrink-0 text-foreground" />
          <span class="text-center text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.FirstRunLocalFirstVault)}
          </span>
        </div>
      </div>
      <div
        class="grid min-w-0 justify-items-center gap-1.5 text-muted-foreground"
      >
        <span class="px-1 text-center text-xs leading-tight text-balance">
          {vault.t(I18N_KEYS.FirstRunLocalFirstOptionalSync)}
        </span>
        <span
          class="relative mx-1.5 justify-self-stretch border-t border-dashed border-muted-foreground"
        >
          <LockKeyhole
            class="absolute -top-px left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 bg-background px-px"
          />
          <ChevronRight
            class="absolute -top-px -right-1 size-3 -translate-y-1/2"
          />
        </span>
      </div>
      <div
        class="grid justify-items-center gap-1 px-1 text-center text-muted-foreground"
      >
        <Folder class="size-7" />
        <span class="text-xs leading-tight font-medium">
          {vault.t(I18N_KEYS.FirstRunLocalFirstStorage)}
        </span>
      </div>
    </div>
  </figure>

  <details class="group">
    <summary
      class="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
    >
      <Server class="size-3.5 shrink-0" aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunLocalFirstSelfHost)}
      <ChevronDown
        class="size-3.5 shrink-0 group-open:rotate-180"
        aria-hidden="true"
      />
    </summary>
    <figure
      aria-label={vault.t(I18N_KEYS.FirstRunLocalFirstHostingDescription)}
      class="m-0 border-l border-border pl-3"
    >
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-foreground"
        aria-hidden="true"
      >
        <Server class="size-4" />
        {vault.t(I18N_KEYS.FirstRunLocalFirstServer)}
        <ArrowRight class="size-3.5 text-muted-foreground" />
        <AppWindow class="size-4" />
        {vault.t(I18N_KEYS.FirstRunLocalFirstBrowserApp)}
      </div>
    </figure>
  </details>
</div>
