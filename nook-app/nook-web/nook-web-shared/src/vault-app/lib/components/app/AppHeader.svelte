<script lang="ts">
  import { ArrowLeft, BookOpen, Lock, Moon, Sun } from "@lucide/svelte";
  import { IS_SENTINEL_APP, siblingAppUrl } from "$lib/app-kind";
  import HeaderLanguageSelect from "$lib/components/HeaderLanguageSelect.svelte";
  import NookLogo from "$lib/components/NookLogo.svelte";
  import VaultSwitcher from "$lib/components/VaultSwitcher.svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";

  type ColorMode = "light" | "dark";

  let {
    vault,
    colorMode,
    shellWidth,
    legalPageOpen,
    logsPage,
    extensionConnectRoute,
    onNavigateHome,
    onToggleColorMode,
  }: {
    vault: VaultState;
    colorMode: ColorMode;
    shellWidth: string;
    legalPageOpen: boolean;
    logsPage: boolean;
    extensionConnectRoute: boolean;
    onNavigateHome: () => void;
    onToggleColorMode: () => void;
  } = $props();

  function navigateToSiblingApp(event: MouseEvent) {
    event.preventDefault();
    const destination = siblingAppUrl();
    if (!destination) return;
    vault.lockVault();
    window.location.assign(destination);
  }
</script>

<header class="app-header border-b border-border/50 bg-card/80 backdrop-blur-md">
  <div
    class="mx-auto flex items-center justify-between gap-4 px-4 py-2 sm:px-6 {shellWidth}"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
      <NookLogo {colorMode} size="sm" class="rounded-lg overflow-hidden" />
      {#if vault.isAuthenticated && !legalPageOpen && !logsPage && !vault.helpOpen}
        <VaultSwitcher {vault} />
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      {#if vault.isAuthenticated && !vault.helpOpen && !legalPageOpen}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
          data-testid="header-lock-vault-btn"
          title={vault.t("session.lock_desc")}
          disabled={vault.isVerifying || vault.isInitializing}
          onclick={() => vault.lockVault()}
        >
          <Lock class="size-4" />
          <span class="hidden sm:inline">{vault.t("common.lock_vault")}</span>
        </Button>
        <div
          class="mx-0.5 h-6 w-px shrink-0 bg-border/60"
          aria-hidden="true"
        ></div>
      {/if}

      <HeaderLanguageSelect {vault} />

      {#if IS_SENTINEL_APP}
        <a
          href={siblingAppUrl()}
          class="hidden h-10 items-center rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
          data-testid="sibling-vault-app-link"
          onclick={navigateToSiblingApp}
        >
          {vault.t("app.open_simple_app")}
        </a>
      {/if}

      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70"
        aria-label={colorMode === "dark"
          ? vault.t("app.switch_light")
          : vault.t("app.switch_dark")}
        title={colorMode === "dark"
          ? vault.t("app.switch_light")
          : vault.t("app.switch_dark")}
        data-testid="theme-toggle-btn"
        onclick={onToggleColorMode}
      >
        {#if colorMode === "dark"}
          <Sun class="size-4" />
        {:else}
          <Moon class="size-4" />
        {/if}
      </button>

      <a
        href="https://github.com/meta-secret/nook"
        target="_blank"
        rel="noreferrer"
        class="h-10 items-center justify-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background {vault.isAuthenticated
          ? 'hidden w-10 sm:inline-flex'
          : 'inline-flex px-3.5'}"
        aria-label={vault.t("app.github_aria")}
        title={vault.t("app.github_title")}
        data-testid="github-source-link"
      >
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M12 2C6.48 2 2 6.59 2 12.25c0 4.52 2.86 8.36 6.84 9.72.5.09.68-.22.68-.49 0-.24-.01-.89-.01-1.75-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.93.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 6.98c.85 0 1.71.12 2.51.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.13 10.13 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
          />
        </svg>
        <span class={vault.isAuthenticated ? "sr-only" : "hidden sm:inline"}
          >GitHub</span
        >
      </a>

      {#if legalPageOpen || logsPage || extensionConnectRoute}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
          data-testid="legal-header-back"
          onclick={onNavigateHome}
        >
          <ArrowLeft class="size-4" />
          <span class="hidden sm:inline">{vault.t("app.back")}</span>
        </Button>
      {:else if vault.helpOpen}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
          data-testid="help-header-close"
          onclick={() => vault.closeHelp()}
        >
          <ArrowLeft class="size-4" />
          <span class="hidden sm:inline">{vault.t("app.back")}</span>
        </Button>
      {:else}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
          data-testid="help-open-btn"
          onclick={() => vault.openHelp()}
        >
          <BookOpen class="size-4" />
          <span class="hidden sm:inline">{vault.t("app.help")}</span>
        </Button>
      {/if}
    </div>
  </div>
</header>
