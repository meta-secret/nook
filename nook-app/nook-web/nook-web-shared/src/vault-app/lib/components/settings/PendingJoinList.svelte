<!--
Devices asking to join the identity, each with Approve and Deny. Shown on
the Devices page and at the end of adding a device.
-->
<script lang="ts">
  import type { Result } from "neverthrow";
  import type { IdentityJoinView } from "$app-wasm";
  import type { VaultStorageFailure } from "$lib/runtime/storage-failure";
  import type { OAuthFailure } from "$lib/auth/oauth-failure";
  import type { IdentityActionOutcome } from "$lib/vault/identity-control.svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Check, Smartphone, X } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { DeviceIdLabel } from "./device-id-label";

  type IdentityActionResult = Result<
    IdentityActionOutcome,
    VaultStorageFailure | OAuthFailure
  >;

  let {
    vault,
    pendingJoins,
    isBusy,
    onApproveJoin,
    onDenyJoin,
  }: {
    vault: VaultState;
    pendingJoins: IdentityJoinView[];
    isBusy: boolean;
    onApproveJoin: (appId: string) => Promise<IdentityActionResult>;
    onDenyJoin: (appId: string) => Promise<IdentityActionResult>;
  } = $props();

  function formatRequestDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      return vault.t(I18N_KEYS.DevicesCardRecently);
    return date.toLocaleDateString();
  }

  function joinName(join: IdentityJoinView): string {
    const label = join.label.trim();
    if (label) return label;
    const idRequest: ConstructorParameters<typeof DeviceIdLabel>[0] = {
      value: join.appId,
      head: 14,
      tail: 10,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${new DeviceIdLabel(idRequest).text}`;
  }
</script>

<section class="grid gap-2" data-testid="pending-join-list">
  <div class="flex items-center justify-between gap-3">
    <h3 class="text-sm font-semibold text-foreground">
      {vault.t(I18N_KEYS.IdentityControlPendingTitle)}
    </h3>
    <span class="text-xs text-muted-foreground">
      {pendingJoins.length === 1
        ? vault.t(I18N_KEYS.DevicesCardRequestsCountSingular)
        : (() => {
            const countArgs: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.DevicesCardRequestsCountPlural,
              replacements: { count: String(pendingJoins.length) },
            };
            return vault.t(countArgs);
          })()}
    </span>
  </div>
  <ul class="grid gap-2">
    {#each pendingJoins as join (join.appId)}
      <li
        class="nk-banner nk-band-success flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        data-testid="pending-join-row"
        data-app-id={join.appId}
      >
        <div class="flex min-w-0 items-center gap-3">
          <span class="nk-tile shrink-0" aria-hidden="true">
            <Smartphone class="size-4" />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-foreground">
              {joinName(join)}
            </p>
            <p class="text-xs text-muted-foreground">
              {vault.t(
                I18N_KEYS.DevicesCardRequestedPrefix,
              )}{formatRequestDate(join.requestedAt)}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            data-testid="deny-join-btn"
            aria-label={vault.t(I18N_KEYS.IdentityControlDeny)}
            onclick={() => void onDenyJoin(join.appId)}
          >
            <X class="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            data-testid="approve-join-btn"
            onclick={() => void onApproveJoin(join.appId)}
          >
            <Check class="size-3.5" />
            {vault.t(I18N_KEYS.IdentityControlApprove)}
          </Button>
        </div>
      </li>
    {/each}
  </ul>
</section>
