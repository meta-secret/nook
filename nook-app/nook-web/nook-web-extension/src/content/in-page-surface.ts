/** The Pilot's host element. Other in-page Nook surfaces share its corner. */
export const WIDGET_HOST_ID = 'nook-auth-widget'

/* Every in-page Nook surface speaks the vault app's visual language: dark,
 * a keytag frame with a cut top-right corner, monospace labels, square marks,
 * and green for what is done. Tokens mirror the companion popup; a surface
 * places them inside its `:host` rule. */
export const IN_PAGE_SURFACE_TOKENS = `
      color-scheme: dark;
      --nk-bg: oklch(0.14 0.005 260);
      --nk-card: oklch(0.18 0.006 260);
      --nk-raised: oklch(0.25 0.007 260);
      --nk-fg: oklch(0.955 0.003 255);
      --nk-muted: oklch(0.7 0.01 258);
      --nk-primary: oklch(0.91 0.006 250);
      --nk-primary-fg: oklch(0.18 0.006 260);
      --nk-border: rgb(180 186 200 / 12%);
      --nk-input: rgb(255 255 255 / 16%);
      --nk-success: oklch(0.82 0.025 225);
      --nk-warning: oklch(0.8 0.13 75);
      --nk-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --nk-cut: 18px;
`
