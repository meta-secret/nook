<!--
The identity's dashboard, laid out by what matters. Devices take the wide
tile, one slot each. Cloud copies sit beside it and turn into a warning
while there are none. It only reports: adding a device or a sync provider
lives in Manage on the card. Vaults, sign-in keys
and this browser follow as small tiles. Every tile opens
its own page; other actions live in Manage on the identity's card.
-->
<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import {
    ChevronRight,
    Cloud,
    CloudOff,
    Laptop,
    FolderKey,
    KeyRound,
    MonitorSmartphone,
    SlidersHorizontal,
    TriangleAlert,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { localizeProviderLabel } from "$lib/auth/providers";
  import { NookIdentityNextStep, type NookIdentityHealth } from "$app-wasm";
  import { CurrentDeviceName } from "$lib/components/settings/current-device-name";
  import { DeviceIdLabel } from "$lib/components/settings/device-id-label";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    health,
    onOpen,
  }: {
    vault: VaultState;
    health: NookIdentityHealth;
    onOpen: (section: WorkspaceSection) => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const members = $derived(
    control.snapshot === false ? [] : control.snapshot.members,
  );
  const pendingJoins = $derived(
    control.snapshot === false ? [] : control.snapshot.pendingJoins,
  );
  const unnamed = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed));
  /** Rows a tile names before "+N more". */
  const TILE_NAMES = 2;

  function summary(names: readonly string[]): string {
    const shown = names.slice(0, TILE_NAMES).join(", ");
    if (names.length <= TILE_NAMES) return shown;
    const moreRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewMore,
      replacements: { count: String(names.length - TILE_NAMES) },
    };
    return `${shown} ${vault.t(moreRequest)}`;
  }

  const vaultNames = $derived(
    vault.localVaults.map((entry) => entry.display_label(unnamed)),
  );
  const providerNames = $derived(
    vault.syncProviders.map((provider) => providerName(provider.label)),
  );

  function memberName(
    ...[label, appId, current]: readonly [string, string, boolean]
  ): string {
    if (label.trim()) return label.trim();
    if (current) {
      const nameRequest: ConstructorParameters<typeof CurrentDeviceName>[0] = {
        t: vault.t,
      };
      return new CurrentDeviceName(nameRequest).text;
    }
    const idRequest: ConstructorParameters<typeof DeviceIdLabel>[0] = {
      value: appId,
      head: 6,
      tail: 4,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${new DeviceIdLabel(idRequest).text}`;
  }

  function providerName(label: string): string {
    const labelRequest: Parameters<typeof localizeProviderLabel>[0] = {
      label,
      t: vault.t,
    };
    return localizeProviderLabel(labelRequest);
  }

  const pendingText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewPendingJoins,
      replacements: { count: String(pendingJoins.length) },
    };
    return vault.t(request);
  });

  /** The identity opens on too few devices, or keeps no cloud copy. */
  const devicesAtRisk = $derived(
    health.nextStep === NookIdentityNextStep.AddDevice,
  );
  const copiesAtRisk = $derived(
    health.nextStep === NookIdentityNextStep.AddSyncProvider ||
      health.nextStep === NookIdentityNextStep.AddCloudProvider,
  );
  onMount(() => {
    void control.followOpenVault();
  });
</script>

{#snippet smallTile(
  testId: string,
  title: string,
  value: string,
  detail: string,
  icon: Snippet,
  section: WorkspaceSection,
)}
  <button
    type="button"
    class="group grid min-h-28 min-w-0 content-between gap-3 border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    data-testid={testId}
    onclick={() => onOpen(section)}
  >
    <span class="flex items-center justify-between gap-2 text-muted-foreground">
      <span class="flex min-w-0 items-center gap-2">
        {@render icon()}
        <span class="truncate text-xs font-medium">{title}</span>
      </span>
      <ChevronRight
        class="size-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </span>
    <span class="grid gap-1">
      {#if value}
        <span class="font-mono text-2xl leading-none text-foreground tabular-nums"
          >{value}</span
        >
      {/if}
      <span class="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  </button>
{/snippet}

{#snippet vaultsIcon()}<FolderKey class="size-4" aria-hidden="true" />{/snippet}
{#snippet keysIcon()}<KeyRound class="size-4" aria-hidden="true" />{/snippet}
{#snippet browserIcon()}<SlidersHorizontal class="size-4" aria-hidden="true" />{/snippet}

<div class="grid min-w-0 gap-3" data-testid="identity-overview">
  <div class="grid gap-3 xl:grid-cols-3">
    <!-- Devices: one slot each. -->
    <section
      class="grid min-w-0 content-start gap-4 border bg-card p-5 xl:col-span-2 {devicesAtRisk
        ? 'border-warning/60'
        : 'border-border'}"
      data-testid="overview-devices"
    >
      <header class="flex items-center justify-between gap-3">
        <span class="flex min-w-0 items-center gap-2">
          <MonitorSmartphone class="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.WorkspaceSectionDevices)}
          </h2>
          {#if devicesAtRisk}
            <span class="nk-tag nk-tag-warning">
              <TriangleAlert class="size-3" aria-hidden="true" />
              {vault.t(I18N_KEYS.IdentityOverviewRiskOneDevice)}
            </span>
          {/if}
        </span>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid="overview-open-devices"
          onclick={() => onOpen(WorkspaceSection.Devices)}
        >
          {vault.t(I18N_KEYS.IdentityOverviewViewAll)}
          <ChevronRight class="size-3.5" aria-hidden="true" />
        </button>
      </header>
      <ul class="grid grid-cols-3 gap-2 sm:gap-3">
        {#if members.length === 0}
          <li>
            <button
              type="button"
              class="grid h-full min-h-28 w-full place-items-center gap-2 border border-success/50 bg-background p-3 text-center transition-colors hover:border-success"
              data-testid="overview-device-slot"
              onclick={() => onOpen(WorkspaceSection.Devices)}
            >
              <Laptop class="size-6 text-foreground" aria-hidden="true" />
              <span class="grid gap-1">
                <span class="text-xs text-foreground">
                  {vault.t(I18N_KEYS.IdentityOverviewThisBrowser)}
                </span>
                <span class="nk-tag nk-tag-success justify-self-center">
                  {vault.t(I18N_KEYS.IdentityControlCurrentApp)}
                </span>
              </span>
            </button>
          </li>
        {/if}
        {#each members as member (member.appId)}
          <li>
            <button
              type="button"
              class="grid h-full min-h-28 w-full place-items-center gap-2 border bg-background p-3 text-center transition-colors {member.isCurrentInstallation
                ? 'border-success/50 hover:border-success'
                : 'border-border hover:border-foreground/40'}"
              data-testid="overview-device-slot"
              onclick={() => onOpen(WorkspaceSection.Devices)}
            >
              {#if member.isCurrentInstallation}
                <Laptop class="size-6 text-foreground" aria-hidden="true" />
              {:else}
                <MonitorSmartphone class="size-6 text-foreground" aria-hidden="true" />
              {/if}
              <span class="grid gap-1">
                <span class="line-clamp-2 text-xs text-foreground">
                  {memberName(member.label, member.appId, member.isCurrentInstallation)}
                </span>
                {#if member.isCurrentInstallation}
                  <span class="nk-tag nk-tag-success justify-self-center">
                    {vault.t(I18N_KEYS.IdentityControlCurrentApp)}
                  </span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if pendingJoins.length > 0}
        <button
          type="button"
          class="nk-banner nk-band-success flex items-center justify-between gap-3 px-3 py-2 text-left text-xs text-foreground"
          data-testid="overview-pending-joins"
          onclick={() => onOpen(WorkspaceSection.Devices)}
        >
          {pendingText}
          <ChevronRight class="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      {/if}
    </section>

    <!-- Cloud copies: a warning while there are none. -->
    <section
      class="grid min-w-0 content-between gap-4 border p-5 {copiesAtRisk
        ? 'border-warning/60 bg-warning/5'
        : 'border-border bg-card'}"
      data-testid="overview-sync"
    >
      <header class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2">
          <Cloud class="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.IdentityOverviewCopies)}
          </h2>
        </span>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid="overview-open-sync"
          onclick={() => onOpen(WorkspaceSection.Sync)}
        >
          {vault.t(I18N_KEYS.IdentityOverviewViewAll)}
          <ChevronRight class="size-3.5" aria-hidden="true" />
        </button>
      </header>
      {#if providerNames.length === 0}
        <div class="grid justify-items-start gap-2">
          <CloudOff class="size-7 text-warning" aria-hidden="true" />
          <p class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.IdentityOverviewRiskLocal)}
          </p>
          <p class="text-xs text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.IdentityHealthSyncBody)}
          </p>
        </div>
      {:else}
        <div class="grid gap-1">
          <span class="font-mono text-3xl leading-none text-foreground tabular-nums">
            {providerNames.length}
          </span>
          <span class="line-clamp-2 text-xs text-muted-foreground">
            {summary(providerNames)}
          </span>
        </div>
      {/if}
    </section>
  </div>

  <div class="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
    {@render smallTile(
      "overview-open-vaults",
      vault.t(I18N_KEYS.WorkspaceSectionVaults),
      String(vaultNames.length),
      vaultNames.length === 0
        ? vault.t(I18N_KEYS.IdentityOverviewVaultsEmpty)
        : summary(vaultNames),
      vaultsIcon,
      WorkspaceSection.Vaults,
    )}
    {@render smallTile(
      "overview-keys",
      vault.t(I18N_KEYS.IdentityOverviewKeysLink),
      "",
      vault.t(I18N_KEYS.IdentityOverviewSignIn),
      keysIcon,
      WorkspaceSection.Keys,
    )}
    {@render smallTile(
      "overview-browser-settings",
      vault.t(I18N_KEYS.IdentityMenuBrowser),
      vault.locale.toUpperCase(),
      vault.t(I18N_KEYS.IdentityMenuBrowserHint),
      browserIcon,
      WorkspaceSection.Settings,
    )}
  </div>
</div>
