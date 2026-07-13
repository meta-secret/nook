<script lang="ts">
  import { onMount } from 'svelte'

  let { compact = false }: { compact?: boolean } = $props()

  type Signal = {
    id: number
    label: string
    slot: number
    driftX: number
    driftY: number
    duration: number
    delay: number
    changing: boolean
  }

  const terms = ['AGE', 'X25519', 'KDF', 'PASSKEY', 'ED25519', 'AEAD', 'DAG']
  const slots = [
    { x: 94, y: 14, shiftX: -100 },
    { x: 86, y: 29, shiftX: -100 },
    { x: 97, y: 72, shiftX: -100 },
    { x: 87, y: 87, shiftX: -100 },
    { x: 4, y: 48, shiftX: 0 },
    { x: 13, y: 68, shiftX: 0 },
  ]
  const slotSectors = [
    [0, 1],
    [2, 3],
    [4, 5],
  ]
  let signals = $state<Signal[]>([
    signal(0, 'AGE', 0),
    signal(1, 'X25519', 2),
    signal(2, 'KDF', 4),
  ])

  function randomBetween(min: number, max: number) {
    return min + Math.random() * (max - min)
  }

  function signal(id: number, label: string, slot: number): Signal {
    return {
      id,
      label,
      slot,
      driftX: Math.round(randomBetween(-11, 11)),
      driftY: Math.round(randomBetween(-9, 9)),
      duration: randomBetween(7, 12),
      delay: -randomBetween(0, 6),
      changing: false,
    }
  }

  function signalStyle(item: Signal) {
    const position = slots[item.slot]
    return [
      `--signal-x:${position.x}%`,
      `--signal-y:${position.y}%`,
      `--signal-shift-x:${position.shiftX}%`,
      `--signal-drift-x:${item.driftX}px`,
      `--signal-drift-y:${item.driftY}px`,
      `--signal-duration:${item.duration.toFixed(2)}s`,
      `--signal-delay:${item.delay.toFixed(2)}s`,
    ].join(';')
  }

  onMount(() => {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reduceMotion || compact) return

    const timers: number[] = []

    function later(callback: () => void, delay: number) {
      const timeout = window.setTimeout(() => {
        const index = timers.indexOf(timeout)
        if (index >= 0) timers.splice(index, 1)
        callback()
      }, delay)
      timers.push(timeout)
    }

    function schedule(item: Signal, initial = false) {
      later(
        () => rotate(item),
        initial
          ? 1300 + item.id * 1050 + randomBetween(0, 450)
          : 4800 + randomBetween(0, 3700),
      )
    }

    function rotate(item: Signal) {
      if (document.hidden) {
        schedule(item)
        return
      }

      item.changing = true
      later(() => {
        const visibleTerms = new Set(
          signals.map((candidate) => candidate.label),
        )
        const availableTerms = terms.filter((term) => !visibleTerms.has(term))
        const sector = slotSectors[item.id]
        const availableSlots = sector.filter((slot) => slot !== item.slot)
        item.label =
          availableTerms[Math.floor(Math.random() * availableTerms.length)] ??
          item.label
        item.slot =
          availableSlots[Math.floor(Math.random() * availableSlots.length)] ??
          item.slot
        item.driftX = Math.round(randomBetween(-11, 11))
        item.driftY = Math.round(randomBetween(-9, 9))
        item.duration = randomBetween(7, 12)
        item.delay = -randomBetween(0, 6)
        item.changing = false
        schedule(item)
      }, 420)
    }

    for (const item of signals) schedule(item, true)

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  })
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
    class="vault-capsule absolute inset-[29%] rounded-full bg-gradient-to-br from-white via-[#e5e8eb] to-[#aeb6be] shadow-[0_18px_38px_rgb(55_64_72/0.24)] dark:from-[#343a40] dark:via-[#20262b] dark:to-[#101417]"
  ></div>
  <div
    class="vault-core relative grid size-[29%] place-items-center overflow-hidden rounded-full border border-white/20 bg-[#141719] shadow-[inset_0_0_14px_rgb(0_0_0/0.45)]"
  >
    <img
      src="/nook-logo-dark.png"
      alt=""
      class="size-[82%] rounded-full object-cover"
    />
  </div>

  {#if !compact}
    {#each signals as item (item.id)}
      <div
        class:signal-changing={item.changing}
        class="vault-signal absolute z-10 flex items-center gap-1.5 rounded-full border border-[#565c60] bg-[#292d30]/95 px-2.5 py-1 font-mono text-[8px] tracking-[0.15em] text-[#d5d9dc] shadow-lg backdrop-blur-sm"
        style={signalStyle(item)}
        data-testid={`vault-security-signal-${item.id}`}
      >
        <span
          class="size-1.5 rounded-full bg-[#66d49b] shadow-[0_0_0_4px_rgb(102_212_155/0.12)]"
        ></span>
        {item.label}
      </div>
    {/each}
  {/if}
</div>

<style>
  .vault-capsule,
  .vault-core {
    animation: vault-breathe 7s ease-in-out infinite;
  }

  .vault-signal {
    top: var(--signal-y);
    left: var(--signal-x);
    opacity: 1;
    transform: translate(var(--signal-shift-x), -50%);
    transition:
      opacity 420ms ease,
      filter 420ms ease;
    animation: signal-float var(--signal-duration) ease-in-out
      var(--signal-delay) infinite alternate;
    will-change: transform, opacity;
  }

  .vault-signal.signal-changing {
    filter: blur(4px);
    opacity: 0;
  }

  @keyframes vault-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1);
    }
    50% {
      transform: translateY(-3px) scale(1.015);
    }
  }

  @keyframes signal-float {
    0% {
      transform: translate(var(--signal-shift-x), -50%) translate(0, 0);
    }
    100% {
      transform: translate(var(--signal-shift-x), -50%)
        translate(var(--signal-drift-x), var(--signal-drift-y));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .vault-capsule,
    .vault-core,
    .vault-signal {
      animation: none;
      transition: none;
    }
  }
</style>
