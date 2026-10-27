<!--
Devices asking to open the open vault, written into its event log by a
device that found the vault in a shared Nook folder. A member approves a
device it recognizes, which wraps the vault keys to that device, or denies
it.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Check, KeyRound, X } from '@lucide/svelte'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AccessRequestDecision,
    VaultAccessRequestActions,
    type AccessRequestAnswer,
  } from '$lib/vault/access-requests'

  let {
    vault,
    isBusy,
  }: {
    vault: VaultState
    isBusy: boolean
  } = $props()

  let answering = $state(false)
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

  async function answer(request: AccessRequestAnswer): Promise<void> {
    answering = true
    try {
      const answered = await new VaultAccessRequestActions(vault).answer(
        request,
      )
      if (answered.isErr())
        vault.errorMsg = vault.t(answered.error.translationKey)
    } finally {
      answering = false
    }
  }
</script>

<ManageSection
  compact
  title={vault.t(I18N_KEYS.DevicesCardPendingRequests)}
  subtitle={vault.t(I18N_KEYS.DevicesCardAccessRequestsBody)}
  testId="vault-access-requests"
>
  <ul class="nk-list">
    {#each vault.pendingJoins as join (join.deviceId)}
      {@const approve: AccessRequestAnswer = {
        deviceId: join.deviceId,
        decision: AccessRequestDecision.Approve,
      }}
      {@const deny: AccessRequestAnswer = {
        deviceId: join.deviceId,
        decision: AccessRequestDecision.Deny,
      }}
      <li
        class="nk-row"
        data-testid="vault-access-request"
        data-device-id={join.deviceId}
      >
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <KeyRound class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="nk-row-title font-mono text-sm">
            {vault.t(I18N_KEYS.DevicesCardDevicePrefix)}{join.deviceId}
          </p>
          <p class="nk-spec mt-1">{requestedLine(join.requestedAt)}</p>
        </div>
        <div class="nk-row-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="vault-access-request-deny"
            disabled={isBusy || answering}
            onclick={() => void answer(deny)}
          >
            <X class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.DevicesCardDeny)}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="vault-access-request-approve"
            disabled={isBusy || answering}
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
