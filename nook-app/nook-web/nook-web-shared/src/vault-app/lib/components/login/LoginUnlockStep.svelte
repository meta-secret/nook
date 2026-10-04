<script lang="ts">
  import { Effect } from "effect";
  import { VaultType } from "$lib/vault/architecture-model";
  type VaultPasswordUnlock = {
    readonly entryId: string;
    readonly password: string;
  };

  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import {
    NookSelectedVaultIdentityContextKind,
    type NookPasswordEntrySummary,
  } from "$app-wasm";
  import { ShieldCheck } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import LoginAuthorizationStep from "$lib/components/login/LoginAuthorizationStep.svelte";
  import LoginVaultIdentityContext from "$lib/components/login/LoginVaultIdentityContext.svelte";
  import LoginVaultCard from "$lib/components/login/LoginVaultCard.svelte";
  import LoginVaultNameForm from "$lib/components/login/LoginVaultNameForm.svelte";
  import LoginVaultWorkflowNav from "$lib/components/login/LoginVaultWorkflowNav.svelte";
  import {
    LoginVaultExtensionPairingStatusKind,
    type LoginVaultExtensionPairingStatus,
  } from "$lib/components/login/login-vault-extension-pairing-status";
  import SentinelCeremonyPanel from "$lib/components/login/SentinelCeremonyPanel.svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { SentinelCeremonyVisibility } from "$lib/vault/sentinel-unlock";
  import {
    SentinelLoginPresentationReader,
    SentinelLoginPresentationKind,
  } from "$lib/vault/sentinel-login-presentation.svelte";
  import type { PasswordEntrySelection } from "$lib/vault/state/session.svelte";
  import {
    DeviceKeysUnlockCapabilityKind,
    LoginVaultEntryKind,
    LoginVaultWorkflow,
    PasswordUnlockCapabilityKind,
    type DeviceKeysUnlockCapability,
    type LoginVaultEntry,
    type PasswordUnlockCapability,
  } from "./login-unlock-state";
  import {
    LoginVaultIdentityReader,
    LoginVaultIdentityContextKind,
    type LoginVaultIdentityContext as LoginVaultIdentityContextState,
  } from "./login-vault-identity-context";

  type PasswordEntrySummary = Pick<
    NookPasswordEntrySummary,
    "id" | "label" | "createdAt"
  >;

  let {
    vault,
    vaultEntry,
    extensionPairingStatus = {
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    },
    hasMultipleVaults = false,
    passwordEntries = [] as PasswordEntrySummary[],
    selectedPasswordEntry,
    isVerifying,
    isInitializing,
    isUnlocking = false,
    onUnlock,
    onUnlockWithPassword,
    onSelectPasswordEntry,
    onOpenDevicesAccess,
    onSwitchVault,
    onCreateAnotherVault,
    onImportFromSync,
  }: {
    vault: VaultState;
    vaultEntry: LoginVaultEntry;
    extensionPairingStatus?: LoginVaultExtensionPairingStatus;
    hasMultipleVaults?: boolean;
    passwordEntries?: PasswordEntrySummary[];
    selectedPasswordEntry: PasswordEntrySelection;
    isVerifying: boolean;
    isInitializing: boolean;
    isUnlocking?: boolean;
    onUnlock: () => void | Promise<void>;
    onUnlockWithPassword: (args: VaultPasswordUnlock) => void | Promise<void>;
    onSelectPasswordEntry: (selection: PasswordEntrySelection) => void;
    onOpenDevicesAccess: () => void | Promise<void>;
    onSwitchVault: () => void | Promise<void>;
    onCreateAnotherVault: (label: string) => void | Promise<void>;
    onImportFromSync: () => void;
  } = $props();

  const isBusy = $derived(isVerifying || isInitializing);
  let workflow = $state<LoginVaultWorkflow>(LoginVaultWorkflow.Open);

  function selectWorkflow(selected: LoginVaultWorkflow): void {
    workflow = selected;
  }
  const sentinelPresentation = $derived(
    new SentinelLoginPresentationReader(vault),
  );
  $effect(() => sentinelPresentation.start());
  const showSentinelCeremony = $derived(
    sentinelPresentation.presentation.kind ===
      SentinelLoginPresentationKind.Ready &&
      sentinelPresentation.presentation.projection.ceremonyVisibility ===
        SentinelCeremonyVisibility.Visible,
  );
  const hidePasswordUnlock = $derived(
    showSentinelCeremony ||
      sentinelPresentation.presentation.kind !==
        SentinelLoginPresentationKind.Ready ||
      sentinelPresentation.presentation.projection.vaultType ===
        VaultType.Sentinel,
  );
  const passwordUnlock = $derived<PasswordUnlockCapability>(
    hidePasswordUnlock
      ? { kind: PasswordUnlockCapabilityKind.Unavailable }
      : {
          kind: PasswordUnlockCapabilityKind.Available,
          unlock: onUnlockWithPassword,
        },
  );
  let identityContext = $state<LoginVaultIdentityContextState>({
    kind: LoginVaultIdentityContextKind.Loading,
  });
  let identityContextLoadGeneration = 0;

  $effect(() => {
    if (!vault.hasManager) {
      identityContext = { kind: LoginVaultIdentityContextKind.Loading };
      return;
    }
    if (vaultEntry.kind !== LoginVaultEntryKind.Available) {
      identityContext = {
        kind: NookSelectedVaultIdentityContextKind.Empty,
      };
      return;
    }

    const manager = vault.admitManager();
    if (manager.isErr()) {
      identityContext = { kind: LoginVaultIdentityContextKind.Failed };
      return;
    }
    const storeId = vaultEntry.entry.storeId;
    const generation = ++identityContextLoadGeneration;
    identityContext = { kind: LoginVaultIdentityContextKind.Loading };
    const identityContextRequest: ConstructorParameters<
      typeof LoginVaultIdentityReader
    >[0] = {
      manager: manager.value,
      storeId,
    };
    void Effect.runPromise(
      new LoginVaultIdentityReader(identityContextRequest).executeQueued(vault),
    ).then(
      (context) => {
        switch (generation) {
          case identityContextLoadGeneration:
            identityContext = context;
            break;
          default:
            return;
        }
      },
      () => {
        switch (generation) {
          case identityContextLoadGeneration:
            identityContext = { kind: LoginVaultIdentityContextKind.Failed };
            break;
          default:
            return;
        }
      },
    );

    return () => {
      if (generation === identityContextLoadGeneration) {
        identityContextLoadGeneration += 1;
      }
    };
  });

  const deviceKeysUnlock = $derived<DeviceKeysUnlockCapability>(
    vault.loginDeviceKeysCapable
      ? { kind: DeviceKeysUnlockCapabilityKind.Available }
      : {
          kind: DeviceKeysUnlockCapabilityKind.Unavailable,
          reason: vault.t(I18N_KEYS.LoginUnlockDeviceKeysUnavailable),
        },
  );
</script>

<div class="space-y-5" data-testid="login-local-unlock-step">
  <LoginVaultWorkflowNav {vault} active={workflow} onSelect={selectWorkflow} />

  {#if workflow === LoginVaultWorkflow.Open}
    {#if vaultEntry.kind === LoginVaultEntryKind.Available}
      <section class="space-y-2" data-testid="login-vault-context">
        <h3
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {vault.t(I18N_KEYS.LoginVaultOnDevice)}
        </h3>
        <LoginVaultCard
          {vault}
          entry={vaultEntry.entry}
          active
          {extensionPairingStatus}
        />
        {#if extensionPairingStatus.kind !== LoginVaultExtensionPairingStatusKind.NotShown}
          <p
            class="text-sm text-pretty text-muted-foreground"
            data-testid="login-vault-extension-pairing-purpose"
          >
            {vault.t(I18N_KEYS.LoginVaultPickerExtensionPairingPurpose)}
          </p>
        {/if}
        {#if hasMultipleVaults}
          <button
            type="button"
            class="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid="login-switch-vault-btn"
            disabled={isBusy}
            onclick={() => onSwitchVault()}
          >
            {vault.t(I18N_KEYS.LoginSwitchVault)}
          </button>
        {/if}
      </section>
    {/if}

    {#if showSentinelCeremony}
      <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
    {:else}
      <LoginVaultIdentityContext
        {vault}
        context={identityContext}
        deviceKeysCapable={vault.loginDeviceKeysCapable}
        onReviewIdentities={onOpenDevicesAccess}
      />

      <section
        class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
        data-testid="login-unlock-section"
      >
        <div class="space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.LoginUnlockSectionTitle)}
          </h3>
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.LoginUnlockSectionDescription)}
          </p>
        </div>

        <LoginAuthorizationStep
          {vault}
          {passwordEntries}
          {selectedPasswordEntry}
          {isVerifying}
          {isInitializing}
          {isUnlocking}
          loginPasswordPrompt={vault.loginPasswordPrompt}
          {deviceKeysUnlock}
          onConsumeLoginPasswordPrompt={() => {
            vault.loginPasswordPrompt = false;
          }}
          {onUnlock}
          {passwordUnlock}
          {onSelectPasswordEntry}
        />
      </section>
    {/if}
  {:else if workflow === LoginVaultWorkflow.Create}
    <section class="space-y-3" data-testid="login-vault-create-workflow">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultWorkflowCreateDescription)}
        </p>
      </div>
      <LoginVaultNameForm
        {vault}
        {isVerifying}
        {isInitializing}
        testId="login-create-additional-vault-btn"
        submitLabel={vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        onCreate={onCreateAnotherVault}
      />
    </section>
  {:else if workflow === LoginVaultWorkflow.Import}
    <section class="space-y-3" data-testid="login-vault-import-workflow">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerImport)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultWorkflowImportDescription)}
        </p>
      </div>
      <Button
        type="button"
        class="sm:min-w-[180px]"
        data-testid="login-import-vault-btn"
        disabled={isBusy}
        onclick={onImportFromSync}
      >
        <ShieldCheck class="size-4" />
        {vault.t(I18N_KEYS.LoginVaultPickerImport)}
      </Button>
    </section>
  {/if}
</div>
