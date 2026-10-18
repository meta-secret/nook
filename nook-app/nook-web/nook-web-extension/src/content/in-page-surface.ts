/** The Pilot's host element. Other in-page Nook surfaces share its corner. */
export const WIDGET_HOST_ID = 'nook-auth-widget'

/* Every in-page Nook surface speaks the vault app's visual language: dark,
 * a keytag frame with a cut top-right corner, monospace labels, square marks,
 * and green for what is done. Tokens mirror the companion popup; a surface
 * places them inside its `:host` rule. */
export const IN_PAGE_SURFACE_TOKENS = `
      color-scheme: dark;
      --nk-bg: oklch(0.141 0.005 285.823);
      --nk-card: oklch(0.21 0.006 285.885);
      --nk-raised: oklch(0.274 0.006 286.033);
      --nk-fg: oklch(0.985 0 0);
      --nk-muted: oklch(0.705 0.015 286.067);
      --nk-primary: oklch(0.92 0.004 286.32);
      --nk-primary-fg: oklch(0.21 0.006 285.885);
      --nk-border: rgb(255 255 255 / 10%);
      --nk-input: rgb(255 255 255 / 16%);
      --nk-success: oklch(0.765 0.177 163.223);
      --nk-warning: oklch(0.8 0.13 75);
      --nk-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --nk-cut: 18px;
`
