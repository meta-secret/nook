<script lang="ts">
  import { ArrowDown, CloudDownload, Laptop, Smartphone } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isBusy,
    onInvite,
    onRecover,
  }: {
    vault: VaultState
    isBusy: boolean
    onInvite?: () => void
    onRecover: () => void
  } = $props()
</script>

<section class="returning" aria-labelledby="returning-vault-heading">
  <h2
    id="returning-vault-heading"
    class="m-0 text-base leading-snug font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-lg md:max-w-[20ch]"
  >
    {vault.t(I18N_KEYS.FirstRunReturning)}
  </h2>

  <div class="journey" class:single={!onInvite} data-testid="login-paths">
    {#if onInvite}
      <button
        type="button"
        id="welcome-invite-route"
        class="route invite nk-frame-nick nk-frame-interactive flex min-h-[3.75rem] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
        disabled={isBusy}
        aria-labelledby="return-invite-title"
        aria-describedby="return-invite-source"
        data-testid="login-join-identity-btn"
        onclick={onInvite}
      >
        <span
          class="nk-tile nk-tile-sm shrink-0 text-foreground"
          aria-hidden="true"
        >
          <Smartphone class="size-4" />
        </span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <strong
            id="return-invite-title"
            class="text-sm leading-snug font-semibold text-foreground"
          >
            {vault.t(I18N_KEYS.FirstRunPathAddDevice)}
          </strong>
          <span
            id="return-invite-source"
            class="text-xs leading-snug text-pretty text-muted-foreground"
          >
            {vault.t(I18N_KEYS.FirstRunInviteSource)}
          </span>
        </span>
      </button>
      <span class="junction upper" aria-hidden="true"></span>
    {/if}

    <button
      type="button"
      class="route recovery nk-frame-nick nk-frame-interactive flex min-h-[3.75rem] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
      disabled={isBusy}
      aria-labelledby="return-backup-title"
      aria-describedby="return-backup-access"
      data-testid="login-connect-storage-btn"
      onclick={onRecover}
    >
      <span
        class="nk-tile nk-tile-sm shrink-0 text-foreground"
        aria-hidden="true"
      >
        <CloudDownload class="size-4" />
      </span>
      <span class="grid min-w-0 flex-1 gap-0.5">
        <strong
          id="return-backup-title"
          class="text-sm leading-snug font-semibold text-foreground"
        >
          {vault.t(I18N_KEYS.FirstRunPathRecover)}
        </strong>
        <span
          id="return-backup-access"
          class="text-xs leading-snug text-pretty text-muted-foreground"
        >
          {vault.t(I18N_KEYS.FirstRunBackupAccess)}
        </span>
      </span>
    </button>
    <span class="junction lower" aria-hidden="true"></span>
    <span class="arrival" aria-hidden="true"></span>

    <div
      class="destination"
      aria-hidden="true"
      data-testid="return-route-destination"
    >
      <ArrowDown
        class="mobile-convergence size-3.5 shrink-0 text-muted-foreground"
      />
      <span
        class="grid size-11 shrink-0 place-items-center border border-foreground bg-foreground text-background"
      >
        <Laptop class="size-5" />
      </span>
      <span
        class="font-mono text-[0.6875rem] leading-tight tracking-[0.06em] text-muted-foreground"
      >
        {vault.t(I18N_KEYS.JoinThisDevice)}
      </span>
    </div>
  </div>
</section>

<style>
  .returning {
    display: grid;
    align-items: center;
    gap: 1rem;
    padding-block: clamp(1.25rem, 2.5vw, 1.75rem);
    border-block: 1px solid var(--border);
  }

  .route:focus-visible {
    clip-path: none;
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .journey {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.625rem;
    min-width: 0;
  }

  .junction,
  .arrival {
    display: none;
  }

  .destination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  @media (width >= 30rem) {
    .journey {
      grid-template-columns: minmax(0, 1fr) clamp(1.75rem, 3.5vw, 3.25rem) auto;
      grid-template-rows: repeat(2, auto);
      column-gap: 0;
      row-gap: 0.625rem;
      align-items: center;
    }

    .journey.single {
      grid-template-rows: auto;
    }

    .route {
      grid-column: 1;
    }

    .invite {
      grid-row: 1;
    }

    .recovery {
      grid-row: 2;
    }

    .single .recovery {
      grid-row: 1;
    }

    .junction,
    .arrival {
      display: block;
      grid-column: 2;
      position: relative;
      align-self: stretch;
      pointer-events: none;
    }

    .upper {
      grid-row: 1;
    }

    .lower {
      grid-row: 2;
    }

    .single .lower {
      grid-row: 1;
    }

    .junction::before,
    .junction::after,
    .arrival::before,
    .arrival::after {
      position: absolute;
      content: '';
      border-color: var(--border);
    }

    .junction::before {
      top: 50%;
      left: 0;
      right: 50%;
      border-top: 1px solid var(--border);
    }

    .junction::after {
      right: 50%;
      border-right: 1px solid var(--border);
    }

    .upper::after {
      top: 50%;
      bottom: -0.3125rem;
    }

    .lower::after {
      top: -0.3125rem;
      bottom: 50%;
    }

    .single .lower::after {
      display: none;
    }

    .arrival,
    .destination {
      grid-row: 1 / -1;
    }

    .arrival::before {
      top: 50%;
      left: 50%;
      right: 0.25rem;
      border-top: 1px solid var(--border);
    }

    .arrival::after {
      top: 50%;
      right: 0.25rem;
      width: 0.4rem;
      height: 0.4rem;
      border-top: 1px solid var(--muted-foreground);
      border-right: 1px solid var(--muted-foreground);
      transform: translateY(-50%) rotate(45deg);
    }

    .destination {
      grid-column: 3;
      display: grid;
      justify-items: center;
      justify-self: center;
      gap: 0.375rem;
      padding-top: 0;
      padding-left: 0.5rem;
      text-align: center;
    }

    .destination :global(.mobile-convergence) {
      display: none;
    }
  }

  @media (width >= 48rem) {
    .returning {
      grid-template-columns: minmax(12rem, 0.72fr) minmax(0, 1.48fr);
      gap: clamp(1.5rem, 3.5vw, 3.5rem);
    }
  }
</style>
