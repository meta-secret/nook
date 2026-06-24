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

  let {
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
      aria-label="Close dialog"
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
                Join this vault
              {:else}
                <ShieldCheck class="size-4 shrink-0" />
                Waiting for approval
              {/if}
            </CardTitle>
            <CardDescription class="text-pretty">
              {#if variant === 'needs_request'}
                This browser is not enrolled yet. Join links your device to the
                vault without a central nook account.
              {:else}
                Your join request was sent. Try unlocking again after an
                enrolled device approves you.
              {/if}
            </CardDescription>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
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
              This browser
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
              Join is required so only trusted browsers receive vault keys —
              reading the encrypted file from GitHub is not enough.
            </li>
            <li>
              Send a request;               an enrolled device approves it under
              <strong class="font-medium text-foreground">Vault settings</strong>.
            </li>
            <li>
              Approval wraps the vault keys for this browser’s public key — no
              plaintext secrets are shared.
            </li>
            <li>
              More enrolled devices mean more recovery paths if one browser is
              lost.
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
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              data-testid="join-enrollment-confirm"
              onclick={() => void onConfirm?.()}
            >
              {#if isBusy}
                Sending…
              {:else}
                Send join request
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
                <span>Have transfer keys from another device?</span>
                <ChevronDown
                  class="size-3.5 shrink-0 transition-transform {showTransferKeys
                    ? 'rotate-180'
                    : ''}"
                />
              </button>

              {#if showTransferKeys}
                <div class="space-y-2 border-t border-border px-3 py-3">
                  <p class="text-[11px] leading-relaxed text-muted-foreground">
                    Paste the two keys copied from an enrolled device. This
                    skips the approval step — only use if you already received
                    them out of band.
                  </p>
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-secrets-key"
                  >
                    Secrets key
                  </label>
                  <input
                    id="enroll-secrets-key"
                    type="password"
                    bind:value={enrollSecretsKey}
                    placeholder="64-character hex key"
                    autocomplete="off"
                    data-testid="enroll-secrets-key-input"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <label
                    class="text-xs font-medium text-muted-foreground"
                    for="enroll-members-key"
                  >
                    Members key
                  </label>
                  <input
                    id="enroll-members-key"
                    type="password"
                    bind:value={enrollMembersKey}
                    placeholder="64-character hex key"
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
                    Enroll with transfer keys
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
                Setting up from scratch?
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                If you cleared this browser and remote storage, create a new
                vault here. This replaces any existing vault file with a fresh
                one for this browser.
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
                  Creating…
                {:else}
                  Create new vault
                {/if}
              </Button>
            </div>
          {/if}
        {:else}
          <p class="text-sm leading-relaxed text-muted-foreground">
            Open Nook on an enrolled device, approve this browser in
            <strong class="font-medium text-foreground">Vault settings</strong>,
            then unlock again here.
          </p>
          <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              data-testid="join-enrollment-dismiss"
              onclick={onCancel}
            >
              Got it
            </Button>
          </div>
          {#if onCreateFreshVault}
            <div
              class="rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2"
            >
              <p class="text-xs font-medium text-foreground">
                Starting over instead?
              </p>
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                Create a new vault if you reset storage and no longer have an
                enrolled device to approve this browser.
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
                  Creating…
                {:else}
                  Create new vault
                {/if}
              </Button>
            </div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
{/if}
