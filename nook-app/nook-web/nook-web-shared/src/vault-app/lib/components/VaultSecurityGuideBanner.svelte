<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    ChevronDown,
    Cloud,
    Laptop,
    ShieldCheck,
    TriangleAlert,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";

  const EXPANDED_STORAGE_KEY = "nook_security_guide_expanded";
  const LEGACY_EXPANDED_STORAGE_KEY = "nook_local_only_warning_expanded";

  let {
    vault,
    needsSyncProvider,
    needsAnotherDevice,
    onAddSyncProvider,
    onAddDevice,
  }: {
    vault: VaultState;
    needsSyncProvider: boolean;
    needsAnotherDevice: boolean;
    onAddSyncProvider: () => void;
    onAddDevice: () => void;
  } = $props();

  const recommendationCount = $derived(
    Number(needsSyncProvider) + Number(needsAnotherDevice),
  );
  let folded = $state(!readExpanded());

  function readExpanded(): boolean {
    try {
      return (
        localStorage.getItem(EXPANDED_STORAGE_KEY) === "1" ||
        localStorage.getItem(LEGACY_EXPANDED_STORAGE_KEY) === "1"
      );
    } catch {
      return false;
    }
  }

  function persistExpanded(expanded: boolean) {
    try {
      localStorage.removeItem(LEGACY_EXPANDED_STORAGE_KEY);
      if (expanded) {
        localStorage.setItem(EXPANDED_STORAGE_KEY, "1");
      } else {
        localStorage.removeItem(EXPANDED_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  }

  function toggleFold() {
    folded = !folded;
    persistExpanded(!folded);
  }
</script>

<aside
  role="alert"
  class="shrink-0 overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/10 font-sans text-sm text-amber-900/80 animate-in fade-in slide-in-from-top-2 dark:text-amber-100/80"
  data-testid="vault-security-guide"
  data-folded={folded ? "true" : "false"}
  data-recommendations={recommendationCount}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-amber-500/10 {folded
      ? ''
      : 'bg-amber-500/10'}"
    aria-expanded={!folded}
    aria-label={vault.t(
      folded ? I18N_KEYS.SecurityGuideExpand : I18N_KEYS.SecurityGuideCollapse,
    )}
    data-testid="security-guide-toggle"
    onclick={toggleFold}
  >
    <TriangleAlert class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <span class="min-w-0 flex-1">
      <span
        class="block text-sm font-medium text-amber-950 dark:text-amber-100"
      >
        {vault.t(I18N_KEYS.SecurityGuideTitle)}
      </span>
      {#if folded}
        <span
          class="block truncate text-xs leading-5 text-amber-900/75 dark:text-amber-100/75"
        >
          {(() => { const translationRequest: Parameters<typeof vault.t>[0] = {
            key: recommendationCount === 1
              ? I18N_KEYS.SecurityGuideRecommendationCountSingular
              : I18N_KEYS.SecurityGuideRecommendationCountPlural,
            replacements: { count: String(recommendationCount) },
          }; return vault.t(translationRequest); })()}
        </span>
      {/if}
    </span>
    <ChevronDown
      class="size-5 shrink-0 text-amber-800 transition-transform duration-200 dark:text-amber-200 {folded
        ? ''
        : 'rotate-180'}"
    />
  </button>

  {#if !folded}
    <div
      class="space-y-3 border-t border-amber-500/25 bg-background/40 px-4 py-4"
      data-testid="security-guide-details"
    >
      <p
        class="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90"
      >
        {vault.t(I18N_KEYS.SecurityGuideIntro)}
      </p>

      {#if needsSyncProvider}
        <section
          class="rounded-lg border border-amber-500/25 bg-background/55 p-3"
          data-testid="security-guide-sync-provider"
        >
          <div class="flex items-start gap-3">
            <Cloud
              class="mt-0.5 size-4.5 shrink-0 text-amber-700 dark:text-amber-300"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <h3
                  class="text-sm font-semibold text-amber-950 dark:text-amber-100"
                >
                  {vault.t(I18N_KEYS.SecurityGuideSyncTitle)}
                </h3>
                <p
                  class="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80"
                >
                  {vault.t(I18N_KEYS.SecurityGuideSyncBody)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
                data-testid="security-guide-add-sync-provider"
                onclick={onAddSyncProvider}
              >
                {vault.t(I18N_KEYS.SecurityGuideAddSyncProvider)}
              </Button>
            </div>
          </div>
        </section>
      {/if}

      {#if needsAnotherDevice}
        <section
          class="rounded-lg border border-amber-500/25 bg-background/55 p-3"
          data-testid="security-guide-device"
        >
          <div class="flex items-start gap-3">
            <Laptop
              class="mt-0.5 size-4.5 shrink-0 text-amber-700 dark:text-amber-300"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <h3
                  class="text-sm font-semibold text-amber-950 dark:text-amber-100"
                >
                  {vault.t(I18N_KEYS.SecurityGuideDeviceTitle)}
                </h3>
                <p
                  class="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80"
                >
                  {vault.t(I18N_KEYS.SecurityGuideDeviceBody)}
                </p>
              </div>
              <div
                class="flex items-start gap-2 text-xs leading-relaxed text-amber-900/75 dark:text-amber-100/75"
              >
                <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
                <span>{vault.t(I18N_KEYS.SecurityGuideDistinctSafeguards)}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
                data-testid="security-guide-add-device"
                onclick={onAddDevice}
              >
                {vault.t(I18N_KEYS.SecurityGuideAddDevice)}
              </Button>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</aside>
