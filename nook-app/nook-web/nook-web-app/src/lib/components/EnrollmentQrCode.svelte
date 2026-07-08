<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw } from '@lucide/svelte'
  import QRCodeStyling from 'qr-code-styling'
  import { createEnrollmentQrOptions } from '$lib/enrollment-qr'

  let {
    enrollmentLink,
    loadingLabel,
  }: {
    enrollmentLink: string
    loadingLabel: string
  } = $props()

  let container: HTMLDivElement | undefined
  let qrCode: QRCodeStyling | undefined
  let isReady = $state(false)
  const options = $derived(createEnrollmentQrOptions(enrollmentLink))

  onMount(() => {
    if (!container) return

    qrCode = new QRCodeStyling(options)
    qrCode.append(container)
    isReady = true

    return () => {
      qrCode = undefined
    }
  })

  $effect(() => {
    if (!qrCode) return
    qrCode.update(options)
  })
</script>

<div
  class="relative flex aspect-square w-full max-w-[360px] items-center justify-center rounded-xl border border-border/70 bg-white p-1 shadow-sm shadow-black/10"
  data-testid="enrollment-qr"
  aria-label="Onboarding QR"
>
  <div
    bind:this={container}
    class="h-full w-full overflow-hidden rounded-lg [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:origin-center [&_svg]:scale-[1.18]"
    aria-hidden="true"
  ></div>

  {#if !isReady}
    <div
      class="absolute inset-1 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20"
      data-testid="enrollment-qr-loading"
      role="status"
      aria-live="polite"
    >
      <RefreshCw class="size-8 animate-spin text-muted-foreground" />
      <span class="text-xs text-muted-foreground">{loadingLabel}</span>
    </div>
  {/if}
</div>
