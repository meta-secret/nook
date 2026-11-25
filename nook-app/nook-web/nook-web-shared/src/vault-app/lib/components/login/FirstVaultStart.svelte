<!-- First visit to Nook on this browser, including setup opened from the extension. -->
<script lang="ts">
  import type { Component } from 'svelte'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ArrowRight,
    CloudDownload,
    MonitorSmartphone,
    RefreshCw,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import JoinThisDevice from '$lib/components/join/JoinThisDevice.svelte'
  import type { EnrollmentCodeUnlock } from './login-create-vault-chooser-contract'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'

  let {
    vault,
    isBusy,
    isVerifying,
    onCreate,
    onConnectStorage,
    onUseEnrollmentCode,
  }: {
    vault: VaultState
    isBusy: boolean
    isVerifying: boolean
    onCreate: (label: string) => void | Promise<void>
    onConnectStorage: () => void
    /** Present when this app can join an identity with an enrollment code. */
    onUseEnrollmentCode?: (code: EnrollmentCodeUnlock) => void | Promise<void>
  } = $props()

  /** Joining an identity this person already has replaces the screen. */
  let joining = $state(false)

  /** One of the other paths: an icon, a short title, an arrow. */
  type StartPath = {
    readonly testId: string
    readonly title: string
    readonly icon: Component
    readonly disabled: boolean
    readonly onOpen: () => void
  }

  const addDevice = $derived<StartPath>({
    testId: 'login-join-identity-btn',
    title: vault.t(I18N_KEYS.FirstRunPathAddDevice),
    icon: MonitorSmartphone,
    disabled: isBusy,
    onOpen: () => (joining = true),
  })
  const recover = $derived<StartPath>({
    testId: 'login-connect-storage-btn',
    title: vault.t(I18N_KEYS.FirstRunPathRecover),
    icon: CloudDownload,
    disabled: isBusy,
    onOpen: onConnectStorage,
  })

  /** The passkey comes next; the identity's name is asked only when setup
   * creates a new one. */
  async function create(): Promise<void> {
    if (isBusy) return
    vault.firstRun = FirstRunStage.Protect
    await onCreate(vault.t(I18N_KEYS.FirstRunNamePlaceholder))
  }
</script>

{#snippet path(row: StartPath)}
  <button
    type="button"
    class="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/5 disabled:opacity-60"
    data-testid={row.testId}
    disabled={row.disabled}
    onclick={row.onOpen}
  >
    <span class="nk-tile nk-tile-sm" aria-hidden="true">
      <row.icon class="size-4" />
    </span>
    <span class="min-w-0 flex-1 text-sm font-medium text-foreground">
      {row.title}
    </span>
    <ArrowRight
      class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      aria-hidden="true"
    />
  </button>
{/snippet}

{#if joining && onUseEnrollmentCode}
  <JoinThisDevice
    {vault}
    {isVerifying}
    {onUseEnrollmentCode}
    onBack={() => (joining = false)}
  />
{:else}
  <section
    class="mx-auto grid w-full max-w-lg gap-8 py-6 text-left sm:gap-10 sm:py-16"
    data-testid="first-vault-start"
  >
    <div class="grid gap-5">
      <header class="space-y-3">
        <h1
          class="text-3xl leading-tight font-semibold tracking-tight text-balance text-foreground sm:text-4xl"
        >
          {vault.t(I18N_KEYS.FirstRunTitle)}
        </h1>
        <p class="text-base leading-relaxed text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.FirstRunIntro)}
        </p>
      </header>
      <Button
        type="button"
        class="min-h-11 h-auto whitespace-normal sm:justify-self-start"
        disabled={isBusy}
        data-testid="first-run-create-identity-btn"
        onclick={() => void create()}
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
        {/if}
        {vault.t(I18N_KEYS.FirstRunCreate)}
        {#if !isBusy}
          <ArrowRight class="size-4" aria-hidden="true" />
        {/if}
      </Button>
    </div>

    <section class="grid gap-3" aria-labelledby="returning-user-heading">
      <h2
        id="returning-user-heading"
        class="text-base font-semibold text-foreground"
      >
        {vault.t(I18N_KEYS.FirstRunReturning)}
      </h2>
      <div class="nk-frame divide-y divide-border" data-testid="login-paths">
        {#if onUseEnrollmentCode}
          {@render path(addDevice)}
        {/if}
        {@render path(recover)}
      </div>
    </section>

    <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
      <button
        type="button"
        class="py-2 text-left underline underline-offset-4 hover:text-foreground"
        data-testid="first-vault-how-it-works"
        onclick={() => vault.openHelp()}
      >
        {vault.t(I18N_KEYS.FirstRunHowItWorks)}
      </button>
      <button
        type="button"
        class="py-2 text-left underline underline-offset-4 hover:text-foreground"
        data-testid="login-access-check-link"
        onclick={() => new VaultWorkspaceActions(vault).openAccessCheck()}
      >
        {vault.t(I18N_KEYS.FirstRunPathCheck)}
      </button>
    </div>
  </section>
{/if}
