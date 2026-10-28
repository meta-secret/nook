/** Nook's matte-steel look as Tailwind classes: graphite surfaces, hairlines,
 * square corners, mono labels, a titanium accent. */
export const ui = {
  page: 'min-h-svh bg-[#0b0c0d] text-[#e9e8e4]',
  title: 'text-[26px] leading-tight font-semibold tracking-tight',
  panelTitle: 'text-[20px] leading-tight font-semibold tracking-tight',
  label: 'font-mono text-[11px] tracking-[0.16em] text-[#80858c] uppercase',
  link: 'text-[13px] text-[#9aa0a8] underline decoration-[#4a5058] underline-offset-4 hover:text-[#e9e8e4]',
  input:
    'h-11 w-full border border-[#2c3035] bg-[#0e1012] px-3 text-[15px] text-[#e9e8e4] outline-none focus:border-[#8fa3c0]',
  grid: 'grid gap-3 sm:grid-cols-2',
} as const
