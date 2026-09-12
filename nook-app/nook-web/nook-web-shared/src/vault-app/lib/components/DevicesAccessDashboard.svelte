<!--
THESIS: Identity selection and key ownership must be clear before relationship details.
OWN-WORLD: Nook's restrained security surfaces, semantic tokens, evidence-aware language, and real local state remain intact.
STORY: Choose an identity from a persistent rail, scan its protection method and apps, then inspect its vault relationships below.
FIRST VIEWPORT: The complete local identity directory and one selected-identity representation appear together.
FORM: A quiet master-detail layout makes identity ownership primary while a compact switch chooses either the key inventory or relationship graph.
-->
<script lang="ts">
  import { err, ok } from "neverthrow";
  import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { onDestroy, untrack } from "svelte";
  import { ArrowLeft, Fingerprint, RefreshCw } from "@lucide/svelte";
  import {
    DeviceAccessProtectionKind,
    DeviceProtectionStatus,
    NookIdentityLocalAccessKind,
  } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import DeviceProtectionGate from "$lib/components/DeviceProtectionGate.svelte";
  import { DeviceProtectionGateFrame } from "$lib/components/device-protection-gate-state";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    DashboardLoadKind,
    DashboardReadyProjectionKind,
    DashboardSnapshotFailureTransition,
    type DashboardSnapshotFailureRequest,
    type DashboardLoadState,
    DashboardTextKind,
    type DashboardView,
    DevicesAccessRepresentationKind,
  } from "./devices-access-dashboard-state";
  import IdentityDirectoryRail from "./devices-access/IdentityDirectoryRail.svelte";
  import IdentityKeyInventory from "./devices-access/IdentityKeyInventory.svelte";
  import IdentityRepresentationSwitch from "./devices-access/IdentityRepresentationSwitch.svelte";
  import {
    IdentityDirectoryLoadKind,
    type IdentityDirectoryLoadState,
    type IdentityDirectoryEntry,
    IdentityDirectorySelectionKind,
    type IdentityDirectoryView,
    IdentityDirectoryReader,
    IdentityDirectoryPresentation,
    DashboardReadyProjection,
  } from "./devices-access/identity-directory-view";
  import {
    IdentityBridgePerspective,
    IdentityBridgeVaultSelectionKind,
    type IdentityBridgeVaultSelection,
  } from "./devices-access/identity-bridge-model";
  import { IdentitySessionTransition } from "./devices-access/identity-session-transition";
  import { IdentityVaultSelection } from "./devices-access/identity-vault-selection";
  import SelectedIdentityProjection from "./devices-access/SelectedIdentityProjection.svelte";
  let {
    vault,
    onBack,
  }: {
    vault: VaultState;
    onBack: () => void;
  } = $props();
  let loadState = $state<DashboardLoadState<DashboardView>>({
    kind: DashboardLoadKind.Loading,
  });
  let directoryLoadState = $state<IdentityDirectoryLoadState>({
    kind: IdentityDirectoryLoadKind.Loading,
  });
  let selectedRepresentation = $state(DevicesAccessRepresentationKind.List);
  let selectedPerspective = $state(IdentityBridgePerspective.Identities);
  let selectedVault = $state<IdentityBridgeVaultSelection>({
    kind: IdentityBridgeVaultSelectionKind.Empty,
  });
  let identityCreationOpen = $state(false);
  let identityCreationPending = false;
  let identityCreationActionInFlight = false;
  let identityCreationCleanupRequested = false;
  let dashboardMounted = true;
  let snapshotLoadGeneration = 0;
  const snapshotFailureRequest: DashboardSnapshotFailureRequest = {
    currentGeneration: () => snapshotLoadGeneration,
    failAccessSnapshot: () => {
      loadState = { kind: DashboardLoadKind.Failed };
    },
    failDirectorySnapshot: () => {
      directoryLoadState = { kind: IdentityDirectoryLoadKind.Failed };
    },
  };
  const snapshotFailureTransition = new DashboardSnapshotFailureTransition(
    snapshotFailureRequest,
  );
  function clearPriorIdentitySession(): void {
    new IdentitySessionTransition(vault).clearPriorIdentity();
  }

  async function focusAfterProtectionReady(
    committedIdentityCreation: boolean,
  ): Promise<void> {
    if (committedIdentityCreation) {
      identityCreationPending = false;
      // Rust has committed and adopted the new app key. Only now discard the
      // prior vault UI session. The immutable action intent matters here:
      // navigation may close the panel while the browser ceremony is running.
      clearPriorIdentitySession();
    }
    identityCreationOpen = false;
    vault.devicesAccessIdentityProtectionOpen = false;
    const providerLoadOptions: Parameters<typeof vault.loadProviders>[0] = {
      ensureLocalRow: true,
    };
    try {
      const loadedProviders1 = await vault.loadProviders(providerLoadOptions);
      if (loadedProviders1.isErr()) {
        vault.errorMsg = vault.t(loadedProviders1.error.translationKey);
        return;
      }
      vault.applyActiveProviderCredentials();
      // Navigation can unmount the dashboard while WebAuthn is still in
      // flight. Keep the login gate alive until the selected identity's
      // providers are available, regardless of which shell now owns it.
      vault.devicesAccessIdentityTransitionPending = false;
    } catch (error) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired);
    }
    if (!dashboardMounted) return;
    directoryLoadState = { kind: IdentityDirectoryLoadKind.Loading };
    await reloadSnapshots();
  }

  function beginIdentityCreationProtectionAction(): void {
    identityCreationActionInFlight = true;
  }

  function finishIdentityCreationProtectionAction(): void {
    identityCreationActionInFlight = false;
    if (identityCreationCleanupRequested) {
      void finishPendingIdentityCreationCancellation();
    }
  }

  function keepCurrentIdentitySession(): void {}

  function chooseIdentity(identityId: string): void {
    if (directoryLoadState.kind !== IdentityDirectoryLoadKind.Ready) return;
    directoryLoadState = {
      kind: IdentityDirectoryLoadKind.Ready,
      view: {
        ...directoryLoadState.view,
        selection: {
          kind: IdentityDirectorySelectionKind.Selected,
          identityId,
        },
      },
    };
    selectedPerspective = IdentityBridgePerspective.Identities;
    selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty };
    const nextIdentity = directoryLoadState.view.identities.find(
      (entry) => entry.identityId === identityId,
    );
    if (
      nextIdentity?.localAccess !== NookIdentityLocalAccessKind.CurrentBrowser
    ) {
      selectedRepresentation = DevicesAccessRepresentationKind.List;
    }
    resetSelectedVaultForIdentity();
  }

  function resetSelectedVaultForIdentity(): void {
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    selectedVault = new IdentityVaultSelection({
      loadState,
      directoryLoadState,
      selectedVault,
    }).reset();
  }

  async function renamePasskey(name: string): Promise<boolean> {
    if (
      loadState.kind !== DashboardLoadKind.Ready ||
      loadState.view.credentialId.kind !== DashboardTextKind.Known ||
      loadState.view.deviceId.kind !== DashboardTextKind.Known
    ) {
      return false;
    }
    const credentialFingerprint = loadState.view.credentialId.value;
    const appId = loadState.view.deviceId.value;
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.errorMsg = vault.t(manager.error.translationKey);
      return false;
    }
    try {
      await manager.value.set_device_access_passkey_name(
        appId,
        credentialFingerprint,
        name,
      );
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return false;
    }
    return (await reloadSnapshots()) === DashboardLoadKind.Ready;
  }

  async function beginAddIdentity(): Promise<void> {
    const labelArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessIdentityDefaultLabel,
      replacements: {
        count:
          directoryLoadState.kind === IdentityDirectoryLoadKind.Ready
            ? String(directoryLoadState.view.identities.length + 1)
            : "1",
      },
    };
    const created = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        await manager.value.begin_local_identity_creation(vault.t(labelArgs));
        return ok();
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (created.isErr()) {
      vault.errorMsg = vault.t(created.error.translationKey);
      return;
    }
    vault.dismissError();
    identityCreationOpen = true;
    identityCreationPending = true;
    identityCreationCleanupRequested = false;
    vault.devicesAccessIdentityProtectionOpen = false;
  }

  async function finishPendingIdentityCreationCancellation(): Promise<void> {
    if (!identityCreationPending || identityCreationActionInFlight) return;
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.errorMsg = vault.t(manager.error.translationKey);
      return;
    }
    try {
      manager.value.cancel_local_identity_creation();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return;
    }
    identityCreationPending = false;
    identityCreationCleanupRequested = false;
    identityCreationOpen = false;
    try {
      vault.deviceProtectionStatus =
        await manager.value.device_protection_status();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return;
    }
    vault.dismissError();
  }

  async function abandonPendingIdentityCreation(): Promise<void> {
    if (!identityCreationPending) return;
    identityCreationCleanupRequested = true;
    identityCreationOpen = false;
    if (!identityCreationActionInFlight) {
      await finishPendingIdentityCreationCancellation();
    }
  }

  async function cancelAddIdentity(): Promise<void> {
    await abandonPendingIdentityCreation();
  }

  async function leaveDashboard(): Promise<void> {
    dashboardMounted = false;
    await abandonPendingIdentityCreation();
    vault.devicesAccessIdentityProtectionOpen = false;
    onBack();
  }

  onDestroy(() => {
    dashboardMounted = false;
    void abandonPendingIdentityCreation();
  });

  async function useIdentity(identityId: string): Promise<void> {
    const activated = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        await manager.value.activate_local_identity(identityId);
        return ok();
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (activated.isErr()) {
      vault.errorMsg = vault.t(activated.error.translationKey);
      return;
    }
    // Establish the cross-shell transition before clearing authentication.
    // The authenticated dashboard is unmounted as soon as the vault session
    // closes, while the login-shell dashboard reuses this shared vault state.
    vault.devicesAccessIdentityTransitionPending = true;
    vault.devicesAccessIdentityProtectionOpen = true;
    vault.deviceProtectionStatus = DeviceProtectionStatus.Loading;
    clearPriorIdentitySession();
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.errorMsg = vault.t(manager.error.translationKey);
      return;
    }
    try {
      vault.deviceProtectionStatus =
        await manager.value.device_protection_status();
    } catch (failure) {
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return;
    }
    vault.deviceId = "";
    vault.devicePublicKey = "";
    await reloadSnapshots();
  }

  function selectPerspective(perspective: IdentityBridgePerspective): void {
    selectedPerspective = perspective;
  }

  function selectVault(storeId: string): void {
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId,
    };
  }

  async function reloadSnapshots(): Promise<DashboardLoadKind> {
    const generation = ++snapshotLoadGeneration;
    // A re-read keeps the current readout on screen. Blanking it would move
    // focus and hide the link the person is reading mid-save.
    if (untrack(() => loadState.kind) !== DashboardLoadKind.Ready) {
      loadState = { kind: DashboardLoadKind.Loading };
    }
    if (
      untrack(() => directoryLoadState.kind) !== IdentityDirectoryLoadKind.Ready
    ) {
      directoryLoadState = { kind: IdentityDirectoryLoadKind.Loading };
    }
    const manager = vault.admitManager();
    if (manager.isErr()) return snapshotFailureTransition.apply(generation);
    const loaded = await new IdentityDirectoryReader(manager.value).load();
    if (loaded.isErr()) return snapshotFailureTransition.apply(generation);
    const snapshot = loaded.value;
    if (generation !== snapshotLoadGeneration) {
      return DashboardLoadKind.Loading;
    }
    const browsedIdentityId = untrack(() =>
      directoryLoadState.kind === IdentityDirectoryLoadKind.Ready &&
      directoryLoadState.view.selection.kind ===
        IdentityDirectorySelectionKind.Selected
        ? directoryLoadState.view.selection.identityId
        : "",
    );
    const preservedDirectory: IdentityDirectoryView =
      browsedIdentityId.length > 0 &&
      snapshot.directory.identities.some(
        (identity) => identity.identityId === browsedIdentityId,
      )
        ? {
            ...snapshot.directory,
            selection: {
              kind: IdentityDirectorySelectionKind.Selected,
              identityId: browsedIdentityId,
            } as const,
          }
        : snapshot.directory;
    loadState = { kind: DashboardLoadKind.Ready, view: snapshot.access };
    directoryLoadState = {
      kind: IdentityDirectoryLoadKind.Ready,
      view: preservedDirectory,
    };
    const identitySelection = new IdentityDirectoryPresentation(
      preservedDirectory,
    ).selectedIdentity();
    if (
      identitySelection.kind === IdentityDirectorySelectionKind.Selected &&
      identitySelection.identity.localAccess ===
        NookIdentityLocalAccessKind.OtherInstallation
    ) {
      selectedRepresentation = DevicesAccessRepresentationKind.List;
    }
    resetSelectedVaultForIdentity();
    return DashboardLoadKind.Ready;
  }

  $effect(() => {
    void vault.deviceProtectionStatus;
    void vault.localVaults.length;
    void reloadSnapshots();
  });
</script>

<section class="w-full space-y-8 pb-4" data-testid="devices-access-dashboard">
  <header class="flex items-start gap-3 border-b border-border/60 pb-5">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="mt-0.5 shrink-0"
      aria-label={vault.t(I18N_KEYS.CommonBack)}
      data-testid="devices-access-back"
      onclick={() => void leaveDashboard()}
    >
      <ArrowLeft class="size-4" />
    </Button>
    <div class="min-w-0 space-y-1">
      <h1
        class="text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl"
      >
        {vault.t(I18N_KEYS.DevicesAccessTitle)}
      </h1>
      <p
        class="max-w-[70ch] text-sm leading-relaxed text-pretty text-muted-foreground"
      >
        {vault.t(I18N_KEYS.DevicesAccessDescription)}
      </p>
    </div>
  </header>

  {#if loadState.kind === DashboardLoadKind.Loading}
    <div
      class="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.DevicesAccessLoading)}
    </div>
  {:else if loadState.kind === DashboardLoadKind.Failed}
    <div
      class="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      role="alert"
    >
      <p class="font-medium text-foreground">
        {vault.t(I18N_KEYS.DevicesAccessLoadFailed)}
      </p>
      <Button
        type="button"
        variant="outline"
        class="mt-3"
        data-testid="devices-access-retry"
        onclick={() => void reloadSnapshots()}
      >
        <RefreshCw class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessTryAgain)}
      </Button>
    </div>
  {:else if directoryLoadState.kind === IdentityDirectoryLoadKind.Loading}
    <div
      class="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryLoading)}
    </div>
  {:else if directoryLoadState.kind === IdentityDirectoryLoadKind.Failed}
    <div
      class="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      role="alert"
    >
      <p class="font-medium text-foreground">
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryFailed)}
      </p>
      <Button
        type="button"
        variant="outline"
        class="mt-3"
        data-testid="devices-access-retry"
        onclick={() => void reloadSnapshots()}
      >
        <RefreshCw class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessTryAgain)}
      </Button>
    </div>
  {:else}
    {@const readyProjectionRequest: ConstructorParameters<
      typeof DashboardReadyProjection
    >[0] = {
      accessState: loadState,
      directoryState: directoryLoadState,
      selectedIdentity:
        directoryLoadState.kind === IdentityDirectoryLoadKind.Ready
          ? new IdentityDirectoryPresentation(
              directoryLoadState.view,
            ).selectedIdentity()
          : { kind: IdentityDirectorySelectionKind.Empty },
    }}
    {@const readyProjection = new DashboardReadyProjection(
      readyProjectionRequest,
    ).state}
    {#if readyProjection.kind !== DashboardReadyProjectionKind.Unavailable}
      {@const accessView = readyProjection.accessView}
      {@const directory = readyProjection.directory}
      {@const selectedIdentityId =
        directory.selection.kind === IdentityDirectorySelectionKind.Selected
          ? directory.selection.identityId
          : ""}
      <div
        class="grid min-w-0 gap-8 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-0"
      >
        <IdentityDirectoryRail
          {vault}
          identities={directory.identities}
          {selectedIdentityId}
          onSelectIdentity={chooseIdentity}
          onAddIdentity={() => void beginAddIdentity()}
        />

        <div
          class="min-w-0 border-t border-border pt-8 md:border-t-0 md:pt-0 md:pl-8"
        >
          {#if identityCreationOpen}
            <div data-testid="devices-access-add-identity-flow">
              <div class="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={vault.isVerifying}
                  onclick={() => void cancelAddIdentity()}
                  data-testid="devices-access-cancel-add-identity"
                >
                  {vault.t(I18N_KEYS.CommonCancel)}
                </Button>
              </div>
              <DeviceProtectionGate
                {vault}
                frame={DeviceProtectionGateFrame.HostSection}
                creationOnly={true}
                initializeSession={false}
                recoveryAppId=""
                onBeforeProtectionAction={beginIdentityCreationProtectionAction}
                onProtectionActionSettled={finishIdentityCreationProtectionAction}
                onProtectionReady={() => void focusAfterProtectionReady(true)}
              />
            </div>
          {:else}
            {#if readyProjection.kind === DashboardReadyProjectionKind.Empty}
              {#if directory.identities.length === 0}
                <div
                  class="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center"
                  data-testid="devices-access-no-identities"
                >
                  <Fingerprint class="size-8 text-muted-foreground" />
                  <h2 class="mt-4 text-lg font-semibold text-foreground">
                    {vault.t(I18N_KEYS.DevicesAccessNoIdentities)}
                  </h2>
                  <p
                    class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground"
                  >
                    {vault.t(I18N_KEYS.DevicesAccessNoIdentitiesDescription)}
                  </p>
                </div>
              {:else}
                <div
                  class="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center"
                  data-testid="devices-access-no-session-identity"
                >
                  <Fingerprint class="size-8 text-muted-foreground" />
                  <h2 class="mt-4 text-lg font-semibold text-foreground">
                    {vault.t(I18N_KEYS.DevicesAccessNoSessionIdentity)}
                  </h2>
                  <p
                    class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground"
                  >
                    {vault.t(
                      I18N_KEYS.DevicesAccessNoSessionIdentityDescription,
                    )}
                  </p>
                </div>
              {/if}
            {:else}
              <SelectedIdentityProjection
                projection={readyProjection}
                {vault}
                {selectedRepresentation}
                {selectedPerspective}
                {selectedVault}
                onPerspective={selectPerspective}
                onVault={selectVault}
              >
                {#snippet children(
                  identity: IdentityDirectoryEntry,
                  view: DashboardView,
                )}
                  {#if vault.devicesAccessIdentityProtectionOpen}
                    <div data-testid="devices-access-identity-protection-flow">
                      <div class="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          onclick={() =>
                            (vault.devicesAccessIdentityProtectionOpen = false)}
                        >
                          {vault.t(I18N_KEYS.CommonCancel)}
                        </Button>
                      </div>
                      <DeviceProtectionGate
                        {vault}
                        frame={DeviceProtectionGateFrame.HostSection}
                        creationOnly={false}
                        initializeSession={false}
                        recoveryAppId={view.deviceId.displayText(() => "")}
                        onBeforeProtectionAction={keepCurrentIdentitySession}
                        onProtectionReady={() =>
                          void focusAfterProtectionReady(false)}
                      />
                    </div>
                  {:else}
                    {#if identity.localAccess === NookIdentityLocalAccessKind.ThisBrowser}
                      <div
                        class="mb-6 rounded-lg border border-border bg-muted/30 p-5"
                      >
                        <p class="text-sm font-medium text-foreground">
                          {vault.t(
                            I18N_KEYS.DevicesAccessIdentityOnThisBrowser,
                          )}
                        </p>
                        <Button
                          type="button"
                          class="mt-3"
                          onclick={() => void useIdentity(identity.identityId)}
                          data-testid="devices-access-use-identity"
                        >
                          {vault.t(I18N_KEYS.DevicesAccessUseIdentity)}
                        </Button>
                      </div>
                    {:else if identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser && vault.deviceProtectionStatus !== DeviceProtectionStatus.Unlocked && accessView.protection !== DeviceAccessProtectionKind.Missing}
                      <div
                        class="mb-6 rounded-lg border border-border bg-muted/30 p-5"
                      >
                        <p class="text-sm font-medium text-foreground">
                          {vault.t(I18N_KEYS.DevicesAccessIdentityLocked)}
                        </p>
                        <Button
                          type="button"
                          class="mt-3"
                          onclick={() =>
                            (vault.devicesAccessIdentityProtectionOpen = true)}
                          data-testid="devices-access-unlock-identity"
                        >
                          {vault.t(I18N_KEYS.DevicesAccessUnlockIdentity)}
                        </Button>
                      </div>
                    {/if}
                    <IdentityRepresentationSwitch
                      {vault}
                      identityLabel={identity.label}
                      {selectedRepresentation}
                      graphDisabled={identity.localAccess !==
                        NookIdentityLocalAccessKind.CurrentBrowser}
                      onSelectRepresentation={(
                        representation: DevicesAccessRepresentationKind,
                      ) => (selectedRepresentation = representation)}
                    />

                    {#if selectedRepresentation === DevicesAccessRepresentationKind.List}
                      <div class="mt-6">
                        <IdentityKeyInventory
                          {vault}
                          {identity}
                          {view}
                          onRenamePasskey={renamePasskey}
                        />
                      </div>
                    {/if}
                  {/if}
                {/snippet}
              </SelectedIdentityProjection>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</section>
