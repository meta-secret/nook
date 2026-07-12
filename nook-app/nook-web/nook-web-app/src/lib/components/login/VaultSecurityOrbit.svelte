<script lang="ts">
  let { compact = false }: { compact?: boolean } = $props()
</script>

<div
  class={[
    'relative grid shrink-0 place-items-center',
    compact ? 'size-32' : 'size-48',
  ]}
  data-testid={compact ? 'vault-security-orbit-mobile' : 'vault-security-orbit'}
  aria-hidden="true"
>
  <div class="absolute inset-0 rounded-full border border-border/70"></div>
  <div class="absolute inset-[14%] rounded-full border border-border/90"></div>
  <div class="absolute inset-[28%] rounded-full border border-border"></div>

  <div
    class="absolute inset-[29%] rounded-full bg-gradient-to-br from-white via-[#e5e8eb] to-[#aeb6be] shadow-[0_18px_38px_rgb(55_64_72/0.24)] dark:from-[#343a40] dark:via-[#20262b] dark:to-[#101417]"
  ></div>
  <div
    class="relative grid size-[29%] place-items-center overflow-hidden rounded-full border border-white/20 bg-[#141719] shadow-[inset_0_0_14px_rgb(0_0_0/0.45)]"
  >
    <img
      src="/nook-logo-dark.png"
      alt=""
      class="size-[82%] rounded-full object-cover"
    />
  </div>

  {#if !compact}
    <div
      class="absolute top-[5%] right-[-5%] flex items-center gap-1.5 rounded-full border border-[#565c60] bg-[#292d30] px-2.5 py-1 font-mono text-[8px] tracking-[0.15em] text-[#d5d9dc] shadow-lg"
    >
      <span
        class="size-1.5 rounded-full bg-[#66d49b] shadow-[0_0_0_4px_rgb(102_212_155/0.12)]"
      ></span>
      AGE
    </div>
    <div
      class="absolute right-[-10%] bottom-[12%] flex items-center gap-1.5 rounded-full border border-[#565c60] bg-[#292d30] px-2.5 py-1 font-mono text-[8px] tracking-[0.15em] text-[#d5d9dc] shadow-lg"
    >
      <span
        class="size-1.5 rounded-full bg-[#66d49b] shadow-[0_0_0_4px_rgb(102_212_155/0.12)]"
      ></span>
      X25519
    </div>
    <div
      class="absolute top-[48%] left-[-8%] flex items-center gap-1.5 rounded-full border border-[#565c60] bg-[#292d30] px-2.5 py-1 font-mono text-[8px] tracking-[0.15em] text-[#d5d9dc] shadow-lg"
    >
      <span
        class="size-1.5 rounded-full bg-[#66d49b] shadow-[0_0_0_4px_rgb(102_212_155/0.12)]"
      ></span>
      KDF
    </div>
  {/if}
</div>
