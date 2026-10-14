<!--
Joining, drawn small: the device that has the identity, the sync provider
that carries the encrypted vaults, and the device that joins. The reader's
own device is filled in.
-->
<script lang="ts">
  import { ChevronRight, Cloud, Laptop, MonitorSmartphone } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { JoinNodeKind, JoinSide } from "./join-flow";

  let { vault, side }: { vault: VaultState; side: JoinSide } = $props();

  const hereKind = $derived(
    side === JoinSide.Inviting ? JoinNodeKind.Member : JoinNodeKind.Joiner,
  );
  const memberLabel = $derived(
    side === JoinSide.Inviting
      ? vault.t(I18N_KEYS.JoinThisDevice)
      : vault.t(I18N_KEYS.JoinNodeMember),
  );
  const joinerLabel = $derived(
    side === JoinSide.Joining
      ? vault.t(I18N_KEYS.JoinThisDevice)
      : vault.t(I18N_KEYS.JoinNodeJoiner),
  );
</script>

{#snippet node(kind: JoinNodeKind, text: string)}
  {@const here = kind === hereKind}
  <div class="flex w-11 flex-col items-center gap-2">
    <span
      class="grid size-11 shrink-0 place-items-center border {here
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground'}"
      data-testid="join-diagram-{kind}"
      {...here ? { "aria-current": "true" } : {}}
    >
      {#if kind === JoinNodeKind.Member}
        <Laptop class="size-5" aria-hidden="true" />
      {:else if kind === JoinNodeKind.Provider}
        <Cloud class="size-5" aria-hidden="true" />
      {:else}
        <MonitorSmartphone class="size-5" aria-hidden="true" />
      {/if}
    </span>
    <span
      class="w-24 shrink-0 text-center text-[11px] leading-tight {here
        ? 'font-semibold text-foreground'
        : 'text-muted-foreground'}"
    >
      {text}
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
  aria-label={vault.t(I18N_KEYS.JoinDiagramLabel)}
  data-testid="join-diagram"
>
  {@render node(JoinNodeKind.Member, memberLabel)}
  {@render link()}
  {@render node(JoinNodeKind.Provider, vault.t(I18N_KEYS.JoinNodeProvider))}
  {@render link()}
  {@render node(JoinNodeKind.Joiner, joinerLabel)}
</figure>
