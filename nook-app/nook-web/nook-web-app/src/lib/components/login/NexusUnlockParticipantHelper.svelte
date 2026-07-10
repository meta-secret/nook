<script lang="ts">
  import { onMount } from 'svelte'
  import { Copy, KeyRound, RefreshCw, Users } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Select from '$lib/components/ui/select'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    disabled = false,
    expanded = false,
    showWhenEmpty = false,
  }: {
    vault: VaultState
    disabled?: boolean
    expanded?: boolean
    showWhenEmpty?: boolean
  } = $props()

  let actionBusy = $state(false)
  let loaded = $state(false)
  let open = $state(false)
  let selectedDelivery = $state<string | undefined>(undefined)
  let request = $state('')
  let response = $state('')
  let copied = $state(false)

  const visible = $derived(
    showWhenEmpty || (loaded && vault.nexusStoredDeliveries.length > 0),
  )
  const selectedSummary = $derived(
    vault.nexusStoredDeliveries.find(
      (delivery) => delivery.storeId === selectedDelivery,
    ),
  )

  $effect(() => {
    if (expanded) open = true
  })

  onMount(() => {
    void refreshDeliveries()
  })

  async function refreshDeliveries() {
    try {
      const deliveries = await vault.listNexusStoredDeliveries()
      if (
        !selectedDelivery ||
        !deliveries.some((delivery) => delivery.storeId === selectedDelivery)
      ) {
        selectedDelivery = deliveries[0]?.storeId
      }
    } catch {
      // A missing device identity or empty list simply hides the first-vault helper.
    } finally {
      loaded = true
    }
  }

  async function createResponse() {
    const storeId = selectedDelivery?.trim()
    const payload = request.trim()
    if (!storeId || !payload || actionBusy) return
    actionBusy = true
    vault.errorMsg = ''
    try {
      response = await vault.createNexusUnlockResponse(storeId, payload)
    } catch (error: unknown) {
      vault.errorMsg =
        error instanceof Error
          ? vault.resolveErrorMessage(error.message)
          : vault.t('architecture_modes.nexus_unlock_failed')
    } finally {
      actionBusy = false
    }
  }

  async function copyResponse() {
    if (!response.trim()) return
    try {
      await navigator.clipboard.writeText(response)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      vault.errorMsg = vault.t('architecture_modes.nexus_ceremony_copy_failed')
    }
  }
</script>

{#if visible}
  <div class="space-y-3" data-testid="nexus-unlock-participant-helper">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="nexus-unlock-participant-toggle"
      aria-expanded={open}
      {disabled}
      onclick={() => {
        open = !open
        if (open) void refreshDeliveries()
      }}
    >
      <span class="flex items-center gap-2">
        <Users class="size-4 text-primary" />
        {vault.t('architecture_modes.nexus_unlock_help_title')}
      </span>
      <span class="text-xs text-muted-foreground">{open ? '−' : '+'}</span>
    </button>

    {#if open}
      <div
        class="space-y-4 rounded-md border border-border/60 bg-background/40 p-3"
      >
        <p class="text-sm leading-snug text-pretty text-muted-foreground">
          {vault.t('architecture_modes.nexus_unlock_help_description')}
        </p>

        {#if !loaded}
          <div
            class="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <RefreshCw class="size-4 animate-spin" />
            {vault.t('common.loading')}
          </div>
        {:else if vault.nexusStoredDeliveries.length === 0}
          <p
            class="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
            data-testid="nexus-unlock-no-deliveries"
          >
            {vault.t('architecture_modes.nexus_unlock_no_deliveries')}
          </p>
        {:else}
          <div class="space-y-2">
            <label
              class="text-xs font-medium text-foreground"
              for="nexus-delivery-select"
            >
              {vault.t('architecture_modes.nexus_unlock_delivery_label')}
            </label>
            <Select.Root
              type="single"
              value={selectedDelivery}
              onValueChange={(value) => (selectedDelivery = value)}
            >
              <Select.Trigger
                id="nexus-delivery-select"
                class="h-10 w-full bg-background px-3"
                data-testid="nexus-unlock-delivery-select"
              >
                {selectedSummary?.storeId ??
                  vault.t(
                    'architecture_modes.nexus_unlock_delivery_placeholder',
                  )}
              </Select.Trigger>
              <Select.Content portalProps={{ disabled: true }}>
                {#each vault.nexusStoredDeliveries as delivery (delivery.storeId)}
                  <Select.Item
                    value={delivery.storeId}
                    data-testid={`nexus-unlock-delivery-${delivery.storeId}`}
                  >
                    {delivery.storeId} · {delivery.policy.threshold}/{delivery
                      .policy.participantCount}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <div class="space-y-2">
            <label
              class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              for="nexus-participant-request"
            >
              {vault.t('architecture_modes.nexus_unlock_paste_request')}
            </label>
            <textarea
              id="nexus-participant-request"
              class="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="nexus-unlock-participant-request-input"
              placeholder={vault.t(
                'architecture_modes.nexus_unlock_paste_request_placeholder',
              )}
              disabled={disabled || actionBusy}
              bind:value={request}></textarea>
            <Button
              type="button"
              variant="outline"
              data-testid="nexus-unlock-create-response-btn"
              disabled={disabled ||
                actionBusy ||
                !selectedDelivery ||
                !request.trim()}
              onclick={() => void createResponse()}
            >
              {#if actionBusy}
                <RefreshCw class="size-4 animate-spin" />
              {:else}
                <KeyRound class="size-4" />
              {/if}
              {vault.t('architecture_modes.nexus_unlock_create_response')}
            </Button>
          </div>

          {#if response}
            <div
              class="grid gap-4 border-t border-border/60 pt-4 md:grid-cols-[minmax(180px,240px)_1fr]"
              data-testid="nexus-unlock-generated-response"
            >
              <EnrollmentQrCode
                enrollmentLink={response}
                loadingLabel={vault.t(
                  'architecture_modes.nexus_unlock_qr_loading',
                )}
              />
              <div class="min-w-0 space-y-2">
                <label
                  class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                  for="nexus-participant-response"
                >
                  {vault.t(
                    'architecture_modes.nexus_unlock_generated_response',
                  )}
                </label>
                <textarea
                  id="nexus-participant-response"
                  class="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground"
                  readonly
                  data-testid="nexus-unlock-generated-response-output"
                  value={response}></textarea>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="nexus-unlock-copy-response-btn"
                  onclick={() => void copyResponse()}
                >
                  <Copy class="size-4" />
                  {copied
                    ? vault.t('architecture_modes.nexus_ceremony_copied')
                    : vault.t('architecture_modes.nexus_unlock_copy_response')}
                </Button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
