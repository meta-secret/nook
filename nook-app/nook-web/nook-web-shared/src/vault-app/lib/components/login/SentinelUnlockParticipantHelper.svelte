<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { onMount } from 'svelte'
  import { Copy, KeyRound, RefreshCw, Users } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Select from '$lib/components/ui/select'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    GenesisDeliverySelectionKind,
    type GenesisDeliverySelection,
  } from './sentinel-unlock-participant-state'
  import {
    createSentinelUnlockResponse,
    listSentinelStoredDeliveries,
  } from '$lib/vault/sentinel-unlock'

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
  let selectedDelivery = $state<GenesisDeliverySelection>({
    kind: GenesisDeliverySelectionKind.NotSelected,
  })
  let request = $state('')
  let response = $state('')
  let copied = $state(false)

  const visible = $derived(
    showWhenEmpty || (loaded && vault.sentinelStoredDeliveries.length > 0),
  )
  const selectedSummary = $derived(
    vault.sentinelStoredDeliveries.find(
      (delivery) =>
        selectedDelivery.kind === GenesisDeliverySelectionKind.Selected &&
        delivery.storeId === selectedDelivery.storeId,
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
      const deliveries = await listSentinelStoredDeliveries(vault)
      if (selectedDelivery.kind !== GenesisDeliverySelectionKind.Selected) {
        const firstDelivery = deliveries[0]
        selectedDelivery = firstDelivery
          ? {
              kind: GenesisDeliverySelectionKind.Selected,
              storeId: firstDelivery.storeId,
            }
          : { kind: GenesisDeliverySelectionKind.NotSelected }
        return
      }
      const selectedStoreId = selectedDelivery.storeId
      if (
        !deliveries.some((delivery) => delivery.storeId === selectedStoreId)
      ) {
        const firstDelivery = deliveries[0]
        selectedDelivery = firstDelivery
          ? {
              kind: GenesisDeliverySelectionKind.Selected,
              storeId: firstDelivery.storeId,
            }
          : { kind: GenesisDeliverySelectionKind.NotSelected }
      }
    } catch {
      // A missing device identity or empty list simply hides the first-vault helper.
    } finally {
      loaded = true
    }
  }

  async function createResponse() {
    const storeId =
      selectedDelivery.kind === GenesisDeliverySelectionKind.Selected
        ? selectedDelivery.storeId.trim()
        : ''
    const payload = request.trim()
    if (!storeId || !payload || actionBusy) return
    actionBusy = true
    vault.errorMsg = ''
    try {
      response = await createSentinelUnlockResponse(vault, storeId, payload)
    } catch (error: unknown) {
      vault.errorMsg =
        error instanceof Error
          ? vault.resolveErrorMessage(error.message)
          : vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockFailed)
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
      vault.errorMsg = vault.t(
        I18N_KEYS.ArchitectureModesSentinelCeremonyCopyFailed,
      )
    }
  }
</script>

{#if visible}
  <div class="space-y-3" data-testid="sentinel-unlock-participant-helper">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="sentinel-unlock-participant-toggle"
      aria-expanded={open}
      {disabled}
      onclick={() => {
        open = !open
        if (open) void refreshDeliveries()
      }}
    >
      <span class="flex items-center gap-2">
        <Users class="size-4 text-primary" />
        {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockHelpTitle)}
      </span>
      <span class="text-xs text-muted-foreground">{open ? '−' : '+'}</span>
    </button>

    {#if open}
      <div
        class="space-y-4 rounded-md border border-border/60 bg-background/40 p-3"
      >
        <p class="text-sm leading-snug text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockHelpDescription)}
        </p>

        {#if !loaded}
          <div
            class="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.CommonLoading)}
          </div>
        {:else if vault.sentinelStoredDeliveries.length === 0}
          <p
            class="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
            data-testid="sentinel-unlock-no-deliveries"
          >
            {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockNoDeliveries)}
          </p>
        {:else}
          <div class="space-y-2">
            <label
              class="text-xs font-medium text-foreground"
              for="sentinel-delivery-select"
            >
              {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockDeliveryLabel)}
            </label>
            <Select.Root
              type="single"
              value={selectedDelivery.kind ===
              GenesisDeliverySelectionKind.Selected
                ? selectedDelivery.storeId
                : GenesisDeliverySelectionKind.NotSelected}
              onValueChange={(value) => {
                selectedDelivery =
                  value === GenesisDeliverySelectionKind.NotSelected
                    ? { kind: GenesisDeliverySelectionKind.NotSelected }
                    : {
                        kind: GenesisDeliverySelectionKind.Selected,
                        storeId: value,
                      }
              }}
            >
              <Select.Trigger
                id="sentinel-delivery-select"
                class="h-10 w-full bg-background px-3"
                data-testid="sentinel-unlock-delivery-select"
              >
                {selectedSummary?.storeId ??
                  vault.t(
                    I18N_KEYS.ArchitectureModesSentinelUnlockDeliveryPlaceholder,
                  )}
              </Select.Trigger>
              <Select.Content portalProps={{ disabled: true }}>
                {#each vault.sentinelStoredDeliveries as delivery (delivery.storeId)}
                  <Select.Item
                    value={delivery.storeId}
                    data-testid={`sentinel-unlock-delivery-${delivery.storeId}`}
                  >
                    {delivery.storeId} · {delivery.threshold}/{delivery.participantCount}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <div class="space-y-2">
            <label
              class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              for="sentinel-participant-request"
            >
              {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockPasteRequest)}
            </label>
            <textarea
              id="sentinel-participant-request"
              class="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="sentinel-unlock-participant-request-input"
              placeholder={vault.t(
                I18N_KEYS.ArchitectureModesSentinelUnlockPasteRequestPlaceholder,
              )}
              disabled={disabled || actionBusy}
              bind:value={request}></textarea>
            <Button
              type="button"
              variant="outline"
              data-testid="sentinel-unlock-create-response-btn"
              disabled={disabled ||
                actionBusy ||
                selectedDelivery.kind !==
                  GenesisDeliverySelectionKind.Selected ||
                !request.trim()}
              onclick={() => void createResponse()}
            >
              {#if actionBusy}
                <RefreshCw class="size-4 animate-spin" />
              {:else}
                <KeyRound class="size-4" />
              {/if}
              {vault.t(I18N_KEYS.ArchitectureModesSentinelUnlockCreateResponse)}
            </Button>
          </div>

          {#if response}
            <div
              class="grid gap-4 border-t border-border/60 pt-4 md:grid-cols-[minmax(180px,240px)_1fr]"
              data-testid="sentinel-unlock-generated-response"
            >
              <EnrollmentQrCode
                enrollmentLink={response}
                loadingLabel={vault.t(
                  I18N_KEYS.ArchitectureModesSentinelUnlockQrLoading,
                )}
              />
              <div class="min-w-0 space-y-2">
                <label
                  class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                  for="sentinel-participant-response"
                >
                  {vault.t(
                    I18N_KEYS.ArchitectureModesSentinelUnlockGeneratedResponse,
                  )}
                </label>
                <textarea
                  id="sentinel-participant-response"
                  class="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-snug text-foreground"
                  readonly
                  data-testid="sentinel-unlock-generated-response-output"
                  value={response}></textarea>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="sentinel-unlock-copy-response-btn"
                  onclick={() => void copyResponse()}
                >
                  <Copy class="size-4" />
                  {copied
                    ? vault.t(I18N_KEYS.ArchitectureModesSentinelCeremonyCopied)
                    : vault.t(
                        I18N_KEYS.ArchitectureModesSentinelUnlockCopyResponse,
                      )}
                </Button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
