/** Nook's blued-gunmetal look as Tailwind classes. Surfaces carry tone, not
 * outlines; the one primary of a step is brushed steel with a tanto cut. */
export const ui = {
  page: 'min-h-svh bg-[#0b0c0d] text-[#e9e8e4]',
  panel: 'relative flex min-h-[640px] w-[460px] shrink-0 flex-col bg-[#111315]',
  eyebrow: 'font-mono text-[11px] tracking-[0.18em] text-[#8fa3c0] uppercase',
  title:
    'mt-2 text-[28px] leading-[1.15] font-semibold tracking-tight text-balance',
  sub: 'mt-2 text-[14px] leading-relaxed text-pretty text-[#8a8f96]',
  mono: 'font-mono text-[12px] text-[#80858c]',
  primary:
    'flex h-12 w-full items-center justify-center gap-2 bg-[linear-gradient(180deg,#dcdee1,#b2b6bb)] text-[15px] font-semibold text-[#0b0c0d] transition [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,0_100%)] hover:brightness-105 disabled:opacity-40',
  /** A plate of information: tone only. */
  plate: 'bg-[#181b1e] px-4 py-4',
  input:
    'h-14 w-full border-0 border-b-2 border-[#2c3035] bg-transparent text-[24px] font-semibold text-[#e9e8e4] outline-none placeholder:text-[#3a3f45] focus:border-[#8fa3c0]',
  /** Prototype-only controls inside the panel, so they read as the simulator. */
  sim: 'inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-[#d2b07a] uppercase transition hover:text-[#ecc98c]',
} as const
