<!--
Devices asking to join this identity, written into its log by a browser
that found the identity on a sync provider and could not open it. A member
approves a device it recognizes, which gives it every vault of the identity,
or denies it. Rust lists only requests this installation can answer.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Check, UserPlus, X } from '@lucide/svelte'
  import type { IdentityJoinRequestView } from '$app-wasm'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityJoinDecision,
    type IdentityJoinAnswer,
  } from '$lib/vault/identity-control.svelte'

  let {
    vault,
    requests,
    isBusy,
  }: {
    vault: VaultState
    requests: IdentityJoinRequestView[]
    isBusy: boolean
  } = $props()

  const dateFormat = $derived.by(() => {
    const options: ConstructorParameters<typeof Intl.DateTimeFormat>[1] = {
      dateStyle: 'medium',
      timeStyle: 'short',
    }
    return new Intl.DateTimeFormat(vault.locale, options)
  })

  function requestedLine(requestedAt: string): string {
    const parsed = new Date(requestedAt)
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesCardRequestedAt,
      replacements: {
        date: Number.isNaN(parsed.getTime())
          ? requestedAt
          : dateFormat.format(parsed),
      },
    }
    return vault.t(request)
  }

  function deviceName(request: IdentityJoinRequestView): string {
    return request.label.trim().length > 0
      ? request.label
      : vault.t(I18N_KEYS.IdentityControlUnnamedApp)
  }

  async function answer(request: IdentityJoinAnswer): Promise<void> {
    await vault.identityControl.answerJoin(request)
  }
</script>

<ManageSection
  compact
  title={vault.t(I18N_KEYS.IdentityControlJoinRequestsTitle)}
  subtitle={vault.t(I18N_KEYS.IdentityControlJoinRequestsBody)}
  testId="identity-join-requests"
>
  <ul class="nk-list">
    {#each requests as request (request.appId)}
      {@const approve: IdentityJoinAnswer = {
        appId: request.appId,
        decision: IdentityJoinDecision.Approve,
      }}
      {@const deny: IdentityJoinAnswer = {
        appId: request.appId,
        decision: IdentityJoinDecision.Deny,
      }}
      <li
        class="nk-row"
        data-testid="identity-join-request"
        data-app-id={request.appId}
      >
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <UserPlus class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="nk-row-title text-sm">{deviceName(request)}</p>
          <p class="nk-spec mt-1 font-mono">
            {vault.t(I18N_KEYS.DevicesCardDevicePrefix)}{request.appId}
          </p>
          <p class="nk-spec mt-1">{requestedLine(request.requestedAt)}</p>
        </div>
        <div class="nk-row-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="identity-join-request-deny"
            disabled={isBusy}
            onclick={() => void answer(deny)}
          >
            <X class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.DevicesCardDeny)}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="identity-join-request-approve"
            disabled={isBusy}
            onclick={() => void answer(approve)}
          >
            <Check class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.DevicesCardApprove)}
          </Button>
        </div>
      </li>
    {/each}
  </ul>
</ManageSection>
