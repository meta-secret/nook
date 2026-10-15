<!--
The identity's dashboard: one tile per part of the identity, each with its
count, a short summary and a warning when that part puts the identity at
risk. A tile opens the part's own page. A line at the top says what is at
risk with the one action that fixes it; other actions live in Manage on
the identity's card.
-->
<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import {
    ChevronRight,
    Cloud,
    FolderKey,
    KeyRound,
    MonitorSmartphone,
    ShieldCheck,
    SlidersHorizontal,
    TriangleAlert,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
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
    onAddSyncProvider,
  }: {
    vault: VaultState;
    health: NookIdentityHealth;
    onOpen: (section: WorkspaceSection) => void;
    onAddSyncProvider: () => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const members = $derived(
    control.snapshot === false ? [] : control.snapshot.members,
  );
  const pendingJoins = $derived(
    control.snapshot === false ? [] : control.snapshot.pendingJoins,
  );
  const unnamed = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed));
  const passwordCount = $derived(vault.passwordEntries.length);
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

  const deviceNames = $derived(
    members.map((member) =>
      memberName(member.label, member.appId, member.isCurrentInstallation),
    ),
  );
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

  const passwordsText = $derived.by(() => {
    if (passwordCount === 0)
      return vault.t(I18N_KEYS.IdentityOverviewPasswordsNone);
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewPasswordsCount,
      replacements: { count: String(passwordCount) },
    };
    return vault.t(request);
  });
  const pendingText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewPendingJoins,
      replacements: { count: String(pendingJoins.length) },
    };
    return vault.t(request);
  });

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

{#snippet tile(
  testId: string,
  title: string,
  count: string,
  detail: string,
  warning: string,
  icon: Snippet,
  onclick: () => void,
)}
  <button
    type="button"
    class="group grid min-h-36 content-between gap-4 border border-border bg-card p-5 text-left transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    data-testid={testId}
    {onclick}
  >
    <span class="flex items-start justify-between gap-3">
      <span class="flex min-w-0 items-center gap-3">
        <span class="nk-tile shrink-0" aria-hidden="true">{@render icon()}</span>
        <span class="truncate text-sm font-semibold text-foreground">{title}</span>
      </span>
      <ChevronRight
        class="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </span>
    <span class="grid gap-1.5">
      {#if count}
        <span class="font-mono text-3xl leading-none text-foreground tabular-nums">
          {count}
        </span>
      {/if}
      <span class="line-clamp-2 text-xs text-pretty text-muted-foreground">{detail}</span>
      {#if warning}
        <span class="nk-tag nk-tag-warning justify-self-start">
          <TriangleAlert class="size-3" aria-hidden="true" />
          {warning}
        </span>
      {/if}
    </span>
  </button>
{/snippet}

{#snippet devicesIcon()}<MonitorSmartphone class="size-4" />{/snippet}
{#snippet vaultsIcon()}<FolderKey class="size-4" />{/snippet}
{#snippet copiesIcon()}<Cloud class="size-4" />{/snippet}
{#snippet keysIcon()}<KeyRound class="size-4" />{/snippet}
{#snippet passwordsIcon()}<ShieldCheck class="size-4" />{/snippet}
{#snippet browserIcon()}<SlidersHorizontal class="size-4" />{/snippet}

<div class="grid min-w-0 gap-6" data-testid="identity-overview">
  {#if health.nextStep === NookIdentityNextStep.Done}
    <p
      class="flex items-center gap-2 text-sm text-foreground"
      data-testid="overview-all-set"
    >
      <ShieldCheck class="size-4 shrink-0 text-success" aria-hidden="true" />
      {vault.t(I18N_KEYS.IdentityOverviewAllSet)}
    </p>
  {:else}
    <div
      class="nk-banner nk-banner-warning flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="overview-next-step"
      data-next-step={NookIdentityNextStep[health.nextStep]}
    >
      <div class="flex min-w-0 items-start gap-3">
        <TriangleAlert
          class="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div class="grid gap-0.5">
          <p class="text-sm font-semibold text-foreground">
            {#if health.nextStep === NookIdentityNextStep.AddDevice}
              {vault.t(I18N_KEYS.IdentityHealthDeviceTitle)}
            {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
              {vault.t(I18N_KEYS.IdentityHealthCloudTitle)}
            {:else}
              {vault.t(I18N_KEYS.IdentityHealthSyncTitle)}
            {/if}
          </p>
          <p class="text-xs text-pretty text-muted-foreground">
            {#if health.nextStep === NookIdentityNextStep.AddDevice}
              {vault.t(I18N_KEYS.IdentityHealthDeviceBody)}
            {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
              {vault.t(I18N_KEYS.IdentityHealthCloudBody)}
            {:else}
              {vault.t(I18N_KEYS.IdentityHealthSyncBody)}
            {/if}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        class="shrink-0"
        data-testid="overview-next-step-btn"
        onclick={nextStep}
      >
        {#if health.nextStep === NookIdentityNextStep.AddDevice}
          {vault.t(I18N_KEYS.IdentityHealthDeviceCta)}
        {:else if health.nextStep === NookIdentityNextStep.AddCloudProvider}
          {vault.t(I18N_KEYS.IdentityHealthCloudCta)}
        {:else}
          {vault.t(I18N_KEYS.IdentityHealthSyncCta)}
        {/if}
      </Button>
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {@render tile(
      "overview-open-devices",
      vault.t(I18N_KEYS.WorkspaceSectionDevices),
      String(Math.max(members.length, 1)),
      members.length === 0
        ? vault.t(I18N_KEYS.IdentityOverviewDevicesEmpty)
        : summary(deviceNames),
      members.length <= 1 ? vault.t(I18N_KEYS.IdentityOverviewRiskOneDevice) : "",
      devicesIcon,
      () => onOpen(WorkspaceSection.Devices),
    )}
    {@render tile(
      "overview-open-vaults",
      vault.t(I18N_KEYS.WorkspaceSectionVaults),
      String(vaultNames.length),
      vaultNames.length === 0
        ? vault.t(I18N_KEYS.IdentityOverviewVaultsEmpty)
        : summary(vaultNames),
      "",
      vaultsIcon,
      () => onOpen(WorkspaceSection.Vaults),
    )}
    {@render tile(
      "overview-open-sync",
      vault.t(I18N_KEYS.IdentityOverviewCopies),
      String(providerNames.length),
      providerNames.length === 0
        ? vault.t(I18N_KEYS.IdentityOverviewSyncEmpty)
        : summary(providerNames),
      providerNames.length === 0
        ? vault.t(I18N_KEYS.IdentityOverviewRiskLocal)
        : "",
      copiesIcon,
      () => onOpen(WorkspaceSection.Sync),
    )}
    {@render tile(
      "overview-keys",
      vault.t(I18N_KEYS.IdentityOverviewKeysLink),
      "",
      vault.t(I18N_KEYS.WorkspaceSectionKeysDescription),
      "",
      keysIcon,
      () => onOpen(WorkspaceSection.Keys),
    )}
    {@render tile(
      "overview-passwords",
      vault.t(I18N_KEYS.IdentityOverviewPasswordsLink),
      String(passwordCount),
      passwordsText,
      "",
      passwordsIcon,
      () => onOpen(WorkspaceSection.Passwords),
    )}
    {@render tile(
      "overview-browser-settings",
      vault.t(I18N_KEYS.IdentityMenuBrowser),
      "",
      vault.t(I18N_KEYS.IdentityMenuBrowserHint),
      "",
      browserIcon,
      () => onOpen(WorkspaceSection.Settings),
    )}
  </div>

  {#if pendingJoins.length > 0}
    <button
      type="button"
      class="nk-banner nk-band-success flex items-center justify-between gap-3 px-4 py-3 text-left text-sm text-foreground"
      data-testid="overview-pending-joins"
      onclick={() => onOpen(WorkspaceSection.Devices)}
    >
      {pendingText}
      <ChevronRight class="size-4 shrink-0" aria-hidden="true" />
    </button>
  {/if}
</div>
