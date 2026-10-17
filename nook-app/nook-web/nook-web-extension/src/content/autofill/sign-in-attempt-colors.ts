import type { SignInPageColor } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type ColorProjection = {
  readonly element: Element
  readonly property: ColorProperty
}
export enum ColorProperty {
  Foreground = 'color',
  Background = 'background-color',
}
export enum ParsedColorKind {
  Opaque = 'opaque',
  Transparent = 'transparent',
  Unreadable = 'unreadable',
}
enum PainterKind {
  Unprepared = 'unprepared',
  Ready = 'ready',
  Unavailable = 'unavailable',
}
type Painter =
  | { readonly kind: PainterKind.Unprepared }
  | {
      readonly kind: PainterKind.Ready
      readonly context: CanvasRenderingContext2D
    }
  | { readonly kind: PainterKind.Unavailable }
export type ParsedColor =
  | { readonly kind: ParsedColorKind.Opaque; readonly color: SignInPageColor }
  | { readonly kind: ParsedColorKind.Transparent }
  | { readonly kind: ParsedColorKind.Unreadable }

/**
 * Reads a computed text or background color as sRGB facts for Rust. Colors
 * that are transparent, or that the browser cannot paint, are reported as
 * such; nothing here decides what a color means.
 */
export class SignInPageColorReader {
  static readonly PAINT_SETTINGS: CanvasRenderingContext2DSettings = {
    willReadFrequently: true,
  }
  static readonly UNPAINTED = 'rgba(0, 0, 0, 0)'
  private painter: Painter = { kind: PainterKind.Unprepared }

  constructor(private readonly browser: typeof globalThis) {}

  color(projection: ColorProjection): ParsedColor {
    const value = this.browser
      .getComputedStyle(projection.element)
      .getPropertyValue(projection.property)
      .trim()
      .toLowerCase()
    const functional = value.match(
      /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
    )
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
    switch (true) {
      case value === 'transparent':
        return { kind: ParsedColorKind.Transparent }
      case functional instanceof Array:
        return this.functionalColor(functional)
      case hex instanceof Array:
        return this.hexColor(String(hex.at(1)))
      case true:
        break
    }
    return this.paintedColor(value)
  }

  /**
   * Modern color syntaxes (oklch, lab, color(), color-mix) are normalized to
   * sRGB by the browser itself: paint one pixel and read it back.
   */
  private paintedColor(value: string): ParsedColor {
    const context = this.paintContext()
    switch (context) {
      case false:
        return { kind: ParsedColorKind.Unreadable }
      default:
        break
    }
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = SignInPageColorReader.UNPAINTED
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const pixel = context.getImageData(0, 0, 1, 1).data
    switch (pixel[3] === 0) {
      case true:
        return { kind: ParsedColorKind.Transparent }
      case false:
        return {
          kind: ParsedColorKind.Opaque,
          color: {
            red: Number(pixel[0]),
            green: Number(pixel[1]),
            blue: Number(pixel[2]),
          },
        }
    }
  }

  private paintContext(): CanvasRenderingContext2D | false {
    switch (this.painter.kind) {
      case PainterKind.Ready:
        return this.painter.context
      case PainterKind.Unavailable:
        return false
      case PainterKind.Unprepared:
        break
    }
    const canvas = this.browser.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext(
      '2d',
      SignInPageColorReader.PAINT_SETTINGS,
    )
    switch (true) {
      case context instanceof Object:
        this.painter = { kind: PainterKind.Ready, context }
        return context
      case true:
        break
    }
    this.painter = { kind: PainterKind.Unavailable }
    return false
  }

  private functionalColor(channels: RegExpMatchArray): ParsedColor {
    switch (parseFloat(String(channels.at(4))) === 0) {
      case true:
        return { kind: ParsedColorKind.Transparent }
      case false:
        return {
          kind: ParsedColorKind.Opaque,
          color: {
            red: this.channel(String(channels.at(1))),
            green: this.channel(String(channels.at(2))),
            blue: this.channel(String(channels.at(3))),
          },
        }
    }
  }

  private hexColor(hex: string): ParsedColor {
    const full = Array.from(hex)
      .flatMap((digit) => Array<string>(6 / hex.length).fill(digit))
      .join('')
    return {
      kind: ParsedColorKind.Opaque,
      color: {
        red: parseInt(full.slice(0, 2), 16),
        green: parseInt(full.slice(2, 4), 16),
        blue: parseInt(full.slice(4, 6), 16),
      },
    }
  }

  private channel(value: string): number {
    return Math.max(0, Math.min(255, Math.round(parseFloat(value))))
  }
}
