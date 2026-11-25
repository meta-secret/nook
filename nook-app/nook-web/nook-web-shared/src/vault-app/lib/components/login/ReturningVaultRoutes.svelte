<script lang="ts">
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
    onInvite: (() => void) | undefined
    onRecover: () => void
  } = $props()
</script>

<section class="returning" aria-labelledby="returning-user-heading">
  <h2 id="returning-user-heading">{vault.t(I18N_KEYS.FirstRunReturning)}</h2>
  <div class="journey" class:single={!onInvite} data-testid="login-paths">
    {#if onInvite}
      <button
        type="button"
        id="welcome-invite-route"
        class="route invite"
        disabled={isBusy}
        aria-labelledby="return-invite-title"
        aria-describedby="return-invite-source"
        data-testid="login-join-identity-btn"
        onclick={onInvite}
      >
        <svg
          class="source-art"
          viewBox="0 0 88 62"
          fill="none"
          aria-hidden="true"
        >
          <g transform="rotate(-7 30 31)">
            <rect x="9" y="5" width="37" height="52" rx="6" class="surface" />
            <rect x="13" y="9" width="29" height="43" rx="3" class="screen" />
            <path d="M22 12h10M25 54h5" class="fine" />
          </g>
          <g transform="rotate(7 58 35)">
            <path
              d="M36 22h41v7a5 5 0 0 0 0 10v7H36v-7a5 5 0 0 0 0-10z"
              class="ticket"
            />
            <path d="M66 24v20" class="perforation" />
            <path
              d="m46 35 4-4a3 3 0 0 1 4 4l-4 4m3-5 4-4a3 3 0 0 1 4 4l-4 4"
              class="ticket-ink"
            />
          </g>
        </svg>
        <span class="route-copy">
          <strong id="return-invite-title"
            >{vault.t(I18N_KEYS.FirstRunPathAddDevice)}</strong
          >
          <span id="return-invite-source"
            >{vault.t(I18N_KEYS.FirstRunInviteSource)}</span
          >
        </span>
      </button>
      <span class="junction upper" aria-hidden="true"></span>
    {/if}
    <button
      type="button"
      class="route recovery"
      disabled={isBusy}
      aria-labelledby="return-backup-title"
      aria-describedby="return-backup-access"
      data-testid="login-connect-storage-btn"
      onclick={onRecover}
    >
      <svg
        class="source-art"
        viewBox="0 0 88 62"
        fill="none"
        aria-hidden="true"
      >
        <g transform="rotate(-5 33 31)">
          <path d="m10 12 5-4h40l5 5v36l-5 4H15l-5-5z" class="surface" />
          <rect x="15" y="14" width="39" height="32" rx="3" class="screen" />
          <path
            d="M22 35h23a5 5 0 0 0-1-10 9 9 0 0 0-17-3 7 7 0 0 0-5 13z"
            class="fine"
          />
        </g>
        <path d="M53 39a8 8 0 1 1-1 9l-9 6h-6l-2-4 14-9z" class="ticket" />
        <circle cx="59" cy="42" r="2.5" class="ticket-ink" />
      </svg>
      <span class="route-copy">
        <strong id="return-backup-title"
          >{vault.t(I18N_KEYS.FirstRunPathRecover)}</strong
        >
        <span id="return-backup-access"
          >{vault.t(I18N_KEYS.FirstRunBackupAccess)}</span
        >
      </span>
    </button>
    <span class="junction lower" aria-hidden="true"></span>
    <span class="arrival" aria-hidden="true"></span>
    <div
      class="destination"
      aria-hidden="true"
      data-testid="return-route-destination"
    >
      <svg viewBox="0 0 88 64" fill="none">
        <path d="M10 44V12a4 4 0 0 1 4-4h58a4 4 0 0 1 4 4v32" class="surface" />
        <path d="M15 14h56v30H15z" class="screen" />
        <path d="M10 44h66l9 8v4H2v-4z" class="surface" />
        <path d="M2 52h83m-50-4h17" class="fine" />
        <rect x="37" y="27" width="14" height="10" rx="2" class="ticket" />
        <path d="M40 27v-3a4 4 0 0 1 8 0v3" class="fine" />
      </svg>
      <span>{vault.t(I18N_KEYS.JoinThisDevice)}</span>
    </div>
  </div>
</section>

<style>
  .returning {
    --line: #397763;
    --paper: #e9f5ef;
    --surface: #c4ded1;
    --mint: #a2edcf;
    display: grid;
    grid-template-columns: minmax(10rem, 0.7fr) minmax(0, 1.7fr);
    align-items: center;
    gap: clamp(1.4rem, 4vw, 4.5rem);
    padding-block: clamp(1.15rem, 2.5vw, 2rem);
    border-block: 1px solid var(--welcome-rule);
  }
  :global(.dark) .returning {
    --line: #8caf9f;
    --paper: #142b24;
    --surface: #213d33;
  }
  h2 {
    max-width: 16ch;
    margin: 0;
    color: var(--foreground);
    font-size: clamp(1.25rem, 2.2vw, 1.75rem);
    font-weight: 590;
    line-height: 1.16;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  .journey {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(1.5rem, 4.5vw, 4.75rem) minmax(
        3.8rem,
        7rem
      );
    grid-template-rows: repeat(2, minmax(4.9rem, 1fr));
    align-items: center;
    min-width: 0;
  }
  .journey.single {
    grid-template-rows: minmax(4.9rem, auto);
  }
  .route {
    grid-column: 1;
    display: grid;
    grid-template-columns: clamp(3.3rem, 5.6vw, 5rem) minmax(
        0,
        max-content
      ) minmax(0.45rem, 1fr);
    align-items: center;

    justify-self: stretch;
    text-align: left;
    min-height: 4.4rem;
    padding: 0.32rem 0;
    border-radius: 3px;
    color: var(--foreground);
  }
  .route::after {
    content: '';
    border-top: 1px solid var(--line);
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
  .route:hover:enabled,
  .route:focus-visible {
    background: color-mix(in srgb, var(--welcome-accent) 8%, transparent);
  }
  .route:disabled {
    opacity: 0.5;
  }
  .source-art,
  .destination svg {
    display: block;
    width: 100%;
  }
  svg {
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .surface,
  .screen,
  .fine {
    stroke: var(--line);
    stroke-width: 1.45;
  }
  .surface {
    fill: var(--surface);
  }
  .screen {
    fill: var(--paper);
  }
  .ticket {
    fill: var(--mint);
    stroke: #32725a;
    stroke-width: 1.35;
  }
  .ticket-ink,
  .perforation {
    stroke: #205642;
    stroke-width: 1.5;
  }
  .perforation {
    stroke-dasharray: 1.7 2.5;
  }
  .route-copy {
    display: grid;
    gap: 0.24rem;
    margin-inline: clamp(0.4rem, 1.4vw, 1rem) clamp(0.35rem, 1.1vw, 0.85rem);
    overflow-wrap: anywhere;
  }
  .route-copy strong {
    color: var(--welcome-accent);
    font-size: clamp(0.95rem, 1.5vw, 1.1rem);
    line-height: 1.25;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 0.22em;
    text-decoration-color: color-mix(in srgb, currentColor 46%, transparent);
  }
  .route-copy span {
    color: var(--muted-foreground);
    font-size: 0.83rem;
    line-height: 1.35;
  }
  .junction,
  .arrival {
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
    border-color: var(--line);
  }
  .junction::before {
    top: 50%;
    left: 0;
    right: 48%;
    border-top: 1px solid var(--line);
  }
  .junction::after {
    right: 48%;
    border-right: 1px solid var(--line);
  }
  .upper::after {
    top: 50%;
    bottom: 0;
  }
  .lower::after {
    top: 0;
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
    left: 52%;
    right: 0;
    border-top: 1px solid var(--line);
  }
  .arrival::after {
    top: 50%;
    right: 0;
    width: 0.42rem;
    height: 0.42rem;
    border-top: 1px solid var(--line);
    border-right: 1px solid var(--line);
    transform: translateY(-45%) rotate(45deg);
  }
  .destination {
    grid-column: 3;
    display: grid;
    justify-items: center;
    justify-self: center;
    gap: 0.25rem;
    padding-left: 0.45rem;
    text-align: center;
    font-size: 0.78rem;
    line-height: 1.2;
    color: var(--foreground);
  }
  .destination svg {
    max-width: 5.3rem;
  }
  @media (max-width: 47.99rem) {
    .returning {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    h2 {
      max-width: none;
    }
    .journey {
      grid-template-columns: minmax(0, 1fr) 1.6rem minmax(3.5rem, 4.2rem);
    }
    .route {
      grid-template-columns: 3rem minmax(0, max-content) minmax(0.35rem, 1fr);
    }
  }
</style>
