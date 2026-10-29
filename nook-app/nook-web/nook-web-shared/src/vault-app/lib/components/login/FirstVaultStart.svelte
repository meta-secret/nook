<!--
The first screen of a browser with no vault: one button that creates the
identity. Setup then makes its passkey, signs in to a sync provider, and
settles the identity there before any vault exists. The other paths sit
under it as equal rows: add this device to an identity, recover from a sync
provider, check access. Opened from the extension, the connect route shows
this same screen: the person creates or joins here, never in the extension.
-->
<script lang="ts">
  import type { Component } from 'svelte'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ArrowRight,
    CloudDownload,
    KeyRound,
    MonitorSmartphone,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import OptionDivider from '$lib/components/provider-vaults/OptionDivider.svelte'
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
  const check = $derived<StartPath>({
    testId: 'login-access-check-link',
    title: vault.t(I18N_KEYS.FirstRunPathCheck),
    icon: ShieldCheck,
    disabled: false,
    onOpen: () => new VaultWorkspaceActions(vault).openAccessCheck(),
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
    class="mx-auto grid w-full max-w-md gap-6 py-6 text-center sm:gap-7 sm:py-16"
    data-testid="first-vault-start"
  >
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunTitle)}
    </h1>

    <Button
      type="button"
      class="h-11 sm:h-10"
      disabled={isBusy}
      data-testid="first-run-create-identity-btn"
      onclick={() => void create()}
    >
      {#if isBusy}
        <RefreshCw class="size-4 animate-spin" />
      {:else}
        <KeyRound class="size-4" />
      {/if}
      {vault.t(I18N_KEYS.FirstRunCreate)}
    </Button>

    <OptionDivider {vault} />

    <!-- The other paths, as equal rows: an icon, a short title, an arrow. -->
    <div class="nk-frame divide-y divide-border text-left" data-testid="login-paths">
      {#if onUseEnrollmentCode}
        {@render path(addDevice)}
      {/if}
      {@render path(recover)}
      {@render path(check)}
    </div>

    <!-- What Nook is, in one line; the details live in Help. -->
    <p
      class="flex flex-col items-center gap-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-2"
      data-testid="first-vault-facts"
    >
      <span>{vault.t(I18N_KEYS.FirstRunFactEncrypted)}</span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <span>{vault.t(I18N_KEYS.FirstRunFactNoServer)}</span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <button
        type="button"
        class="underline underline-offset-4 hover:text-foreground"
        data-testid="first-vault-how-it-works"
        onclick={() => vault.openHelp()}
      >
        {vault.t(I18N_KEYS.FirstRunHowItWorks)}
      </button>
    </p>
  </section>
{/if}
