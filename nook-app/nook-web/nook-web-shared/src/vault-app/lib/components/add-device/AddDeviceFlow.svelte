<!--
Adding a device: a focused page outside identity management. A hero names
it and draws this device, the cloud copy and the new device; a progress bar
counts cloud copy, invite and join; one card holds the stage at hand.
Every place that offers "Add a device" opens this.
-->
<script lang="ts">
  import { Check, Cloud, CloudOff, ShieldCheck } from "@lucide/svelte";
  import { onMount, type ComponentProps } from "svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import OnboardDevice from "$lib/components/OnboardDevice.svelte";
  import IdentityStandingNotices from "$lib/components/identity-control/IdentityStandingNotices.svelte";
  import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import StepProgress from "$lib/components/login/StepProgress.svelte";
  import { Button } from "$lib/components/ui/button";
  import { CipherField, scramble } from "$lib/components/ui/cipher";
  import { localizeProviderLabel } from "$lib/auth/providers";
  import { enrollmentBrowser } from "$lib/enrollment/code";
  import type { VaultState } from "$lib/vault.svelte";
  import { DeviceJoinMounts } from "./device-join-mounts";
  import PairingDiagram from "./PairingDiagram.svelte";
  import { PairingProgress, PairingStage } from "./pairing-stage";

  type OnboardDeviceProps = ComponentProps<typeof OnboardDevice>;

  /** How often an open invite checks the identity log for its device. */
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
  const memberIds = $derived(
    snapshot === false ? [] : snapshot.members.map((member) => member.appId),
  );
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);
  const joinMounts = $derived.by(() => {
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts: control.mounts,
      replication: vault.vaultArchitecture.replication_type,
    };
    return new DeviceJoinMounts(mountRequest).compatible;
  });
  const inviteReady = $derived(vault.enrollmentCode !== "");
  /** The members when the open invite went out; a new one is its device. */
  let membersAtInvite = $state<readonly string[] | false>(false);

  const progress = $derived.by(() => {
    const facts: ConstructorParameters<typeof PairingProgress>[0] = {
      cloudReady: joinMounts.length > 0,
      inviteReady,
      membersAtInvite,
      members: memberIds,
    };
    return new PairingProgress(facts);
  });
  const stage = $derived(progress.stage);
  const steps = $derived([
    vault.t(I18N_KEYS.AddDeviceProgressCloud),
    vault.t(I18N_KEYS.AddDeviceProgressInvite),
    vault.t(I18N_KEYS.AddDeviceProgressJoin),
  ]);
  const providerLabel = $derived.by(() => {
    const [mount] = joinMounts;
    if (!mount) return "";
    const labelRequest: Parameters<typeof localizeProviderLabel>[0] = {
      label: mount.label,
      t: vault.t,
    };
    return localizeProviderLabel(labelRequest);
  });

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

  function reportFailure(translationKey: Parameters<typeof vault.t>[0]) {
    vault.errorMsg = vault.t(translationKey);
  }

  function checkForDevice(): void {
    void control.syncWithMounts().then((synced) => {
      if (synced.isErr()) reportFailure(synced.error.translationKey);
    });
  }

  // Remember who belonged when the invite went out; forget it with the
  // invite.
  $effect(() => {
    if (!inviteReady) {
      membersAtInvite = false;
      return;
    }
    if (membersAtInvite !== false || snapshot === false) return;
    membersAtInvite = memberIds;
  });

  onMount(() => {
    void control.followOpenVault().then((refreshed) => {
      if (refreshed.isErr()) reportFailure(refreshed.error.translationKey);
    });
  });

  // While an invite waits for its device, look for it now and then so the
  // join shows up without a click.
  $effect(() => {
    if (stage !== PairingStage.Waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (control.busy || vault.isSaving || vault.isVerifying) return;
      checkForDevice();
    }, JOIN_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  });
</script>

{#snippet liveStatus()}
  <div
    class="flex flex-wrap items-center justify-between gap-3 border border-dashed border-foreground/40 px-4 py-3"
    data-testid="add-device-waiting"
    role="status"
    aria-live="polite"
  >
    <span class="flex items-center gap-3 text-sm text-foreground">
      <span class="relative flex size-2.5" aria-hidden="true">
        <span
          class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none"
        ></span>
        <span class="relative inline-flex size-2.5 rounded-full bg-success"></span>
      </span>
      {vault.t(I18N_KEYS.AddDeviceWaiting)}
    </span>
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isBusy}
      data-testid="add-device-check"
      onclick={checkForDevice}
    >
      {vault.t(I18N_KEYS.AddDeviceCheck)}
    </Button>
  </div>
{/snippet}

<section
  class="mx-auto grid w-full max-w-4xl gap-6 py-6 sm:py-10"
  data-testid="add-device-page"
>
  <FirstRunBackLink {vault} testId="add-device-back" {onBack} />

  <header class="nk-frame-tab nk-hero relative">
    <CipherField class="nk-hero-cipher" />
    <div class="relative grid gap-8">
      <div class="min-w-0">
        <p class="nk-eyebrow">
          <ShieldCheck class="size-3.5 text-success" aria-hidden="true" />
          {vault.t(I18N_KEYS.AddDeviceEyebrow)}<span
            class="nk-caret"
            aria-hidden="true"
          ></span>
        </p>
        {#key vault.locale}
          <h1
            class="mt-2.5 text-[clamp(1.875rem,4.5vw,2.75rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-foreground"
            use:scramble
          >
            {vault.t(I18N_KEYS.AddDeviceTitle)}
          </h1>
        {/key}
        <p class="mt-3 max-w-[48ch] text-sm text-pretty text-muted-foreground sm:text-base">
          {intro}
        </p>
      </div>
      <div class="max-w-xl">
        <PairingDiagram {vault} {stage} {providerLabel} />
      </div>
    </div>
  </header>

  <StepProgress {steps} current={progress.step} testId="add-device-progress" />

  <IdentityStandingNotices {vault} />

  {#if standing.isMember()}
    <div
      class="nk-frame-sheet p-5 sm:p-8"
      data-testid="add-device-stage"
      data-stage={stage}
    >
      {#if stage === PairingStage.Cloud}
        <div class="grid gap-6" data-testid="onboard-no-identity-mount">
          <div class="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <span class="nk-pair-node" data-state="missing">
              <CloudOff class="size-6" aria-hidden="true" />
            </span>
            <div class="grid gap-2">
              <h2 class="text-xl font-semibold tracking-tight text-foreground">
                {vault.t(I18N_KEYS.AddDeviceCloudTitle)}
              </h2>
              <p class="max-w-[56ch] text-sm text-pretty text-muted-foreground">
                {vault.t(I18N_KEYS.AddDeviceCloudMissing)}
              </p>
              <p class="font-mono text-xs tracking-wide text-muted-foreground">
                {vault.t(I18N_KEYS.AddDeviceCloudExamples)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            class="nk-go h-11 justify-self-start px-5"
            data-testid="onboard-open-sync-btn"
            onclick={onOpenSync}
          >
            <Cloud class="size-4" />
            {vault.t(I18N_KEYS.AddDeviceCloudAction)}
          </Button>
        </div>
      {:else if stage === PairingStage.Joined}
        <div class="grid justify-items-start gap-4" data-testid="add-device-joined">
          <span class="nk-pair-node" data-state="ready">
            <Check class="size-6" aria-hidden="true" />
          </span>
          <div class="grid gap-1.5" role="status">
            <h2 class="text-xl font-semibold tracking-tight text-foreground">
              {vault.t(I18N_KEYS.AddDeviceJoinedTitle)}
            </h2>
            <p class="max-w-[56ch] text-sm text-pretty text-muted-foreground">
              {vault.t(I18N_KEYS.AddDeviceJoined)}
            </p>
          </div>
          <Button
            type="button"
            class="nk-go h-11 px-5"
            data-testid="add-device-done"
            onclick={onBack}
          >
            {vault.t(I18N_KEYS.AddDeviceDone)}
          </Button>
        </div>
      {:else}
        <OnboardDevice
          {vault}
          mounts={control.mounts}
          enrollmentCode={vault.enrollmentCode}
          {isBusy}
          {manualJoin}
          status={liveStatus}
          onIssueCode={(issueRequest: Parameters<OnboardDeviceProps["onIssueCode"]>[0]) =>
            vault.issueEnrollmentCode(issueRequest)}
          onClearCode={() => vault.clearEnrollmentCode()}
        />
      {/if}
    </div>
  {/if}
</section>
