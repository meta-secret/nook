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
  import LoginAuthorizationStep from "$lib/components/login/LoginAuthorizationStep.svelte";
  import LoginVaultIdentityContext from "$lib/components/login/LoginVaultIdentityContext.svelte";
  import LoginVaultCard from "$lib/components/login/LoginVaultCard.svelte";
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
  } = $props();

  const isBusy = $derived(isVerifying || isInitializing);
  const vaultLabel = $derived(
    vaultEntry.kind === LoginVaultEntryKind.Available
      ? vaultEntry.entry.display_label(
          vault.t(I18N_KEYS.LoginVaultPickerUnnamed),
        )
      : vault.t(I18N_KEYS.LoginVaultPickerUnnamed),
  );
  const title = $derived.by(() => {
    const titleArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.LoginUnlockPanelTitle,
      replacements: { vault: vaultLabel },
    };
    return vault.t(titleArgs);
  });
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

<section
  class="grid min-w-0 gap-5"
  aria-label={title}
  data-testid="login-local-unlock-step"
>
  <header class="grid gap-3">
    <p class="nk-eyebrow">
      <ShieldCheck class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.LoginUnlockPanelEyebrow)}<span
        class="nk-caret"
        aria-hidden="true"
      ></span>
    </p>
    <h2
      class="text-xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]"
    >
      {title}
    </h2>
    <p
      class="text-sm text-pretty text-muted-foreground"
      data-testid="login-local-vault-detected"
    >
      {vault.t(I18N_KEYS.LoginVaultPickerHint)}
    </p>
    {#if vaultEntry.kind === LoginVaultEntryKind.Available}
      <div class="grid gap-2" data-testid="login-vault-context">
        <LoginVaultCard
          {vault}
          entry={vaultEntry.entry}
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
      </div>
    {/if}
  </header>

  {#if showSentinelCeremony}
    <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
  {:else}
    <section class="grid gap-3" data-testid="login-unlock-section">
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.LoginUnlockSectionDescription)}
      </p>
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

    <LoginVaultIdentityContext
      {vault}
      context={identityContext}
      deviceKeysCapable={vault.loginDeviceKeysCapable}
      onReviewIdentities={onOpenDevicesAccess}
    />
  {/if}

  {#if hasMultipleVaults}
    <p class="text-xs text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.LoginUnlockPanelOtherVault)}
      <button
        type="button"
        class="font-medium text-foreground underline underline-offset-4"
        data-testid="login-switch-vault-btn"
        disabled={isBusy}
        onclick={() => onSwitchVault()}
      >
        {vault.t(I18N_KEYS.LoginSwitchVault)}
      </button>
    </p>
  {/if}
</section>
