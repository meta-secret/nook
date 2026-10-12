<script lang="ts">
  import { ArrowRight, LockKeyhole } from "@lucide/svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { LoginVaultSelectionKind } from "$lib/vault/state/provider.svelte";
  import {
    configured_vault_application,
    VaultApplication,
    ExternalDeviceIdentityAuthorizationMode,
  } from "$app-wasm";
  import {
    ExtensionConnectIntentKind,
    type ExtensionConnectIntent,
  } from "$lib/app/route-state";
  import { extensionConnectionBrowser } from "$lib/extension/connect";
  import {
    ConfiguredSiteUrlEnvironment,
    SiteUrlConfiguration,
  } from "$lib/content/sitemap";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  import CompanionAccess from "./CompanionAccess.svelte";
  import DeviceAuthorization from "./DeviceAuthorization.svelte";
  import SentinelAccess from "./SentinelAccess.svelte";
  interface AccessWorkspace {
    vault: VaultState;
    extension: ExtensionConnectIntent;
  }
  let { vault, extension }: AccessWorkspace = $props();
  let creating = $state(false);
  let name = $state("");
  let password = $state("");
  let entryId = $state("");
  let usePassword = $state(false);
  const sentinel = configured_vault_application() === VaultApplication.Sentinel;
  const siteUrl = new SiteUrlConfiguration(
    new ConfiguredSiteUrlEnvironment(import.meta.env.VITE_SITE_URL ?? ""),
  ).url;
  async function authorizeExtension() {
    if (extension.kind !== ExtensionConnectIntentKind.Requested) return;
    const request = extension.request;
    const authorization: Parameters<
      VaultState["authorizeWithExternalDeviceIdentity"]
    >[0] = {
      mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      adopt: (manager) => {
        const handoff: Parameters<
          typeof extensionConnectionBrowser.adoptExtensionIdentity
        >[0] = { manager, request };
        return extensionConnectionBrowser.adoptExtensionIdentity(handoff);
      },
    };
    await vault.authorizeWithExternalDeviceIdentity(authorization);
  }
  async function unlock() {
    if (usePassword || vault.loginPasswordPrompt) {
      const request: Parameters<VaultState["unlockWithPassword"]>[0] = {
        entryId,
        password,
      };
      await vault.unlockWithPassword(request);
      password = "";
    } else await vault.loadDb();
  }
</script>

<div class="access-page" data-testid="login-gate">
  <header class="access-brand">
    <span class="brand-mark" aria-hidden="true">n</span><strong
      >{vault.t(K.WorkspaceBrand)}</strong
    >
  </header>
  <section class="access-content">
    <p class="eyebrow">{vault.t(K.WorkspaceEyebrow)}</p>
    <h1>{vault.t(K.WorkspaceAccessTitle)}</h1>
    <p class="access-intro">{vault.t(K.WorkspaceAccessDescription)}</p>
    {#if vault.sessionExpiredByIdle}<p role="status">
        {vault.t(K.SessionExpiredIdle)}
      </p>{/if}
    <div
      class="access-form"
      data-testid={vault.localVaults.length === 0
        ? "login-create-vault-chooser"
        : "login-local-unlock-step"}
    >
      {#if !vault.deviceProtectionReady && extension.kind === ExtensionConnectIntentKind.Requested && (creating || vault.localVaults.length === 0)}
        <button
          class="primary"
          disabled={vault.deviceAuthorizationInProgress}
          onclick={authorizeExtension}
          >{vault.t(K.ExtensionConnectContinue)}</button
        >
      {:else if !vault.deviceProtectionReady && (sentinel || creating || vault.localVaults.length === 0)}
        <DeviceAuthorization {vault} />
      {:else if sentinel}<SentinelAccess {vault} />
      {:else if creating || vault.localVaults.length === 0}
        <form
          class="stack"
          onsubmit={(e) => {
            e.preventDefault();
            void vault.createLocalVaultWithDeviceKeys(name);
          }}
        >
          <label
            >{vault.t(K.WorkspaceVaultName)}<input
              data-testid="login-vault-name-input"
              bind:value={name}
              placeholder={vault.t(K.LoginVaultNamePlaceholder)}
              autocomplete="off"
            /></label
          >
          <button
            data-testid="login-create-device-vault-btn"
            class="primary"
            disabled={vault.isVerifying}
            >{vault.t(
              vault.isVerifying ? K.WorkspaceBusy : K.WorkspaceNewVault,
            )}<ArrowRight size={18} /></button
          >
          {#if vault.localVaults.length}<button
              type="button"
              onclick={() => {
                creating = false;
              }}>{vault.t(K.CommonBack)}</button
            >{/if}
        </form>
      {:else}
        <div class="vault-choices">
          {#each vault.localVaults as local (local.storeId)}
            <button
              class="vault-choice"
              class:chosen={vault.selectedLoginVault.kind ===
                LoginVaultSelectionKind.Selected &&
                vault.selectedLoginVault.storeId === local.storeId}
              disabled={vault.isVerifying}
              onclick={async () => {
                usePassword = false;
                entryId = "";
                password = "";
                await vault.chooseLoginVault(local.storeId);
              }}
              ><LockKeyhole size={20} /><span
                ><strong
                  >{local.label || vault.t(K.LoginVaultPickerUnnamed)}</strong
                ><small>{vault.t(K.WorkspaceDevice)}</small></span
              ><ArrowRight size={17} /></button
            >
          {/each}
        </div>
        {#if vault.selectedLoginVault.kind === LoginVaultSelectionKind.Selected}
          {#if extension.kind === ExtensionConnectIntentKind.Absent}{#key vault.selectedLoginVault.storeId}<CompanionAccess
                {vault}
                storeId={vault.selectedLoginVault.storeId}
              />{/key}{/if}
          {#if !vault.deviceProtectionReady && !usePassword && !vault.loginPasswordPrompt}<DeviceAuthorization
              {vault}
            />
          {:else}<form
              class="stack"
              onsubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              {#if usePassword || vault.loginPasswordPrompt}
                <label
                  >{vault.t(K.WorkspaceBackupLabel)}<select bind:value={entryId}
                    ><option value="" disabled
                      >{vault.t(K.WorkspaceBackupLabel)}</option
                    >{#each vault.passwordEntries as entry (entry.id)}<option
                        value={entry.id}>{entry.label}</option
                      >{/each}</select
                  ></label
                >
                <label
                  >{vault.t(K.VaultFieldsPassword)}<input
                    type="password"
                    bind:value={password}
                    autocomplete="current-password"
                  /></label
                >
              {/if}
              <button
                class="primary"
                disabled={vault.isVerifying || vault.isPasswordBusy}
                >{vault.t(
                  vault.isVerifying ? K.WorkspaceBusy : K.WorkspaceUnlock,
                )}<ArrowRight size={18} /></button
              >
            </form>{/if}
          {#if vault.passwordEntries.length}<button
              class="text-button"
              onclick={() => {
                usePassword = !usePassword;
                vault.loginPasswordPrompt = false;
                password = "";
              }}
              >{vault.t(
                usePassword ? K.LoginUnlockKeys : K.LoginUnlockBackup,
              )}</button
            >{/if}
        {/if}
        <button
          class="text-button"
          onclick={() => {
            creating = true;
          }}>{vault.t(K.WorkspaceNewVault)}</button
        >
      {/if}
    </div>
  </section>
  <footer class="access-links">
    <a href={`${siteUrl}/privacy.html`}>{vault.t(K.LegalPrivacyPolicy)}</a><a
      href={`${siteUrl}/terms.html`}>{vault.t(K.LegalTermsOfService)}</a
    >
  </footer>
</div>
