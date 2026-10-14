<!--
What joining a device means, drawn: the device that already has the
identity syncs its encrypted vaults to a sync provider, and the new device
downloads them from there. The reader's own device is marked "You are here";
the invite and approval pass directly between the two devices.
-->
<script lang="ts">
  import {
    ArrowDown,
    ArrowRight,
    Cloud,
    Laptop,
    Link2,
    MonitorSmartphone,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { JoinNodeKind, JoinSide } from "./join-flow";

  let { vault, side }: { vault: VaultState; side: JoinSide } = $props();

  const memberHere = $derived(side === JoinSide.Inviting);
  const joinerHere = $derived(side === JoinSide.Joining);
</script>

{#snippet arrow(label: string)}
  <div
    class="flex flex-col items-center justify-center gap-1 py-1 text-muted-foreground md:px-1"
    aria-hidden="true"
  >
    <span class="font-mono text-[10px] tracking-[0.06em] uppercase">
      {label}
    </span>
    <ArrowRight class="hidden size-4 md:block" />
    <ArrowDown class="size-4 md:hidden" />
  </div>
{/snippet}

{#snippet node(
  title: string,
  detail: string,
  here: boolean,
  kind: JoinNodeKind,
)}
  <div
    class="relative flex min-w-0 items-center gap-3 border p-3 md:flex-col md:items-start md:p-4 {here
      ? 'border-foreground bg-card'
      : 'border-border bg-background/40'}"
    data-testid="join-diagram-{kind}"
    {...here ? { "aria-current": "true" } : {}}
  >
    {#if here}
      <span
        class="absolute -top-2.5 right-3 bg-foreground px-1.5 font-mono text-[10px] leading-5 tracking-[0.06em] text-background uppercase"
      >
        {vault.t(I18N_KEYS.JoinYouAreHere)}
      </span>
    {/if}
    <span class="nk-tile shrink-0" aria-hidden="true">
      {#if kind === JoinNodeKind.Member}
        <Laptop class="size-4" />
      {:else if kind === JoinNodeKind.Provider}
        <Cloud class="size-4" />
      {:else}
        <MonitorSmartphone class="size-4" />
      {/if}
    </span>
    <span class="min-w-0">
      <span class="block text-sm font-semibold text-foreground">{title}</span>
      <span class="block text-xs text-pretty text-muted-foreground">
        {detail}
      </span>
    </span>
  </div>
{/snippet}

<figure
  class="m-0 grid gap-3"
  aria-label={vault.t(I18N_KEYS.JoinDiagramLabel)}
  data-testid="join-diagram"
>
  <div
    class="grid grid-cols-1 items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]"
  >
    {@render node(
      memberHere
        ? vault.t(I18N_KEYS.JoinThisDevice)
        : vault.t(I18N_KEYS.JoinNodeMember),
      vault.t(I18N_KEYS.JoinNodeMemberDetail),
      memberHere,
      JoinNodeKind.Member,
    )}
    {@render arrow(vault.t(I18N_KEYS.JoinArrowInvite))}
    {@render node(
      vault.t(I18N_KEYS.JoinNodeProvider),
      vault.t(I18N_KEYS.JoinNodeProviderDetail),
      false,
      JoinNodeKind.Provider,
    )}
    {@render arrow(vault.t(I18N_KEYS.JoinArrowDownload))}
    {@render node(
      joinerHere
        ? vault.t(I18N_KEYS.JoinThisDevice)
        : vault.t(I18N_KEYS.JoinNodeJoiner),
      vault.t(I18N_KEYS.JoinNodeJoinerDetail),
      joinerHere,
      JoinNodeKind.Joiner,
    )}
  </div>
  <figcaption
    class="flex items-start gap-2 text-xs text-pretty text-muted-foreground"
  >
    <Link2 class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
    {vault.t(I18N_KEYS.JoinDirectLink)}
  </figcaption>
</figure>
