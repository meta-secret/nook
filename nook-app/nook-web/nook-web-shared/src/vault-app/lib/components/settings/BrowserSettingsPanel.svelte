<!--
This browser's own settings, apart from any identity: the language Nook
speaks here, and wiping everything Nook keeps in this browser.
-->
<script lang="ts">
  import { LocaleCatalogSource } from "$lib/vault/locale";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Globe, Trash2 } from "@lucide/svelte";
  import {
    parse_app_locale,
    supported_app_locale_code,
    NookAppLocaleParse,
  } from "$app-wasm";
  import type { VaultState } from "$lib/vault.svelte";
  import { Button } from "$lib/components/ui/button";

  let deleteConfirmationOpen = $state(false);

  type LocaleChoice = { readonly code: string; readonly label: string };
  const LOCALES: readonly LocaleChoice[] = [
    { code: "en", label: "English" },
    { code: "ru", label: "Русский" },
  ];

  function chooseLocale(code: string): void {
    const parsed = parse_app_locale(code);
    if (parsed === NookAppLocaleParse.Unsupported) return;
    const localeRequest: Parameters<typeof vault.updateLocale>[0] = {
      newLocale: supported_app_locale_code(parsed),
      catalogSource: vault.hasManager
        ? LocaleCatalogSource.Engine
        : LocaleCatalogSource.Bundled,
    };
    void vault.updateLocale(localeRequest).then((updated) => {
      if (updated.isErr()) vault.errorMsg = vault.t(updated.error.translationKey);
    });
  }

  let {
    vault,
  }: {
    vault: VaultState;
  } = $props();
</script>

<div class="grid min-w-0 divide-y divide-border" data-testid="browser-settings-panel">
  <section
    class="flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between"
    data-testid="vault-language-section"
  >
    <div class="flex min-w-0 items-start gap-3">
      <span class="nk-tile shrink-0" aria-hidden="true">
        <Globe class="size-4" />
      </span>
      <div class="grid gap-0.5">
        <h2 class="text-base font-semibold text-foreground">
          {vault.t(I18N_KEYS.SettingsLanguage)}
        </h2>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.SettingsSelectLanguage)}
        </p>
      </div>
    </div>
    <div
      class="inline-flex shrink-0 self-start border border-border sm:self-center"
      role="radiogroup"
      aria-label={vault.t(I18N_KEYS.SettingsLanguage)}
      data-testid="language-choice"
    >
      {#each LOCALES as choice (choice.code)}
        <button
          type="button"
          role="radio"
          aria-checked={vault.locale === choice.code}
          class="px-4 py-2 text-sm font-medium transition-colors {vault.locale ===
          choice.code
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
          data-testid="language-choice-{choice.code}"
          onclick={() => chooseLocale(choice.code)}
        >
          {choice.label}
        </button>
      {/each}
    </div>
  </section>

  <section class="grid gap-4 pt-6" data-testid="vault-danger-section">
    <div class="flex min-w-0 items-start gap-3">
      <span class="nk-tile shrink-0 text-destructive" aria-hidden="true">
        <Trash2 class="size-4" />
      </span>
      <div class="grid gap-1">
        <h2 class="text-base font-semibold text-foreground">
          {vault.t(I18N_KEYS.SettingsDeleteLocalTitle)}
        </h2>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.SettingsDeleteLocalDesc)}
        </p>
        <p class="text-xs text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.SettingsDeleteLocalDetails)}
        </p>
      </div>
    </div>
    {#if deleteConfirmationOpen}
      <div
        class="nk-banner grid gap-3 border-l-destructive bg-destructive/5 p-4"
        data-testid="delete-local-vault-confirmation"
      >
        <p class="text-sm font-medium text-foreground">
          {vault.t(I18N_KEYS.SettingsDeleteLocalConfirm)}
        </p>
        <div class="flex flex-wrap gap-2">
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
        </div>
      </div>
    {:else}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="justify-self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        data-testid="delete-local-vault-button"
        onclick={() => (deleteConfirmationOpen = true)}
      >
        <Trash2 class="size-3.5" />
        {vault.t(I18N_KEYS.SettingsDeleteLocalButton)}
      </Button>
    {/if}
  </section>
</div>
