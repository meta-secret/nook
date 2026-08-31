import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  attachPointerDrag,
  clampMountedWidgetPosition,
  PointerDragBehaviorKind,
} from '../../../../nook-web-extension/src/content/autofill/widget-position'
import {
  WidgetPlacementKind,
  WidgetWorkflowRootKind,
  widgetState,
} from '../../../../nook-web-extension/src/content/autofill/state'
import {
  createWidgetShell,
  mountWidgetShell,
} from '../../../../nook-web-extension/src/content/autofill/widget-shell'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'

afterEach(() => {
  document.body.replaceChildren()
  widgetState.clearRenderedWidget()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('keeps one visible Nook mark across expanded and compact states', () => {
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => key },
    runtime: { getURL: (path: string) => path },
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    callback(0),
  )
  const shell = createWidgetShell({
    copy: {
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      descriptionKey: BROWSER_MESSAGE_KEYS.WidgetLoginDescription,
    },
    currentStep: 1,
    totalSteps: 2,
  })
  mountWidgetShell({
    shell,
    workflowKey: 'login',
    workflowRoot: { kind: WidgetWorkflowRootKind.Unassigned },
  })

  expect([...shell.body.children].slice(0, 4)).toEqual([
    shell.nookMark,
    shell.title,
    shell.description,
    shell.continueButton,
  ])
  shell.collapseButton.click()
  expect(shell.nookMark.parentElement).toBe(shell.collapsedLaunch)
  shell.collapsedLaunch.click()
  expect(shell.nookMark.parentElement).toBe(shell.body)
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
  function tappableWidget() {
    const host = document.createElement('div')
    const handle = document.createElement('button')
    handle.className = 'collapsed-launch'
    host.append(handle)
    const onTap = vi.fn()
    attachPointerDrag({
      host,
      handle,
      behavior: { kind: PointerDragBehaviorKind.Tappable, onTap },
    })
    return { handle, onTap }
  }

  test('uses the native click path for synthetic button activation', () => {
    const { handle, onTap } = tappableWidget()
    handle.click()

    expect(onTap).toHaveBeenCalledOnce()
  })

  test('suppresses the click generated after a drag', () => {
    const { handle, onTap } = tappableWidget()
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => false)

    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    )
    handle.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 7,
        clientX: 40,
        clientY: 40,
      }),
    )
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    handle.click()

    expect(onTap).not.toHaveBeenCalled()
  })
})
