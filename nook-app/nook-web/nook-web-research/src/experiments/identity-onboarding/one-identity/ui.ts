/** Nook's blued-gunmetal look as Tailwind classes. Surfaces carry tone
 * instead of outlines; rows are separated by a hairline gap; the one primary
 * is brushed steel with a tanto-cut corner. */
export const ui = {
  page: 'min-h-svh bg-[#0b0c0d] text-[#e9e8e4]',
  /** The app as it would ship: an extension popup or a narrow web window. */
  window: 'relative flex h-[720px] w-[400px] shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#15181b,#101214)]',
  title: 'text-[28px] leading-[1.15] font-semibold tracking-tight text-balance',
  label: 'font-mono text-[11px] tracking-[0.16em] text-[#80858c] uppercase',
  words: 'font-mono text-[12px] text-[#80858c]',
  primary:
    'flex h-12 w-full items-center justify-center gap-2 bg-[linear-gradient(180deg,#d9dbde,#b3b7bc)] text-[15px] font-semibold text-[#0b0c0d] transition [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,0_100%)] hover:brightness-105 disabled:opacity-60',
  quiet: 'flex h-12 w-full items-center justify-center gap-2 text-[14px] text-[#a4a8ae] transition hover:text-[#e9e8e4]',
  /** A row of a list: tone, no outline. */
  row: 'flex min-h-14 w-full items-center gap-3 bg-[#1a1d20] px-4 py-2.5 text-left',
  rowButton: 'transition hover:bg-[#202428]',
  /** A small action inside a row. */
  action:
    'inline-flex h-8 shrink-0 items-center gap-1.5 bg-[#2a2e33] px-3 text-[13px] font-medium text-[#e9e8e4] transition hover:bg-[#33383e] disabled:opacity-40',
  actionOk: 'inline-flex h-8 shrink-0 items-center gap-1.5 bg-[#24302a] px-3 text-[13px] font-medium text-[#b9dcc1] transition hover:bg-[#2b3a31]',
  /** A choice of provider: a tile with an icon and a name. */
  tile: 'flex aspect-[4/3] flex-col items-start justify-between bg-[#1a1d20] p-4 text-left text-[14px] font-medium transition hover:bg-[#202428]',
  /** Attention without alarm: warm tone, no outline. */
  notice: 'flex min-h-14 w-full items-center gap-3 bg-[#211e18] px-4 py-2.5',
  field:
    'h-12 w-full border-0 border-b border-[#3a3f45] bg-transparent text-center text-[22px] font-semibold text-[#e9e8e4] outline-none focus:border-[#8fa3c0]',
  /** Prototype-only controls inside the app, so they read as the simulator. */
  sim: 'inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-[#d2b07a] uppercase transition hover:text-[#ecc98c]',
} as const
