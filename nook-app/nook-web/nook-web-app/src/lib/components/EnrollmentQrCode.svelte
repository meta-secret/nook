<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw } from '@lucide/svelte'
  import QRCodeStyling from 'qr-code-styling'
  import {
    createEnrollmentQrOptions,
    enrollmentQrSize,
  } from '$lib/enrollment-qr'

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
  class="relative flex items-center justify-center rounded-lg border border-border/70 bg-white p-2 shadow-sm shadow-black/10"
  style={`width: ${enrollmentQrSize}px; height: ${enrollmentQrSize}px;`}
  data-testid="enrollment-qr"
  aria-label="Onboarding QR"
>
  <div
    bind:this={container}
    class="h-full w-full overflow-hidden rounded-md [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
    aria-hidden="true"
  ></div>

  {#if !isReady}
    <div
      class="absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted/20"
      data-testid="enrollment-qr-loading"
      role="status"
      aria-live="polite"
    >
      <RefreshCw class="size-8 animate-spin text-muted-foreground" />
      <span class="text-xs text-muted-foreground">{loadingLabel}</span>
    </div>
  {/if}
</div>
