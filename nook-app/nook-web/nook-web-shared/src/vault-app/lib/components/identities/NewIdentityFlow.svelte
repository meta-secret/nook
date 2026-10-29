<!--
Creating another identity, in the same guided shape as the first run: name
it, give it its own passkey (the card shows what is being made), then offer
its first vault. It stands above the workspace and the locked screen, since
adopting the new identity ends the current identity's session midway.
-->
<script lang="ts">
  import { err, ok } from "neverthrow";
  import { RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
  import { Button } from "$lib/components/ui/button";
  import DeviceProtectionGate from "$lib/components/DeviceProtectionGate.svelte";
  import { DeviceProtectionGateFrame } from "$lib/components/device-protection-gate-state";
  import { IdentityLifecycleMutationOutcome } from "$lib/components/devices-access-dashboard-state";
  import { IdentitySessionTransition } from "$lib/components/devices-access/identity-session-transition";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import StepProgress from "$lib/components/login/StepProgress.svelte";
  import FirstRunDiagram from "$lib/components/login/FirstRunDiagram.svelte";
  import {
    firstRunKeyDiagram,
    type FirstRunKeyDiagramRequest,
  } from "$lib/components/login/first-run-diagram";
  import type { VaultState } from "$lib/vault.svelte";
  import { NewIdentityStage } from "$lib/vault/state/ui.svelte";
  import { untrack } from "svelte";
  import { IdentityJoinWaitKind } from "$lib/vault/identity-join-wait";
  import { IdentityJoinActions } from "$lib/vault/identity-plan-actions";

  let { vault }: { vault: VaultState } = $props();

  let nameInput = $state("");
  let vaultInput = $state("");
  /** Rust holds a prepared identity until its passkey commits it. A join to
   * another identity that waits for this identity's key arrives prepared:
   * Rust staged it, and the key asks to join once it exists. */
  const joinWait = untrack(() => vault.identityJoin);
  let creationPending = joinWait.kind === IdentityJoinWaitKind.NewKey;
  let protectionInFlight = false;
  let cancelRequested = false;

  const placeholderName = $derived(
    vault.t(I18N_KEYS.NewIdentityNamePlaceholder),
  );
  const identityName = $derived(
    vault.newIdentityName || nameInput.trim() || placeholderName,
  );
  const steps = $derived([
    vault.t(I18N_KEYS.NewIdentityStepName),
    vault.t(I18N_KEYS.NewIdentityStepKey),
  ]);
  const stepIndex = $derived(
    vault.newIdentity === NewIdentityStage.Name
      ? 0
      : vault.newIdentity === NewIdentityStage.Key
        ? 1
        : 2,
  );
  /** The passkey made here opens the identity being named. */
  const keyDiagram = $derived.by(() => {
    const request: FirstRunKeyDiagramRequest = {
      vault,
      identity: identityName,
    };
    return firstRunKeyDiagram(request);
  });

  function withIdentity(key: string): string {
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { identity: identityName },
    };
    return vault.t(request);
  }

  function close(): void {
    vault.newIdentity = NewIdentityStage.Off;
    vault.newIdentityName = "";
  }

  async function prepare(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const label = nameInput.trim() || placeholderName;
    const prepared = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        await manager.value.begin_local_identity_creation(label);
        return ok(IdentityLifecycleMutationOutcome.CreationPrepared);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (prepared.isErr()) {
      vault.errorMsg = vault.t(prepared.error.translationKey);
      return;
    }
    vault.dismissError();
    creationPending = true;
    cancelRequested = false;
    vault.newIdentityName = label;
    vault.newIdentity = NewIdentityStage.Key;
  }

  /** Drop the prepared identity; waits for a passkey ceremony in flight. */
  async function cancelPrepared(): Promise<void> {
    if (!creationPending) return;
    if (protectionInFlight) {
      cancelRequested = true;
      return;
    }
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.errorMsg = vault.t(manager.error.translationKey);
      return;
    }
    try {
      manager.value.cancel_local_identity_creation();
      vault.deviceProtectionStatus =
        await manager.value.device_protection_status();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return;
    }
    creationPending = false;
    cancelRequested = false;
    vault.dismissError();
  }

  async function backToName(): Promise<void> {
    await cancelPrepared();
    // A join has no name to go back to: leaving its key leaves the join.
    if (vault.identityJoin.kind === IdentityJoinWaitKind.NewKey) {
      new IdentityJoinActions(vault).cancel();
      close();
      return;
    }
    nameInput = vault.newIdentityName;
    vault.newIdentityName = "";
    vault.newIdentity = NewIdentityStage.Name;
  }

  function protectionStarted(): void {
    protectionInFlight = true;
  }

  function protectionSettled(): void {
    protectionInFlight = false;
    if (cancelRequested) void cancelPrepared();
  }

  /** The passkey committed the identity: adopt it as this browser's own. */
  async function adopt(): Promise<void> {
    creationPending = false;
    new IdentitySessionTransition(vault).clearPriorIdentity();
    const providerLoad: Parameters<typeof vault.loadProviders>[0] = {
      ensureLocalRow: true,
    };
    const wait = vault.identityJoin;
    const loaded = await vault.loadProviders(providerLoad);
    if (loaded.isErr()) {
      vault.identityJoin = { kind: IdentityJoinWaitKind.Idle };
      vault.errorMsg = vault.t(loaded.error.translationKey);
      return;
    }
    vault.applyActiveProviderCredentials();
    vault.identityTransitionPending = false;
    switch (wait.kind) {
      case IdentityJoinWaitKind.Idle:
      case IdentityJoinWaitKind.Device:
        vault.newIdentity = NewIdentityStage.Ready;
        return;
      case IdentityJoinWaitKind.NewKey: {
        // The new key exists: it asks to join, and the flow ends there.
        const asked = await new IdentityJoinActions(vault).resume(wait);
        close();
        if (asked.isErr()) vault.errorMsg = vault.t(asked.error.translationKey);
      }
    }
  }

  async function createVault(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await vault.createLocalVaultWithDeviceKeys(
      vaultInput.trim() || identityName,
    );
    if (!vault.errorMsg) close();
  }
</script>

{#if vault.newIdentity === NewIdentityStage.Name}
  <section
    class="mx-auto grid w-full max-w-md gap-7 py-10 sm:py-16"
    data-testid="new-identity-name"
  >
    <FirstRunBackLink {vault} testId="new-identity-cancel" onBack={close} />
    <StepProgress {steps} current={stepIndex} />
    <header class="space-y-2 text-center">
      <h1
        class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
      >
        {vault.t(I18N_KEYS.NewIdentityTitle)}
      </h1>
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.NewIdentitySubtitle)}
      </p>
    </header>
    <form class="flex flex-col gap-2 sm:flex-row" onsubmit={prepare}>
      <label class="sr-only" for="new-identity-name-input">
        {vault.t(I18N_KEYS.NewIdentityNameLabel)}
      </label>
      <input
        id="new-identity-name-input"
        type="text"
        class="h-11 min-w-0 border border-border bg-card px-3 text-sm text-foreground sm:h-10 sm:flex-1 outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={placeholderName}
        maxlength="64"
        autocomplete="off"
        bind:value={nameInput}
        data-testid="new-identity-name-input"
      />
      <Button
        type="submit"
        class="h-11 shrink-0 sm:h-10"
        disabled={vault.isVerifying}
        data-testid="new-identity-continue"
      >
        {vault.t(I18N_KEYS.NewIdentityContinue)}
      </Button>
    </form>
  </section>
{:else if vault.newIdentity === NewIdentityStage.Key}
  <section
    class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
    data-testid="new-identity-key"
  >
    <div class="grid gap-4">
      <FirstRunBackLink
        {vault}
        testId="new-identity-back"
        disabled={vault.isVerifying}
        onBack={() => void backToName()}
      />
      <StepProgress {steps} current={stepIndex} />
    </div>
    <div class="space-y-2 text-center">
      <h1
        class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
      >
        {withIdentity(I18N_KEYS.NewIdentityKeyTitle)}
      </h1>
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.NewIdentityKeyBody)}
      </p>
    </div>
    <FirstRunDiagram diagram={keyDiagram} />
    <DeviceProtectionGate
      {vault}
      frame={DeviceProtectionGateFrame.Embedded}
      creationOnly={true}
      initializeSession={false}
      recoveryAppId=""
      onBeforeProtectionAction={protectionStarted}
      onProtectionActionSettled={protectionSettled}
      onProtectionReady={() => void adopt()}
    />
  </section>
{:else if vault.newIdentity === NewIdentityStage.Ready}
  <section
    class="mx-auto grid w-full max-w-md gap-7 py-10 sm:py-16"
    data-testid="new-identity-ready"
  >
    <StepProgress {steps} current={stepIndex} />
    <header class="space-y-2 text-center">
      <h1
        class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
      >
        {withIdentity(I18N_KEYS.NewIdentityReadyTitle)}
      </h1>
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.NewIdentityReadyBody)}
      </p>
    </header>
    <form class="flex flex-col gap-2 sm:flex-row" onsubmit={createVault}>
      <label class="sr-only" for="new-identity-vault-input">
        {vault.t(I18N_KEYS.NewIdentityVaultLabel)}
      </label>
      <input
        id="new-identity-vault-input"
        type="text"
        class="h-11 min-w-0 border border-border bg-card px-3 text-sm text-foreground sm:h-10 sm:flex-1 outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={identityName}
        maxlength="64"
        autocomplete="off"
        bind:value={vaultInput}
        data-testid="new-identity-vault-input"
      />
      <Button
        type="submit"
        class="h-11 shrink-0 sm:h-10"
        disabled={vault.isVerifying || vault.isInitializing}
        data-testid="new-identity-create-vault"
      >
        {#if vault.isVerifying || vault.isInitializing}
          <RefreshCw class="size-4 animate-spin" />
        {/if}
        {vault.t(I18N_KEYS.NewIdentityCreateVault)}
      </Button>
    </form>
    <div class="flex justify-center">
      <button
        type="button"
        class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        data-testid="new-identity-later"
        onclick={close}
      >
        {vault.t(I18N_KEYS.NewIdentityLater)}
      </button>
    </div>
  </section>
{/if}

{#if vault.errorMsg}
  <p
    class="nk-banner nk-banner-warning mx-auto max-w-md px-4 py-3 text-sm text-foreground"
    role="alert"
    data-testid="new-identity-error"
  >
    {vault.errorMsg}
  </p>
{/if}
