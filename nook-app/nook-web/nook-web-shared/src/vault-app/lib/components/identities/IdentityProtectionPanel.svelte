<!--
Setting up the identity, beside its card, drawn as a journey: what is at
risk now, then each step in order on one rail. A finished step stays ticked
and its rail turns solid, so the path shows how far the identity has come; a
blocked step waits for the copy it joins through. Only the first open step
leads with the primary action; a later open one offers its action quietly.
Until a second device joins, a kept copy also offers another provider,
quietly. The browser extension comes last where the app offers it.
nook-core decides every row.
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

  /** The step the journey is at: the first one that can be done now, or -1
   * when none can. */
  const leadIndex = $derived(
    steps.findIndex(
      (step) => step.state === NookIdentityProtectionTaskState.Open,
    ),
  )

  const title = $derived.by(() => {
    const titleRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityProtectionPanelTitle,
      replacements: { identity: identityName },
    }
    return vault.t(titleRequest)
  })

  /** The loss the identity is open to now: the first protection not done.
   * The browser extension protects nothing, so it names no risk. */
  const risk = $derived.by(() => {
    const open = steps.find(
      (step) => step.state !== NookIdentityProtectionTaskState.Done,
    )
    if (!open) return ''
    switch (open.task) {
      case NookIdentityProtectionTask.CopyOutsideBrowser:
        return vault.t(I18N_KEYS.IdentityProtectionRiskLocal)
      case NookIdentityProtectionTask.SecondDevice:
        return vault.t(I18N_KEYS.IdentityProtectionRiskOneDevice)
      case NookIdentityProtectionTask.BrowserExtension:
        return ''
    }
  })

  function taskId(step: NookIdentityProtectionStep): string {
    switch (step.task) {
      case NookIdentityProtectionTask.CopyOutsideBrowser:
        return 'copy'
      case NookIdentityProtectionTask.SecondDevice:
        return 'device'
      case NookIdentityProtectionTask.BrowserExtension:
        return 'extension'
    }
  }

  function taskTitle(step: NookIdentityProtectionStep): string {
    switch (step.task) {
      case NookIdentityProtectionTask.CopyOutsideBrowser:
        return vault.t(I18N_KEYS.IdentityProtectionCopyTitle)
      case NookIdentityProtectionTask.SecondDevice:
        return vault.t(I18N_KEYS.IdentityProtectionDeviceTitle)
      case NookIdentityProtectionTask.BrowserExtension:
        return vault.t(I18N_KEYS.IdentityProtectionExtensionTitle)
    }
  }

  function taskDetail(step: NookIdentityProtectionStep): string {
    if (step.state === NookIdentityProtectionTaskState.Blocked)
      return vault.t(I18N_KEYS.IdentityProtectionDeviceBlocked)
    switch (step.task) {
      case NookIdentityProtectionTask.CopyOutsideBrowser:
        return vault.t(I18N_KEYS.IdentityProtectionCopyWhy)
      case NookIdentityProtectionTask.SecondDevice:
        return vault.t(I18N_KEYS.IdentityProtectionDeviceWhy)
      case NookIdentityProtectionTask.BrowserExtension:
        return vault.t(
          step.action === NookIdentityNextStep.ConnectExtension
            ? I18N_KEYS.IdentityProtectionExtensionConnectWhy
            : I18N_KEYS.IdentityProtectionExtensionWhy,
        )
    }
  }

  function actionLabel(action: NookIdentityNextStep): string {
    switch (action) {
      case NookIdentityNextStep.AddSyncProvider:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddSync)
      case NookIdentityNextStep.AddCloudProvider:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddCloud)
      case NookIdentityNextStep.AddDevice:
        return vault.t(I18N_KEYS.IdentityProtectionActionAddDevice)
      case NookIdentityNextStep.InstallExtension:
        return vault.t(I18N_KEYS.IdentityProtectionActionInstallExtension)
      case NookIdentityNextStep.ConnectExtension:
        return vault.t(I18N_KEYS.IdentityProtectionActionConnectExtension)
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

  <ol class="grid">
    {#each steps as step, index (step.task)}
      {@const done = step.state === NookIdentityProtectionTaskState.Done}
      {@const blocked = step.state === NookIdentityProtectionTaskState.Blocked}
      {@const lead = index === leadIndex}
      {@const last = index === steps.length - 1}
      <li
        class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 {last
          ? ''
          : 'pb-3'}"
        data-testid="identity-protection-step"
        data-task={taskId(step)}
        data-state={done ? 'done' : blocked ? 'blocked' : 'open'}
        {...lead ? { 'aria-current': 'step' } : {}}
      >
        {#if !last}
          <!-- The rail to the next step: solid once this one is done. -->
          <span
            class="absolute top-12 -bottom-4 left-4 -translate-x-1/2 border-l {done
              ? 'border-success/60'
              : 'border-dashed border-border'}"
            aria-hidden="true"
          ></span>
        {/if}
        <span
          class="relative mt-4 grid size-8 place-items-center border bg-background font-mono text-xs {done
            ? 'border-success text-success'
            : lead
              ? 'border-foreground text-foreground'
              : 'border-border text-muted-foreground'}"
          aria-hidden="true"
        >
          {#if done}
            <Check class="size-4" />
          {:else if blocked}
            <Lock class="size-3.5" />
          {:else}
            {index + 1}
          {/if}
        </span>
        <div
          class="grid gap-3 border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center {lead
            ? 'border-warning/50 bg-warning/5'
            : 'border-border'}"
        >
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
          {#if lead}
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
          {:else if step.state === NookIdentityProtectionTaskState.Open}
            <Button
              type="button"
              size="sm"
              variant="outline"
              class="justify-self-start sm:justify-self-end"
              data-testid="identity-protection-later-action"
              disabled={busy}
              onclick={() => onAction(step.action)}
            >
              {actionLabel(step.action)}
            </Button>
          {:else if done && step.action !== NookIdentityNextStep.Done}
            <Button
              type="button"
              size="sm"
              variant="outline"
              class="justify-self-start sm:justify-self-end"
              data-testid="identity-protection-add-another"
              disabled={busy}
              onclick={() => onAction(step.action)}
            >
              {vault.t(I18N_KEYS.IdentityProtectionActionAddAnotherSync)}
            </Button>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</div>
