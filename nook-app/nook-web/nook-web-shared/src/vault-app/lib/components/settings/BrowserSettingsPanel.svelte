<script lang="ts">
  import { LocaleCatalogSource } from "$lib/vault/locale";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Globe, Trash2, TriangleAlert } from "@lucide/svelte";
  import {
    parse_app_locale,
    supported_app_locale_code,
    NookAppLocaleParse,
  } from "$app-wasm";
  import type { VaultState } from "$lib/vault.svelte";
  import ManageSection from "$lib/components/settings/ManageSection.svelte";
  import { Button } from "$lib/components/ui/button";

  let deleteConfirmationOpen = $state(false);

  let {
    vault,
  }: {
    vault: VaultState;
  } = $props();
</script>

<div class="grid min-w-0 grid-cols-1 gap-8" data-testid="browser-settings-panel">
  <ManageSection
    title={vault.t(I18N_KEYS.SettingsLanguage)}
    subtitle={vault.t(I18N_KEYS.SettingsSelectLanguage)}
    testId="vault-language-section"
  >
    {#snippet badge()}
      <span
        class="nk-tag"
      >
        <Globe class="size-3" />
        {vault.locale === "en" ? "English" : "Русский"}
      </span>
    {/snippet}
    <div class="nk-list space-y-3 p-4">
      <label
        for="language-select"
        class="block text-sm font-medium text-muted-foreground"
      >
        {vault.t(I18N_KEYS.SettingsSelectLanguage)}
      </label>
      <select
        id="language-select"
        class="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary"
        value={vault.locale}
        onchange={(e) => {
          const parsed = parse_app_locale(e.currentTarget.value);
          if (parsed === NookAppLocaleParse.Unsupported) return;
          const localeRequest: Parameters<typeof vault.updateLocale>[0] = {
            newLocale: supported_app_locale_code(parsed),
            catalogSource: vault.hasManager
              ? LocaleCatalogSource.Engine
              : LocaleCatalogSource.Bundled,
          };
          void vault.updateLocale(localeRequest).then((updated) => {
            if (updated.isErr())
              vault.errorMsg = vault.t(updated.error.translationKey);
          });
        }}
      >
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>
    </div>
  </ManageSection>

  <ManageSection
    title={vault.t(I18N_KEYS.SettingsDeleteLocalTitle)}
    subtitle={vault.t(I18N_KEYS.SettingsDeleteLocalDesc)}
    testId="vault-danger-section"
  >
    {#snippet badge()}
      <span
        class="nk-tag nk-tag-danger"
      >
        <TriangleAlert class="size-3" />
        {vault.t(I18N_KEYS.SettingsDangerZone)}
      </span>
    {/snippet}
    <div class="nk-banner space-y-3 border-l-destructive p-4">
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.SettingsDeleteLocalDetails)}
      </p>
      {#if deleteConfirmationOpen}
        <div
          class="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          data-testid="delete-local-vault-confirmation"
        >
          <p class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.SettingsDeleteLocalConfirm)}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={vault.isSaving}
              data-testid="delete-local-vault-cancel"
              onclick={() => (deleteConfirmationOpen = false)}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={vault.isSaving}
              data-testid="delete-local-vault-confirm"
              onclick={() => void vault.deleteLocalBrowserData()}
            >
              <Trash2 class="size-3.5" />
              {vault.isSaving
                ? vault.t(I18N_KEYS.SettingsDeletingLocal)
                : vault.t(I18N_KEYS.SettingsDeleteLocalConfirmButton)}
            </Button>
          </div>
        </div>
      {:else}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          data-testid="delete-local-vault-button"
          onclick={() => (deleteConfirmationOpen = true)}
        >
          <Trash2 class="size-3.5" />
          {vault.t(I18N_KEYS.SettingsDeleteLocalButton)}
        </Button>
      {/if}
    </div>
  </ManageSection>
</div>
