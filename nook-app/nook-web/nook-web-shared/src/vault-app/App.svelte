<script lang="ts">
  import {
    WorkspacePage,
    workspaceNavigation,
  } from "$lib/workspace/navigation";
  import { onMount } from "svelte";
  import { LockKeyhole, SunMoon } from "@lucide/svelte";
  import { VaultState } from "$lib/vault.svelte";
  import {
    vaultBrowserLifecycle,
    THEME_STORAGE_KEY,
  } from "$lib/app/browser-lifecycle";
  import { browserColorMode, ColorMode } from "$lib/app/theme";
  import { I18N_KEYS as K } from "../generated/i18n-keys";
  import Access from "$lib/workspace/Access.svelte";
  import Items from "$lib/workspace/Items.svelte";
  import Preferences from "$lib/workspace/Preferences.svelte";
  import ExtensionConnectConsent from "$lib/components/ExtensionConnectConsent.svelte";
  import { configured_vault_application, VaultApplication } from "$app-wasm";
  import {
    initialExtensionConnectIntent,
    ExtensionConnectIntentKind,
    type ExtensionConnectIntent,
  } from "$lib/app/route-state";

  const vault = new VaultState();
  const application = configured_vault_application();
  const supportsExtension =
    application === VaultApplication.Simple ||
    application === VaultApplication.UnifiedDevelopment;
  let extension = $state<ExtensionConnectIntent>(
    initialExtensionConnectIntent(supportsExtension),
  );
  let page = $state(WorkspacePage.Items);
  let colorMode = $state(browserColorMode.systemColorMode());
  let systemMode = $state(true);
  onMount(() => {
    const lifecycle: Parameters<
      typeof vaultBrowserLifecycle.mountBrowserLifecycle
    >[0] = {
      vault,
      followsSystemColorMode: () => systemMode,
      setColorMode: (mode) => {
        colorMode = mode;
      },
      stopFollowingSystemColorMode: () => {
        systemMode = false;
      },
      syncRoute: () => {
        extension = initialExtensionConnectIntent(supportsExtension);
      },
    };
    return vaultBrowserLifecycle.mountBrowserLifecycle(lifecycle);
  });
  $effect(() => {
    document.documentElement.classList.toggle(
      "dark",
      colorMode === ColorMode.Dark,
    );
  });
  function toggleAppearance() {
    systemMode = false;
    const selection: Parameters<typeof browserColorMode.manualColorMode>[0] = {
      current: colorMode,
      storageKey: THEME_STORAGE_KEY,
    };
    colorMode = browserColorMode.manualColorMode(selection);
  }
</script>

<svelte:head><title>{vault.t(K.WorkspaceBrand)}</title></svelte:head>
<div class="workspace" class:locked={!vault.isAuthenticated}>
  {#if vault.isAuthenticated}
    <aside class="rail" data-testid="authenticated-shell">
      <div class="wordmark">
        <span class="brand-mark" aria-hidden="true">n</span><strong
          >{vault.t(K.WorkspaceBrand)}</strong
        >
      </div>
      <nav aria-label={vault.t(K.WorkspaceBrand)}>
        {#each workspaceNavigation as entry (entry.page)}
          <button
            aria-label={vault.t(entry.label)}
            class:active={page === entry.page}
            onclick={() => {
              page = entry.page;
            }}
          >
            <entry.icon size={19} /><span>{vault.t(entry.label)}</span>
          </button>
        {/each}
      </nav>
      <div class="rail-bottom">
        <div class="device-note">
          <span class="status-dot"></span><span
            >{vault.t(K.WorkspaceProtected)}</span
          >
        </div>
        <button
          aria-label={vault.t(K.WorkspaceChangeAppearance)}
          onclick={toggleAppearance}
          ><SunMoon size={18} /><span
            >{vault.t(K.WorkspaceChangeAppearance)}</span
          ></button
        >
        <button
          aria-label={vault.t(K.CommonLockVault)}
          data-testid="header-lock-vault-btn"
          onclick={() => vault.lockVault()}
          ><LockKeyhole size={18} /><span>{vault.t(K.CommonLockVault)}</span
          ></button
        >
      </div>
    </aside>
  {/if}
  <main>
    {#if vault.errorMsg}<div class="notice error" role="alert">
        <span>{vault.errorMsg}</span><button
          aria-label={vault.t(K.CommonDismissError)}
          onclick={() => vault.dismissError()}>×</button
        >
      </div>{/if}
    {#if vault.successMsg}<div
        class="notice success"
        role="status"
        data-testid="app-success"
      >
        <span>{vault.successMsg}</span><button
          aria-label={vault.t(K.CommonDismissSuccess)}
          onclick={() => vault.dismissSuccess()}>×</button
        >
      </div>{/if}
    {#if vault.isInitializing}<div class="empty-state" role="status">
        <span class="brand-mark">n</span>
        <p>{vault.t(K.CommonLoading)}</p>
      </div>
    {:else if !vault.isAuthenticated}<Access {vault} {extension} />
    {:else if extension.kind === ExtensionConnectIntentKind.Requested}
      <ExtensionConnectConsent
        {vault}
        request={extension.request}
        onClose={() => {
          extension = { kind: ExtensionConnectIntentKind.Absent };
          const routeState: Record<string, never> = {};
          history.replaceState(routeState, "", "/vault");
        }}
      />
    {:else}
      {#key vault.sessionEpoch}
        {#if page === WorkspacePage.Items}<Items {vault} />{:else}<Preferences
            {vault}
            {toggleAppearance}
          />{/if}
      {/key}
    {/if}
  </main>
</div>
