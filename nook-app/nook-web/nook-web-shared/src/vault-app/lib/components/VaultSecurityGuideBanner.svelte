<script lang="ts">
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

<div
  role="alert"
  class="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 animate-in fade-in slide-in-from-top-2 {folded
    ? 'p-3'
    : 'p-4'}"
  data-testid="vault-security-guide"
  data-folded={folded ? "true" : "false"}
  data-recommendations={recommendationCount}
>
  <div class="flex items-start gap-3">
    <TriangleAlert
      class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p
            class="text-sm font-semibold text-amber-950 dark:text-amber-100 {folded
              ? 'truncate'
              : ''}"
          >
            {vault.t("security_guide.title")}
          </p>
          <p class="text-xs text-amber-900/75 dark:text-amber-100/75">
            {vault.t(
              recommendationCount === 1
                ? "security_guide.recommendation_count_singular"
                : "security_guide.recommendation_count_plural",
              { count: String(recommendationCount) },
            )}
          </p>
        </div>
        {#if folded}
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="shrink-0 border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
            data-testid="security-guide-primary-action"
            onclick={needsSyncProvider ? onAddSyncProvider : onAddDevice}
          >
            {vault.t(
              needsSyncProvider
                ? "security_guide.add_sync_provider"
                : "security_guide.add_device",
            )}
          </Button>
        {/if}
        <button
          type="button"
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-200"
          aria-expanded={!folded}
          aria-label={vault.t(
            folded ? "security_guide.expand" : "security_guide.collapse",
          )}
          data-testid="security-guide-toggle"
          onclick={toggleFold}
        >
          <ChevronDown
            class="size-4 transition-transform duration-200 {folded
              ? ''
              : 'rotate-180'}"
          />
        </button>
      </div>

      {#if !folded}
        <div class="mt-3 space-y-3" data-testid="security-guide-details">
          <p
            class="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90"
          >
            {vault.t("security_guide.intro")}
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
                      {vault.t("security_guide.sync_title")}
                    </h3>
                    <p
                      class="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80"
                    >
                      {vault.t("security_guide.sync_body")}
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
                    {vault.t("security_guide.add_sync_provider")}
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
                      {vault.t("security_guide.device_title")}
                    </h3>
                    <p
                      class="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80"
                    >
                      {vault.t("security_guide.device_body")}
                    </p>
                  </div>
                  <div
                    class="flex items-start gap-2 text-xs leading-relaxed text-amber-900/75 dark:text-amber-100/75"
                  >
                    <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
                    <span>{vault.t("security_guide.distinct_safeguards")}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class="border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
                    data-testid="security-guide-add-device"
                    onclick={onAddDevice}
                  >
                    {vault.t("security_guide.add_device")}
                  </Button>
                </div>
              </div>
            </section>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
