<script lang="ts">
  import { onMount } from "svelte";
  import { SunMoon, LockKeyhole, Languages, Trash2 } from "@lucide/svelte";
  import {
    configured_vault_application,
    VaultApplication,
    type NookAppLocale,
  } from "$app-wasm";
  import type { VaultState } from "$lib/vault.svelte";
  import { LocaleCatalogSource } from "$lib/vault/locale";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  let {
    vault,
    toggleAppearance,
  }: { vault: VaultState; toggleAppearance: () => void } = $props();
  let label = $state("");
  let password = $state("");
  let deleting = $state(false);
  let removingPasswordId = $state("");
  let busy = $state(false);
  const application = configured_vault_application();
  const simple =
    application === VaultApplication.Simple ||
    application === VaultApplication.UnifiedDevelopment;
  onMount(() => {
    void vault.refreshPasswordEntriesList();
  });
  async function locale(newLocale: NookAppLocale) {
    const request: Parameters<VaultState["updateLocale"]>[0] = {
      newLocale,
      catalogSource: LocaleCatalogSource.Engine,
    };
    const result = await vault.updateLocale(request);
    if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
  }
  async function addPassword() {
    const request: Parameters<VaultState["addVaultPassword"]>[0] = {
      label,
      password,
    };
    const result = await vault.addVaultPassword(request);
    password = "";
    if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
    else label = "";
  }
  async function removePassword(id: string) {
    const result = await vault.removeVaultPasswordEntry(id);
    if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
    else removingPasswordId = "";
  }
  async function deleteData() {
    busy = true;
    try {
      await vault.deleteLocalBrowserData();
    } finally {
      busy = false;
    }
  }
</script>

<div class="preferences">
  <header>
    <p class="eyebrow">{vault.t(K.WorkspaceBrand)}</p>
    <h1>{vault.t(K.NavSettings)}</h1>
    <p class="muted">{vault.t(K.WorkspacePreferencesHint)}</p>
  </header>
  <section class="preference-section">
    <div class="section-title">
      <Languages size={20} />
      <h2>{vault.t(K.SettingsLanguage)}</h2>
    </div>
    <div class="choice-row">
      <button class:chosen={vault.locale === "en"} onclick={() => locale("en")}
        >{vault.t(K.WorkspaceLanguageEnglish)}</button
      ><button class:chosen={vault.locale === "ru"} onclick={() => locale("ru")}
        >{vault.t(K.WorkspaceLanguageRussian)}</button
      >
    </div>
  </section>
  <section class="preference-section">
    <div class="section-title">
      <SunMoon size={20} />
      <h2>{vault.t(K.WorkspaceAppearance)}</h2>
    </div>
    <button onclick={toggleAppearance}
      >{vault.t(K.WorkspaceChangeAppearance)}</button
    >
  </section>
  {#if simple}<section class="preference-section">
      <div class="section-title">
        <LockKeyhole size={20} />
        <h2>{vault.t(K.DevicesAccessBackupPasswords)}</h2>
      </div>
      <p class="muted">{vault.t(K.DevicesAccessBackupPasswordBoundary)}</p>
      {#each vault.passwordEntries as entry (entry.id)}<div class="setting-row">
          <span>{entry.label}</span><button
            disabled={vault.isPasswordBusy}
            onclick={() => {
              removingPasswordId = entry.id;
            }}>{vault.t(K.CommonRemove)}</button
          >
        </div>{/each}
      {#if removingPasswordId}<div class="confirmation">
          <p>{vault.t(K.VaultPasswordsRemoveConfirm)}</p>
          <div class="form-actions">
            <button
              onclick={() => {
                removingPasswordId = "";
              }}>{vault.t(K.CommonCancel)}</button
            >
            <button
              class="danger"
              disabled={vault.isPasswordBusy}
              onclick={() => removePassword(removingPasswordId)}
              >{vault.t(K.CommonRemove)}</button
            >
          </div>
        </div>{/if}
      <form
        class="stack"
        onsubmit={(e) => {
          e.preventDefault();
          void addPassword();
        }}
      >
        <label
          >{vault.t(K.WorkspaceBackupLabel)}<input
            bind:value={label}
            autocomplete="off"
          /></label
        ><label
          >{vault.t(K.VaultFieldsPassword)}<input
            type="password"
            bind:value={password}
            autocomplete="new-password"
          /></label
        ><button class="primary" disabled={vault.isPasswordBusy}
          >{vault.t(K.CommonSave)}</button
        >
      </form>
    </section>{/if}
  <section class="preference-section">
    <div class="section-title">
      <Trash2 size={20} />
      <h2>{vault.t(K.SettingsDeleteLocalTitle)}</h2>
    </div>
    <p class="muted">{vault.t(K.SettingsDeleteLocalDesc)}</p>
    {#if deleting}<div class="confirmation">
        <p>{vault.t(K.SettingsDeleteLocalConfirm)}</p>
        <div class="form-actions">
          <button
            onclick={() => {
              deleting = false;
            }}>{vault.t(K.CommonCancel)}</button
          ><button class="danger" disabled={busy} onclick={deleteData}
            >{vault.t(K.SettingsDeleteLocalConfirmButton)}</button
          >
        </div>
      </div>{:else}<button
        class="danger-text"
        onclick={() => {
          deleting = true;
        }}>{vault.t(K.SettingsDeleteLocalButton)}</button
      >{/if}
  </section>
</div>
