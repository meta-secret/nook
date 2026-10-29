<!--
What the passkey is for, drawn small: the passkey opens the identity, and
the identity holds the vaults. The passkey, made on this step, is filled in.
-->
<script lang="ts">
  import type { Component } from 'svelte'
  import { ChevronRight, Fingerprint, UserRound, Vault } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()

  /** One box of the diagram. */
  type KeyNode = {
    readonly icon: Component
    readonly label: string
    readonly testId: string
    readonly current: boolean
  }

  const passkey = $derived<KeyNode>({
    icon: Fingerprint,
    label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
    testId: 'first-run-diagram-passkey',
    current: true,
  })
  const identity = $derived<KeyNode>({
    icon: UserRound,
    label: vault.t(I18N_KEYS.FirstRunDiagramIdentity),
    testId: 'first-run-diagram-identity',
    current: false,
  })
  const vaults = $derived<KeyNode>({
    icon: Vault,
    label: vault.t(I18N_KEYS.FirstRunDiagramVaults),
    testId: 'first-run-diagram-vaults',
    current: false,
  })
</script>

{#snippet node(box: KeyNode)}
  <div class="flex w-11 flex-col items-center gap-2">
    <span
      class="grid size-11 shrink-0 place-items-center border {box.current
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground'}"
      data-testid={box.testId}
      {...box.current ? { 'aria-current': 'step' } : {}}
    >
      <box.icon class="size-5" aria-hidden="true" />
    </span>
    <span
      class="w-24 shrink-0 text-center text-[11px] leading-tight {box.current
        ? 'font-semibold text-foreground'
        : 'text-muted-foreground'}"
    >
      {box.label}
    </span>
  </div>
{/snippet}

{#snippet link()}
  <span
    class="mt-[1.375rem] flex -translate-y-1/2 items-center text-muted-foreground"
    aria-hidden="true"
  >
    <span class="h-px flex-1 border-t border-dashed border-border"></span>
    <ChevronRight class="-ml-1 size-3.5" />
  </span>
{/snippet}

<figure
  class="m-0 grid grid-cols-[auto_minmax(1.5rem,1fr)_auto_minmax(1.5rem,1fr)_auto] items-start gap-x-2 px-8"
  aria-label={vault.t(I18N_KEYS.FirstRunDiagramLabel)}
  data-testid="first-run-key-diagram"
>
  {@render node(passkey)}
  {@render link()}
  {@render node(identity)}
  {@render link()}
  {@render node(vaults)}
</figure>
