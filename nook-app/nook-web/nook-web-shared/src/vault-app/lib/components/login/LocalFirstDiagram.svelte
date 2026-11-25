<script lang="ts">
  import {
    AppWindow,
    ArrowRight,
    ChevronDown,
    Folder,
    LockKeyhole,
    Server,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()
</script>

<div class="architecture">
  <figure
    class="scene"
    aria-label={vault.t(I18N_KEYS.FirstRunLocalFirstDiagramDescription)}
  >
    <div aria-hidden="true" class="art">
      <div class="blueprint-grid"></div>
      <div class="window-stack">
        <div class="browser" data-testid="local-vault-browser">
          <div class="chrome">
            <i class="pins"></i>
            <span>{vault.t(I18N_KEYS.FirstRunLocalFirstBrowser)}</span>
          </div>
          <div class="chamber">
            <div class="reticle"></div>
            <img
              src="/nook-vault-mark.webp"
              class="vault-mark"
              alt=""
              width="422"
              height="512"
            />
            <span class="vault-caption"
              >{vault.t(I18N_KEYS.FirstRunLocalFirstVault)}</span
            >
          </div>
        </div>
      </div>
      <div class="backup-path">
        <span class="path-label"
          >{vault.t(I18N_KEYS.FirstRunLocalFirstOptionalSync)}</span
        >
        <div class="wire">
          <LockKeyhole class="wire-lock" strokeWidth={1.8} />
        </div>
      </div>
      <div class="destination">
        <div class="drive">
          <Folder strokeWidth={1.35} class="drive-folder" />
          <span class="drive-slot"></span>
        </div>
        <span>{vault.t(I18N_KEYS.FirstRunLocalFirstStorage)}</span>
      </div>
    </div>
  </figure>

  <details class="hosting">
    <summary>
      <Server class="size-4" strokeWidth={1.6} aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunLocalFirstSelfHost)}
      <ChevronDown class="disclosure-chevron size-3.5" aria-hidden="true" />
    </summary>
    <figure
      aria-label={vault.t(I18N_KEYS.FirstRunLocalFirstHostingDescription)}
    >
      <div aria-hidden="true">
        <Server class="size-4" />
        {vault.t(I18N_KEYS.FirstRunLocalFirstServer)}
        <ArrowRight class="size-4" />
        <AppWindow class="size-4" />
        {vault.t(I18N_KEYS.FirstRunLocalFirstBrowserApp)}
      </div>
    </figure>
  </details>
</div>

<style>
  .architecture {
    --trace: #447c70;
    min-width: 0;
    container-type: inline-size;
  }
  :global(.dark) .architecture {
    --trace: #7dc4ae;
  }
  .scene {
    margin: 0;
    position: relative;
  }
  .art {
    position: relative;
    isolation: isolate;
    aspect-ratio: 1.85;
    background: radial-gradient(
      ellipse at 43% 56%,
      color-mix(in srgb, var(--trace) 20%, transparent),
      transparent 68%
    );
  }
  .blueprint-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(
        color-mix(in srgb, var(--trace) 18%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--trace) 18%, transparent) 1px,
        transparent 1px
      );
    background-size: 5.5cqw 5.5cqw;
    mask-image: radial-gradient(ellipse, #000 30%, transparent 72%);
  }
  .window-stack {
    position: absolute;
    left: 3%;
    top: 6%;
    width: 54%;
    height: 84%;
    transform: rotate(-2.25deg);
  }
  .window-stack::before,
  .window-stack::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 1px solid #679386;
    border-radius: 2.1cqw;
    background: #203731;
  }
  .window-stack::before {
    transform: translate(-1.4cqw, 1.7cqw);
    opacity: 0.5;
  }
  .window-stack::after {
    transform: translate(-0.65cqw, 0.8cqw);
  }
  .browser {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #729e90;
    border-radius: 2.1cqw;
    box-shadow: 0 1.7cqw 3cqw #06221829;
    background: #12322b;
    color: #e8faf2;
  }
  .chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    flex-shrink: 0;
    min-height: 1.4rem;
    padding: 0.65cqw 2.5cqw;
    border-bottom: 1px solid #729e9069;
    background: linear-gradient(125deg, #2e4840, #182922);
    color: #ddede6;
    font: 500 clamp(0.75rem, 2.4cqw, 0.84rem)/1.35 var(--font-mono, monospace);
  }
  .pins,
  .pins::before,
  .pins::after {
    display: block;
    width: 0.55cqw;
    height: 0.55cqw;
    min-width: 3px;
    min-height: 3px;
    border-radius: 100%;
    background: #a1c5b5;
  }
  .pins {
    position: relative;
    margin-right: 1rem;
  }
  .pins::before,
  .pins::after {
    content: '';
    position: absolute;
  }
  .pins::before {
    left: 1.2cqw;
  }
  .pins::after {
    left: 2.4cqw;
  }

  .chamber {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(
      ellipse at 53% 43%,
      #527665 0%,
      #2b5144 31%,
      #122f27 66%,
      #091d17 100%
    );
  }
  .chamber::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(#b8dbc544 0.65px, transparent 1px) 0 0 / 1.7cqw
      1.7cqw;
    opacity: 0.5;
    mask-image: linear-gradient(115deg, #000, transparent 50%, #000);
  }
  .reticle {
    position: absolute;
    width: 63%;
    aspect-ratio: 1;
    inset: 43% auto auto 50%;
    transform: translate(-50%, -50%);
    border: 1px solid #a0d1b933;
    border-radius: 100%;
    box-shadow:
      0 0 4cqw #9ad7b923,
      inset 0 0 3cqw #79b79a18;
  }
  .vault-mark {
    position: absolute;
    left: 50%;
    top: 44%;
    width: auto;
    height: 80%;
    object-fit: contain;
    transform: translate(-50%, -50%) rotate(2.25deg);
    filter: drop-shadow(0 1.25cqw 1.1cqw #001b14aa);
  }
  .vault-caption {
    position: absolute;
    right: 4%;
    bottom: 5%;
    left: 4%;
    text-align: center;
    color: #e1fae9;
    font-size: clamp(0.79rem, 2.8cqw, 1.05rem);
    font-weight: 580;
  }
  .backup-path {
    position: absolute;
    top: 52%;
    left: 56.5%;
    width: 22%;
    color: var(--trace);
  }
  .path-label {
    display: block;
    position: absolute;
    bottom: 0.75rem;
    width: 100%;
    text-align: center;
    font-size: clamp(0.75rem, 2.6cqw, 0.85rem);
    line-height: 1.2;
    text-wrap: balance;
  }
  .wire {
    position: relative;
    height: 1px;
    border-top: 1px dashed currentColor;
  }
  .wire::after {
    position: absolute;
    content: '';
    top: -3px;
    right: 0;
    width: 5px;
    height: 5px;
    transform: rotate(45deg);
    border-top: 1px solid;
    border-right: 1px solid;
  }
  .wire :global(.wire-lock) {
    position: absolute;
    left: 48%;
    top: 0;
    width: 1.1rem;
    height: 1.1rem;
    transform: translate(-50%, -50%);
    background: var(--background);
    padding: 2px;
  }
  .destination {
    position: absolute;
    top: 52%;
    right: 0.5%;
    width: 20.5%;
    color: var(--foreground);
    text-align: center;
  }
  .drive {
    position: absolute;
    inset: auto 50% auto auto;
    display: grid;
    place-items: center;
    width: 11.5cqw;
    aspect-ratio: 1.18;
    transform: translate(50%, -50%) rotate(-4deg);
    border-radius: 18%;
    border: 1px solid color-mix(in srgb, var(--trace) 70%, var(--background));
    background: linear-gradient(
      150deg,
      color-mix(in srgb, var(--trace) 18%, var(--background)),
      var(--background)
    );
    box-shadow: -0.45cqw 0.65cqw 0
      color-mix(in srgb, var(--trace) 47%, var(--background));
    color: var(--trace);
  }
  .drive :global(.drive-folder) {
    width: 57%;
    height: 57%;
  }
  .drive-slot {
    position: absolute;
    bottom: 10%;
    right: 12%;
    height: 1px;
    width: 13%;
    background: var(--trace);
  }
  .destination > span {
    display: block;
    margin-top: 7.1cqw;
    font-weight: 550;
    font-size: clamp(0.75rem, 2.7cqw, 0.92rem);
    line-height: 1.25;
  }
  .hosting {
    margin: 0.25rem 0 0 3%;
    color: var(--muted-foreground);
  }
  .hosting summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: fit-content;
    min-height: 2.75rem;
    cursor: pointer;
    list-style: none;
    font-size: 0.875rem;
  }
  .hosting summary::-webkit-details-marker {
    display: none;
  }
  .hosting summary:hover {
    color: var(--foreground);
  }
  .hosting[open] :global(.disclosure-chevron) {
    transform: rotate(180deg);
  }
  .hosting figure {
    margin: 0 0 0.5rem;
    padding-left: 0.7rem;
    border-left: 1px solid var(--trace);
  }
  .hosting figure div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: var(--foreground);
    font-size: 0.8rem;
  }
  @media (max-width: 47.99rem) {
    .architecture {
      width: 100%;
      max-width: 27rem;
    }
    .art {
      aspect-ratio: 2.25;
    }
    .window-stack {
      width: 51%;
      height: 88%;
      top: 4%;
    }
    .backup-path {
      left: 54%;
      width: 24%;
    }
    .hosting {
      margin-top: 0;
    }
  }
</style>
