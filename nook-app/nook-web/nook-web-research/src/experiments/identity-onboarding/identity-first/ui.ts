/** Nook's matte-steel look, as Tailwind classes: graphite surfaces, hairlines
 * instead of boxes, square corners, one steel primary, mono labels. */
export const ui = {
  page: 'min-h-svh bg-[#0b0c0d] text-[#e9e8e4]',
  sheet: 'mx-auto w-full max-w-[560px] px-5 pt-24 pb-16',
  label: 'font-mono text-[11px] tracking-[0.18em] text-[#8a8f96] uppercase',
  title: 'text-[26px] leading-tight font-semibold tracking-tight',
  body: 'text-[15px] leading-relaxed text-pretty text-[#a4a8ae]',
  quiet: 'text-[13px] leading-relaxed text-pretty text-[#80858c]',
  plate: 'bg-[#131517] px-5 py-4',
  hairline: 'border-t border-[#24272b]',
  /** A full-width row the user picks from a short list. */
  choice:
    'group flex w-full items-start gap-4 bg-[#131517] px-5 py-4 text-left transition hover:bg-[#181b1e] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#8fa3c0]',
  choiceIcon:
    'grid size-10 shrink-0 place-items-center bg-[#0e1012] text-[#9aa0a8] group-hover:text-[#e9e8e4]',
  /** The one primary action of a screen: brushed steel with a cut corner. */
  primary:
    'inline-flex min-h-11 items-center justify-center gap-2 bg-[linear-gradient(180deg,#d9dbdd,#b9bcc0)] px-6 text-[15px] font-medium text-[#0b0c0d] [clip-path:polygon(0_0,100%_0,100%_calc(100%-12px),calc(100%-12px)_100%,0_100%)] transition hover:brightness-105 disabled:opacity-50',
  secondary:
    'inline-flex min-h-11 items-center justify-center gap-2 border border-[#2c3035] px-5 text-[15px] text-[#d6d5d1] transition hover:border-[#4a5058]',
  link: 'text-[13px] text-[#9aa0a8] underline decoration-[#4a5058] underline-offset-4 hover:text-[#e9e8e4]',
  tag: 'font-mono text-[11px] tracking-[0.12em] text-[#8a8f96] uppercase',
  tagOk: 'font-mono text-[11px] tracking-[0.12em] text-[#9cc3a4] uppercase',
  input:
    'h-11 w-full border border-[#2c3035] bg-[#0e1012] px-3 text-[15px] text-[#e9e8e4] outline-none focus:border-[#8fa3c0]',
} as const
