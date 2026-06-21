<script lang="ts">
  import { ShieldCheck, Smartphone, UserPlus, X } from '@lucide/svelte'
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
    onConfirm,
    onCancel,
  }: {
    open: boolean
    variant: 'needs_request' | 'pending'
    deviceId?: string
    isBusy?: boolean
    onConfirm?: () => void | Promise<void>
    onCancel: () => void
  } = $props()

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
            <CardDescription>
              {#if variant === 'needs_request'}
                This browser is not enrolled yet. Send a join request to an
                existing device.
              {:else}
                Your join request was sent. Connect again after an enrolled
                device approves it.
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
              This device
            </p>
            <p class="mt-1 font-mono text-muted-foreground">
              {truncate(deviceId)}
            </p>
          </div>
        {/if}

        {#if variant === 'needs_request'}
          <p class="text-sm leading-relaxed text-muted-foreground">
            An enrolled device will see your request and can approve access.
            Your public key is shared in the vault until approval — no secrets
            are exposed.
          </p>
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
        {:else}
          <p class="text-sm leading-relaxed text-muted-foreground">
            Open Nook on an enrolled device, approve this device in storage
            settings, then click
            <strong class="font-medium text-foreground">Connect vault</strong> here
            again.
          </p>
          <div class="flex justify-end">
            <Button
              type="button"
              data-testid="join-enrollment-dismiss"
              onclick={onCancel}
            >
              Got it
            </Button>
          </div>
        {/if}
      </CardContent>
    </Card>
  </div>
{/if}
