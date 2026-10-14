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
  class="shrink-0 overflow-hidden font-sans text-sm text-muted-foreground animate-in fade-in"
  data-testid="vault-security-guide"
  data-folded={folded ? "true" : "false"}
  data-recommendations={recommendationCount}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 md:px-6"
    aria-expanded={!folded}
    aria-label={vault.t(
      folded ? I18N_KEYS.SecurityGuideExpand : I18N_KEYS.SecurityGuideCollapse,
    )}
    data-testid="security-guide-toggle"
    onclick={toggleFold}
  >
    <TriangleAlert class="size-4 shrink-0 text-warning" />
    <span class="min-w-0 flex-1">
      <span
        class="block text-sm font-medium text-foreground"
      >
        {vault.t(I18N_KEYS.SecurityGuideTitle)}
      </span>
      {#if folded}
        <span
          class="block truncate text-xs leading-5 text-muted-foreground"
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
      class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {folded
        ? ''
        : 'rotate-180'}"
    />
  </button>

  {#if !folded}
    <div
      class="space-y-3 px-4 pb-4 md:px-6 md:pl-[3.25rem]"
      data-testid="security-guide-details"
    >
      <p
        class="text-sm leading-relaxed text-muted-foreground"
      >
        {vault.t(I18N_KEYS.SecurityGuideIntro)}
      </p>

      {#if needsSyncProvider}
        <section
          class="border-t border-border pt-3"
          data-testid="security-guide-sync-provider"
        >
          <div class="flex items-start gap-3">
            <Cloud
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <h3
                  class="text-sm font-semibold text-foreground"
                >
                  {vault.t(I18N_KEYS.SecurityGuideSyncTitle)}
                </h3>
                <p
                  class="mt-1 text-xs leading-relaxed text-muted-foreground"
                >
                  {vault.t(I18N_KEYS.SecurityGuideSyncBody)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="border-border"
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
          class="border-t border-border pt-3"
          data-testid="security-guide-device"
        >
          <div class="flex items-start gap-3">
            <Laptop
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <h3
                  class="text-sm font-semibold text-foreground"
                >
                  {vault.t(I18N_KEYS.SecurityGuideDeviceTitle)}
                </h3>
                <p
                  class="mt-1 text-xs leading-relaxed text-muted-foreground"
                >
                  {vault.t(I18N_KEYS.SecurityGuideDeviceBody)}
                </p>
              </div>
              <div
                class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
                <span>{vault.t(I18N_KEYS.SecurityGuideDistinctSafeguards)}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="border-border"
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
