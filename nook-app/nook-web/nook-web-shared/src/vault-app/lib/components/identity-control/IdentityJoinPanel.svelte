<!--
Joining app on the identities hub: waits for a member to approve the join,
then lists the vaults the identity granted this app that are not on this
browser yet. Opening one pulls it from an identity mount and self-enrolls.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onMount } from "svelte";
  import { Clock, LockOpen, RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityJoinKind } from "$lib/vault/identity-control.svelte";
  import { browserLogRuntime } from "$lib/runtime/log";

  const log = browserLogRuntime.createLogger("identity-join-panel");

  let { vault }: { vault: VaultState } = $props();

  const control = $derived(vault.identityControl);
  const join = $derived(control.join);
  const joinableVaults = $derived.by(() => {
    const snapshot = control.snapshot;
    if (snapshot === false) return [];
    const local = new Set(vault.localVaults.map((entry) => entry.storeId));
    return snapshot.vaults.filter(
      (entry) => entry.grantedToCurrentInstallation && !local.has(entry.storeId),
    );
  });
  const waitingDescription = $derived.by(() => {
    if (join.kind === IdentityJoinKind.Idle) return "";
    const waitingArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityControlJoinWaitingDescription,
      replacements: { identity: join.identityLabel },
    };
    return vault.t(waitingArgs);
  });

  async function checkAgain() {
    const checked = await control.checkJoinApproval();
    if (checked.isErr()) vault.errorMsg = vault.t(checked.error.translationKey);
  }

  async function openVault(storeId: string) {
    const opened = await control.openVault(storeId);
    if (opened.isErr()) vault.errorMsg = vault.t(opened.error.translationKey);
  }

  onMount(() => {
    if (!vault.hasManager || vault.isAuthenticated) return;
    void control.refresh().then((refreshed) => {
      // The hub opens before the device key is unlocked; the panel stays
      // hidden until a later refresh succeeds.
      if (refreshed.isErr()) log.info("identity snapshot not available yet");
    });
  });
</script>

{#if join.kind === IdentityJoinKind.Pending}
  <section
    class="nk-banner space-y-2 p-4 text-sm text-foreground"
    data-testid="identity-join-pending"
    role="status"
    aria-live="polite"
  >
    <p class="inline-flex items-center gap-2 font-medium">
      <Clock class="size-4 shrink-0 text-primary" />
      {vault.t(I18N_KEYS.IdentityControlJoinWaitingTitle)}
    </p>
    <p class="text-xs text-muted-foreground">{waitingDescription}</p>
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={control.busy}
      data-testid="identity-join-check-btn"
      onclick={() => void checkAgain()}
    >
      <RefreshCw class="size-3.5" />
      {vault.t(I18N_KEYS.IdentityControlJoinCheck)}
    </Button>
  </section>
{/if}

{#if !vault.isAuthenticated && (join.kind === IdentityJoinKind.Approved || joinableVaults.length > 0)}
  <section
    class="nk-banner nk-banner-success space-y-3 p-4 text-sm text-foreground"
    data-testid="identity-join-approved"
  >
    <p class="font-medium">{vault.t(I18N_KEYS.IdentityControlJoinApproved)}</p>
    <ul class="space-y-2" data-testid="identity-joinable-vaults">
      {#each joinableVaults as entry (entry.storeId)}
        <li
          class="flex items-center justify-between gap-3 border border-border bg-background/70 px-3 py-2"
          data-testid="identity-joinable-vault"
          data-store-id={entry.storeId}
        >
          <span class="truncate font-mono text-xs">{entry.storeId}</span>
          <Button
            type="button"
            size="sm"
            disabled={control.busy || vault.isVerifying}
            data-testid="identity-open-vault-btn"
            onclick={() => void openVault(entry.storeId)}
          >
            <LockOpen class="size-3.5" />
            {vault.t(I18N_KEYS.IdentityControlVaultOpenThroughIdentity)}
          </Button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
