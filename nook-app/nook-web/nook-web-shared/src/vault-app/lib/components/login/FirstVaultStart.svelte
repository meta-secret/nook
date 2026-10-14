<!--
The first screen of a browser with no vault: one name, one button. The
identity is created with the vault and introduced on the next step, where
its passkey is made. Returning users get two quiet links instead of a menu.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import LoginEnrollmentPanel from "$lib/components/login/LoginEnrollmentPanel.svelte";
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
  let joinOpen = $state(false);
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

<section
  class="mx-auto grid w-full max-w-md gap-7 py-10 text-center sm:py-16"
  data-testid="first-vault-start"
>
  <div class="space-y-2">
    <h1 class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground">
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
      class="h-10 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
      placeholder={vault.t(I18N_KEYS.FirstRunNamePlaceholder)}
      maxlength="64"
      autocomplete="off"
      data-testid="login-vault-name-input"
      bind:value={name}
      disabled={isBusy}
    />
    <Button
      type="submit"
      class="h-10 shrink-0"
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

  <div
    class="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
    data-testid="login-path-cloud"
  >
    {#if onUseEnrollmentCode}
      <button
        type="button"
        class="text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
        aria-expanded={joinOpen}
        data-testid="login-join-identity-btn"
        disabled={isBusy}
        onclick={() => (joinOpen = !joinOpen)}
      >
        {vault.t(I18N_KEYS.FirstRunJoinLink)}
      </button>
    {/if}
    <button
      type="button"
      class="text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
      data-testid="login-connect-storage-btn"
      disabled={isBusy}
      onclick={onConnectStorage}
    >
      {vault.t(I18N_KEYS.FirstRunRestoreLink)}
    </button>
  </div>

  {#if onUseEnrollmentCode && joinOpen}
    <div class="text-left">
      <LoginEnrollmentPanel
        {vault}
        bind:open={joinOpen}
        {isVerifying}
        {onUseEnrollmentCode}
      />
    </div>
  {/if}
</section>
