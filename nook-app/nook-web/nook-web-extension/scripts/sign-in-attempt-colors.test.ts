import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import {
  ColorProperty,
  ParsedColorKind,
  SignInPageColorReader,
  type ColorProjection,
} from '../src/content/autofill/sign-in-attempt-colors'

type PaintedPixel = readonly [number, number, number, number]

/** A browser whose computed colour uses a modern syntax and whose canvas paints one pixel. */
class PaintingBrowser {
  static create(request: PaintingBrowserRequest): typeof globalThis {
    const context = {
      fillStyle: '',
      clearRect: () => {},
      fillRect: () => {},
      getImageData: () => ({ data: Uint8ClampedArray.from(request.pixel) }),
    }
    const canvas = { width: 0, height: 0, getContext: () => context }
    const style = { getPropertyValue: () => request.computed }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- a test double standing in for the browser global.
    return Object.assign(Object.create(globalThis), {
      getComputedStyle: () => style,
      document: { createElement: () => canvas },
    })
  }
}
type PaintingBrowserRequest = {
  readonly computed: string
  readonly pixel: PaintedPixel
}

describe('sign-in page colour facts', () => {
  // The stubbed browser never inspects the element it is asked about.
  const browser = new Window()
  const globals: Pick<Window, 'document'> = { document: browser.document }
  Object.assign(globalThis, globals)
  const projection: ColorProjection = {
    element: document.createElement('p'),
    property: ColorProperty.Foreground,
  }

  test('a modern colour syntax is normalised to sRGB by the browser canvas', () => {
    const request: PaintingBrowserRequest = {
      computed: 'oklch(0.55 0.2 25)',
      pixel: [190, 30, 45, 255],
    }
    const reader = new SignInPageColorReader(PaintingBrowser.create(request))
    expect(reader.color(projection)).toEqual({
      kind: ParsedColorKind.Opaque,
      color: { red: 190, green: 30, blue: 45 },
    })
  })

  test('a colour the canvas paints transparent is reported as transparent', () => {
    const request: PaintingBrowserRequest = {
      computed: 'color-mix(in oklab, transparent 100%, red)',
      pixel: [0, 0, 0, 0],
    }
    const reader = new SignInPageColorReader(PaintingBrowser.create(request))
    expect(reader.color(projection)).toEqual({
      kind: ParsedColorKind.Transparent,
    })
  })

  test('rgb and hex values are read directly', () => {
    const rgb: PaintingBrowserRequest = {
      computed: 'rgb(179, 0, 27)',
      pixel: [0, 0, 0, 0],
    }
    expect(
      new SignInPageColorReader(PaintingBrowser.create(rgb)).color(projection),
    ).toEqual({
      kind: ParsedColorKind.Opaque,
      color: { red: 179, green: 0, blue: 27 },
    })
  })
})
