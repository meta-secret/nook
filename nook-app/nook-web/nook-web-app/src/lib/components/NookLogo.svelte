<script lang="ts">
  import NookIcon from '../../../../nook-web-shared/src/components/NookIcon.svelte'

  type ColorMode = 'light' | 'dark'
  type LogoSize = 'sm' | 'md' | 'lg'

  let {
    colorMode = 'dark' as ColorMode,
    size = 'sm' as LogoSize,
    class: className = '',
  }: {
    colorMode?: ColorMode
    size?: LogoSize
    class?: string
  } = $props()

  const src = $derived(
    colorMode === 'dark'
      ? '/nook-logo-dark-transparent.png'
      : '/nook-logo-light.png',
  )

  const sizeClass = $derived(
    size === 'lg' ? 'size-24' : size === 'md' ? 'size-14' : 'size-10',
  )
</script>

<div
  class="nook-logo relative inline-flex shrink-0 items-center justify-center {sizeClass} {className}"
  data-testid="nook-logo"
>
  <svg
    class="pointer-events-none absolute size-0 overflow-hidden"
    aria-hidden="true"
  >
    <defs>
      <filter
        id="nook-logo-dark-filter"
        x="-40%"
        y="-40%"
        width="180%"
        height="180%"
        color-interpolation-filters="sRGB"
      >
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="1.05 0 0 0 0.01
                  0 1.05 0 0 0.01
                  0 0 1.08 0 0.02
                  0 0 0 1 0"
          result="boost"
        />
        <feGaussianBlur in="boost" stdDeviation="2.5" result="glow" />
        <feColorMatrix
          in="glow"
          type="matrix"
          values="0 0 0 0 0.12
                  0 0 0 0 0.78
                  0 0 0 0 0.72
                  0 0 0 0.45 0"
          result="tealGlow"
        />
        <feOffset in="tealGlow" dx="0" dy="1" result="glowShift" />
        <feGaussianBlur in="boost" stdDeviation="0.6" result="shadow" />
        <feOffset in="shadow" dx="0" dy="1.5" result="shadowShift" />
        <feColorMatrix
          in="shadowShift"
          type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0.35 0"
          result="dropShadow"
        />
        <feMerge>
          <feMergeNode in="glowShift" />
          <feMergeNode in="dropShadow" />
          <feMergeNode in="boost" />
        </feMerge>
      </filter>

      <filter
        id="nook-logo-light-filter"
        x="-30%"
        y="-30%"
        width="160%"
        height="160%"
        color-interpolation-filters="sRGB"
      >
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="blur" />
        <feOffset in="blur" dx="0" dy="1" result="offset" />
        <feColorMatrix
          in="offset"
          type="matrix"
          values="0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0 0
                  0 0 0 0.18 0"
          result="shadow"
        />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  </svg>

  {#if colorMode === 'dark'}
    <div
      class="pointer-events-none absolute inset-[-20%] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(62,233,214,0.14),transparent_68%)]"
      aria-hidden="true"
    ></div>
  {/if}

  <NookIcon
    {src}
    alt="Nook logo"
    class="relative z-10 size-full object-contain"
    filter={colorMode === 'dark'
      ? 'url(#nook-logo-dark-filter)'
      : 'url(#nook-logo-light-filter)'}
  />
</div>
