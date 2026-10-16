<!--
What keeps the identity from being lost, beside its card: what is at risk
now, then both protections in order. A finished one stays ticked, so the
list shows why the identity is safe; an open one carries the step that
finishes it; a blocked one waits for the copy it joins through. nook-core
decides every row.
-->
<script lang="ts">
  import { Check, Lock, X } from '@lucide/svelte'
  import {
    NookIdentityNextStep,
    NookIdentityProtectionTask,
    NookIdentityProtectionTaskState,
    type NookIdentityHealth,
    type NookIdentityProtectionStep,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    health,
    identityName,
    busy = false,
    onAction,
    onClose,
  }: {
    vault: VaultState
    health: NookIdentityHealth
    identityName: string
    busy?: boolean
    /** Take the step that finishes an open task. */
    onAction: (action: NookIdentityNextStep) => void
    onClose: () => void
  } = $props()

  const steps = $derived(health.checklist)

  const title = $derived.by(() => {
    const titleRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityProtectionPanelTitle,
      replacements: { identity: identityName },
    }
    return vault.t(titleRequest)
  })

  /** The loss the identity is open to now: the first task not done. */
  const risk = $derived.by(() => {
    const open = steps.find(
      (step) => step.state !== NookIdentityProtectionTaskState.Done,
    )
    if (!open) return ''
    return vault.t(
      open.task === NookIdentityProtectionTask.CopyOutsideBrowser
        ? I18N_KEYS.IdentityProtectionRiskLocal
        : I18N_KEYS.IdentityProtectionRiskOneDevice,
    )
  })

  function taskTitle(step: NookIdentityProtectionStep): string {
    return vault.t(
      step.task === NookIdentityProtectionTask.CopyOutsideBrowser
        ? I18N_KEYS.IdentityProtectionCopyTitle
        : I18N_KEYS.IdentityProtectionDeviceTitle,
    )
  }

  function taskDetail(step: NookIdentityProtectionStep): string {
    if (step.state === NookIdentityProtectionTaskState.Blocked)
      return vault.t(I18N_KEYS.IdentityProtectionDeviceBlocked)
    return vault.t(
      step.task === NookIdentityProtectionTask.CopyOutsideBrowser
        ? I18N_KEYS.IdentityProtectionCopyWhy
        : I18N_KEYS.IdentityProtectionDeviceWhy,
    )
  }

  function actionLabel(action: NookIdentityNextStep): string {
    switch (action) {
      case NookIdentityNextStep.AddSyncProvider:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddSync)
      case NookIdentityNextStep.AddCloudProvider:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddCloud)
      case NookIdentityNextStep.AddDevice:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddDevice)
      case NookIdentityNextStep.Done:
        return vault.t(I18N_KEYS.IdentityProtectionDone)
    }
  }
</script>

<div class="grid min-w-0 content-start gap-5" data-testid="identity-protection">
  <header class="flex items-start justify-between gap-3">
    <div class="grid min-w-0 gap-1.5">
      <h2 class="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {#if risk}
        <p
          class="max-w-[56ch] text-sm text-pretty text-muted-foreground"
          data-testid="identity-protection-risk"
        >
          {risk}
        </p>
      {/if}
    </div>
    <button
      type="button"
      class="grid size-8 flex-none place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
      title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
      data-testid="identity-protection-close"
      onclick={onClose}
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <ol class="grid gap-2">
    {#each steps as step (step.task)}
      {@const done = step.state === NookIdentityProtectionTaskState.Done}
      {@const blocked = step.state === NookIdentityProtectionTaskState.Blocked}
      <li
        class="grid gap-3 border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center {done ||
        blocked
          ? 'border-border'
          : 'border-warning/50 bg-warning/5'}"
        data-testid="identity-protection-step"
        data-task={step.task === NookIdentityProtectionTask.CopyOutsideBrowser
          ? 'copy'
          : 'device'}
        data-state={done ? 'done' : blocked ? 'blocked' : 'open'}
      >
        <span
          class="grid size-8 place-items-center border {done
            ? 'border-success text-success'
            : 'border-border text-muted-foreground'}"
          aria-hidden="true"
        >
          {#if done}
            <Check class="size-4" />
          {:else if blocked}
            <Lock class="size-3.5" />
          {/if}
        </span>
        <span class="grid min-w-0 gap-0.5">
          <span
            class="text-[0.9375rem] font-medium {done
              ? 'text-muted-foreground'
              : 'text-foreground'}"
          >
            {taskTitle(step)}
          </span>
          <span class="text-xs text-pretty text-muted-foreground">
            {taskDetail(step)}
          </span>
        </span>
        {#if step.state === NookIdentityProtectionTaskState.Open}
          <Button
            type="button"
            size="sm"
            class="justify-self-start sm:justify-self-end"
            data-testid="identity-protection-action"
            disabled={busy}
            onclick={() => onAction(step.action)}
          >
            {actionLabel(step.action)}
          </Button>
        {/if}
      </li>
    {/each}
  </ol>
</div>
