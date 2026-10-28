<!--
The first screen of a browser with no vault: one name, one button. The
identity is created with the vault and introduced on the next step, where
its passkey is made. Joining an identity from another device is the second
path and stands apart; restoring from a sync provider is a quiet link.
Opened from the extension, the connect route shows this same screen: the
person creates or joins here, never in the extension.
-->
<script lang="ts">
  import { VaultWorkspaceActions } from "$lib/vault/ui";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { ArrowRight, MonitorSmartphone, RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import JoinThisDevice from "$lib/components/join/JoinThisDevice.svelte";
  import type { EnrollmentCodeUnlock } from "./login-create-vault-chooser-contract";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    isBusy,
    isVerifying,
    usesExtensionDeviceIdentity = false,
    onCreate,
    onConnectStorage,
    onUseEnrollmentCode,
  }: {
    vault: VaultState;
    isBusy: boolean;
    isVerifying: boolean;
    /** The paired extension supplies the device key; no passkey is asked. */
    usesExtensionDeviceIdentity?: boolean;
    onCreate: (label: string) => void | Promise<void>;
    onConnectStorage: () => void;
    /** Present when this app can join an identity with an enrollment code. */
    onUseEnrollmentCode?: (code: EnrollmentCodeUnlock) => void | Promise<void>;
  } = $props();

  let name = $state("");
  /** Joining an identity this person already has replaces the screen. */
  let joining = $state(false);
  // An empty field takes the suggested name, so one click is enough.
  const vaultName = $derived(
    name.trim() || vault.t(I18N_KEYS.FirstRunNamePlaceholder),
  );

  const extensionHint = $derived.by(() => {
    const hintRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.LoginLandingCreateSimpleWithExtension,
      replacements: { name: vaultName },
    };
    return vault.t(hintRequest);
  });

  async function create(): Promise<void> {
    if (isBusy) return;
    vault.firstRunVaultName = vaultName;
    vault.firstRun = vault.deviceProtectionReady
      ? FirstRunStage.Backup
      : FirstRunStage.Protect;
    await onCreate(vaultName);
  }
</script>

{#if joining && onUseEnrollmentCode}
  <JoinThisDevice
    {vault}
    {isVerifying}
    {onUseEnrollmentCode}
    onBack={() => (joining = false)}
  />
{:else}
  <section
    class="mx-auto grid w-full max-w-md gap-6 py-6 text-center sm:gap-7 sm:py-16"
    data-testid="first-vault-start"
  >
    <div class="space-y-2">
      <h1
        class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
      >
        {vault.t(I18N_KEYS.FirstRunTitle)}
      </h1>
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.FirstRunSubtitle)}
      </p>
    </div>

    <form
      class="flex flex-col gap-2 sm:flex-row"
      onsubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label class="sr-only" for="first-vault-name">
        {vault.t(I18N_KEYS.FirstRunNameLabel)}
      </label>
      <input
        id="first-vault-name"
        type="text"
        class="h-11 min-w-0 border border-border bg-card px-3 text-sm text-foreground sm:h-10 sm:flex-1 outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={vault.t(I18N_KEYS.FirstRunNamePlaceholder)}
        maxlength="64"
        autocomplete="off"
        data-testid="login-vault-name-input"
        bind:value={name}
        disabled={isBusy}
      />
      <Button
        type="submit"
        class="h-11 shrink-0 sm:h-10"
        disabled={isBusy}
        data-testid="login-create-device-vault-btn"
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" />
        {/if}
        {vault.t(I18N_KEYS.FirstRunCreate)}
      </Button>
    </form>
    {#if usesExtensionDeviceIdentity}
      <p
        class="-mt-4 text-xs text-pretty text-muted-foreground"
        data-testid="first-vault-extension-hint"
      >
        {extensionHint}
      </p>
    {/if}

    {#if onUseEnrollmentCode}
      <button
        type="button"
        class="group flex w-full items-center gap-3 border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40 disabled:opacity-60"
        data-testid="login-join-identity-btn"
        disabled={isBusy}
        onclick={() => (joining = true)}
      >
        <span class="nk-tile shrink-0" aria-hidden="true">
          <MonitorSmartphone class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.JoinEntryTitle)}
          </span>
          <span class="block text-xs text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.JoinEntryBody)}
          </span>
        </span>
        <span
          class="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground"
        >
          <span class="hidden sm:inline">{vault.t(I18N_KEYS.JoinEntryCta)}</span
          >
          <ArrowRight
            class="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </button>
    {/if}

    <div class="flex justify-center text-sm" data-testid="login-path-cloud">
      <button
        type="button"
        class="text-balance text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground disabled:opacity-60"
        data-testid="login-connect-storage-btn"
        disabled={isBusy}
        onclick={onConnectStorage}
      >
        {vault.t(I18N_KEYS.FirstRunRestoreLink)}
      </button>
    </div>

    <div class="flex justify-center text-sm">
      <button
        type="button"
        class="text-balance text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground"
        data-testid="login-access-check-link"
        onclick={() => new VaultWorkspaceActions(vault).openAccessCheck()}
      >
        {vault.t(I18N_KEYS.AccessCheckEntryLink)}
      </button>
    </div>

    <!-- What Nook is, in one line; the details live in Help. -->
    <p
      class="flex flex-col items-center gap-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-2"
      data-testid="first-vault-facts"
    >
      <span>{vault.t(I18N_KEYS.FirstRunFactEncrypted)}</span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <span>{vault.t(I18N_KEYS.FirstRunFactNoServer)}</span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <span>{vault.t(I18N_KEYS.FirstRunFactYourStorage)}</span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <button
        type="button"
        class="underline underline-offset-4 hover:text-foreground"
        data-testid="first-vault-how-it-works"
        onclick={() => vault.openHelp()}
      >
        {vault.t(I18N_KEYS.FirstRunHowItWorks)}
      </button>
    </p>
  </section>
{/if}
