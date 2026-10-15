<!--
The identity's dashboard: what the card itself does not show, as four
equal tiles (devices, cloud copies, sign-in keys, this browser). Each gives
a count and one line, turns amber with a short warning when the identity
is at risk, and opens its page. It only reports: adding things lives in
Manage, and the vaults are on the card.
-->
<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import {
    ChevronRight,
    Cloud,
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
  /** Each device that opens the identity holds its own key; this browser
   * holds one even before the device list loads. */
  const keyCount = $derived(Math.max(members.length, 1));
  const keyCountText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key:
        keyCount === 1
          ? I18N_KEYS.WorkspaceCardKeyCountSingular
          : I18N_KEYS.WorkspaceCardKeyCountPlural,
      replacements: { count: String(keyCount) },
    };
    return vault.t(request);
  });
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
  const memberNames = $derived(
    members.map((member) =>
      memberName(member.label, member.appId, member.isCurrentInstallation),
    ),
  );
  const deviceCount = $derived(Math.max(members.length, 1));

  type Tile = {
    readonly testId: string;
    readonly section: WorkspaceSection;
    readonly title: string;
    readonly value: string;
    readonly detail: string;
    /** A short warning; the tile turns amber while it shows. */
    readonly risk: string;
    readonly icon: Snippet;
  };

  const tiles = $derived.by((): Tile[] => [
    {
      testId: "overview-open-devices",
      section: WorkspaceSection.Devices,
      title: vault.t(I18N_KEYS.WorkspaceSectionDevices),
      value: String(deviceCount),
      detail:
        summary(memberNames) || vault.t(I18N_KEYS.IdentityOverviewThisBrowser),
      risk: devicesAtRisk
        ? vault.t(I18N_KEYS.IdentityOverviewRiskOneDevice)
        : "",
      icon: devicesIcon,
    },
    {
      testId: "overview-open-sync",
      section: WorkspaceSection.Sync,
      title: vault.t(I18N_KEYS.IdentityOverviewCopies),
      value: String(providerNames.length),
      detail:
        providerNames.length > 0
          ? summary(providerNames)
          : vault.t(I18N_KEYS.IdentityHealthSyncBody),
      risk:
        copiesAtRisk || providerNames.length === 0
          ? vault.t(I18N_KEYS.IdentityOverviewRiskLocal)
          : "",
      icon: copiesIcon,
    },
    {
      testId: "overview-keys",
      section: WorkspaceSection.Keys,
      title: vault.t(I18N_KEYS.IdentityOverviewKeysLink),
      value: String(keyCount),
      detail: keyCountText,
      risk: "",
      icon: keysIcon,
    },
    {
      testId: "overview-browser-settings",
      section: WorkspaceSection.Settings,
      title: vault.t(I18N_KEYS.IdentityMenuBrowser),
      value: vault.locale.toUpperCase(),
      detail: vault.t(I18N_KEYS.IdentityMenuBrowserHint),
      risk: "",
      icon: browserIcon,
    },
  ]);

  onMount(() => {
    void control.followOpenVault();
  });
</script>

{#snippet devicesIcon()}<MonitorSmartphone class="size-4" aria-hidden="true" />{/snippet}
{#snippet copiesIcon()}<Cloud class="size-4" aria-hidden="true" />{/snippet}
{#snippet keysIcon()}<KeyRound class="size-4" aria-hidden="true" />{/snippet}
{#snippet browserIcon()}<SlidersHorizontal class="size-4" aria-hidden="true" />{/snippet}

{#snippet tile(item: Tile)}
  <button
    type="button"
    class="group grid min-h-36 min-w-0 content-between gap-4 border p-5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {item.risk
      ? 'border-warning/50 bg-warning/5 hover:border-warning'
      : 'border-border bg-card hover:border-foreground/40'}"
    data-testid={item.testId}
    data-risk={item.risk ? "true" : "false"}
    onclick={() => onOpen(item.section)}
  >
    <span class="flex items-center justify-between gap-2 text-muted-foreground">
      <span class="flex min-w-0 items-center gap-2">
        {@render item.icon()}
        <span class="truncate text-sm font-medium text-foreground"
          >{item.title}</span
        >
      </span>
      <ChevronRight
        class="size-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </span>
    <span class="grid gap-2">
      <span class="flex items-baseline gap-3">
        <span
          class="font-mono text-3xl leading-none text-foreground tabular-nums"
          >{item.value}</span
        >
        {#if item.risk}
          <span class="nk-tag nk-tag-warning">
            <TriangleAlert class="size-3" aria-hidden="true" />
            {item.risk}
          </span>
        {/if}
      </span>
      <span class="line-clamp-2 text-xs text-pretty text-muted-foreground"
        >{item.detail}</span
      >
    </span>
  </button>
{/snippet}

<div class="grid min-w-0 gap-3" data-testid="identity-overview">
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
  <div class="grid gap-3 sm:grid-cols-2">
    {#each tiles as item (item.testId)}
      {@render tile(item)}
    {/each}
  </div>
</div>
