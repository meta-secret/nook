<script lang="ts">
  import type { Snippet } from "svelte";
  import { Check, Copy } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import {
    NO_SLOT_COPY,
    SlotCopyKind,
    SlotSeal,
    SlotWidth,
    type SlotCopy,
  } from "./secret-slot";

  let {
    label,
    seal = SlotSeal.Plain,
    width = SlotWidth.Half,
    mono = false,
    copy = NO_SLOT_COPY,
    testId = "secret-slot",
    children,
    extra,
  }: {
    label: string;
    seal?: SlotSeal;
    width?: SlotWidth;
    mono?: boolean;
    copy?: SlotCopy;
    testId?: string;
    children: Snippet;
    extra?: Snippet;
  } = $props();
</script>

<div
  class={cn(
    "nk-frame-nick nk-slot",
    width === SlotWidth.Full && "nk-slot-wide",
    seal === SlotSeal.Sealed && "nk-slot-sealed",
    seal === SlotSeal.Open && "nk-slot-open",
  )}
  data-seal={seal}
  data-testid={testId}
>
  <span class="nk-slot-label">{label}</span>
  <div
    class={cn(
      "nk-slot-value",
      (mono || seal !== SlotSeal.Plain) && "nk-slot-value-mono",
    )}
  >
    {@render children()}
  </div>
  {#if copy.kind === SlotCopyKind.Available}
    <div class="nk-slot-actions">
      <button
        type="button"
        class="nk-icon-btn"
        aria-label={copy.label}
        title={copy.label}
        onclick={copy.onCopy}
      >
        {#if copy.copied}
          <Check class="size-3.5 text-success" />
        {:else}
          <Copy class="size-3.5" />
        {/if}
      </button>
    </div>
  {/if}
  {#if extra}
    <div class="nk-slot-extra">{@render extra()}</div>
  {/if}
</div>
