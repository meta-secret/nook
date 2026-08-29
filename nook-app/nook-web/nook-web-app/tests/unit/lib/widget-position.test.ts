import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  attachPointerDrag,
  clampMountedWidgetPosition,
  PointerDragBehaviorKind,
} from '../../../../nook-web-extension/src/content/autofill/widget-position'
import {
  WidgetPlacementKind,
  widgetState,
} from '../../../../nook-web-extension/src/content/autofill/state'

afterEach(() => {
  document.body.replaceChildren()
  widgetState.clearRenderedWidget()
  vi.restoreAllMocks()
})

describe('Pilot viewport placement', () => {
  test('clamps a mounted widget inside a smaller viewport', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200)
    const host = document.createElement('div')
    Object.defineProperty(host, 'offsetWidth', {
      configurable: true,
      value: 120,
    })
    Object.defineProperty(host, 'offsetHeight', {
      configurable: true,
      value: 80,
    })
    document.body.append(host)
    widgetState.attachHost(host)
    widgetState.setPosition({ left: 500, top: 400 })

    clampMountedWidgetPosition()

    expect(host.style.left).toBe('172px')
    expect(host.style.top).toBe('112px')
    expect(widgetState.placement).toEqual({
      kind: WidgetPlacementKind.Positioned,
      position: { left: 172, top: 112 },
    })
  })
})

describe('compact Pilot activation', () => {
  test('uses the native click path for synthetic button activation', () => {
    const host = document.createElement('div')
    const handle = document.createElement('button')
    handle.className = 'collapsed-launch'
    host.append(handle)
    document.body.append(host)
    const onTap = vi.fn()
    const request: Parameters<typeof attachPointerDrag>[0] = {
      host,
      handle,
      behavior: { kind: PointerDragBehaviorKind.Tappable, onTap },
    }

    attachPointerDrag(request)
    handle.click()

    expect(onTap).toHaveBeenCalledOnce()
  })

  test('suppresses the click generated after a drag', () => {
    const host = document.createElement('div')
    const handle = document.createElement('button')
    handle.className = 'collapsed-launch'
    host.append(handle)
    document.body.append(host)
    const onTap = vi.fn()
    const request: Parameters<typeof attachPointerDrag>[0] = {
      host,
      handle,
      behavior: { kind: PointerDragBehaviorKind.Tappable, onTap },
    }
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => false)

    attachPointerDrag(request)
    const pointerDownInit: PointerEventInit = {
      pointerId: 7,
      button: 0,
      clientX: 10,
      clientY: 10,
    }
    handle.dispatchEvent(new PointerEvent('pointerdown', pointerDownInit))
    const pointerMoveInit: PointerEventInit = {
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    }
    handle.dispatchEvent(new PointerEvent('pointermove', pointerMoveInit))
    const pointerUpInit: PointerEventInit = { pointerId: 7 }
    handle.dispatchEvent(new PointerEvent('pointerup', pointerUpInit))
    handle.click()

    expect(onTap).not.toHaveBeenCalled()
  })
})
