<!--
The identity at a glance, read as one system: who it is and how protected
(a three-rung ladder with the single next step), then its parts in the
order things flow: the vaults it holds are copied to sync providers, and
devices open them through those copies. Each part opens its own page for
the details; keys and backup passwords sit quietly below.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import {
    ArrowDown,
    ArrowRight,
    Check,
    ChevronRight,
    Cloud,
    FolderKey,
    KeyRound,
    MonitorSmartphone,
    Plus,
    ShieldCheck,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import { localizeProviderLabel } from "$lib/auth/providers";
  import {
    NookIdentityHealthStage,
    NookIdentityNextStep,
    type NookIdentityHealth,
  } from "$app-wasm";
  import {
    IdentityVaultRowState,
    type IdentityCardView,
  } from "$lib/components/identities/identity-card-model";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    card,
    health,
    onOpen,
    onOpenVault,
    onNewVault,
    onAddSyncProvider,
  }: {
    vault: VaultState;
    card: IdentityCardView;
    health: NookIdentityHealth;
    onOpen: (section: WorkspaceSection) => void;
    onOpenVault: (storeId: string) => void;
    onNewVault: () => void;
    onAddSyncProvider: () => void;
  } = $props();

  /** Rows a part tile lists before "+N more". */
  const TILE_ROWS = 3;

  const control = $derived(vault.identityControl);
  const members = $derived(
    control.snapshot === false ? [] : control.snapshot.members,
  );
  const pendingJoins = $derived(
    control.snapshot === false ? [] : control.snapshot.pendingJoins,
  );
  const vaults = $derived(
    card.vaults.filter((row) => row.state !== IdentityVaultRowState.Unavailable),
  );
  const providers = $derived(vault.syncProviders);
  const passwordCount = $derived(vault.passwordEntries.length);

  const RUNGS: readonly NookIdentityHealthStage[] = [
    NookIdentityHealthStage.LocalOnly,
    NookIdentityHealthStage.CopyKept,
    NookIdentityHealthStage.MultiDevice,
  ];
  const reached = $derived(RUNGS.indexOf(health.stage));

  function rungLabel(stage: NookIdentityHealthStage): string {
    switch (stage) {
      case NookIdentityHealthStage.LocalOnly:
        return vault.t(I18N_KEYS.IdentityHealthStageLocalOnly);
      case NookIdentityHealthStage.CopyKept:
        return vault.t(I18N_KEYS.IdentityHealthStageCopyKept);
      case NookIdentityHealthStage.MultiDevice:
        return vault.t(I18N_KEYS.IdentityHealthStageMultiDevice);
    }
  }

  function moreText(hidden: number): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewMore,
      replacements: { count: String(hidden) },
    };
    return vault.t(request);
  }
  const pendingText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewPendingJoins,
      replacements: { count: String(pendingJoins.length) },
    };
    return vault.t(request);
  });
  const passwordsText = $derived.by(() => {
    if (passwordCount === 0)
      return vault.t(I18N_KEYS.IdentityOverviewPasswordsNone);
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewPasswordsCount,
      replacements: { count: String(passwordCount) },
    };
    return vault.t(request);
  });

  function providerName(index: number): string {
    const provider = providers[index];
    if (!provider) return "";
    const labelRequest: Parameters<typeof localizeProviderLabel>[0] = {
      label: provider.label,
      t: vault.t,
    };
    return localizeProviderLabel(labelRequest);
  }

  function nextStep(): void {
    if (health.nextStep === NookIdentityNextStep.AddDevice) {
      onOpen(WorkspaceSection.AddDevice);
      return;
    }
    onAddSyncProvider();
  }

  onMount(() => {
    void control.followOpenVault();
  });
</script>

{#snippet tileHead(
  section: WorkspaceSection,
  title: string,
  caption: string,
  count: number,
)}
  <button
    type="button"
    class="group flex w-full items-start justify-between gap-3 text-left"
    data-testid="overview-open-{section}"
    onclick={() => onOpen(section)}
  >
    <span class="flex min-w-0 items-center gap-3">
      <span class="nk-tile shrink-0" aria-hidden="true">
        {#if section === WorkspaceSection.Vaults}
          <FolderKey class="size-4" />
        {:else if section === WorkspaceSection.Sync}
          <Cloud class="size-4" />
        {:else}
          <MonitorSmartphone class="size-4" />
        {/if}
      </span>
      <span class="min-w-0">
        <span
          class="flex items-center gap-1 text-sm font-semibold text-foreground"
        >
          {title}
          <ChevronRight
            class="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
        <span class="block text-xs text-muted-foreground">{caption}</span>
      </span>
    </span>
    <span
      class="font-mono text-2xl leading-none text-foreground tabular-nums"
      data-testid="overview-count-{section}"
    >
      {count}
    </span>
  </button>
{/snippet}

{#snippet more(count: number)}
  {#if count > TILE_ROWS}
    <li class="px-1 pt-1 font-mono text-[11px] text-muted-foreground">
      {moreText(count - TILE_ROWS)}
    </li>
  {/if}
{/snippet}

{#snippet link(label: string)}
  <span
    class="flex flex-col items-center justify-center gap-1 py-1 text-muted-foreground lg:px-1"
    aria-hidden="true"
  >
    <span class="font-mono text-[10px] tracking-[0.06em] uppercase">
      {label}
    </span>
    <ArrowRight class="hidden size-4 lg:block" />
    <ArrowDown class="size-4 lg:hidden" />
  </span>
{/snippet}

<div class="grid min-w-0 gap-6" data-testid="identity-overview">
  <!-- Who the identity is, and how protected. -->
  <section
    class="grid gap-5 border border-border bg-card p-4 sm:p-6"
    data-testid="overview-identity"
    data-stage={NookIdentityHealthStage[health.stage]}
  >
    <div class="flex items-center gap-4">
      <span
        class="nk-monogram nk-monogram-lg shrink-0"
        style:--nk-hue={card.hue}
        aria-hidden="true">{card.monogram}</span
      >
      <div class="min-w-0">
        <p class="nk-label">{vault.t(I18N_KEYS.IdentityOverviewEyebrow)}</p>
        <p class="truncate text-xl font-semibold text-foreground">
          {card.label}
        </p>
        {#if card.fingerprint.length > 0}
          <p class="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            {card.fingerprint.join(" ")}
          </p>
        {/if}
      </div>
    </div>

    <div class="grid gap-3">
      <p class="nk-label">{vault.t(I18N_KEYS.IdentityOverviewProtection)}</p>
      <ol class="grid grid-cols-3 gap-2" data-testid="overview-ladder">
        {#each RUNGS as stage, index (stage)}
          <li
            class={[
              "flex items-start gap-1.5 border-t-2 pt-2 font-mono text-[11px] leading-tight tracking-[0.06em] uppercase",
              index < reached
                ? "border-success text-success"
                : index === reached
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground",
            ]}
            {...index === reached ? { "aria-current": "step" } : {}}
          >
            {#if index < reached}
              <Check class="size-3.5 shrink-0" aria-hidden="true" />
            {/if}
            <span class="min-w-0">{rungLabel(stage)}</span>
          </li>
        {/each}
      </ol>
      {#if health.nextStep === NookIdentityNextStep.Done}
        <p
          class="flex items-center gap-2 text-sm text-foreground"
          data-testid="overview-all-set"
        >
          <ShieldCheck class="size-4 text-success" aria-hidden="true" />
          {vault.t(I18N_KEYS.IdentityOverviewAllSet)}
        </p>
      {:else}
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="overview-next-step"
          data-next-step={NookIdentityNextStep[health.nextStep]}
        >
          <div class="min-w-0 space-y-0.5">
            <p class="text-sm font-semibold text-foreground">
              {#if health.nextStep === NookIdentityNextStep.AddSyncProvider}
                {vault.t(I18N_KEYS.IdentityHealthSyncTitle)}
              {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
                {vault.t(I18N_KEYS.IdentityHealthCloudTitle)}
              {:else}
                {vault.t(I18N_KEYS.IdentityHealthDeviceTitle)}
              {/if}
            </p>
            <p class="text-xs text-pretty text-muted-foreground">
              {#if health.nextStep === NookIdentityNextStep.AddSyncProvider}
                {vault.t(I18N_KEYS.IdentityHealthSyncBody)}
              {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
                {vault.t(I18N_KEYS.IdentityHealthCloudBody)}
              {:else}
                {vault.t(I18N_KEYS.IdentityHealthDeviceBody)}
              {/if}
            </p>
          </div>
          <Button
            type="button"
            class="shrink-0"
            data-testid="overview-next-step-btn"
            onclick={nextStep}
          >
            {#if health.nextStep === NookIdentityNextStep.AddSyncProvider}
              {vault.t(I18N_KEYS.IdentityHealthSyncCta)}
            {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
              {vault.t(I18N_KEYS.IdentityHealthCloudCta)}
            {:else}
              {vault.t(I18N_KEYS.IdentityHealthDeviceCta)}
            {/if}
          </Button>
        </div>
      {/if}
    </div>
  </section>

  <!-- Its parts, in the order things flow. -->
  <div
    class="grid grid-cols-1 items-stretch lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]"
    data-testid="overview-parts"
  >
    <section class="grid content-start gap-4 border border-border p-4">
      {@render tileHead(
        WorkspaceSection.Vaults,
        vault.t(I18N_KEYS.WorkspaceSectionVaults),
        vault.t(I18N_KEYS.IdentityOverviewVaultsCaption),
        vaults.length,
      )}
      {#if vaults.length === 0}
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.IdentityOverviewVaultsEmpty)}
        </p>
      {:else}
        <ul class="grid gap-0.5">
          {#each vaults.slice(0, TILE_ROWS) as row (row.storeId)}
            <li>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-1 py-1 text-left text-sm text-foreground hover:bg-accent"
                data-testid="overview-vault"
                onclick={() => onOpenVault(row.storeId)}
              >
                <span class="truncate">{row.label}</span>
                {#if row.state === IdentityVaultRowState.Open}
                  <span class="nk-tag nk-tag-success shrink-0">
                    {vault.t(I18N_KEYS.VaultSwitcherOpenBadge)}
                  </span>
                {/if}
              </button>
            </li>
          {/each}
          {@render more(vaults.length)}
        </ul>
      {/if}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="justify-self-start"
        data-testid="overview-new-vault"
        onclick={onNewVault}
      >
        <Plus class="size-4" />
        {vault.t(I18N_KEYS.WorkspaceNewVault)}
      </Button>
    </section>

    {@render link(vault.t(I18N_KEYS.IdentityOverviewCopiedTo))}

    <section class="grid content-start gap-4 border border-border p-4">
      {@render tileHead(
        WorkspaceSection.Sync,
        vault.t(I18N_KEYS.WorkspaceSectionSync),
        vault.t(I18N_KEYS.IdentityOverviewSyncCaption),
        providers.length,
      )}
      {#if providers.length === 0}
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.IdentityOverviewSyncEmpty)}
        </p>
      {:else}
        <ul class="grid gap-0.5">
          {#each providers.slice(0, TILE_ROWS) as provider, index (provider.id)}
            <li class="truncate px-1 py-1 text-sm text-foreground">
              {providerName(index)}
            </li>
          {/each}
          {@render more(providers.length)}
        </ul>
      {/if}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="justify-self-start"
        data-testid="overview-add-sync"
        onclick={onAddSyncProvider}
      >
        <Plus class="size-4" />
        {vault.t(I18N_KEYS.SettingsAddSyncProvider)}
      </Button>
    </section>

    {@render link(vault.t(I18N_KEYS.IdentityOverviewOpensOn))}

    <section class="grid content-start gap-4 border border-border p-4">
      {@render tileHead(
        WorkspaceSection.Devices,
        vault.t(I18N_KEYS.WorkspaceSectionDevices),
        vault.t(I18N_KEYS.IdentityOverviewDevicesCaption),
        Math.max(members.length, 1),
      )}
      {#if members.length <= 1}
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.IdentityOverviewDevicesEmpty)}
        </p>
      {:else}
        <ul class="grid gap-0.5">
          {#each members.slice(0, TILE_ROWS) as member (member.appId)}
            <li class="truncate px-1 py-1 text-sm text-foreground">
              {member.label.trim() ||
                (member.isCurrentInstallation
                  ? vault.t(I18N_KEYS.IdentityOverviewThisBrowser)
                  : member.appId.slice(0, 10))}
            </li>
          {/each}
          {@render more(members.length)}
        </ul>
      {/if}
      {#if pendingJoins.length > 0}
        <button
          type="button"
          class="nk-tag nk-tag-success justify-self-start"
          data-testid="overview-pending-joins"
          onclick={() => onOpen(WorkspaceSection.Devices)}
        >
          {pendingText}
        </button>
      {/if}
      <div class="grid gap-1 justify-self-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="justify-self-start"
          data-testid="overview-add-device"
          onclick={() => onOpen(WorkspaceSection.AddDevice)}
        >
          <Plus class="size-4" />
          {vault.t(I18N_KEYS.IdentityOverviewAddDevice)}
        </Button>
      </div>
    </section>
  </div>

  <!-- Who can unlock it. -->
  <section
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-sm"
    data-testid="overview-security"
  >
    <span class="nk-label">{vault.t(I18N_KEYS.IdentityOverviewSecurity)}</span>
    <button
      type="button"
      class="inline-flex items-center gap-2 text-foreground hover:underline"
      data-testid="overview-keys"
      onclick={() => onOpen(WorkspaceSection.Keys)}
    >
      <KeyRound class="size-4 text-muted-foreground" aria-hidden="true" />
      {vault.t(I18N_KEYS.IdentityOverviewKeysLink)}
      <span class="font-mono text-xs text-muted-foreground">{card.keyCount}</span>
    </button>
    <button
      type="button"
      class="inline-flex items-center gap-2 text-foreground hover:underline"
      data-testid="overview-passwords"
      onclick={() => onOpen(WorkspaceSection.Passwords)}
    >
      <ShieldCheck class="size-4 text-muted-foreground" aria-hidden="true" />
      {vault.t(I18N_KEYS.IdentityOverviewPasswordsLink)}
      <span class="font-mono text-xs text-muted-foreground">
        {passwordsText}
      </span>
    </button>
  </section>
</div>
