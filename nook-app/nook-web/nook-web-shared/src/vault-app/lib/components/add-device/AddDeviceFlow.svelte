<!--
Adding a device, as one focused page outside identity management: what
happens in a sentence and a small diagram, then three steps. The identity
needs a cloud copy the new device can reach; an invite (QR code, link and
passphrase) is made through it; the new device redeems the invite and the
request is approved here. Every place that offers "Add a device" opens this.
-->
<script lang="ts">
  import { Check, RefreshCw } from "@lucide/svelte";
  import { onMount, type ComponentProps, type Snippet } from "svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import OnboardDevice from "$lib/components/OnboardDevice.svelte";
  import IdentityStandingNotices from "$lib/components/identity-control/IdentityStandingNotices.svelte";
  import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
  import JoinFlowDiagram from "$lib/components/join/JoinFlowDiagram.svelte";
  import { JoinSide } from "$lib/components/join/join-flow";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import PendingJoinList from "$lib/components/settings/PendingJoinList.svelte";
  import { Button } from "$lib/components/ui/button";
  import { enrollmentBrowser } from "$lib/enrollment/code";
  import type { VaultState } from "$lib/vault.svelte";
  import { DeviceJoinMounts } from "./device-join-mounts";

  type OnboardDeviceProps = ComponentProps<typeof OnboardDevice>;
  type PendingJoinListProps = ComponentProps<typeof PendingJoinList>;

  /** How often an open invite checks the identity log for its request. */
  const JOIN_CHECK_INTERVAL_MS = 8_000;

  let {
    vault,
    identityName,
    onBack,
    onOpenSync,
  }: {
    vault: VaultState;
    identityName: string;
    /** Leave the flow for the page it was opened from. */
    onBack: () => void;
    /** Add a sync provider so the identity has a cloud copy. */
    onOpenSync: () => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const snapshot = $derived(control.snapshot);
  const standing = $derived(new IdentityStandingPresentation(snapshot));
  const pendingJoins = $derived(snapshot === false ? [] : snapshot.pendingJoins);
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);
  const joinMounts = $derived.by(() => {
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts: control.mounts,
      replication: vault.vaultArchitecture.replication_type,
    };
    return new DeviceJoinMounts(mountRequest).compatible;
  });
  const cloudReady = $derived(joinMounts.length > 0);
  const inviteReady = $derived(vault.enrollmentCode !== "");
  /** A request approved from this page; the flow is then complete. */
  let approved = $state(false);

  const intro = $derived.by(() => {
    const introRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AddDeviceIntro,
      replacements: { identity: identityName },
    };
    return vault.t(introRequest);
  });
  const manualJoin = $derived.by(() => {
    const appUrl = enrollmentBrowser
      .getEnrollmentLinkBase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const manualRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AddDeviceJoinManual,
      replacements: { url: appUrl },
    };
    return vault.t(manualRequest);
  });

  function stepLabel(number: number): string {
    const stepRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AddDeviceStep,
      replacements: { number: String(number) },
    };
    return vault.t(stepRequest);
  }

  function reportFailure(translationKey: Parameters<typeof vault.t>[0]) {
    vault.errorMsg = vault.t(translationKey);
  }

  function checkForRequests(): void {
    void control.syncWithMounts().then((synced) => {
      if (synced.isErr()) reportFailure(synced.error.translationKey);
    });
  }

  async function approve(
    appId: Parameters<PendingJoinListProps["onApproveJoin"]>[0],
  ): ReturnType<PendingJoinListProps["onApproveJoin"]> {
    const approval = await control.approve(appId);
    if (approval.isOk()) approved = true;
    return approval;
  }

  onMount(() => {
    void control.followOpenVault().then((refreshed) => {
      if (refreshed.isErr()) reportFailure(refreshed.error.translationKey);
    });
  });

  // While an invite waits for its device, look for the request now and then
  // so it shows up without a click.
  $effect(() => {
    if (!inviteReady || approved || pendingJoins.length > 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (control.busy || vault.isSaving || vault.isVerifying) return;
      checkForRequests();
    }, JOIN_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  });
</script>

{#snippet step(
  number: number,
  title: string,
  done: boolean,
  upcoming: boolean,
  testId: string,
  content: Snippet,
)}
  <li class="group relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 pb-8 last:pb-0" data-testid={testId}>
    <span
      class="relative z-10 grid size-8 place-items-center border font-mono text-sm {done
        ? 'border-success bg-success text-background'
        : upcoming
          ? 'border-border bg-card text-muted-foreground'
          : 'border-foreground bg-foreground text-background'}"
      aria-hidden="true"
    >
      {#if done}
        <Check class="size-4" />
      {:else}
        {number}
      {/if}
    </span>
    <span
      class="absolute top-8 bottom-0 left-4 w-px bg-border group-last:hidden"
      aria-hidden="true"
    ></span>
    <div class="grid min-w-0 gap-3 pt-1 {upcoming ? 'opacity-60' : ''}">
      <h2 class="text-base font-semibold text-foreground">
        <span class="sr-only">{stepLabel(number)}:</span>
        {title}
      </h2>
      {@render content()}
    </div>
  </li>
{/snippet}

{#snippet cloudStep()}
  {#if cloudReady}
    <p class="text-sm text-pretty text-muted-foreground" data-testid="add-device-cloud-ready">
      {vault.t(I18N_KEYS.AddDeviceCloudReady)}
    </p>
  {:else}
    <div class="grid justify-items-start gap-3" data-testid="onboard-no-identity-mount">
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.AddDeviceCloudMissing)}
      </p>
      <Button type="button" data-testid="onboard-open-sync-btn" onclick={onOpenSync}>
        {vault.t(I18N_KEYS.AddDeviceCloudAction)}
      </Button>
    </div>
  {/if}
{/snippet}

{#snippet inviteStep()}
  {#if !cloudReady}
    <p class="text-sm text-muted-foreground">
      {vault.t(I18N_KEYS.AddDeviceLockedStep)}
    </p>
  {:else}
    {#if !inviteReady}
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.AddDeviceInviteBody)}
      </p>
    {/if}
    <OnboardDevice
      {vault}
      mounts={control.mounts}
      enrollmentCode={vault.enrollmentCode}
      {isBusy}
      onIssueCode={(issueRequest: Parameters<OnboardDeviceProps["onIssueCode"]>[0]) =>
        vault.issueEnrollmentCode(issueRequest)}
      onClearCode={() => vault.clearEnrollmentCode()}
    />
  {/if}
{/snippet}

{#snippet joinStep()}
  {#if approved}
    <div class="grid justify-items-start gap-3" data-testid="add-device-approved">
      <p class="nk-banner nk-band-success px-4 py-3 text-sm text-foreground" role="status">
        {vault.t(I18N_KEYS.AddDeviceApproved)}
      </p>
      <Button type="button" data-testid="add-device-done" onclick={onBack}>
        {vault.t(I18N_KEYS.AddDeviceDone)}
      </Button>
    </div>
  {:else}
    <ol class="grid list-decimal gap-1.5 pl-5 text-sm text-pretty text-muted-foreground marker:text-foreground">
      <li>{vault.t(I18N_KEYS.AddDeviceJoinScan)}</li>
      <li>{vault.t(I18N_KEYS.AddDeviceJoinPassphrase)}</li>
      <li>{vault.t(I18N_KEYS.AddDeviceJoinApprove)}</li>
    </ol>
    <p class="text-xs text-pretty text-muted-foreground">{manualJoin}</p>
    {#if pendingJoins.length > 0}
      <PendingJoinList
        {vault}
        {pendingJoins}
        {isBusy}
        onApproveJoin={approve}
        onDenyJoin={(appId: Parameters<PendingJoinListProps["onDenyJoin"]>[0]) =>
          control.deny(appId)}
      />
    {:else if inviteReady}
      <div
        class="flex flex-wrap items-center justify-between gap-3 border border-dashed border-border px-4 py-3"
        data-testid="add-device-waiting"
        role="status"
        aria-live="polite"
      >
        <span class="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw class="size-4 shrink-0 {control.busy ? 'animate-spin' : ''}" aria-hidden="true" />
          {vault.t(I18N_KEYS.AddDeviceWaiting)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          data-testid="add-device-check"
          onclick={checkForRequests}
        >
          {vault.t(I18N_KEYS.AddDeviceCheck)}
        </Button>
      </div>
    {/if}
  {/if}
{/snippet}

<section
  class="mx-auto grid w-full max-w-2xl gap-6 py-6 sm:py-10"
  data-testid="add-device-page"
>
  <FirstRunBackLink {vault} testId="add-device-back" {onBack} />

  <header class="grid gap-2">
    <h1 class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground">
      {vault.t(I18N_KEYS.AddDeviceTitle)}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">{intro}</p>
  </header>

  <JoinFlowDiagram {vault} side={JoinSide.Inviting} />

  <IdentityStandingNotices {vault} />

  {#if standing.isMember()}
    <ol class="grid">
      {@render step(1, vault.t(I18N_KEYS.AddDeviceCloudTitle), cloudReady, false, "add-device-step-cloud", cloudStep)}
      {@render step(2, vault.t(I18N_KEYS.AddDeviceInviteTitle), inviteReady, !cloudReady, "add-device-step-invite", inviteStep)}
      {@render step(3, vault.t(I18N_KEYS.AddDeviceJoinTitle), approved, !inviteReady, "add-device-step-join", joinStep)}
    </ol>
  {/if}
</section>
