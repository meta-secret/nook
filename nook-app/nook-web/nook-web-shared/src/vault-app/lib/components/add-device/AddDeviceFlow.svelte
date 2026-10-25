<!--
Adding a device: a focused page outside identity management. A hero names
it, leads back to the identities hub, and draws this device, the cloud copy
and the new device; a progress bar counts cloud copy and invite; one card
holds the stage at hand. The invite carries the vault keys, so once it is
out the new device joins by itself: nothing here waits for it.
Every place that offers "Add a device" opens this.
-->
<script lang="ts">
  import { Cloud, CloudOff, KeyRound, ShieldCheck } from "@lucide/svelte";
  import { VaultIdentityKeySource } from "$app-wasm";
  import { onMount, type ComponentProps } from "svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import OnboardDevice from "$lib/components/OnboardDevice.svelte";
  import IdentityStandingNotices from "$lib/components/identity-control/IdentityStandingNotices.svelte";
  import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
  import BackButton from "$lib/components/workspace/BackButton.svelte";
  import StepProgress from "$lib/components/login/StepProgress.svelte";
  import { Button } from "$lib/components/ui/button";
  import { CipherField, scramble } from "$lib/components/ui/cipher";
  import { localizeProviderLabel } from "$lib/auth/providers";
  import { enrollmentBrowser } from "$lib/enrollment/code";
  import type { VaultState } from "$lib/vault.svelte";
  import { BrowserKeySwitch } from "$lib/vault/browser-key-switch";
  import { DeviceJoinMounts } from "./device-join-mounts";
  import PairingDiagram from "./PairingDiagram.svelte";
  import { PairingProgress, PairingStage } from "./pairing-stage";

  type OnboardDeviceProps = ComponentProps<typeof OnboardDevice>;

  let {
    vault,
    identityName,
    onBack,
    onOpenSync,
    onManageAccounts,
  }: {
    vault: VaultState;
    identityName: string;
    /** Leave the flow for the page it was opened from. */
    onBack: () => void;
    /** Add a sync provider so the identity has a cloud copy. */
    onOpenSync: () => void;
    /** Authorize another account on a sync provider. */
    onManageAccounts: () => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const snapshot = $derived(control.snapshot);
  const standing = $derived(new IdentityStandingPresentation(snapshot));
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);
  const joinMounts = $derived.by(() => {
    const mountRequest: ConstructorParameters<typeof DeviceJoinMounts>[0] = {
      mounts: control.mounts,
      replication: vault.vaultArchitecture.replication_type,
    };
    return new DeviceJoinMounts(mountRequest).compatible;
  });
  const progress = $derived.by(() => {
    const facts: ConstructorParameters<typeof PairingProgress>[0] = {
      member: standing.isMember(),
      cloudReady: joinMounts.length > 0,
      inviteReady: vault.enrollmentCode !== "",
    };
    return new PairingProgress(facts);
  });
  const stage = $derived(progress.stage);
  const steps = $derived([
    vault.t(I18N_KEYS.AddDeviceProgressCloud),
    vault.t(I18N_KEYS.AddDeviceProgressInvite),
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
  /** Why the key in use cannot invite: the paired extension's key, or this
   * browser's own key, has not joined the identity. */
  const notMember = $derived.by(() => {
    const notMemberRequest: Parameters<typeof vault.t>[0] = {
      key:
        vault.identityKeySource === VaultIdentityKeySource.PairedCompanion
          ? I18N_KEYS.AddDeviceNotMemberExtension
          : I18N_KEYS.AddDeviceNotMemberBrowser,
      replacements: { identity: identityName },
    };
    return vault.t(notMemberRequest);
  });
  /** The extension's key is in use and this browser holds its own key
   * behind a passkey: the page can switch to it. */
  const browserKey = $derived(new BrowserKeySwitch(vault));
  const browserKeyHint = $derived.by(() => {
    const hintRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AddDeviceUseBrowserKeyHint,
      replacements: { identity: identityName },
    };
    return vault.t(hintRequest);
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

  onMount(() => {
    void control.followOpenVault().then((refreshed) => {
      if (refreshed.isErr()) reportFailure(refreshed.error.translationKey);
    });
  });
</script>

{#snippet done()}
  <Button
    type="button"
    class="nk-go h-11 justify-self-start px-5"
    data-testid="add-device-done"
    onclick={onBack}
  >
    {vault.t(I18N_KEYS.AddDeviceDone)}
  </Button>
{/snippet}

<section
  class="mx-auto grid w-full max-w-4xl gap-6 py-4 sm:py-8"
  data-testid="add-device-page"
>
  <header class="nk-frame-tab nk-hero relative">
    <CipherField class="nk-hero-cipher" />
    <div class="relative grid gap-8">
      <div class="flex min-w-0 items-start gap-4">
        <BackButton
          label={vault.t(I18N_KEYS.WorkspaceBackToIdentities)}
          testId="add-device-back"
          {onBack}
        />
        <div class="min-w-0">
          <p class="nk-eyebrow nk-lockup">
            <ShieldCheck class="size-3.5 text-success" aria-hidden="true" />
            {vault.t(I18N_KEYS.AddDeviceEyebrow)}<span
              class="nk-caret"
              aria-hidden="true"
            ></span>
          </p>
          {#key vault.locale}
            <h1
              class="mt-2.5 text-[clamp(1.875rem,4.5vw,2.75rem)] leading-[1.05] font-light tracking-[-0.045em] text-foreground"
              use:scramble
            >
              {vault.t(I18N_KEYS.AddDeviceTitle)}
            </h1>
          {/key}
          <p class="mt-3 max-w-[48ch] text-sm text-pretty text-muted-foreground sm:text-base">
            {intro}
          </p>
        </div>
      </div>
      <div class="max-w-xl">
        <PairingDiagram {vault} {stage} {providerLabel} />
      </div>
    </div>
  </header>

  <StepProgress {steps} current={progress.step} testId="add-device-progress" />

  <IdentityStandingNotices {vault} />

  {#if vault.errorMsg}
    <p
      class="nk-banner nk-banner-destructive p-3 text-sm text-pretty text-foreground"
      role="alert"
      data-testid="add-device-error"
    >
      {vault.errorMsg}
    </p>
  {/if}

  {#if snapshot !== false && !standing.isRevoked()}
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
      {:else if stage === PairingStage.NotMember}
        <div class="grid gap-6" data-testid="add-device-not-member">
          <div class="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <span class="nk-pair-node" data-state="missing">
              <KeyRound class="size-6" aria-hidden="true" />
            </span>
            <div class="grid gap-2">
              <h2 class="text-xl font-semibold tracking-tight text-foreground">
                {vault.t(I18N_KEYS.AddDeviceNotMemberTitle)}
              </h2>
              <p class="max-w-[56ch] text-sm text-pretty text-muted-foreground">
                {notMember}
              </p>
              {#if browserKey.available}
                <p class="max-w-[56ch] text-sm text-pretty text-muted-foreground">
                  {browserKeyHint}
                </p>
              {/if}
            </div>
          </div>
          {#if browserKey.available}
            <Button
              type="button"
              class="nk-go h-11 justify-self-start px-5"
              data-testid="add-device-use-browser-key"
              disabled={isBusy}
              onclick={() => void browserKey.run()}
            >
              <KeyRound class="size-4" />
              {vault.t(I18N_KEYS.AddDeviceUseBrowserKey)}
            </Button>
          {/if}
        </div>
      {:else}
        <OnboardDevice
          {vault}
          mounts={control.mounts}
          enrollmentCode={vault.enrollmentCode}
          {isBusy}
          {manualJoin}
          {done}
          onIssueCode={(issueRequest: Parameters<OnboardDeviceProps["onIssueCode"]>[0]) =>
            vault.issueEnrollmentCode(issueRequest)}
          onClearCode={() => vault.clearEnrollmentCode()}
          {onManageAccounts}
        />
      {/if}
    </div>
  {/if}
</section>
