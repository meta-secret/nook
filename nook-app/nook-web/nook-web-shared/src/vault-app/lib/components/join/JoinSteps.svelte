<!--
The four steps of joining, seen from the joining device. Each names the
device it happens on, so it is clear what to do here and what on the
device that already has the identity.
-->
<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { JoinStep, JoinStepProgress, JoinStepState } from "./join-flow";

  let { vault, current }: { vault: VaultState; current: JoinStep } = $props();

  type JoinStepCopy = {
    readonly step: JoinStep;
    readonly onThisDevice: boolean;
    readonly titleKey: string;
    readonly bodyKey: string;
  };

  const STEPS: readonly JoinStepCopy[] = [
    {
      step: JoinStep.Invite,
      onThisDevice: false,
      titleKey: I18N_KEYS.JoinStepInviteTitle,
      bodyKey: I18N_KEYS.JoinStepInviteBody,
    },
    {
      step: JoinStep.Redeem,
      onThisDevice: true,
      titleKey: I18N_KEYS.JoinStepRedeemTitle,
      bodyKey: I18N_KEYS.JoinStepRedeemBody,
    },
    {
      step: JoinStep.Approve,
      onThisDevice: false,
      titleKey: I18N_KEYS.JoinStepApproveTitle,
      bodyKey: I18N_KEYS.JoinStepApproveBody,
    },
    {
      step: JoinStep.Download,
      onThisDevice: true,
      titleKey: I18N_KEYS.JoinStepDownloadTitle,
      bodyKey: I18N_KEYS.JoinStepDownloadBody,
    },
  ];

  const progress = $derived(new JoinStepProgress(current));
</script>

<ol
  class="grid gap-0 border border-border"
  aria-label={vault.t(I18N_KEYS.JoinStepsLabel)}
  data-testid="join-steps"
>
  {#each STEPS as item (item.step)}
    {@const state = progress.stateOf(item.step)}
    <li
      class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 border-b border-border p-3 last:border-b-0 sm:p-4 {state ===
      JoinStepState.Current
        ? 'bg-card'
        : ''}"
      data-testid="join-step"
      data-step={JoinStep[item.step]}
      data-state={state}
      {...state === JoinStepState.Current ? { "aria-current": "step" } : {}}
    >
      <span
        class="grid size-7 place-items-center border font-mono text-xs {state ===
        JoinStepState.Upcoming
          ? 'border-border text-muted-foreground'
          : 'border-foreground text-foreground'}"
        aria-hidden="true"
      >
        {#if state === JoinStepState.Done}
          <Check class="size-3.5" />
        {:else}
          {item.step}
        {/if}
      </span>
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-sm font-semibold {state === JoinStepState.Upcoming
              ? 'text-muted-foreground'
              : 'text-foreground'}"
          >
            {vault.t(item.titleKey)}
          </span>
          <span
            class="nk-tag {item.onThisDevice ? 'nk-tag-success' : ''}"
            data-testid="join-step-where"
          >
            {item.onThisDevice
              ? vault.t(I18N_KEYS.JoinWhereJoiner)
              : vault.t(I18N_KEYS.JoinWhereMember)}
          </span>
        </div>
        <p class="text-xs text-pretty text-muted-foreground">
          {vault.t(item.bodyKey)}
        </p>
      </div>
    </li>
  {/each}
</ol>
