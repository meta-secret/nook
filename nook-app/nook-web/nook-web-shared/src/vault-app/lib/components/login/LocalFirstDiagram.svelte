<script lang="ts">
  import {
    Archive,
    ArrowDown,
    Braces,
    Globe,
    KeyRound,
    LockKeyhole,
    Monitor,
    ShieldCheck,
  } from '@lucide/svelte'
  import GoogleDriveMark from '../provider-marks/GoogleDriveMark.svelte'
  import ICloudMark from '../provider-marks/ICloudMark.svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()
</script>

<figure
  class="nk-local-diagram m-0 grid min-w-0 gap-0"
  aria-label={vault.t(I18N_KEYS.FirstRunLocalFirstDiagramDescription)}
>
  <div
    class="nk-frame-nick flex w-full items-center gap-3 px-3.5 py-2.5 min-[420px]:w-fit min-[420px]:max-w-full"
    data-testid="local-vault-passkey"
  >
    <span
      class="nk-tile nk-tile-sm shrink-0 text-foreground"
      aria-hidden="true"
    >
      <KeyRound class="size-4" />
    </span>
    <span class="grid min-w-0 gap-0.5">
      <strong class="text-sm leading-tight font-semibold text-foreground">
        {vault.t(I18N_KEYS.FirstRunLocalFirstPasskey)}
      </strong>
      <span class="text-xs leading-tight text-muted-foreground">
        {vault.t(I18N_KEYS.FirstRunLocalFirstPasskeyDetail)}
      </span>
    </span>
  </div>

  <div class="ml-6 flex items-center gap-2 py-1.5">
    <span
      class="flex flex-col items-center text-muted-foreground"
      aria-hidden="true"
    >
      <span class="h-3 w-px bg-border"></span>
      <ArrowDown class="-mt-1 size-3.5" />
    </span>
    <span
      class="font-mono text-[0.6875rem] tracking-[0.06em] text-muted-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunLocalFirstUnlocks)}
    </span>
  </div>

  <div
    class="nk-frame-keytag nk-frame-live relative grid min-w-0 gap-3.5 p-4 sm:p-5"
    data-testid="local-vault-browser"
  >
    <span class="nk-edge-glint" aria-hidden="true"></span>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5 pr-4"
    >
      <span
        class="nk-label inline-flex items-center gap-1.5 text-foreground/80"
      >
        <Monitor
          class="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {vault.t(I18N_KEYS.FirstRunLocalFirstBrowser)}
      </span>
      <span
        class="nk-tag nk-tag-success whitespace-normal sm:whitespace-nowrap"
      >
        <span class="nk-tag-dot" aria-hidden="true"></span>
        {vault.t(I18N_KEYS.FirstRunLocalFirstOwnershipTag)}
      </span>
    </div>

    <div class="grid gap-2.5">
      <div class="flex items-center gap-2.5">
        <span class="nk-vault-icon nk-vault-icon-open" aria-hidden="true">
          <LockKeyhole class="size-4" />
        </span>
        <strong
          class="text-base leading-snug font-semibold tracking-[-0.015em] text-foreground"
        >
          {vault.t(I18N_KEYS.FirstRunLocalFirstVault)}
        </strong>
      </div>

      <div class="nk-vault-slots">
        <div
          class="nk-frame-nick nk-slot-sealed flex min-w-0 items-center gap-2 px-2.5 py-2"
        >
          <Globe
            class="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            class="min-w-0 text-xs leading-tight font-medium wrap-break-word text-foreground/90"
          >
            {vault.t(I18N_KEYS.FirstRunLocalFirstItemsPasswords)}
          </span>
        </div>
        <div
          class="nk-frame-nick nk-slot-sealed flex min-w-0 items-center gap-2 px-2.5 py-2"
        >
          <ShieldCheck
            class="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            class="min-w-0 text-xs leading-tight font-medium wrap-break-word text-foreground/90"
          >
            {vault.t(I18N_KEYS.FirstRunLocalFirstItemsTotp)}
          </span>
        </div>
        <div
          class="nk-frame-nick nk-slot-sealed flex min-w-0 items-center gap-2 px-2.5 py-2"
        >
          <Braces
            class="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            class="min-w-0 text-xs leading-tight font-medium wrap-break-word text-foreground/90"
          >
            {vault.t(I18N_KEYS.FirstRunLocalFirstItemsSecrets)}
          </span>
        </div>
      </div>
    </div>

    <div class="border-t border-border pt-2.5">
      <div class="nk-spec text-xs text-muted-foreground">
        <ShieldCheck
          class="size-3.5 shrink-0 text-success"
          aria-hidden="true"
        />
        <span>{vault.t(I18N_KEYS.FirstRunLocalFirstZeroServer)}</span>
      </div>
    </div>
  </div>

  <div class="ml-6 flex items-center gap-2 py-1.5 sm:ml-8">
    <span class="h-5 border-l border-dashed border-border" aria-hidden="true"
    ></span>
    <LockKeyhole
      class="size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <span class="nk-tag whitespace-normal text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunLocalFirstOptionalSync)}
    </span>
  </div>

  <div
    class="nk-subpanel-recessed ml-4 flex min-w-0 items-start gap-3 border-dashed px-3.5 py-3 sm:ml-6"
    data-testid="local-vault-cloud"
  >
    <span
      class="flex shrink-0 items-center gap-1.5 pt-0.5 text-muted-foreground"
      aria-hidden="true"
    >
      <GoogleDriveMark class="size-3.5" />
      <ICloudMark class="size-3.5" />
      <Archive class="size-3.5" />
    </span>
    <span class="grid min-w-0 gap-0.5">
      <span class="text-xs font-semibold text-foreground/90">
        {vault.t(I18N_KEYS.FirstRunLocalFirstStorage)}
      </span>
      <span class="text-xs leading-snug text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.FirstRunLocalFirstStorageDetail)}
      </span>
    </span>
  </div>
</figure>

<style>
  .nk-local-diagram {
    container-type: inline-size;
  }

  .nk-vault-slots {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
  }

  @container (width >= 24rem) {
    .nk-vault-slots {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
