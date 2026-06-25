<script lang="ts">
  import {
    ChevronDown,
    ShieldCheck,
    Smartphone,
    UserPlus,
    X,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    open,
    variant,
    deviceId = '',
    isBusy = false,
    enrollSecretsKey = $bindable(),
    enrollMembersKey = $bindable(),
    onConfirm,
    onEnrollWithKeys,
    onCreateFreshVault,
    onCancel,
  }: {
    vault: VaultState
    open: boolean
    variant: 'needs_request' | 'pending'
    deviceId?: string
    isBusy?: boolean
    enrollSecretsKey: string
    enrollMembersKey: string
    onConfirm?: () => void | Promise<void>
    onEnrollWithKeys?: () => void | Promise<void>
    onCreateFreshVault?: () => void | Promise<void>
    onCancel: () => void
  } = $props()

  let showTransferKeys = $state(false)

  function truncate(value: string, head = 10, tail = 8) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="join-enrollment-title"
    data-testid="join-enrollment-dialog"
  >
    <button
      type="button"
      class="absolute inset-0 bg-background/80 backdrop-blur-sm"
      aria-label={vault.t('common.cancel')}
      onclick={onCancel}
    ></button>

    <Card
      class="relative z-10 w-full max-w-md border-border bg-card shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-200"
    >
      <CardHeader class="border-b border-border/60 pb-4">
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1">
            <CardTitle
              id="join-enrollment-title"
              class="text-lg font-semibold tracking-tight text-foreground inline-flex items-center gap-2"
            >
              {#if variant === 'needs_request'}
                <UserPlus class="size-4 shrink-0" />
                {vault.t('join_enrollment.title_join')}
              {:else}
                <ShieldCheck class="size-4 shrink-0" />
                {vault.t('join_enrollment.title_pending')}
              {/if}
            </CardTitle>
            <CardDescription class="text-pretty">
              {#if variant === 'needs_request'}
                {vault.t('join_enrollment.desc_join')}
              {:else}
                {vault.t('join_enrollment.desc_pending')}
              {/if}
            </CardDescription>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={vault.t('common.cancel')}
            data-testid="join-enrollment-close"
            onclick={onCancel}
          >
            <X class="size-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent class="space-y-4 pt-4">
        {#if deviceId}
          <div
            class="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs"
            data-testid="join-enrollment-device"
          >
            <p
              class="font-medium text-foreground inline-flex items-center gap-1.5"
            >
              <Smartphone class="size-3.5" />
              {vault.t('join_enrollment.this_browser')}
            </p>
            <p class="mt-1 font-mono text-muted-foreground">
              {truncate(deviceId)}
            </p>
          </div>
        {/if}

        {#if variant === 'needs_request'}
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-muted-foreground text-pretty"
            data-testid="join-enrollment-explainer"
          >
            <li>
              {vault.t('join_enrollment.explainer_item1')}
            </li>
            <li>
              {vault.t('join_enrollment.explainer_item2')}
            </li>
            <li>
              {vault.t('join_enrollment.explainer_item3')}
            </li>
            <li>
              {vault.t('join_enrollment.explainer_item4')}
            </li>
          </ul>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              class="border-border"
              disabled={isBusy}
              data-testid="join-enrollment-cancel"
              onclick={onCancel}
            >
              {vault.t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              data-testid="join-enrollment-confirm"
              onclick={() => void onConfirm?.()}
            >
              {#if isBusy}
                {vault.t('join_enrollment.sending')}
              {:else}
                {vault.t('join_enrollment.send_request')}
              {/if}
            </Button>
          </div>

          {#if onEnrollWithKeys}
            <div class="rounded-lg border border-border bg-muted/20">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                data-testid="enroll-dec-toggle"
                aria-expanded={showTransferKeys}
                onclick={() => (showTransferKeys = !showTransferKeys)}
              >
                <span>{vault.t('join_enrollment.have_transfer_keys')}</span>
                <ChevronDown
                  class="size-3.5 shrink-0 transition-transform {showTransferKeys
                    ? 'rotate-180'
                    : ''}"
                />
              </button>

              {#if showTransferKeys}
                <div class="space-y-2 border-t border-border px-3 py-3">
                  <p class="text-[11px] leading-relaxed text-muted-foreground">
                    {vault.t('join_enrollment.transfer_keys_desc')}
                  </p>
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-secrets-key"
                  >
                    {vault.t('join_enrollment.secrets_key')}
                  </label>
                  <input
                    id="enroll-secrets-key"
                    type="password"
                    bind:value={enrollSecretsKey}
                    placeholder={vault.t(
                      'join_enrollment.secrets_key_placeholder',
                    )}
                    autocomplete="off"
                    data-testid="enroll-secrets-key-input"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-members-key"
                  >
                    {vault.t('join_enrollment.members_key')}
                  </label>
                  <input
                    id="enroll-members-key"
                    type="password"
                    bind:value={enrollMembersKey}
                    placeholder={vault.t(
                      'join_enrollment.secrets_key_placeholder',
                    )}
                    autocomplete="off"
                    data-testid="enroll-members-key-input"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="w-full border-border"
                    disabled={isBusy ||
                      !enrollSecretsKey.trim() ||
                      !enrollMembersKey.trim()}
                    data-testid="enroll-with-keys-btn"
                    onclick={() => void onEnrollWithKeys()}
                  >
                    {vault.t('join_enrollment.enroll_with_keys')}
                  </Button>
                </div>
              {/if}
            </div>
          {/if}

          {#if onCreateFreshVault}
            <div
              class="rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2"
            >
              <p class="text-xs font-medium text-foreground">
                {vault.t('join_enrollment.setup_from_scratch')}
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                {vault.t('join_enrollment.setup_from_scratch_desc')}
              </p>
              <Button
                type="button"
                variant="outline"
                class="w-full border-border"
                disabled={isBusy}
                data-testid="create-fresh-vault-btn"
                onclick={() => void onCreateFreshVault()}
              >
                {#if isBusy}
                  {vault.t('join_enrollment.creating')}
                {:else}
                  {vault.t('join_enrollment.create_new_vault')}
                {/if}
              </Button>
            </div>
          {/if}
        {:else}
          <p class="text-sm leading-relaxed text-muted-foreground">
            {vault.t('join_enrollment.approve_on_enrolled')}
          </p>
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              data-testid="join-enrollment-dismiss"
              onclick={onCancel}
            >
              {vault.t('join_enrollment.got_it')}
            </Button>
          </div>
          {#if onCreateFreshVault}
            <div
              class="rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2"
            >
              <p class="text-xs font-medium text-foreground">
                {vault.t('join_enrollment.starting_over')}
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                {vault.t('join_enrollment.starting_over_desc')}
              </p>
              <Button
                type="button"
                variant="outline"
                class="w-full border-border"
                disabled={isBusy}
                data-testid="create-fresh-vault-btn"
                onclick={() => void onCreateFreshVault()}
              >
                {#if isBusy}
                  {vault.t('join_enrollment.creating')}
                {:else}
                  {vault.t('join_enrollment.create_new_vault')}
                {/if}
              </Button>
            </div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
{/if}
