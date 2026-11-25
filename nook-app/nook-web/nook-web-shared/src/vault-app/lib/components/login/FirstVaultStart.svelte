<!-- First visit to Nook on this browser, including setup opened from the extension. -->
<script lang="ts">
  import { tick } from 'svelte'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ArrowRight,
    ShieldCheck,
    BookOpen,
    ScanFace,
    RefreshCw,
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
  <section class="welcome" data-testid="first-vault-start">
    <div class="welcome-hero">
      <div class="welcome-intro">
        <h1>{vault.t(I18N_KEYS.FirstRunTitle)}</h1>
        <p class="welcome-promise">
          <ShieldCheck
            aria-hidden="true"
            strokeWidth={1.65}
            class="size-5 shrink-0"
          />
          {vault.t(I18N_KEYS.FirstRunIntro)}
        </p>
        <Button
          type="button"
          class="welcome-setup"
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
      <LocalFirstDiagram {vault} />
    </div>

    <ReturningVaultRoutes
      {vault}
      {isBusy}
      onInvite={onUseEnrollmentCode ? showInvite : undefined}
      onRecover={onConnectStorage}
    />

    <div class="welcome-utilities">
      <button
        type="button"
        data-testid="first-vault-how-it-works"
        onclick={() => vault.openHelp()}
      >
        <BookOpen class="size-4" aria-hidden="true" />
        {vault.t(I18N_KEYS.FirstRunHowItWorks)}
      </button>
      <button
        type="button"
        data-testid="login-access-check-link"
        onclick={() => new VaultWorkspaceActions(vault).openAccessCheck()}
      >
        <ScanFace class="size-4" aria-hidden="true" />
        {vault.t(I18N_KEYS.FirstRunPathCheck)}
      </button>
    </div>
  </section>
{/if}

<style>
  .welcome {
    --welcome-accent: #086450;
    --welcome-button: #99e7c8;
    --welcome-rule: color-mix(in srgb, var(--foreground) 22%, transparent);
    width: min(100%, 66rem);
    margin-inline: auto;
    padding-block: clamp(1rem, 3vw, 3rem);
  }

  :global(.dark) .welcome {
    --welcome-accent: #8adab9;
  }
  .welcome-hero {
    display: grid;
    align-items: center;
    gap: clamp(2rem, 5vw, 5rem);
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
    padding-block: clamp(2rem, 5vw, 5rem);
  }

  .welcome-intro h1 {
    margin: 0;
    max-width: 15ch;
    color: var(--foreground);
    font-size: clamp(3rem, 4.65vw, 4.25rem);
    font-weight: 610;
    letter-spacing: -0.052em;
    line-height: 1.015;
    text-wrap: balance;
  }

  .welcome-promise {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-block: 1.3rem 1.9rem;
    color: color-mix(in srgb, var(--foreground) 76%, var(--background));
    font-size: clamp(1rem, 1.4vw, 1.17rem);
  }
  .welcome-promise :global(svg) {
    color: var(--welcome-accent);
  }

  .welcome-intro :global(.welcome-setup) {
    height: auto;
    min-height: 2.95rem;
    padding: 0.72rem 1.3rem;
    gap: 1.2rem;
    border: 1px solid color-mix(in srgb, var(--welcome-button) 58%, #25433c);
    border-radius: var(--radius);
    background: var(--welcome-button);
    color: #092c23;
    font-size: 1rem;
    font-weight: 650;
    white-space: normal;
  }
  .welcome-intro :global(.welcome-setup:hover) {
    background: #b1f0d7;
  }

  .welcome-utilities {
    display: flex;
    flex-wrap: wrap;
    column-gap: 1.75rem;
    margin-top: 0.45rem;
  }
  .welcome-utilities button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  .welcome-utilities button:hover {
    color: var(--foreground);
  }
  .welcome :global(button:focus-visible) {
    outline: 2px solid var(--welcome-accent);
    outline-offset: 4px;
  }

  @media (max-width: 47.99rem) {
    .welcome {
      max-width: 35rem;
      padding-block: 0.2rem 0.8rem;
    }
    .welcome-hero {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.4rem;
      padding-block: 1rem 1.25rem;
    }
    .welcome-intro h1 {
      font-size: clamp(2.75rem, 9vw, 4.1rem);
    }
    .welcome-promise {
      margin-block: 0.8rem 1.05rem;
    }
    .welcome-intro :global(.welcome-setup) {
      min-height: 2.75rem;
    }
    .welcome-utilities {
      column-gap: 1.25rem;
    }
  }
</style>
