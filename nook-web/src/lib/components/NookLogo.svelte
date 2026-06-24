<script lang="ts">
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

  const sizeClass = $derived(
    size === 'lg' ? 'size-24' : size === 'md' ? 'size-14' : 'size-10',
  )

  const bg = $derived(colorMode === 'dark' ? '#111317' : '#ffffff')
  const fg = $derived(colorMode === 'dark' ? '#ffffff' : '#111317')
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
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="glow" />
        <feColorMatrix
          in="glow"
          type="matrix"
          values="0 0 0 0 0.12
                  0 0 0 0 0.78
                  0 0 0 0 0.72
                  0 0 0 0.35 0"
          result="tealGlow"
        />
        <feMerge>
          <feMergeNode in="tealGlow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  </svg>

  {#if colorMode === 'dark'}
    <div
      class="pointer-events-none absolute inset-[-20%] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(62,233,214,0.12),transparent_68%)]"
      aria-hidden="true"
    ></div>
  {/if}

  <svg
    viewBox="0 0 100 100"
    role="img"
    aria-label="Nook logo"
    class="relative z-10 size-full"
    style:filter={colorMode === 'dark' ? 'url(#nook-logo-dark-filter)' : undefined}
  >
    <rect width="100" height="100" rx="20" fill={bg} />
    <path
      stroke={fg}
      stroke-width="4"
      stroke-linejoin="round"
      stroke-linecap="round"
      fill="none"
      d="
        M50 12
        L22 34
        C18 37 16 42 16 47
        L16 72
        C16 77 20 81 25 81
        L38 81
        L38 60
        C38 53.4 43.4 48 50 48
        C56.6 48 62 53.4 62 60
        L62 81
        L75 81
        C80 81 84 77 84 72
        L84 47
        C84 42 82 37 78 34
        Z
      "
    />
    <line
      stroke={fg}
      stroke-width="3"
      stroke-linecap="round"
      x1="50"
      y1="12"
      x2="50"
      y2="30"
    />
    <circle stroke={fg} stroke-width="3" fill="none" cx="50" cy="34" r="4" />
    <line
      stroke={fg}
      stroke-width="2.5"
      stroke-linecap="round"
      x1="30"
      y1="42"
      x2="30"
      y2="62"
    />
    <line
      stroke={fg}
      stroke-width="2.5"
      stroke-linecap="round"
      x1="30"
      y1="46"
      x2="20"
      y2="46"
    />
    <circle fill={fg} cx="18.5" cy="46" r="2.5" />
    <line
      stroke={fg}
      stroke-width="2.5"
      stroke-linecap="round"
      x1="30"
      y1="53"
      x2="20"
      y2="53"
    />
    <circle fill={fg} cx="18.5" cy="53" r="2.5" />
    <line
      stroke={fg}
      stroke-width="2.5"
      stroke-linecap="round"
      x1="30"
      y1="60"
      x2="20"
      y2="60"
    />
    <circle fill={fg} cx="18.5" cy="60" r="2.5" />
    <polyline
      stroke={fg}
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
      points="70,38 70,56 62,64"
    />
    <circle fill={fg} cx="62" cy="66" r="2.5" />
    <circle stroke={fg} stroke-width="2.5" fill="none" cx="70" cy="35" r="3.5" />
  </svg>
</div>
