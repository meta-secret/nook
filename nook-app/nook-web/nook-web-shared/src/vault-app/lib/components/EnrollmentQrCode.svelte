<script lang="ts">
  import { onMount } from "svelte";
  import { RefreshCw } from "@lucide/svelte";
  import QRCodeStyling from "qr-code-styling";
  import { createEnrollmentQrOptions } from "$lib/enrollment-qr";
  import {
    QrCodeContainerMountKind,
    QrCodeMountKind,
    type QrCodeContainerMount,
    type QrCodeMount,
  } from "./enrollment-qr-code-state";

  let {
    enrollmentLink,
    loadingLabel,
    dense = false,
  }: {
    enrollmentLink: string;
    loadingLabel: string;
    dense?: boolean;
  } = $props();

  let container = $state<QrCodeContainerMount>({
    kind: QrCodeContainerMountKind.Unmounted,
  });
  let qrCode = $state.raw<QrCodeMount>({ kind: QrCodeMountKind.Unmounted });
  let isReady = $state(false);
  const options = $derived(createEnrollmentQrOptions(enrollmentLink, dense));

  onMount(() => {
    if (container.kind === QrCodeContainerMountKind.Unmounted) return;

    const instance = new QRCodeStyling(options);
    qrCode = { kind: QrCodeMountKind.Mounted, instance };
    instance.append(container.element);
    isReady = true;

    return () => {
      qrCode = { kind: QrCodeMountKind.Unmounted };
    };
  });

  function captureContainer(element: HTMLDivElement) {
    container = { kind: QrCodeContainerMountKind.Mounted, element };
    return {
      destroy() {
        container = { kind: QrCodeContainerMountKind.Unmounted };
      },
    };
  }

  $effect(() => {
    if (qrCode.kind === QrCodeMountKind.Unmounted) return;
    qrCode.instance.update(options);
  });
</script>

<div
  class="enrollment-qr-surface relative flex aspect-square w-full max-w-[360px] items-center justify-center rounded-xl border border-border/70 bg-white p-2 shadow-sm shadow-black/10"
  data-testid="enrollment-qr"
  aria-label="Onboarding QR"
>
  <div
    use:captureContainer
    class="h-full w-full overflow-hidden rounded-lg bg-white [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:origin-center [&_svg]:scale-[1.1]"
    aria-hidden="true"
  ></div>

  {#if !isReady}
    <div
      class="absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20"
      data-testid="enrollment-qr-loading"
      role="status"
      aria-live="polite"
    >
      <RefreshCw class="size-8 animate-spin text-muted-foreground" />
      <span class="text-xs text-muted-foreground">{loadingLabel}</span>
    </div>
  {/if}
</div>

<style>
  /*
   * QR scanners need dark modules on a light quiet zone. Mobile browsers that
   * force dark mode otherwise darken the SVG white fill and hide the pattern.
   */
  .enrollment-qr-surface {
    color-scheme: light;
    background-color: #ffffff;
  }

  .enrollment-qr-surface :global(svg) {
    color-scheme: light;
    background-color: #ffffff;
    forced-color-adjust: none;
  }
</style>
