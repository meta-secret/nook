<!-- First visit to Nook on this browser, including setup opened from the extension. -->
<script lang="ts">
  import { tick } from 'svelte'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ArrowRight,
    BookOpen,
    Fingerprint,
    RefreshCw,
    ScanFace,
    ShieldCheck,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import ReturningVaultRoutes from './ReturningVaultRoutes.svelte'
  import LocalFirstDiagram from './LocalFirstDiagram.svelte'
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

  async function showInvite(): Promise<void> {
    joining = true
    await tick()
    document.getElementById('join-route-heading')?.focus()
  }

  async function returnFromInvite(): Promise<void> {
    joining = false
    await tick()
    document.getElementById('welcome-invite-route')?.focus()
  }

  /** The passkey comes next; the identity's name is asked only when setup
   * creates a new one. */
  async function create(): Promise<void> {
    if (isBusy) return
    vault.firstRun = FirstRunStage.Protect
    await onCreate(vault.t(I18N_KEYS.FirstRunNamePlaceholder))
  }
</script>

{#if joining && onUseEnrollmentCode}
  <JoinThisDevice
    {vault}
    {isVerifying}
    {onUseEnrollmentCode}
    onBack={returnFromInvite}
  />
{:else}
  <section
    class="mx-auto grid w-full max-w-[68rem] gap-8 py-3 sm:gap-10 sm:py-8 lg:py-10"
    data-testid="first-vault-start"
  >
    <div
      class="grid grid-cols-1 items-start gap-7 md:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)] md:items-center md:gap-[clamp(2rem,4.5vw,4rem)] md:py-[clamp(0.75rem,2.5vw,2rem)]"
    >
      <div class="grid min-w-0 justify-items-start gap-4 sm:gap-5">
        <div class="nk-lockup w-full">
          <span class="nk-eyebrow text-foreground/80">
            <ShieldCheck
              class="size-3.5 shrink-0 text-success"
              aria-hidden="true"
            />
            <span>{vault.t(I18N_KEYS.FirstRunEyebrow)}</span>
          </span>
        </div>

        <h1
          class="m-0 max-w-[21ch] text-[clamp(1.875rem,3.3vw,2.625rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance wrap-break-word text-foreground"
        >
          {vault.t(I18N_KEYS.FirstRunTitle)}
        </h1>

        <p
          class="m-0 max-w-[46ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground sm:text-base"
        >
          {vault.t(I18N_KEYS.FirstRunIntro)}
        </p>

        <div class="grid w-full justify-items-start gap-2.5 pt-1">
          <Button
            type="button"
            variant="default"
            size="lg"
            class="h-auto min-h-11 w-full justify-center gap-3 px-5 py-2.5 text-[0.9375rem] font-semibold whitespace-normal min-[420px]:w-auto min-[420px]:justify-start"
            disabled={isBusy}
            aria-describedby="first-run-create-hint"
            data-testid="first-run-create-identity-btn"
            onclick={() => void create()}
          >
            {#if isBusy}
              <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {/if}
            <span>{vault.t(I18N_KEYS.FirstRunCreate)}</span>
            {#if !isBusy}
              <ArrowRight class="size-4" aria-hidden="true" />
            {/if}
          </Button>
          <p
            id="first-run-create-hint"
            class="m-0 flex max-w-[44ch] items-start gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <Fingerprint
              class="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80"
              aria-hidden="true"
            />
            <span>{vault.t(I18N_KEYS.FirstRunCreateHint)}</span>
          </p>
        </div>
      </div>

      <LocalFirstDiagram {vault} />
    </div>

    <ReturningVaultRoutes
      {vault}
      {isBusy}
      {...onUseEnrollmentCode ? { onInvite: showInvite } : {}}
      onRecover={onConnectStorage}
    />

    <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
      <button
        type="button"
        class="-mx-1.5 inline-flex min-h-11 items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm"
        data-testid="first-vault-how-it-works"
        onclick={() => vault.openHelp()}
      >
        <BookOpen class="size-4 shrink-0" aria-hidden="true" />
        <span>{vault.t(I18N_KEYS.FirstRunHowItWorks)}</span>
      </button>
      <button
        type="button"
        class="-mx-1.5 inline-flex min-h-11 items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm"
        data-testid="login-access-check-link"
        onclick={() => new VaultWorkspaceActions(vault).openAccessCheck()}
      >
        <ScanFace class="size-4 shrink-0" aria-hidden="true" />
        <span>{vault.t(I18N_KEYS.FirstRunPathCheck)}</span>
      </button>
    </div>
  </section>
{/if}
