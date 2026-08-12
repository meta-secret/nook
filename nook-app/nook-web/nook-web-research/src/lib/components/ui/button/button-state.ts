export enum ButtonVariant {
  Default = 'default',
  Outline = 'outline',
  Ghost = 'ghost',
}

export enum ButtonSize {
  Default = 'default',
  Small = 'sm',
  Large = 'lg',
  Icon = 'icon',
}

const BUTTON_BASE =
  'focus-visible:ring-ring inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4'

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  [ButtonVariant.Default]:
    'bg-primary text-primary-foreground hover:bg-primary/90',
  [ButtonVariant.Outline]:
    'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
  [ButtonVariant.Ghost]: 'hover:bg-accent hover:text-accent-foreground',
}

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  [ButtonSize.Default]: 'h-10 px-4 py-2',
  [ButtonSize.Small]: 'h-9 px-3',
  [ButtonSize.Large]: 'h-11 px-8',
  [ButtonSize.Icon]: 'size-10',
}

type ButtonVariantsArgs = {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function buttonVariants({
  variant = ButtonVariant.Default,
  size = ButtonSize.Default,
}: ButtonVariantsArgs): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_SIZE_CLASSES[size]}`
}
