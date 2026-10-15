<!--
This device, the cloud copy and the new device, drawn as the pairing
advances: the cloud is dashed while missing, the link to the new device
runs while the invite waits, and everything turns green once approved.
-->
<script lang="ts">
  import { Check, Cloud, CloudOff, Laptop, MonitorSmartphone } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { PairingStage } from "./pairing-stage";

  let {
    vault,
    stage,
    providerLabel,
  }: {
    vault: VaultState;
    stage: PairingStage;
    /** The mount the invite goes through; empty before one exists. */
    providerLabel: string;
  } = $props();

  const cloudMissing = $derived(stage === PairingStage.Cloud);
  const approved = $derived(stage === PairingStage.Approved);
  const inviteOut = $derived(
    stage === PairingStage.Waiting || stage === PairingStage.Request,
  );
  const cloudState = $derived(
    cloudMissing ? "missing" : approved ? "ready" : "on",
  );
  const joinerState = $derived(
    approved ? "ready" : inviteOut ? "waiting" : "off",
  );
  const firstLink = $derived(
    cloudMissing ? "off" : approved ? "done" : "on",
  );
  const secondLink = $derived(approved ? "done" : inviteOut ? "live" : "off");
</script>

{#snippet label(text: string, strong: boolean)}
  <span
    class="w-20 text-center text-[11px] leading-tight {strong
      ? 'font-semibold text-foreground'
      : 'text-muted-foreground'}"
  >
    {text}
  </span>
{/snippet}

<div class="flex items-start gap-1 sm:gap-2" data-testid="pairing-diagram" data-stage={stage}>
  <div class="flex flex-col items-center gap-2">
    <span class="nk-pair-node" data-state={approved ? "ready" : "on"}>
      <Laptop class="size-5" aria-hidden="true" />
    </span>
    {@render label(vault.t(I18N_KEYS.JoinThisDevice), true)}
  </div>
  <span class="nk-pair-link" data-state={firstLink} aria-hidden="true"></span>
  <div class="flex flex-col items-center gap-2">
    <span class="nk-pair-node" data-state={cloudState}>
      {#if cloudMissing}
        <CloudOff class="size-5" aria-hidden="true" />
      {:else}
        <Cloud class="size-5" aria-hidden="true" />
      {/if}
    </span>
    {@render label(providerLabel || vault.t(I18N_KEYS.JoinNodeProvider), false)}
  </div>
  <span class="nk-pair-link" data-state={secondLink} aria-hidden="true"></span>
  <div class="flex flex-col items-center gap-2">
    <span class="nk-pair-node" data-state={joinerState}>
      {#if approved}
        <Check class="size-5" aria-hidden="true" />
      {:else}
        <MonitorSmartphone class="size-5" aria-hidden="true" />
      {/if}
    </span>
    {@render label(vault.t(I18N_KEYS.JoinNodeJoiner), approved)}
  </div>
</div>
