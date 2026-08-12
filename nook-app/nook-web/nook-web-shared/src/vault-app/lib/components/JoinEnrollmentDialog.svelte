<script lang="ts">
  type IdentityTextTruncation = { readonly value: string; readonly head: number; readonly tail: number }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    ChevronDown,
    ShieldCheck,
    Smartphone,
    UserPlus,
    X,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";

  import type { VaultState } from "$lib/vault.svelte";
  import { JoinEnrollmentDialogVariant } from "./join-enrollment-dialog-state";

  let {
    vault,
    open,
    variant,
    deviceId = "",
    isBusy = false,
    enrollSecretsKey = $bindable(""),
    enrollMembersKey = $bindable(""),
    onConfirm,
    onEnrollWithKeys,
    onCreateFreshVault,
    onCancel,
  }: {
    vault: VaultState;
    open: boolean;
    variant: JoinEnrollmentDialogVariant;
    deviceId?: string;
    isBusy?: boolean;
    enrollSecretsKey: string;
    enrollMembersKey: string;
    onConfirm?: () => void | Promise<void>;
    onEnrollWithKeys?: () => void | Promise<void>;
    onCreateFreshVault?: () => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  let showTransferKeys = $state(false);

  function truncate({ value, head, tail }: IdentityTextTruncation) {
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
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
      aria-label={vault.t(I18N_KEYS.CommonCancel)}
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
              {#if variant === JoinEnrollmentDialogVariant.NeedsRequest}
                <UserPlus class="size-4 shrink-0" />
                {vault.t(I18N_KEYS.JoinEnrollmentTitleJoin)}
              {:else}
                <ShieldCheck class="size-4 shrink-0" />
                {vault.t(I18N_KEYS.JoinEnrollmentTitlePending)}
              {/if}
            </CardTitle>
            <CardDescription class="text-pretty">
              {#if variant === JoinEnrollmentDialogVariant.NeedsRequest}
                {vault.t(I18N_KEYS.JoinEnrollmentDescJoin)}
              {:else}
                {vault.t(I18N_KEYS.JoinEnrollmentDescPending)}
              {/if}
            </CardDescription>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={vault.t(I18N_KEYS.CommonCancel)}
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
              {vault.t(I18N_KEYS.JoinEnrollmentThisBrowser)}
            </p>
            <p class="mt-1 font-mono text-muted-foreground">
              {(() => { const truncateArgs: Parameters<typeof truncate>[0] = { value: deviceId, head: 14, tail: 10 }; return truncate(truncateArgs); })()}
            </p>
          </div>
        {/if}

        {#if variant === JoinEnrollmentDialogVariant.NeedsRequest}
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-muted-foreground text-pretty"
            data-testid="join-enrollment-explainer"
          >
            <li>
              {vault.t(I18N_KEYS.JoinEnrollmentExplainerItem1)}
            </li>
            <li>
              {vault.t(I18N_KEYS.JoinEnrollmentExplainerItem2)}
            </li>
            <li>
              {vault.t(I18N_KEYS.JoinEnrollmentExplainerItem3)}
            </li>
            <li>
              {vault.t(I18N_KEYS.JoinEnrollmentExplainerItem4)}
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
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              data-testid="join-enrollment-confirm"
              onclick={() => void onConfirm?.()}
            >
              {#if isBusy}
                {vault.t(I18N_KEYS.JoinEnrollmentSending)}
              {:else}
                {vault.t(I18N_KEYS.JoinEnrollmentSendRequest)}
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
                <span>{vault.t(I18N_KEYS.JoinEnrollmentHaveTransferKeys)}</span>
                <ChevronDown
                  class="size-3.5 shrink-0 transition-transform {showTransferKeys
                    ? 'rotate-180'
                    : ''}"
                />
              </button>

              {#if showTransferKeys}
                <div class="space-y-2 border-t border-border px-3 py-3">
                  <p class="text-[11px] leading-relaxed text-muted-foreground">
                    {vault.t(I18N_KEYS.JoinEnrollmentTransferKeysDesc)}
                  </p>
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-secrets-key"
                  >
                    {vault.t(I18N_KEYS.JoinEnrollmentSecretsKey)}
                  </label>
                  <input
                    id="enroll-secrets-key"
                    type="password"
                    bind:value={enrollSecretsKey}
                    placeholder={vault.t(
                      I18N_KEYS.JoinEnrollmentSecretsKeyPlaceholder,
                    )}
                    autocomplete="off"
                    data-testid="enroll-secrets-key-input"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-members-key"
                  >
                    {vault.t(I18N_KEYS.JoinEnrollmentMembersKey)}
                  </label>
                  <input
                    id="enroll-members-key"
                    type="password"
                    bind:value={enrollMembersKey}
                    placeholder={vault.t(
                      I18N_KEYS.JoinEnrollmentSecretsKeyPlaceholder,
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
                    {vault.t(I18N_KEYS.JoinEnrollmentEnrollWithKeys)}
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
                {vault.t(I18N_KEYS.JoinEnrollmentSetupFromScratch)}
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                {vault.t(I18N_KEYS.JoinEnrollmentSetupFromScratchDesc)}
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
                  {vault.t(I18N_KEYS.JoinEnrollmentCreating)}
                {:else}
                  {vault.t(I18N_KEYS.JoinEnrollmentCreateNewVault)}
                {/if}
              </Button>
            </div>
          {/if}
        {:else}
          <p class="text-sm leading-relaxed text-muted-foreground">
            {vault.t(I18N_KEYS.JoinEnrollmentApproveOnEnrolled)}
          </p>
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              data-testid="join-enrollment-dismiss"
              onclick={onCancel}
            >
              {vault.t(I18N_KEYS.JoinEnrollmentGotIt)}
            </Button>
          </div>
          {#if onCreateFreshVault}
            <div
              class="rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2"
            >
              <p class="text-xs font-medium text-foreground">
                {vault.t(I18N_KEYS.JoinEnrollmentStartingOver)}
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                {vault.t(I18N_KEYS.JoinEnrollmentStartingOverDesc)}
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
                  {vault.t(I18N_KEYS.JoinEnrollmentCreating)}
                {:else}
                  {vault.t(I18N_KEYS.JoinEnrollmentCreateNewVault)}
                {/if}
              </Button>
            </div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
{/if}
